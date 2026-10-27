import { lookup as dnsLookup } from 'node:dns/promises';
import { BlockList, isIP } from 'node:net';
import http from 'node:http';
import https from 'node:https';
import tls from 'node:tls';
import { brotliDecompressSync, gunzipSync, inflateSync } from 'node:zlib';
import type { IncomingHttpHeaders, IncomingMessage, RequestOptions } from 'node:http';

export interface PublicAddress { address: string; family: 4 | 6 }
export interface PublicPage { url: string; status: number; contentType: string; body: string }
export interface TransportResult { status: number; headers: IncomingHttpHeaders; body: string }
export interface TransportInput {
  url: URL;
  address: PublicAddress;
  timeoutMs: number;
  maxBytes: number;
  proxyUrl: string | undefined;
}
export interface SafeFetchOptions {
  resolver?: (hostname: string) => Promise<PublicAddress[]>;
  transport?: (input: TransportInput) => Promise<TransportResult>;
  timeoutMs?: number;
  maxBytes?: number;
  maxRedirects?: number;
  /** undefined uses the environment proxy; null explicitly selects direct transport. */
  proxyUrl?: string | null;
  beforeRedirect?: (destination: URL) => Promise<void>;
}

const ipv4Denied = new BlockList();
for (const [network, prefix] of [
  ['0.0.0.0', 8], ['10.0.0.0', 8], ['100.64.0.0', 10], ['127.0.0.0', 8],
  ['169.254.0.0', 16], ['172.16.0.0', 12], ['192.0.0.0', 24], ['192.0.2.0', 24],
  ['192.88.99.0', 24], ['192.168.0.0', 16], ['198.18.0.0', 15], ['198.51.100.0', 24],
  ['203.0.113.0', 24], ['224.0.0.0', 4], ['240.0.0.0', 4],
] as const) ipv4Denied.addSubnet(network, prefix, 'ipv4');
const ipv6Global = new BlockList();
ipv6Global.addSubnet('2000::', 3, 'ipv6');
const ipv6Denied = new BlockList();
for (const [network, prefix] of [
  ['2001::', 23], ['2001:db8::', 32], ['2002::', 16], ['3fff::', 20],
] as const) ipv6Denied.addSubnet(network, prefix, 'ipv6');

export function isPublicAddress(address: string): boolean {
  const family = isIP(address);
  if (family === 4) return !ipv4Denied.check(address, 'ipv4');
  if (family === 6) return ipv6Global.check(address, 'ipv6') && !ipv6Denied.check(address, 'ipv6');
  return false;
}

export function validatePublicUrl(input: string): URL {
  let url: URL;
  if (input.length > 8192) throw new Error('Website URL exceeds the supported length.');
  try { url = new URL(input); } catch { throw new Error('Enter a valid public website URL.'); }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') throw new Error('Only HTTP and HTTPS websites are supported.');
  if (url.username || url.password) throw new Error('Website URLs cannot contain credentials.');
  if (url.port && url.port !== (url.protocol === 'https:' ? '443' : '80')) throw new Error('Only standard web ports are supported.');
  const hostname = url.hostname.replace(/^\[|\]$/g, '').replace(/\.$/, '').toLowerCase();
  if (!hostname || hostname === 'localhost' || /\.(localhost|local|internal|lan|home)$/.test(hostname)) {
    throw new Error('Only public websites can be researched.');
  }
  if (isIP(hostname) && !isPublicAddress(hostname)) throw new Error('Private or reserved network addresses are not allowed.');
  url.hash = '';
  return url;
}

export async function resolvePublicAddress(
  url: URL,
  resolver: (hostname: string) => Promise<PublicAddress[]> = async (hostname) =>
    (await dnsLookup(hostname, { all: true, verbatim: true })).map((entry) => ({ address: entry.address, family: entry.family as 4 | 6 })),
): Promise<PublicAddress> {
  const hostname = url.hostname.replace(/^\[|\]$/g, '').replace(/\.$/, '');
  const literalFamily = isIP(hostname);
  const addresses = literalFamily
    ? [{ address: hostname, family: literalFamily as 4 | 6 }]
    : await resolver(hostname);
  if (!addresses.length || addresses.some((entry) => !isPublicAddress(entry.address))) {
    throw new Error('Website DNS resolved to a private, reserved, or unavailable address.');
  }
  // Prefer IPv4 where both families are available; every answer has already been checked.
  return addresses.find((entry) => entry.family === 4) ?? addresses[0]!;
}

function proxyFor(url: URL): string | undefined {
  // Only the proxy address is read here; it is never exposed in reports or logs.
  return url.protocol === 'https:'
    ? process.env.HTTPS_PROXY ?? process.env.https_proxy ?? process.env.HTTP_PROXY ?? process.env.http_proxy
    : process.env.HTTP_PROXY ?? process.env.http_proxy;
}

function proxyOptions(proxy: URL): RequestOptions {
  return {
    hostname: proxy.hostname.replace(/^\[|\]$/g, ''),
    port: proxy.port || (proxy.protocol === 'https:' ? 443 : 80),
  };
}

function collectResponse(response: IncomingMessage, maxBytes: number): Promise<TransportResult> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let bytes = 0;
    if (Number(response.headers['content-length']) > maxBytes) {
      response.destroy();
      reject(new Error('Website response exceeds the crawl size limit.'));
      return;
    }
    response.on('error', () => reject(new Error('Website response was interrupted.')));
    response.on('data', (chunk: Buffer) => {
      bytes += chunk.length;
      if (bytes > maxBytes) {
        reject(new Error('Website response exceeds the crawl size limit.'));
        response.destroy();
      } else chunks.push(chunk);
    });
    response.on('end', () => {
      try {
        let body = Buffer.concat(chunks);
        const encoding = (response.headers['content-encoding'] ?? 'identity').toLowerCase();
        if (encoding === 'gzip') body = gunzipSync(body, { maxOutputLength: maxBytes });
        else if (encoding === 'br') body = brotliDecompressSync(body, { maxOutputLength: maxBytes });
        else if (encoding === 'deflate') body = inflateSync(body, { maxOutputLength: maxBytes });
        else if (encoding !== 'identity') throw new Error('Website uses an unsupported response encoding.');
        resolve({ status: response.statusCode ?? 502, headers: response.headers, body: body.toString('utf8') });
      } catch { reject(new Error('Website response could not be decoded within crawl limits.')); }
    });
  });
}

async function requestPinned(input: TransportInput): Promise<TransportResult> {
  const { url, address, timeoutMs, maxBytes, proxyUrl } = input;
  const transportDeadline = Date.now() + timeoutMs;
  const hostAddress = address.family === 6 ? `[${address.address}]` : address.address;
  const port = url.protocol === 'https:' ? 443 : 80;
  const headers = {
    Host: url.host,
    'User-Agent': 'RivalScopeBot/0.1 (+https://github.com/itsanwar-dev/RivalScope)',
    Accept: 'text/html,application/xhtml+xml,application/xml,text/plain;q=0.9,*/*;q=0.1',
    'Accept-Encoding': 'identity',
    Connection: 'close',
  };

  const execute = (requester: typeof http | typeof https, options: RequestOptions): Promise<TransportResult> => new Promise((resolve, reject) => {
    const request = requester.request(options, (response) => {
      collectResponse(response, maxBytes).then(resolve, reject);
    });
    const timer = setTimeout(() => { reject(new Error('Website request timed out.')); request.destroy(); }, Math.max(1, transportDeadline - Date.now()));
    request.on('close', () => clearTimeout(timer));
    request.on('error', (error: NodeJS.ErrnoException) => {
      const tlsFailure = /CERT|TLS|SSL|VERIFY/.test(error.code ?? '');
      reject(new Error(tlsFailure ? 'Website TLS verification failed; no insecure fallback was attempted.' : proxyUrl ? 'The network proxy could not complete the website request. Check destination access in environment settings.' : 'The public website connection failed. Check the destination and retry.'));
    });
    request.end();
  });

  if (!proxyUrl) {
    return execute(url.protocol === 'https:' ? https : http, {
      hostname: address.address,
      port,
      path: url.pathname + url.search,
      method: 'GET',
      headers,
      agent: false,
      ...(url.protocol === 'https:' && !isIP(url.hostname.replace(/^\[|\]$/g, '')) ? { servername: url.hostname } : {}),
    });
  }

  let proxy: URL;
  try { proxy = new URL(proxyUrl); } catch { throw new Error('The configured network proxy is invalid.'); }
  if (!['http:', 'https:'].includes(proxy.protocol)) throw new Error('The configured proxy protocol is unsupported.');
  const proxyRequester = proxy.protocol === 'https:' ? https : http;
  const proxyAuth = proxy.username
    ? { 'Proxy-Authorization': `Basic ${Buffer.from(`${decodeURIComponent(proxy.username)}:${decodeURIComponent(proxy.password)}`).toString('base64')}` }
    : {};
  if (url.protocol === 'http:') {
    const result = await execute(proxyRequester, {
      ...proxyOptions(proxy),
      method: 'GET',
      path: `http://${hostAddress}${url.pathname}${url.search}`,
      headers: { ...headers, ...proxyAuth },
      agent: false,
    });
    if (result.status === 403 && result.headers['x-mitmproxy-blocked-reason']) throw new Error('Network policy blocked this website. Enable its destination in environment settings or use a supported crawl provider.');
    return result;
  }

  // CONNECT to the checked IP, not the hostname: the proxy cannot re-resolve the
  // competitor to an internal destination. Original Host and TLS SNI are preserved.
  const socket = await new Promise<import('node:net').Socket>((resolve, reject) => {
    const connect = proxyRequester.request({
      ...proxyOptions(proxy), method: 'CONNECT', path: `${hostAddress}:${port}`,
      headers: { Host: `${hostAddress}:${port}`, ...proxyAuth }, agent: false,
    });
    const timer = setTimeout(() => { reject(new Error('Network proxy connection timed out.')); connect.destroy(); }, Math.max(1, transportDeadline - Date.now()));
    connect.on('error', () => { clearTimeout(timer); reject(new Error('The network proxy connection failed. Check destination access in environment settings.')); });
    connect.on('connect', (response, connected, head) => {
      clearTimeout(timer);
      if (response.statusCode !== 200) {
        connected.destroy();
        reject(new Error(`Network proxy refused the website connection (HTTP ${response.statusCode ?? 502}). Allow the public destination or configure a crawl provider.`));
      } else {
        if (head.length) connected.unshift(head);
        resolve(connected);
      }
    });
    connect.end();
  });
  const agent = new https.Agent({ keepAlive: false });
  agent.createConnection = () => tls.connect({
    socket,
    servername: isIP(url.hostname.replace(/^\[|\]$/g, '')) ? undefined : url.hostname,
    rejectUnauthorized: true,
  });
  try {
    return await execute(https, { hostname: url.hostname.replace(/^\[|\]$/g, ''), port, method: 'GET', path: url.pathname + url.search, headers, agent });
  } finally { agent.destroy(); socket.destroy(); }
}

export async function fetchPublicPage(input: string, options: SafeFetchOptions = {}): Promise<PublicPage> {
  let url = validatePublicUrl(input);
  const timeoutMs = Math.min(Math.max(options.timeoutMs ?? 8000, 100), 30000);
  const deadline = Date.now() + timeoutMs;
  const maxBytes = Math.min(Math.max(options.maxBytes ?? 2_000_000, 1024), 5_000_000);
  const transport = options.transport ?? requestPinned;
  const redirectLimit = Math.min(Math.max(options.maxRedirects ?? 4, 0), 6);
  for (let redirects = 0; redirects <= redirectLimit; redirects++) {
    const remaining = deadline - Date.now();
    if (remaining <= 0) throw new Error('Website request timed out.');
    let dnsTimer: ReturnType<typeof setTimeout> | undefined;
    const address = await Promise.race([
      resolvePublicAddress(url, options.resolver),
      new Promise<never>((_resolve, reject) => { dnsTimer = setTimeout(() => reject(new Error('Website DNS lookup timed out.')), remaining); }),
    ]).finally(() => { if (dnsTimer) clearTimeout(dnsTimer); });
    const result = await transport({
      url, address, timeoutMs: Math.max(1, deadline - Date.now()), maxBytes,
      proxyUrl: options.proxyUrl === null ? undefined : options.proxyUrl ?? proxyFor(url),
    });
    if ([301, 302, 303, 307, 308].includes(result.status)) {
      const location = result.headers.location;
      if (!location) throw new Error('Website redirect is missing its destination.');
      if (redirects === redirectLimit) throw new Error('Website exceeded the redirect limit.');
      const destination = validatePublicUrl(new URL(location, url).href);
      if (url.protocol === 'https:' && destination.protocol !== 'https:') throw new Error('Website redirected to an insecure HTTP destination.');
      if (options.beforeRedirect) await options.beforeRedirect(destination);
      url = destination;
      continue;
    }
    return { url: url.href, status: result.status, contentType: String(result.headers['content-type'] ?? ''), body: result.body };
  }
  throw new Error('Website exceeded the redirect limit.');
}
