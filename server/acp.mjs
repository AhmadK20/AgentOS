import { spawn } from 'node:child_process';
import { createInterface } from 'node:readline';
import { EventEmitter } from 'node:events';

/** JSON-RPC over stdio, using Hermes' installed Agent Client Protocol adapter. */
export class HermesACP extends EventEmitter {
  constructor({ profile, directory, workspace, command = process.env.HERMES_BIN || 'hermes', args }) {
    super();
    this.nextId = 1;
    this.pending = new Map();
    this.closed = false;
    this.stderr = '';
    this.child = spawn(command, args || ['--profile', profile, 'acp'], {
      cwd: workspace,
      env: { ...process.env, HERMES_HOME: directory, PYTHONUNBUFFERED: '1' },
      stdio: ['pipe', 'pipe', 'pipe'],
      detached: process.platform !== 'win32',
    });
    this.child.stdin.on('error', () => {});
    this.lines = createInterface({ input: this.child.stdout });
    this.lines.on('line', line => {
      try { this.receive(JSON.parse(line)); } catch { /* protocol stdout only; ignore incidental lines */ }
    });
    this.child.stderr.on('data', data => { this.stderr = (this.stderr + data.toString()).slice(-16000); });
    this.child.on('error', error => this.fail(new Error(`Unable to start Hermes: ${error.message}`)));
    this.child.on('exit', (code, signal) => {
      this.fail(new Error(`Hermes stopped (${signal || code}). Check your Hermes configuration and authentication.`));
      this.emit('closed');
    });
  }

  receive(message) {
    if (!message.method && message.id != null) {
      const entry = this.pending.get(message.id);
      if (!entry) return;
      this.pending.delete(message.id);
      clearTimeout(entry.timer);
      if (message.error) entry.reject(new Error(message.error.message || 'Hermes request failed'));
      else entry.resolve(message.result);
    } else if (message.method === 'session/update') {
      this.emit('update', message.params);
    } else if (message.method === 'session/request_permission' && message.id != null) {
      this.emit('permission', message);
    } else if (message.id != null && message.method) {
      this.send({ jsonrpc: '2.0', id: message.id, error: { code: -32601, message: 'Client capability not available' } });
    }
  }

  send(message) {
    if (this.closed || !this.child.stdin.writable) throw new Error('Hermes connection is closed');
    this.child.stdin.write(`${JSON.stringify(message)}\n`);
  }

  request(method, params, timeout = 120000) {
    if (this.closed) return Promise.reject(new Error('Hermes connection is closed'));
    const id = this.nextId++;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`Hermes ${method} timed out`));
      }, timeout);
      this.pending.set(id, { resolve, reject, timer });
      try { this.send({ jsonrpc: '2.0', id, method, params }); }
      catch (error) { clearTimeout(timer); this.pending.delete(id); reject(error); }
    });
  }

  async initialize() {
    return this.request('initialize', {
      protocolVersion: 1, clientCapabilities: {},
      clientInfo: { name: 'agent-os', title: 'AgentOS', version: '0.1.0' },
    }, 60000);
  }

  cancel(sessionId) {
    if (!this.closed) this.send({ jsonrpc: '2.0', method: 'session/cancel', params: { sessionId } });
  }

  answerPermission(id, optionId) {
    this.send({ jsonrpc: '2.0', id, result: { outcome: optionId
      ? { outcome: 'selected', optionId } : { outcome: 'cancelled' } } });
  }

  fail(error) {
    this.closed = true;
    for (const entry of this.pending.values()) { clearTimeout(entry.timer); entry.reject(error); }
    this.pending.clear();
  }

  close() {
    if (this.closed) return;
    this.fail(new Error('Hermes connection closed'));
    this.lines.close();
    try {
      if (process.platform !== 'win32') process.kill(-this.child.pid, 'SIGTERM');
      else this.child.kill('SIGTERM');
    } catch { /* already exited */ }
    const killTimer = setTimeout(() => {
      try {
        if (process.platform !== 'win32') process.kill(-this.child.pid, 'SIGKILL');
        else this.child.kill('SIGKILL');
      } catch { /* already exited */ }
    }, 3000);
    killTimer.unref();
  }
}
