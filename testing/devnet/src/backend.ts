/** TEST ONLY: invented protocol APIs; never a production source of prices. */
import { createServer, type ServerResponse } from 'node:http';
import { BackendState, PHASES, PRICES, PROTOCOLS, type Phase, type Protocol, type Symbol, json } from './types.js';

export function createBackend(log: (message: string) => void = () => {}) {
  let phase: Phase = 'baseline';
  let requests: Record<Protocol, number> = { atlas: 0, boreal: 0, cygnus: 0 };
  function respond(response: ServerResponse, status: number, body: unknown) {
    const bytes = Buffer.from(json(body));
    response.writeHead(status, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store', 'Content-Length': bytes.length });
    response.end(bytes);
  }
  return createServer(async (request, response) => {
    try {
      const path = new URL(request.url ?? '/', 'http://localhost').pathname;
      log(`${request.method} ${path}`);
      if (request.method === 'GET') {
        if (path === '/health') return respond(response, 200, { status: 'ok', test_only: true });
        if (path === '/control/state') return respond(response, 200, { phase, requests: { ...requests } } satisfies BackendState);
        const match = /^\/v1\/protocols\/([^/]+)\/prices\/([^/]+)$/.exec(path);
        const protocol = match?.[1] as Protocol;
        const symbol = match?.[2] as Symbol;
        if (!PROTOCOLS.includes(protocol) || !Object.hasOwn(PRICES, symbol)) return respond(response, 404, { error: 'unknown protocol/asset/endpoint' });
        requests[protocol]++;
        if (phase === 'unavailable' && protocol === 'cygnus') return respond(response, 503, { error: 'injected protocol backend outage' });
        let price = PRICES[symbol];
        if (phase === 'updated') price = price * 11n / 10n;
        if (phase === 'outlier' && protocol === 'cygnus') price *= 10n;
        return respond(response, 200, { test_only: true, protocol, symbol, price_micro_usd: price.toString(), decimals: 6, phase, observed_at_ms: Date.now() });
      }
      if (request.method === 'POST' && path === '/control/state') {
        let size = 0;
        const chunks: Buffer[] = [];
        for await (const chunk of request) {
          const bytes = Buffer.from(chunk);
          size += bytes.length;
          if (size > 1024) return respond(response, 400, { error: 'body too large' });
          chunks.push(bytes);
        }
        const body = JSON.parse(Buffer.concat(chunks).toString()) as { phase?: Phase };
        if (!PHASES.includes(body?.phase as Phase)) return respond(response, 400, { error: 'unknown phase' });
        phase = body.phase!;
        requests = { atlas: 0, boreal: 0, cygnus: 0 };
        return respond(response, 200, { phase });
      }
      respond(response, 404, { error: 'unknown endpoint' });
    } catch {
      if (!response.headersSent) respond(response, 400, { error: 'invalid request body' });
    }
  });
}
