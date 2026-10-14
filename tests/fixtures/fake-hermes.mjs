import { createInterface } from 'node:readline';

let pendingPrompt = null;
const send = message => process.stdout.write(JSON.stringify({ jsonrpc: '2.0', ...message }) + '\n');
const update = value => send({ method: 'session/update', params: { sessionId: 'test-session', update: value } });
function finish(id, text) {
  update({ sessionUpdate: 'agent_message_chunk', content: { type: 'text', text: 'Hermes: ' } });
  update({ sessionUpdate: 'agent_message_chunk', content: { type: 'text', text } });
  send({ id, result: { stopReason: 'end_turn' } });
}
createInterface({ input: process.stdin }).on('line', line => {
  const message = JSON.parse(line);
  const { id, method, params } = message;
  if (!method && id === 900 && pendingPrompt) {
    finish(pendingPrompt.id, 'Permission ' + message.result.outcome.outcome);
    pendingPrompt = null;
  } else if (method === 'initialize') send({ id, result: { protocolVersion: 1, agentCapabilities: { loadSession: true } } });
  else if (method === 'session/new') send({ id, result: { sessionId: 'test-session' } });
  else if (method === 'session/load') {
    update({ sessionUpdate: 'agent_message_chunk', content: { type: 'text', text: 'OLD HISTORY SHOULD NOT BE DUPLICATED' } });
    send({ id, result: {} });
  } else if (method === 'session/prompt') {
    const text = params.prompt[0].text;
    if (text === 'REFUSE') return send({ id, result: { stopReason: 'refusal' } });
    if (text === 'CRASH') return process.exit(7);
    if (text === 'WAIT') { pendingPrompt = { id, text }; return; }
    update({ sessionUpdate: 'tool_call', toolCallId: 'tool-1', title: 'Inspect workspace', status: 'in_progress', rawInput: { command: 'pwd', api_key: 'should-never-reach-client' } });
    if (text === 'APPROVAL') {
      pendingPrompt = { id, text };
      send({ id: 900, method: 'session/request_permission', params: {
        sessionId: 'test-session', toolCall: { title: 'Confirm test tool', rawInput: { command: 'test' } },
        options: [{ optionId: 'allow', name: 'Allow once', kind: 'allow_once' }, { optionId: 'deny', name: 'Reject', kind: 'reject_once' }],
      } });
      return;
    }
    setTimeout(() => finish(id, text), 40);
  } else if (method === 'session/cancel' && pendingPrompt) {
    send({ id: pendingPrompt.id, result: { stopReason: 'cancelled' } });
    pendingPrompt = null;
  }
});
