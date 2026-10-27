import assert from 'node:assert/strict';
import { once } from 'node:events';
import { spawn } from 'node:child_process';
import { test } from 'node:test';
import { createApp } from '../dist/app.js';

async function withServer(t) {
  const server = createApp();
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  t.after(() => new Promise((resolve, reject) => {
    server.close((error) => error ? reject(error) : resolve());
  }));
  return `http://127.0.0.1:${server.address().port}`;
}

test('health endpoint reports readiness over HTTP', async (t) => {
  const base = await withServer(t);
  const response = await fetch(`${base}/health`);
  assert.equal(response.status, 200);
  assert.match(response.headers.get('content-type'), /application\/json/);
  assert.deepEqual(await response.json(), { status: 'ok' });
});

test('root identifies the starter and accepts query strings', async (t) => {
  const base = await withServer(t);
  const response = await fetch(`${base}/?check=1`);
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { name: 'RivalScope', status: 'research-api', capabilities: '/api/capabilities' });
});

test('unknown paths return 404', async (t) => {
  const base = await withServer(t);
  const response = await fetch(`${base}/missing`);
  assert.equal(response.status, 404);
  assert.deepEqual(await response.json(), { error: 'Not found' });
});

test('unsupported methods return 405 without reporting health success', async (t) => {
  const base = await withServer(t);
  const response = await fetch(`${base}/health`, { method: 'POST' });
  assert.equal(response.status, 405);
  assert.equal(response.headers.get('allow'), 'GET, HEAD');
});

test('HEAD reports readiness without a response body', async (t) => {
  const base = await withServer(t);
  const response = await fetch(`${base}/health`, { method: 'HEAD' });
  assert.equal(response.status, 200);
  assert.equal(await response.text(), '');
});

test('compiled entry starts on the configured port and shuts down cleanly', { timeout: 10000 }, async (t) => {
  const child = spawn(process.execPath, ['dist/server.js'], {
    cwd: new URL('..', import.meta.url),
    env: { ...process.env, HOST: '127.0.0.1', PORT: '0' },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  t.after(() => { if (child.exitCode === null) child.kill('SIGKILL'); });
  const exited = once(child, 'exit');
  let output = '';
  const port = await new Promise((resolve, reject) => {
    child.on('error', reject);
    child.on('exit', (code) => reject(new Error(`Server exited before startup: ${code}`)));
    child.stdout.on('data', (chunk) => {
      output += chunk;
      const match = output.match(/listening on 127\.0\.0\.1:(\d+)/);
      if (match) resolve(Number(match[1]));
    });
  });
  const response = await fetch(`http://127.0.0.1:${port}/health`);
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { status: 'ok' });
  child.kill('SIGTERM');
  assert.deepEqual(await exited, [0, null]);
});
