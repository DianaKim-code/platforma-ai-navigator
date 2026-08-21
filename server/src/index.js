import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { analyzeWithProvider } from './analyze.js';

const PORT = Number(process.env.PORT || 8787);
const HOST = process.env.HOST || '0.0.0.0';
const productionOrigin = process.env.ALLOWED_ORIGIN || 'https://dianakim-code.github.io';
const allowedOrigins = new Set([
  productionOrigin,
  'http://127.0.0.1:8000',
  'http://localhost:8000',
  'http://127.0.0.1:4173',
  'http://localhost:4173',
]);
const practicesUrl = new URL('../../data/practices.json', import.meta.url);

function json(response, status, body, origin = '') {
  response.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
    ...(origin ? { 'Access-Control-Allow-Origin': origin, Vary: 'Origin' } : {}),
  });
  response.end(JSON.stringify(body));
}

async function readJson(request) {
  const chunks = [];
  let size = 0;
  for await (const chunk of request) {
    size += chunk.length;
    if (size > 64_000) throw new Error('PAYLOAD_TOO_LARGE');
    chunks.push(chunk);
  }
  return JSON.parse(Buffer.concat(chunks).toString('utf8'));
}

const server = createServer(async (request, response) => {
  const origin = request.headers.origin || '';
  if (origin && !allowedOrigins.has(origin)) return json(response, 403, { error: 'origin_not_allowed' });
  if (request.method === 'OPTIONS') {
    response.writeHead(204, {
      'Access-Control-Allow-Origin': origin,
      'Access-Control-Allow-Methods': 'POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type',
      Vary: 'Origin',
    });
    return response.end();
  }
  if (request.method !== 'POST' || request.url !== '/analyze') return json(response, 404, { error: 'not_found' }, origin);
  try {
    const answers = await readJson(request);
    const practices = JSON.parse(await readFile(practicesUrl, 'utf8'));
    const result = await analyzeWithProvider(answers, practices);
    return json(response, 200, result, origin);
  } catch (error) {
    const status = error.message === 'PAYLOAD_TOO_LARGE' ? 413 : 502;
    return json(response, status, { error: 'analysis_unavailable' }, origin);
  }
});

server.listen(PORT, HOST, () => {
  console.log(`Platforma AI endpoint listening on ${HOST}:${PORT}`);
});
