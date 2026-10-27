import { createServer } from 'node:http';

export function createApp() {
  return createServer((request, response) => {
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
        : { name: 'RivalScope', status: 'starter' };
    }

    response.statusCode = statusCode;
    response.end(request.method === 'HEAD' ? undefined : JSON.stringify(payload));
  });
}
