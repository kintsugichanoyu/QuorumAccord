/** Test-only pacing gateway. Forwards real devnet RPC; never fabricates chain data. */
import assert from 'node:assert/strict';
import { createServer, type Server } from 'node:http';

export interface GatewayOptions {
  host?: string;
  port?: number;
  intervalMs?: number;
  methodIntervalMs?: number;
  retryBaseMs?: number;
  retries?: number;
  fetch?: typeof globalThis.fetch;
}
export function retryDelay(value: string | null, attempt: number, base = 1000, now = Date.now()): number {
  const seconds = value === null ? NaN : Number(value);
  const hinted = Number.isFinite(seconds) ? seconds * 1000 : value ? Date.parse(value) - now : 0;
  return Math.min(30_000, Math.max(base * 2 ** attempt, Number.isFinite(hinted) ? hinted : 0));
}
export async function startRpcGateway(upstream: string, options: GatewayOptions = {}) {
  const interval = options.intervalMs ?? 150;
  const methodInterval = options.methodIntervalMs ?? 350;
  const retries = options.retries ?? 5;
  const fetchRpc = options.fetch ?? globalThis.fetch;
  const stop = new AbortController();
  const stats = { requests: 0, upstream_attempts: 0, rate_limit_retries: 0, cache_hits: 0, methods: Object.create(null) as Record<string, number> };
  const lastMethod = new Map<string, number>();
  let lastRequest = 0;
  let pending = 0;
  let queue: Promise<unknown> = Promise.resolve();
  const reads = new Map<string, { expires: number; promise: Promise<{status: number; text: string}> }>();
  async function pause(ms: number) {
    if (ms <= 0) return;
    await new Promise<void>((done, reject) => {
      const abort = () => { clearTimeout(timer); reject(new Error('RPC gateway stopped')); };
      const timer = setTimeout(() => { stop.signal.removeEventListener('abort', abort); done(); }, ms);
      stop.signal.addEventListener('abort', abort, { once: true });
      if (stop.signal.aborted) abort();
    });
  }
  async function forward(body: string, method: string) {
    for (let attempt = 0; ; attempt++) {
      assert(!stop.signal.aborted, 'RPC gateway stopped');
      // Pace request starts; a slow response must not block every other method.
      const turn = queue.then(async () => {
        await pause(Math.max(lastRequest + interval, (lastMethod.get(method) ?? 0) + methodInterval) - Date.now());
        lastRequest = Date.now();
        lastMethod.set(method, lastRequest);
      });
      queue = turn.catch(() => undefined);
      await turn;
      stats.upstream_attempts++;
      const response = await fetchRpc(upstream, { method: 'POST', body, headers: { 'Content-Type': 'application/json' },
        signal: AbortSignal.any([stop.signal, AbortSignal.timeout(30_000)]) });
      const text = await response.text();
      if ((response.status === 429 || response.status === 503) && attempt < retries) {
        stats.rate_limit_retries++;
        await pause(retryDelay(response.headers.get('retry-after'), attempt, options.retryBaseMs ?? 1000));
        continue;
      }
      return { status: response.status, text };
    }
  }
  const server: Server = createServer(async (request, response) => {
    try {
      if (request.method === 'GET' && request.url === '/health') {
        response.writeHead(200, { 'Content-Type': 'application/json' }).end(JSON.stringify(stats)); return;
      }
      if (request.method !== 'POST' || request.url !== '/') { response.writeHead(405).end(); return; }
      let body = '';
      for await (const chunk of request) {
        body += String(chunk);
        if (Buffer.byteLength(body) > 2_000_000) { response.writeHead(413).end(); return; }
      }
      let parsed: { jsonrpc?: string; method?: string; params?: unknown; id?: unknown };
      try { parsed = JSON.parse(body) as typeof parsed; }
      catch { response.writeHead(400).end(); return; }
      if (!parsed || parsed.jsonrpc !== '2.0' || typeof parsed.method !== 'string') { response.writeHead(400).end(); return; }
      if (pending >= 256) { response.writeHead(503).end('RPC gateway queue is full'); return; }
      pending++;
      stats.requests++;
      stats.methods[parsed.method] = (stats.methods[parsed.method] ?? 0) + 1;
      const ttl = parsed.method === 'getGenesisHash' ? 60_000 :
        ['getSlot', 'getLatestBlockhash', 'getAccountInfo', 'getMultipleAccounts'].includes(parsed.method) ? 1000 : 0;
      const key = JSON.stringify([parsed.method, parsed.params]);
      const cached = ttl ? reads.get(key) : undefined;
      let job: Promise<{status: number; text: string}>;
      if (cached && cached.expires > Date.now()) {
        stats.cache_hits++; job = cached.promise;
      } else {
        job = forward(body, parsed.method);
        if (ttl) {
          const entry = { expires: Number.POSITIVE_INFINITY, promise: job };
          reads.set(key, entry);
          void job.then(result => {
            // Coalesce in-flight reads, then retain successful RPC responses briefly.
            const value = JSON.parse(result.text) as { error?: unknown };
            if (result.status === 200 && !value.error) entry.expires = Date.now() + ttl;
            else if (reads.get(key) === entry) reads.delete(key);
          }).catch(() => { if (reads.get(key) === entry) reads.delete(key); });
          if (reads.size > 512) for (const [k, v] of reads) if (v.expires <= Date.now()) reads.delete(k);
        }
      }
      try {
        const result = await job;
        let text = result.text;
        try {
          const value = JSON.parse(text) as { id?: unknown };
          value.id = parsed.id; text = JSON.stringify(value);
        } catch { /* Preserve non-JSON upstream HTTP errors verbatim. */ }
        response.writeHead(result.status, { 'Content-Type': 'application/json' }).end(text);
      } finally { pending--; }
    } catch (error) {
      if (!response.destroyed) response.writeHead(502).end(error instanceof Error ? error.message : 'RPC upstream failed');
    }
  });
  await new Promise<void>((done, reject) => { server.once('error', reject); server.listen(options.port ?? 0, options.host ?? '127.0.0.1', done); });
  const address = server.address();
  assert(address && typeof address !== 'string');
  return { url: `http://127.0.0.1:${address.port}`, stats,
    async close() {
      stop.abort();
      server.closeAllConnections();
      await new Promise<void>((done) => server.close(() => done()));
    },
  };
}
