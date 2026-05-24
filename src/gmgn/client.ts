import { GMGN_API_KEY, GMGN_REQUEST_DELAY_MS, JSON_HEADERS, GMGN_BASE } from '../config.js';

let lastRequestAt = 0;

export class GmgnError extends Error {
  constructor(
    message: string,
    public status?: number,
    public data?: unknown,
  ) {
    super(message);
    this.name = 'GmgnError';
  }
}

async function paceRequest() {
  const elapsed = Date.now() - lastRequestAt;
  if (elapsed < GMGN_REQUEST_DELAY_MS) {
    await new Promise(r => setTimeout(r, GMGN_REQUEST_DELAY_MS - elapsed));
  }
  lastRequestAt = Date.now();
}

export async function gmgnGet<T = unknown>(pathname: string, params: Record<string, string> = {}): Promise<T> {
  await paceRequest();

  const url = new URL(pathname, GMGN_BASE);
  for (const [k, v] of Object.entries(params)) {
    if (v !== undefined && v !== null) url.searchParams.set(k, v);
  }

  const res = await fetch(url.toString(), {
    method: 'GET',
    headers: {
      'X-APIKEY': GMGN_API_KEY,
      'Content-Type': 'application/json',
      ...JSON_HEADERS,
    },
  });

  if (!res.ok) {
    let body: any = {};
    try { body = await res.json(); } catch {}
    throw new GmgnError(
      `GMGN ${res.status}: ${body?.message || body?.error || res.statusText}`,
      res.status,
      body,
    );
  }

  return res.json() as Promise<T>;
}

export async function gmgnPost<T = unknown>(pathname: string, body: Record<string, unknown> = {}): Promise<T> {
  await paceRequest();

  const url = new URL(pathname, GMGN_BASE);

  const res = await fetch(url.toString(), {
    method: 'POST',
    headers: {
      'X-APIKEY': GMGN_API_KEY,
      'Content-Type': 'application/json',
      ...JSON_HEADERS,
    },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    let b: any = {};
    try { b = await res.json(); } catch {}
    throw new GmgnError(
      `GMGN ${res.status}: ${b?.message || b?.error || res.statusText}`,
      res.status,
      b,
    );
  }

  return res.json() as Promise<T>;
}

export { paceRequest };
