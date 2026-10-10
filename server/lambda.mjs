import { handle } from 'hono/aws-lambda';
import { runtime } from './runtime.mjs';

export async function handler(event, context) {
  try { const services = await runtime(); return handle(services.app)(event, context); }
  catch { console.error(JSON.stringify({ event: 'studio_not_ready' })); return { statusCode: 503, headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' }, body: JSON.stringify({ error: 'Essay Studio setup is not complete. The operator must finish the private workspace configuration.' }) }; }
}
