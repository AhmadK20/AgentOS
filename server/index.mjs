import { createApp } from './app.mjs';
import next from 'next';

const port = Number(process.env.AGENTOS_PORT) || 4310;
const dev = process.argv.includes('--dev');
const nextApp = next({ dev, hostname: '127.0.0.1', port });
await nextApp.prepare();
const { app, close } = createApp({ serveFrontend: false });
app.all('/{*path}', (req, res) => nextApp.getRequestHandler()(req, res));
const server = app.listen(port, '127.0.0.1', () => {
  console.log(`AgentOS is running at http://127.0.0.1:${port}`);
});
server.on('error', error => { console.error(error.message); process.exitCode = 1; });
let stopping = false;
for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, async () => {
  if (stopping) return;
  stopping = true;
  await close();
  server.close();
  server.closeAllConnections();
  await nextApp.close();
});
