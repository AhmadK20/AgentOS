import express from 'express';
import { resolve, join } from 'node:path';
import { existsSync } from 'node:fs';
import { openStore } from './store.mjs';
import { discoverProfiles, hermesRoot, profileDirectory, readMemory } from './hermes.mjs';
import { HermesACP } from './acp.mjs';

const tidy = (value, max = 12000) => typeof value === 'string' ? value.trim().slice(0, max) : '';
const stripSecrets = text => String(text)
  .replace(/\b(?:sk-|ghp_|github_pat_|eyJ)[A-Za-z0-9_.-]{16,}/g, '[redacted]')
  .replace(/(bearer\s+)[A-Za-z0-9_.-]+/gi, '$1[redacted]')
  .replace(/((?:api[_-]?key|access[_-]?token|refresh[_-]?token|password|secret)\s*[=:]\s*)[^\s,;]+/gi, '$1[redacted]');
function redactPayload(value) {
  if (typeof value === 'string') return stripSecrets(value);
  if (Array.isArray(value)) return value.map(redactPayload);
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([key, item]) =>
    [key, /^(api[_-]?key|access[_-]?token|refresh[_-]?token|password|secret|authorization)$/i.test(key) ? '[redacted]' : redactPayload(item)]));
  return value;
}

export function createApp(options = {}) {
  const workspace = resolve(options.workspace || process.env.AGENTOS_WORKSPACE || process.cwd());
  const root = options.hermesRoot || hermesRoot;
  const store = openStore(options.dataDir || process.env.AGENTOS_DATA_DIR || join(process.cwd(), '.data'));
  const runtimeFactory = options.runtimeFactory || (args => new HermesACP(args));
  const limit = Math.max(1, Math.min(8, Number(process.env.AGENTOS_MAX_CONCURRENT) || 3));
  const runTimeout = Number(options.runTimeout || process.env.AGENTOS_RUN_TIMEOUT_MS) || 900000;
  const streams = new Set();
  const clients = new Map();
  const active = new Map();
  const approvals = new Map();
  let cachedProfiles = null;
  let profileCacheAt = 0;
  let shuttingDown = false;
  const app = express();
  app.disable('x-powered-by');
  app.use((req, res, next) => {
    const hostname = req.hostname;
    if (!['127.0.0.1', 'localhost', '[::1]', '::1'].includes(hostname)) {
      return res.status(403).json({ error: 'AgentOS is a local workspace. Connect through localhost or an SSH tunnel.' });
    }
    if (!['GET', 'HEAD', 'OPTIONS'].includes(req.method) && req.headers.origin) {
      let origin;
      try { origin = new URL(req.headers.origin); } catch { return res.status(403).json({ error: 'Invalid origin' }); }
      const permitted = options.allowedOrigins || [
        `http://${req.get('host')}`, 'http://127.0.0.1:5173', 'http://localhost:5173',
      ];
      if (!permitted.includes(origin.origin)) return res.status(403).json({ error: 'Cross-origin actions are not allowed' });
    }
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Referrer-Policy', 'same-origin');
    res.setHeader('X-Frame-Options', 'DENY');
    next();
  });
  app.use(express.json({ limit: '256kb' }));

  function publish(type, payload = {}, runId = null, threadId = null) {
    const event = store.event(type, payload, runId, threadId);
    for (const res of streams) {
      if (!res.write(`id: ${event.id}\ndata: ${JSON.stringify(event)}\n\n`)) {
        res.end(); streams.delete(res);
      }
    }
    return event;
  }
  async function profiles(refresh = false) {
    if (refresh || !cachedProfiles || Date.now() - profileCacheAt > 30000) {
      cachedProfiles = await discoverProfiles(root);
      profileCacheAt = Date.now();
    }
    return cachedProfiles;
  }
  async function requireProfile(id) {
    const found = (await profiles()).find(item => item.id === id);
    if (!found) throw Object.assign(new Error('Hermes profile not found'), { status: 404 });
    return found;
  }
  function newThread(profile, title) {
    const id = store.id(), now = store.now();
    store.db.prepare('INSERT INTO threads(id,profile,title,created_at,updated_at) VALUES(?,?,?,?,?)')
      .run(id, profile, title || 'New conversation', now, now);
    publish('thread_created', { id }, null, id);
    return store.getThread(id);
  }
  function addMessage(threadId, role, content) {
    const id = store.id();
    store.db.prepare('INSERT INTO messages(id,thread_id,role,content,created_at) VALUES(?,?,?,?,?)')
      .run(id, threadId, role, content, store.now());
    return id;
  }
  function expireApprovals(runId) {
    for (const [id, approval] of approvals) if (approval.runId === runId) {
      try { approval.client.answerPermission(approval.rpcId, null); } catch { /* runtime closed */ }
      approvals.delete(id);
      publish('approval_resolved', { id, cancelled: true }, runId, approval.threadId);
    }
  }

  async function getClient(thread) {
    let client = clients.get(thread.id);
    if (client && !client.closed) { clearTimeout(client.idleTimer); return client; }
    const directory = await profileDirectory(thread.profile, root);
    client = runtimeFactory({ profile: thread.profile, directory, workspace });
    clients.set(thread.id, client);
    client.on('closed', () => { if (clients.get(thread.id) === client) clients.delete(thread.id); });
    client.on('update', ({ update }) => {
      const running = active.get(thread.id);
      if (!running?.acceptUpdates || !update) return;
      const kind = update.sessionUpdate;
      if (kind === 'agent_message_chunk' && update.content?.type === 'text') {
        running.text += update.content.text || '';
        store.db.prepare('UPDATE messages SET content=? WHERE id=?').run(running.text, running.messageId);
        publish('message_delta', { messageId: running.messageId, text: update.content.text }, running.id, thread.id);
      } else if (kind === 'tool_call' || kind === 'tool_call_update') {
        // ACP tool content is owner-visible. Redact obvious credential patterns.
        const safe = redactPayload(update);
        publish('tool', safe, running.id, thread.id);
      } else if (kind === 'plan') publish('plan', update, running.id, thread.id);
      else if (kind === 'usage_update') {
        store.db.prepare('UPDATE runs SET usage=? WHERE id=?').run(JSON.stringify(update), running.id);
        publish('usage', update, running.id, thread.id);
      }
    });
    client.on('permission', message => {
      const running = active.get(thread.id);
      if (!running) { client.answerPermission(message.id, null); return; }
      const id = store.id();
      const payload = redactPayload({
        id, toolCall: message.params.toolCall, options: message.params.options,
      });
      approvals.set(id, { ...payload, client, rpcId: message.id, runId: running.id, threadId: thread.id });
      store.db.prepare("UPDATE runs SET status='waiting' WHERE id=?").run(running.id);
      publish('approval', payload, running.id, thread.id);
    });
    try {
      await client.initialize();
      if (thread.session_id) {
        const result = await client.request('session/load', { sessionId: thread.session_id, cwd: workspace, mcpServers: [] });
        if (!result) throw new Error('Hermes could not restore this conversation. Start a new conversation to continue.');
        client.sessionId = thread.session_id;
      } else {
        const result = await client.request('session/new', { cwd: workspace, mcpServers: [] });
        if (!result?.sessionId) throw new Error('Hermes did not return a session ID');
        client.sessionId = result.sessionId;
        store.db.prepare('UPDATE threads SET session_id=? WHERE id=?').run(result.sessionId, thread.id);
      }
      return client;
    } catch (error) { client.close(); clients.delete(thread.id); throw error; }
  }

  async function executeRun(thread, running, text) {
    let client;
    let timer;
    try {
      client = await getClient(thread);
      if (running.cancelled || shuttingDown) throw new Error('Run cancelled');
      publish('runtime_ready', {}, running.id, thread.id);
      running.acceptUpdates = true;
      timer = setTimeout(() => {
        running.timedOut = true;
        client.cancel(client.sessionId);
        client.close();
      }, runTimeout);
      const result = await client.request('session/prompt', {
        sessionId: client.sessionId, prompt: [{ type: 'text', text }],
      }, runTimeout + 5000);
      const cancelled = running.cancelled || result?.stopReason === 'cancelled';
      const failed = result?.stopReason === 'refusal';
      const status = cancelled ? 'cancelled' : failed ? 'failed' : 'completed';
      const error = failed ? 'Hermes refused this request. Check the agent configuration.' : null;
      finish(status, error);
    } catch (error) {
      const cancelled = running.cancelled;
      if (cancelled) client?.close();
      finish(cancelled ? 'cancelled' : 'failed', cancelled ? null : running.timedOut
        ? 'Run exceeded its time limit. The Hermes process was stopped.' : stripSecrets(error.message));
    } finally {
      clearTimeout(timer);
      clearTimeout(running.cancelTimer);
      expireApprovals(running.id);
      active.delete(thread.id);
      if (client && !client.closed && !shuttingDown) {
        client.idleTimer = setTimeout(() => { client.close(); clients.delete(thread.id); }, 300000);
        client.idleTimer.unref();
      }
    }
    function finish(status, error) {
      const now = store.now();
      store.db.prepare('UPDATE runs SET status=?,ended_at=?,error=? WHERE id=?').run(status, now, error, running.id);
      store.db.prepare('UPDATE threads SET updated_at=? WHERE id=?').run(now, thread.id);
      if (running.taskId) store.db.prepare('UPDATE tasks SET status=?,updated_at=? WHERE id=?')
        .run(status === 'completed' ? 'done' : 'todo', now, running.taskId);
      publish('run_finished', { status, error }, running.id, thread.id);
    }
  }

  function startRun(thread, text, taskId = null) {
    if (active.has(thread.id)) throw Object.assign(new Error('This conversation already has an active run'), { status: 409 });
    if (active.size >= limit) throw Object.assign(new Error(`All ${limit} agent slots are busy. Wait for a run to finish.`), { status: 409 });
    const id = store.id(), now = store.now();
    addMessage(thread.id, 'user', text);
    const messageId = addMessage(thread.id, 'assistant', '');
    store.db.prepare('INSERT INTO runs(id,thread_id,profile,status,message_id,started_at,task_id) VALUES(?,?,?,?,?,?,?)')
      .run(id, thread.id, thread.profile, 'running', messageId, now, taskId);
    const title = thread.title === 'New conversation' ? text.replace(/\s+/g, ' ').slice(0, 64) : thread.title;
    store.db.prepare('UPDATE threads SET title=?,updated_at=? WHERE id=?').run(title, now, thread.id);
    const running = { id, messageId, text: '', taskId, cancelled: false, acceptUpdates: false };
    active.set(thread.id, running);
    publish('run_started', { profile: thread.profile }, id, thread.id);
    void executeRun(thread, running, text);
    return store.getRun(id);
  }

  app.get('/api/health', (_req, res) => res.json({ ok: true, runtime: 'hermes-acp' }));
  app.get('/api/bootstrap', async (_req, res) => {
    const agents = await profiles();
    const runs = store.runs();
    res.json({
      profiles: agents, threads: store.threads(), tasks: store.tasks(), runs,
      approvals: [...approvals.values()].map(({ client, rpcId, ...item }) => item),
      runtime: { name: 'Hermes ACP', workspace, root, concurrency: limit, active: active.size },
      stats: { profiles: agents.length, skills: agents.reduce((sum, item) => sum + item.skills, 0),
        sessions: agents.reduce((sum, item) => sum + item.sessions, 0), completed: runs.filter(r => r.status === 'completed').length },
    });
  });
  app.post('/api/profiles/refresh', async (_req, res) => res.json(await profiles(true)));
  app.get('/api/profiles/:id/memory', async (req, res) => {
    await requireProfile(req.params.id);
    res.json(await readMemory(req.params.id, root));
  });
  app.get('/api/events', (req, res) => {
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.setHeader('X-Accel-Buffering', 'no');
    res.flushHeaders();
    const after = Number(req.headers['last-event-id']);
    if (Number.isSafeInteger(after) && after > 0) {
      const rows = store.db.prepare('SELECT * FROM events WHERE id>? ORDER BY id LIMIT 3000').all(after);
      for (const event of rows) res.write(`id: ${event.id}\ndata: ${JSON.stringify({ ...event, payload: JSON.parse(event.payload) })}\n\n`);
    }
    res.write(': connected\n\n');
    streams.add(res);
    const heartbeat = setInterval(() => res.write(': heartbeat\n\n'), 20000);
    req.on('close', () => { clearInterval(heartbeat); streams.delete(res); });
  });
  app.post('/api/threads', async (req, res) => {
    const profile = tidy(req.body.profile, 64);
    await requireProfile(profile);
    res.status(201).json(newThread(profile, tidy(req.body.title, 100)));
  });
  app.get('/api/threads/:id', (req, res) => {
    const thread = store.getThread(req.params.id);
    if (!thread) return res.status(404).json({ error: 'Conversation not found' });
    res.json({ ...thread, messages: store.messages(thread.id), events: store.events(thread.id),
      runs: store.db.prepare('SELECT * FROM runs WHERE thread_id=? ORDER BY started_at DESC').all(thread.id) });
  });
  app.patch('/api/threads/:id', (req, res) => {
    const title = tidy(req.body.title, 100);
    if (!title) return res.status(400).json({ error: 'A conversation title is required' });
    if (!store.getThread(req.params.id)) return res.status(404).json({ error: 'Conversation not found' });
    store.db.prepare('UPDATE threads SET title=?,updated_at=? WHERE id=?').run(title, store.now(), req.params.id);
    publish('thread_updated', {}, null, req.params.id);
    res.json(store.getThread(req.params.id));
  });
  app.post('/api/threads/:id/messages', async (req, res) => {
    const thread = store.getThread(req.params.id);
    if (!thread) return res.status(404).json({ error: 'Conversation not found' });
    await requireProfile(thread.profile);
    const text = tidy(req.body.text, 32000);
    if (!text) return res.status(400).json({ error: 'Write a message first' });
    res.status(202).json(startRun(thread, text));
  });
  app.post('/api/runs/:id/cancel', (req, res) => {
    const run = store.getRun(req.params.id);
    const running = run && active.get(run.thread_id);
    if (!run || !running || running.id !== run.id) return res.status(409).json({ error: 'This run is no longer active' });
    running.cancelled = true;
    expireApprovals(run.id);
    const client = clients.get(run.thread_id);
    client?.cancel(client.sessionId);
    running.cancelTimer = setTimeout(() => client?.close(), 5000);
    running.cancelTimer.unref();
    publish('cancellation_requested', {}, run.id, run.thread_id);
    res.json({ ok: true });
  });
  app.post('/api/approvals/:id', (req, res) => {
    const approval = approvals.get(req.params.id);
    if (!approval) return res.status(404).json({ error: 'This approval has expired' });
    const choice = approval.options.find(item => item.optionId === req.body.optionId);
    if (!choice) return res.status(400).json({ error: 'Choose a valid approval option' });
    approval.client.answerPermission(approval.rpcId, choice.optionId);
    approvals.delete(req.params.id);
    if (![...approvals.values()].some(item => item.runId === approval.runId)) {
      store.db.prepare("UPDATE runs SET status='running' WHERE id=?").run(approval.runId);
    }
    publish('approval_resolved', { id: req.params.id, choice: choice.name }, approval.runId, approval.threadId);
    res.json({ ok: true });
  });
  app.post('/api/tasks', async (req, res) => {
    const title = tidy(req.body.title, 120), description = tidy(req.body.description), profile = tidy(req.body.profile, 64);
    if (!title) return res.status(400).json({ error: 'Give your task a title' });
    await requireProfile(profile);
    const id = store.id(), now = store.now();
    store.db.prepare('INSERT INTO tasks(id,title,description,profile,status,created_at,updated_at) VALUES(?,?,?,?,?,?,?)')
      .run(id, title, description, profile, 'todo', now, now);
    publish('task_created', { id });
    res.status(201).json(store.db.prepare('SELECT * FROM tasks WHERE id=?').get(id));
  });
  app.patch('/api/tasks/:id', async (req, res) => {
    const task = store.db.prepare('SELECT * FROM tasks WHERE id=?').get(req.params.id);
    if (!task) return res.status(404).json({ error: 'Task not found' });
    if (task.status === 'running') return res.status(409).json({ error: 'Stop the active run before editing this task' });
    const status = req.body.status || task.status;
    if (!['todo', 'done'].includes(status)) return res.status(400).json({ error: 'Invalid task status' });
    const profile = req.body.profile || task.profile;
    await requireProfile(profile);
    const title = req.body.title === undefined ? task.title : tidy(req.body.title, 120);
    if (!title) return res.status(400).json({ error: 'Task title cannot be empty' });
    store.db.prepare('UPDATE tasks SET title=?,description=?,profile=?,status=?,updated_at=? WHERE id=?')
      .run(title, req.body.description === undefined ? task.description : tidy(req.body.description), profile, status, store.now(), task.id);
    publish('task_updated', { id: task.id });
    res.json(store.db.prepare('SELECT * FROM tasks WHERE id=?').get(task.id));
  });
  app.delete('/api/tasks/:id', (req, res) => {
    const task = store.db.prepare('SELECT * FROM tasks WHERE id=?').get(req.params.id);
    if (!task) return res.status(404).json({ error: 'Task not found' });
    if (task.status === 'running') return res.status(409).json({ error: 'Stop the active run before deleting this task' });
    store.db.prepare('DELETE FROM tasks WHERE id=?').run(task.id);
    publish('task_deleted', { id: task.id });
    res.json({ ok: true });
  });
  app.post('/api/tasks/:id/run', async (req, res) => {
    const task = store.db.prepare('SELECT * FROM tasks WHERE id=?').get(req.params.id);
    if (!task) return res.status(404).json({ error: 'Task not found' });
    await requireProfile(task.profile);
    if (task.status === 'running') return res.status(409).json({ error: 'This task is already running' });
    if (active.size >= limit) return res.status(409).json({ error: 'All agent slots are busy' });
    // Each task execution gets a dedicated Hermes session; chats are never silently shared.
    const thread = newThread(task.profile, task.title);
    const run = startRun(thread, [task.title, task.description].filter(Boolean).join('\n\n'), task.id);
    store.db.prepare("UPDATE tasks SET status='running',thread_id=?,updated_at=? WHERE id=?").run(thread.id, store.now(), task.id);
    res.status(202).json({ thread, run });
  });

  const dist = options.distDir || join(process.cwd(), 'dist');
  if (options.serveFrontend !== false && existsSync(dist)) {
    app.use(express.static(dist));
    app.get('/{*path}', (req, res, next) => req.path.startsWith('/api/') ? next() : res.sendFile(join(dist, 'index.html')));
  }
  app.use('/api', (_req, res) => res.status(404).json({ error: 'API endpoint not found' }));
  app.use((error, _req, res, _next) => {
    res.status(error.status || 500).json({ error: stripSecrets(error.message || 'Request failed') });
  });

  async function close() {
    shuttingDown = true;
    for (const running of active.values()) running.cancelled = true;
    for (const client of clients.values()) { clearTimeout(client.idleTimer); client.close(); }
    for (const res of streams) res.end();
    // Let rejected runtime promises persist their final state before closing SQLite.
    const deadline = Date.now() + 6000;
    while (active.size && Date.now() < deadline) await new Promise(resolve => setTimeout(resolve, 20));
    store.close();
  }
  return { app, close, store, profiles };
}
