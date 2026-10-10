import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, rm, symlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { once } from 'node:events';
import { createApp } from '../server/app.mjs';
import { HermesACP } from '../server/acp.mjs';
import { profileDirectory } from '../server/hermes.mjs';

async function setup(t) {
  const directory = await mkdtemp(join(tmpdir(), 'agentos-test-'));
  const root = join(directory, 'hermes');
  await mkdir(join(root, 'profiles', 'scout', 'memories'), { recursive: true });
  await mkdir(join(root, 'skills', 'example'), { recursive: true });
  await writeFile(join(root, 'skills', 'example', 'SKILL.md'), 'example');
  const config = 'model:\n  default: test-model\n  provider: test\nmcp_servers:\n  mobbin:\n    url: https://api.mobbin.com/mcp\n    headers:\n      Authorization: SECRET-SENTINEL\n';
  await writeFile(join(root, 'config.yaml'), config);
  await writeFile(join(root, 'profiles', 'scout', 'config.yaml'), config);
  await writeFile(join(root, 'profiles', 'scout', 'profile.yaml'), 'description: Research agent\n');
  await writeFile(join(root, 'profiles', 'scout', 'memories', 'MEMORY.md'), 'Remember project context.');
  const options = {
    hermesRoot: root, workspace: directory, dataDir: join(directory, 'data'), serveFrontend: false, runTimeout: 5000,
    runtimeFactory: args => new HermesACP({ ...args, command: process.execPath, args: [resolve('tests/fixtures/fake-hermes.mjs')] }),
  };
  const service = createApp(options);
  const server = service.app.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const url = 'http://127.0.0.1:' + server.address().port;
  const request = async (path, method = 'GET', body, headers = {}) => {
    const response = await fetch(url + '/api' + path, { method, headers: { 'Content-Type': 'application/json', ...headers }, body: body === undefined ? undefined : JSON.stringify(body) });
    return { status: response.status, data: await response.json() };
  };
  t.after(async () => {
    await service.close();
    server.closeAllConnections();
    await new Promise(resolve => server.close(resolve));
    await rm(directory, { recursive: true, force: true });
  });
  const thread = async () => (await request('/threads', 'POST', { profile: 'scout' })).data;
  async function waitFor(predicate) {
    const deadline = Date.now() + 5000;
    while (Date.now() < deadline) {
      const snapshot = (await request('/bootstrap')).data;
      if (predicate(snapshot)) return snapshot;
      await new Promise(resolve => setTimeout(resolve, 25));
    }
    throw new Error('State did not settle');
  }
  return { request, thread, waitFor, service, root, directory, options, url };
}

test('discovers real profile metadata without exposing configuration credentials', async t => {
  const { request } = await setup(t);
  const result = await request('/bootstrap');
  assert.equal(result.status, 200);
  assert.equal(result.data.profiles.length, 2);
  assert.equal(result.data.profiles[0].skills, 1);
  assert.equal(result.data.profiles[1].model, 'test-model');
  assert.equal(JSON.stringify(result).includes('SECRET-SENTINEL'), false);
});

test('streams and persists a Hermes answer without shell-interpreting the prompt', async t => {
  const { request, thread, waitFor } = await setup(t);
  const chat = await thread();
  const tick = String.fromCharCode(96);
  const text = 'Hello $(touch should-not-exist) ' + tick + 'literal' + tick + ' "quotes"';
  assert.equal((await request('/threads/' + chat.id + '/messages', 'POST', { text })).status, 202);
  await waitFor(snapshot => snapshot.runs[0]?.status === 'completed');
  const state = (await request('/threads/' + chat.id)).data;
  assert.equal(state.messages[1].content, 'Hermes: ' + text);
  assert.equal(state.events.find(event => event.type === 'tool').payload.rawInput.api_key, '[redacted]');
  assert.ok(state.events.some(event => event.type === 'message_delta'));
});

test('rejects concurrent prompts in the same conversation', async t => {
  const { request, thread } = await setup(t);
  const chat = await thread();
  await request('/threads/' + chat.id + '/messages', 'POST', { text: 'WAIT' });
  const second = await request('/threads/' + chat.id + '/messages', 'POST', { text: 'second' });
  assert.equal(second.status, 409);
});

test('routes approval requests to the owner and validates their choices', async t => {
  const { request, thread, waitFor } = await setup(t);
  const chat = await thread();
  await request('/threads/' + chat.id + '/messages', 'POST', { text: 'APPROVAL' });
  const snapshot = await waitFor(snapshot => snapshot.approvals.length === 1);
  assert.equal(snapshot.runs[0].status, 'waiting');
  const id = snapshot.approvals[0].id;
  assert.equal((await request('/approvals/' + id, 'POST', { optionId: 'invented' })).status, 400);
  assert.equal((await request('/approvals/' + id, 'POST', { optionId: 'deny' })).status, 200);
  await waitFor(snapshot => snapshot.runs[0]?.status === 'completed');
  const state = (await request('/threads/' + chat.id)).data;
  assert.equal(state.messages[1].content, 'Hermes: Permission selected');
  assert.equal((await request('/approvals/' + id, 'POST', { optionId: 'allow' })).status, 404);
});

test('cancels an active agent run and clears pending approvals', async t => {
  const { request, thread, waitFor } = await setup(t);
  const chat = await thread();
  const run = (await request('/threads/' + chat.id + '/messages', 'POST', { text: 'APPROVAL' })).data;
  await waitFor(snapshot => snapshot.approvals.length === 1);
  await request('/runs/' + run.id + '/cancel', 'POST', {});
  const snapshot = await waitFor(snapshot => snapshot.runs[0]?.status === 'cancelled');
  assert.equal(snapshot.approvals.length, 0);
});

test('executes assigned tasks and prevents edits while running', async t => {
  const { request, waitFor } = await setup(t);
  const task = (await request('/tasks', 'POST', { title: 'WAIT', description: '', profile: 'scout' })).data;
  const runResult = await request('/tasks/' + task.id + '/run', 'POST', {});
  assert.equal(runResult.status, 202);
  await waitFor(snapshot => snapshot.tasks[0].status === 'running');
  assert.equal((await request('/tasks/' + task.id, 'PATCH', { title: 'changed' })).status, 409);
  assert.equal((await request('/tasks/' + task.id + '/run', 'POST', {})).status, 409);
  await request('/runs/' + runResult.data.run.id + '/cancel', 'POST', {});
  await waitFor(snapshot => snapshot.runs[0]?.status === 'cancelled');
  assert.equal((await request('/tasks/' + task.id, 'PATCH', { status: 'done' })).status, 200);
  assert.equal((await request('/tasks/' + task.id, 'DELETE')).status, 200);
});

test('finishing a task moves it to done with a linked conversation', async t => {
  const { request, waitFor } = await setup(t);
  const task = (await request('/tasks', 'POST', { title: 'Explain the plan', profile: 'scout' })).data;
  await request('/tasks/' + task.id + '/run', 'POST', {});
  const snapshot = await waitFor(snapshot => snapshot.tasks[0].status === 'done');
  assert.ok(snapshot.tasks[0].thread_id);
  assert.equal(snapshot.runs[0].status, 'completed');
});

test('resumes persisted Hermes sessions without appending replayed history to new answers', async t => {
  const { request, thread, waitFor, service } = await setup(t);
  const chat = await thread();
  await request('/threads/' + chat.id + '/messages', 'POST', { text: 'first' });
  await waitFor(snapshot => snapshot.runs[0]?.status === 'completed');
  const resumed = await thread();
  service.store.db.prepare('UPDATE threads SET session_id=? WHERE id=?').run('test-session', resumed.id);
  await request('/threads/' + resumed.id + '/messages', 'POST', { text: 'second' });
  await waitFor(snapshot => snapshot.runs[0]?.status === 'completed' && snapshot.runs[0]?.thread_id === resumed.id);
  const state = (await request('/threads/' + resumed.id)).data;
  assert.equal(state.messages[1].content, 'Hermes: second');
});

test('reports runtime crashes and refusals as failed runs', async t => {
  const { request, thread, waitFor } = await setup(t);
  for (const text of ['CRASH', 'REFUSE']) {
    const chat = await thread();
    await request('/threads/' + chat.id + '/messages', 'POST', { text });
    const snapshot = await waitFor(snapshot => snapshot.runs[0]?.thread_id === chat.id && snapshot.runs[0]?.status === 'failed');
    assert.ok(snapshot.runs[0].error);
  }
});

test('reads only allowlisted memory files and rejects path traversal', async t => {
  const { request, root, directory } = await setup(t);
  const response = await request('/profiles/scout/memory');
  assert.equal(response.data[0].content, 'Remember project context.');
  await assert.rejects(profileDirectory('../../outside', root));
  const external = join(directory, 'external-secret');
  await writeFile(external, 'PRIVATE');
  await symlink(external, join(root, 'profiles', 'scout', 'memories', 'USER.md'));
  assert.equal(JSON.stringify((await request('/profiles/scout/memory')).data).includes('PRIVATE'), false);
});

test('rejects actions from foreign browser origins and unknown agents', async t => {
  const { request } = await setup(t);
  assert.equal((await request('/threads', 'POST', { profile: 'scout' }, { Origin: 'https://foreign.example' })).status, 403);
  assert.equal((await request('/threads', 'POST', { profile: 'missing' })).status, 404);
  assert.equal((await request('/tasks', 'POST', { title: '', profile: 'scout' })).status, 400);
});

test('replays SSE events after a client reconnects', async t => {
  const { request, url } = await setup(t);
  await request('/threads', 'POST', { profile: 'scout' });
  await request('/threads', 'POST', { profile: 'scout' });
  const controller = new AbortController();
  const response = await fetch(url + '/api/events', { headers: { 'Last-Event-ID': '1' }, signal: controller.signal });
  const chunk = await response.body.getReader().read();
  controller.abort();
  const text = new TextDecoder().decode(chunk.value);
  assert.ok(text.includes('id: 2'));
  assert.ok(text.includes('thread_created'));
});
