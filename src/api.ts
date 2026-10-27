import type { IncomingMessage, ServerResponse } from 'node:http';
import { ReportStore } from './reports.ts';
import { ImportValidationError } from './intelligence.ts';

class RequestError extends Error {
  readonly status: number;
  constructor(message: string, status: number) { super(message); this.status = status; }
}

function json(response: ServerResponse, status: number, value: unknown) {
  response.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
    'X-Content-Type-Options': 'nosniff',
  });
  response.end(JSON.stringify(value));
}

function validateOrigin(request: IncomingMessage) {
  if (request.headers.origin) {
    let origin: URL;
    try { origin = new URL(request.headers.origin); }
    catch { throw new RequestError('Invalid request origin.', 403); }
    if (origin.host !== request.headers.host) throw new RequestError('Cross-origin changes are not allowed.', 403);
  }
}

async function readJson(request: IncomingMessage): Promise<unknown> {
  if ((request.headers['content-type'] ?? '').split(';')[0]?.trim().toLowerCase() !== 'application/json') {
    throw new RequestError('Send a JSON body with Content-Type: application/json.', 415);
  }
  const chunks: Buffer[] = [];
  let bytes = 0;
  for await (const chunk of request.iterator({ destroyOnReturn: false })) {
    bytes += chunk.length;
    if (bytes > 2_000_000) {
      request.resume();
      throw new RequestError('Import exceeds the 2 MB request limit.', 413);
    }
    chunks.push(Buffer.from(chunk));
  }
  try { return JSON.parse(Buffer.concat(chunks).toString('utf8')) as unknown; }
  catch { throw new RequestError('The request body is not valid JSON.', 400); }
}

export async function handleApi(request: IncomingMessage, response: ServerResponse, store: ReportStore) {
  const path = (request.url ?? '/').split('?')[0]!;
  const method = request.method ?? 'GET';
  try {
    if (method !== 'GET' && method !== 'HEAD') validateOrigin(request);
    if (path === '/api/capabilities' && method === 'GET') {
      json(response, 200, {
        mode: 'single-workspace',
        website: { mode: 'automatic', maxPages: 6, requires: 'Public DNS and outbound web access; robots.txt must allow crawling.' },
        social: { mode: 'profile-discovery-and-import', automatedHistory: false },
        ads: { mode: 'import', automaticMetaLibrary: false },
        traffic: { available: false, note: 'Interactions and ad longevity do not measure traffic or conversions.' },
      });
      return;
    }
    if (path === '/api/reports') {
      if (method === 'GET') { json(response, 200, { reports: await store.list() }); return; }
      if (method === 'POST') {
        let report;
        try { report = await store.create(await readJson(request)); }
        catch (error) {
          if (error instanceof RequestError) throw error;
          throw new RequestError(error instanceof Error ? error.message : 'Report could not be created.', 400);
        }
        response.setHeader('Location', `/api/reports/${report.id}`);
        json(response, 202, report);
        return;
      }
      response.setHeader('Allow', 'GET, POST');
      throw new RequestError('Method not allowed.', 405);
    }

    const match = path.match(/^\/api\/reports\/([a-f\d-]{36})(\/(import|export))?$/i);
    if (match) {
      const id = match[1]!;
      const action = match[3];
      if (method === 'GET' && (!action || action === 'export')) {
        const report = await store.get(id);
        if (!report) throw new RequestError('Report not found.', 404);
        if (action === 'export') response.setHeader('Content-Disposition', `attachment; filename="rivalscope-${id}.json"`);
        json(response, 200, report);
        return;
      }
      if (method === 'POST' && action === 'import') {
        let report;
        try { report = await store.import(id, await readJson(request)); }
        catch (error) {
          if (error instanceof RequestError || error instanceof ImportValidationError) throw error;
          throw new RequestError(error instanceof Error ? error.message : 'Import could not be saved.', 409);
        }
        if (!report) throw new RequestError('Report not found.', 404);
        json(response, 200, report);
        return;
      }
      if (method === 'DELETE' && !action) {
        let removed;
        try { removed = await store.remove(id); }
        catch (error) { throw new RequestError(error instanceof Error ? error.message : 'Report could not be removed.', 409); }
        if (!removed) throw new RequestError('Report not found.', 404);
        json(response, 200, { deleted: true });
        return;
      }
      response.setHeader('Allow', action === 'import' ? 'POST' : action === 'export' ? 'GET' : 'GET, DELETE');
      throw new RequestError('Method not allowed.', 405);
    }
    throw new RequestError('API endpoint not found.', 404);
  } catch (error) {
    if (error instanceof RequestError) {
      if (error.status === 413) response.setHeader('Connection', 'close');
      json(response, error.status, { error: error.message });
    }
    else if (error instanceof ImportValidationError) json(response, 400, { error: error.message });
    else json(response, 500, { error: 'The research workspace could not complete this request.' });
  }
}
