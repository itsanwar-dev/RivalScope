import assert from 'node:assert/strict';
import { once } from 'node:events';
import { mkdtemp, rm, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { setTimeout as delay } from 'node:timers/promises';
import { createApp } from '../dist/app.js';
import { researchWebsite } from '../dist/research.js';

const NOW = new Date('2026-10-27T12:00:00Z');
const website = 'https://brand.example/';
const fixtureFetcher = async (url) => ({
  url, status: url.endsWith('robots.txt') ? 404 : 200,
  contentType: 'text/html',
  body: url.endsWith('robots.txt') ? '' : `<!doctype html><title>Brand Example</title>
    <meta name="description" content="Products for better research">
    <h1>Meet our new collection</h1><a href="https://instagram.com/brandexample">Instagram</a>
    <a href="/pricing">See pricing</a><button>Shop now</button>`,
});
const researcher = (input) => researchWebsite(input, { fetcher: fixtureFetcher, now: NOW });

async function withApi(t, options = {}) {
  const directory = await mkdtemp(join(tmpdir(), 'rivalscope-api-'));
  const dataDir = join(directory, 'reports');
  const servers = [];
  const start = async () => {
    const server = createApp({ dataDir, now: () => NOW, researcher, ...options });
    servers.push(server);
    server.listen(0, '127.0.0.1');
    await once(server, 'listening');
    return { base: `http://127.0.0.1:${server.address().port}`, server };
  };
  t.after(async () => {
    for (const server of servers) {
      if (server.listening) await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
    }
    await rm(directory, { recursive: true, force: true });
  });
  return { ...await start(), start, dataDir };
}

const post = (id, platform = 'instagram') => ({
  id, platform, url: `https://example.com/${platform}/${id}`, date: '2026-10-20',
  text: 'Customer review and new collection', likes: 25, comments: 2, shares: 3,
});
const send = (base, path, body) => fetch(`${base}${path}`, {
  method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
});

async function finished(base, id) {
  for (let attempt = 0; attempt < 200; attempt++) {
    const response = await fetch(`${base}/api/reports/${id}`);
    assert.equal(response.status, 200);
    const report = await response.json();
    if (!['queued', 'running'].includes(report.status)) return report;
    await delay(10);
  }
  throw new Error('Research did not finish');
}

test('research API crawls source evidence, persists reports, imports data, exports and deletes', async (t) => {
  const { base, start } = await withApi(t);
  const created = await send(base, '/api/reports', { url: website });
  assert.equal(created.status, 202);
  const queued = await created.json();
  assert.equal(created.headers.get('location'), `/api/reports/${queued.id}`);
  const report = await finished(base, queued.id);
  assert.ok(['complete', 'partial'].includes(report.status));
  assert.equal(report.research.socialProfiles[0].platform, 'instagram');
  assert.ok(report.research.pages.some((page) => page.url === report.research.socialProfiles[0].sourceUrl));
  assert.equal(report.research.coverage.social, 'discovery-only');
  assert.equal(report.research.coverage.traffic, 'not-connected');
  assert.equal(report.intelligence.posts.length, 0);

  const imported = await send(base, `/api/reports/${queued.id}/import`, {
    posts: [post('one')],
    ads: [{ id: 'old-ad', platform: 'meta', url: 'https://facebook.com/ads/library/?id=old-ad', startDate: '2026-08-01', status: 'active' }],
  });
  assert.equal(imported.status, 200);
  const updated = await imported.json();
  assert.equal(updated.intelligence.topPosts[0].interactions, 30);
  assert.equal(updated.intelligence.ads[0].label, 'Winner candidate');
  assert.match(updated.intelligence.ads[0].signal, /longevity/i);

  const restarted = await start();
  const restored = await (await fetch(`${restarted.base}/api/reports/${queued.id}`)).json();
  assert.equal(restored.data.posts.length, 1);
  const listing = await (await fetch(`${base}/api/reports`)).json();
  assert.equal(listing.reports[0].posts, 1);
  const exported = await fetch(`${base}/api/reports/${queued.id}/export`);
  assert.match(exported.headers.get('content-disposition'), /attachment/);
  assert.equal((await exported.json()).id, queued.id);
  assert.equal((await fetch(`${base}/api/reports/${queued.id}`, { method: 'DELETE' })).status, 200);
  assert.equal((await fetch(`${base}/api/reports/${queued.id}`)).status, 404);
});

test('failed collection is reported as failed and still permits attributed imports', async (t) => {
  const { base } = await withApi(t, { researcher: async () => { throw new Error('Website DNS lookup timed out.'); } });
  const queued = await (await send(base, '/api/reports', { url: website })).json();
  const report = await finished(base, queued.id);
  assert.equal(report.status, 'failed');
  assert.equal(report.research, null);
  assert.match(report.error, /DNS/);
  const imported = await send(base, `/api/reports/${queued.id}/import`, { posts: [post('one')] });
  assert.equal(imported.status, 200);
  const updated = await imported.json();
  assert.equal(updated.status, 'failed');
  assert.equal(updated.data.posts[0].source, 'import');
});

test('input validation rejects unsafe targets, invalid JSON, oversize and cross-origin changes', async (t) => {
  const { base } = await withApi(t);
  for (const url of ['http://127.0.0.1', 'http://169.254.169.254', 'file:///etc/passwd', 'https://user:secret@example.com']) {
    assert.equal((await send(base, '/api/reports', { url })).status, 400);
  }
  assert.equal((await fetch(`${base}/api/reports`, { method: 'POST', body: '{}' })).status, 415);
  assert.equal((await fetch(`${base}/api/reports`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{',
  })).status, 400);
  assert.equal((await fetch(`${base}/api/reports`, {
    method: 'POST', headers: { 'Content-Type': 'application/json', Origin: 'https://evil.example' }, body: JSON.stringify({ url: website }),
  })).status, 403);
  assert.equal((await fetch(`${base}/api/reports`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ url: 'a'.repeat(2_000_001) }),
  })).status, 413);
});

test('concurrent imports merge safely and equal IDs on different platforms remain distinct', async (t) => {
  const { base } = await withApi(t);
  const queued = await (await send(base, '/api/reports', { url: website })).json();
  await finished(base, queued.id);
  const responses = await Promise.all([
    send(base, `/api/reports/${queued.id}/import`, { posts: [post('same', 'instagram')] }),
    send(base, `/api/reports/${queued.id}/import`, { posts: [post('same', 'facebook')] }),
  ]);
  assert.deepEqual(responses.map((response) => response.status), [200, 200]);
  const report = await (await fetch(`${base}/api/reports/${queued.id}`)).json();
  assert.equal(report.data.posts.length, 2);
  const duplicate = await send(base, `/api/reports/${queued.id}/import`, { posts: [post('same', 'instagram')] });
  assert.equal(duplicate.status, 200);
  assert.equal((await duplicate.json()).data.posts.length, 2);
});

test('research concurrency is bounded and imports/deletion wait for collection', async (t) => {
  let release;
  const gate = new Promise((resolve) => { release = resolve; });
  const { base } = await withApi(t, { researcher: async (input) => { await gate; return researcher(input); } });
  const first = await (await send(base, '/api/reports', { url: website })).json();
  const second = await (await send(base, '/api/reports', { url: website })).json();
  assert.equal((await send(base, '/api/reports', { url: website })).status, 400);
  assert.equal((await send(base, `/api/reports/${first.id}/import`, { posts: [post('one')] })).status, 409);
  assert.equal((await fetch(`${base}/api/reports/${first.id}`, { method: 'DELETE' })).status, 409);
  release();
  await Promise.all([finished(base, first.id), finished(base, second.id)]);
});

test('capability responses disclose the exact automation boundaries', async (t) => {
  const { base } = await withApi(t);
  const response = await fetch(`${base}/api/capabilities`);
  assert.equal(response.status, 200);
  const capabilities = await response.json();
  assert.equal(capabilities.website.mode, 'automatic');
  assert.equal(capabilities.social.automatedHistory, false);
  assert.equal(capabilities.ads.automaticMetaLibrary, false);
  assert.equal(capabilities.traffic.available, false);
});

test('interrupted-job recovery cannot overwrite a concurrent import or recreate a deleted report', async (t) => {
  const { base, dataDir } = await withApi(t);
  const queued = await (await send(base, '/api/reports', { url: website })).json();
  await finished(base, queued.id);
  const file = join(dataDir, `${queued.id}.json`);
  const saved = JSON.parse(await readFile(file, 'utf8'));
  saved.status = 'running';
  await writeFile(file, JSON.stringify(saved));
  const [read, imported] = await Promise.all([
    fetch(`${base}/api/reports/${queued.id}`),
    send(base, `/api/reports/${queued.id}/import`, { posts: [post('restored')] }),
  ]);
  assert.equal(read.status, 200);
  assert.equal(imported.status, 200);
  const report = await (await fetch(`${base}/api/reports/${queued.id}`)).json();
  assert.equal(report.status, 'failed');
  assert.match(report.error, /interrupted/);
  assert.equal(report.data.posts.length, 1);

  report.status = 'running';
  await writeFile(file, JSON.stringify(report));
  const results = await Promise.all([
    fetch(`${base}/api/reports/${queued.id}`),
    fetch(`${base}/api/reports/${queued.id}`, { method: 'DELETE' }),
  ]);
  assert.equal(results[1].status, 200);
  assert.equal((await fetch(`${base}/api/reports/${queued.id}`)).status, 404);
});
