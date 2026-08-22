import { createServer } from 'node:http';
import { fileURLToPath } from 'node:url';
import { createRequestHandler } from './app.js';

const PORT = Number(process.env.PORT || 8787);
const HOST = process.env.HOST || '0.0.0.0';

export function startServer({ port = PORT, host = HOST } = {}) {
  const server = createServer(createRequestHandler());
  server.listen(port, host, () => {
    console.log(`Platforma AI staging backend listening on ${host}:${port}`);
  });
  return server;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  startServer();
}
