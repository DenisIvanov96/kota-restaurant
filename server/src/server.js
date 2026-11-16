import path from 'node:path';
import { createApp } from './app.js';

const env = process.env;
const production = env.NODE_ENV === 'production';
const dataDir = path.resolve(env.DATA_DIR || './data');
const port = Number(env.PORT || 3000);

let now = () => Date.now();
if (!production && env.KOTA_NOW) {
  const t = Date.parse(env.KOTA_NOW);
  if (Number.isNaN(t)) { console.error('KOTA_NOW is not a valid ISO date'); process.exit(1); }
  now = () => t;
  console.warn(`[test hook] KOTA_NOW active: clock frozen at ${env.KOTA_NOW}`);
}
const cookieSecure = env.COOKIE_SECURE !== undefined ? env.COOKIE_SECURE === 'true' : production;
const tp = env.TRUST_PROXY;
const trustProxy = tp === undefined || tp === '' || tp === 'false' ? false : (/^\d+$/.test(tp) ? Number(tp) : tp === 'true' ? 1 : tp);

const app = createApp({ dataDir, now, cookieSecure, trustProxy });
const server = app.listen(port, () => console.log(`Kota1 server listening on http://localhost:${port} (data: ${dataDir})`));

function shutdown(signal) {
  console.log(`${signal} received, shutting down`);
  server.close(() => { app.closeDb(); process.exit(0); });
  server.closeIdleConnections?.();
  setTimeout(() => { app.closeDb(); process.exit(0); }, 5000).unref();
}
process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));
