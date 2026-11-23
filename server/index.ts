/**
 * Optional HTTP server for the demo inventory API.
 *
 *   npm run server                      # http://localhost:4000
 *   FAILURE_RATE=0.3 LOST_RESPONSE_RATE=0.2 npm run server
 *
 * Then start the app with EXPO_PUBLIC_API_URL=http://<your-ip>:4000.
 * Runs on Node's built-in TypeScript support (Node 22.18+), no build step.
 */
import { createServer } from 'node:http';
import { DEMO_STOCK } from '../src/server/demoStock.ts';
import { createInventory } from '../src/server/inventory.ts';

const port = Number(process.env.PORT ?? 4000);
const rate = (name: string) => {
  const v = Number(process.env[name] ?? 0);
  return Number.isFinite(v) && v >= 0 && v <= 1 ? v : 0;
};

const inventory = createInventory({
  initialStock: { ...DEMO_STOCK },
  failureRate: rate('FAILURE_RATE'),
  lostResponseRate: rate('LOST_RESPONSE_RATE'),
});

const MAX_BODY = 64 * 1024;

const server = createServer((req, res) => {
  const cors = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type, Idempotency-Key',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Expose-Headers': 'Retry-After',
  };
  if (req.method === 'OPTIONS') {
    res.writeHead(204, cors).end();
    return;
  }

  const chunks: Buffer[] = [];
  let size = 0;
  req.on('data', (c: Buffer) => {
    size += c.length;
    if (size > MAX_BODY) {
      res.writeHead(413, { ...cors, 'Content-Type': 'application/json' }).end('{"error":"too_large"}');
      req.destroy();
      return;
    }
    chunks.push(c);
  });
  req.on('end', () => {
    if (res.writableEnded) return;
    let body: unknown;
    if (chunks.length > 0) {
      try {
        body = JSON.parse(Buffer.concat(chunks).toString('utf8'));
      } catch {
        res.writeHead(400, { ...cors, 'Content-Type': 'application/json' }).end('{"error":"invalid_json"}');
        return;
      }
    }
    const headers = Object.fromEntries(
      Object.entries(req.headers).map(([k, v]) => [k, Array.isArray(v) ? v[0] : v]),
    );
    const out = inventory.handle({ method: req.method ?? 'GET', path: req.url ?? '/', headers, body });
    res.writeHead(out.status, { ...cors, ...out.headers, 'Content-Type': 'application/json' });
    res.end(JSON.stringify(out.body));
    console.log(`${req.method} ${req.url} -> ${out.status}`);
  });
});

server.listen(port, () => console.log(`Inventory API on http://localhost:${port}`));
