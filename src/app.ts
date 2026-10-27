import { createServer } from 'node:http';
import { handleApi } from './api.ts';
import { ReportStore } from './reports.ts';
import type { ReportStoreOptions } from './reports.ts';

export function createApp(options: ReportStoreOptions = {}) {
  const store = new ReportStore(options);
  return createServer({ requestTimeout: 15000, headersTimeout: 10000 }, (request, response) => {
    if ((request.url ?? '').startsWith('/api/')) {
      void handleApi(request, response, store);
      return;
    }
    response.setHeader('Content-Type', 'application/json; charset=utf-8');

    const path = (request.url ?? '/').split('?')[0];
    const knownRoute = path === '/' || path === '/health';
    let statusCode = 200;
    let payload: object;

    if (!knownRoute) {
      statusCode = 404;
      payload = { error: 'Not found' };
    } else if (request.method !== 'GET' && request.method !== 'HEAD') {
      statusCode = 405;
      response.setHeader('Allow', 'GET, HEAD');
      payload = { error: 'Method not allowed' };
    } else {
      payload = path === '/health'
        ? { status: 'ok' }
        : { name: 'RivalScope', status: 'research-api', capabilities: '/api/capabilities' };
    }

    response.statusCode = statusCode;
    response.end(request.method === 'HEAD' ? undefined : JSON.stringify(payload));
  });
}
