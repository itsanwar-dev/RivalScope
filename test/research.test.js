import assert from 'node:assert/strict';
import { test } from 'node:test';
import { fetchPublicPage, isPublicAddress, resolvePublicAddress, validatePublicUrl } from '../dist/safe-fetch.js';
import { normalizeSocialProfile, parseRobots, researchWebsite, robotsAllows } from '../dist/research.js';

const publicResolver = async () => [{ address: '93.184.216.34', family: 4 }];
const page = (url, body, contentType = 'text/html', status = 200) => ({ url, status, contentType, body });

test('rejects alternate private IP representations, credentials and unsafe protocols before requests', () => {
  for (const target of [
    'http://127.0.0.1', 'http://2130706433', 'http://0x7f000001', 'http://0177.0.0.1',
    'http://[::1]', 'http://[::ffff:127.0.0.1]', 'http://[::ffff:7f00:1]', 'http://169.254.169.254',
    'http://localhost.', 'http://box.local', 'https://user:password@example.com', 'ftp://example.com',
    'https://example.com:8443',
  ]) assert.throws(() => validatePublicUrl(target), undefined, target);
  assert.equal(validatePublicUrl('https://example.com/about#team').href, 'https://example.com/about');
});

test('public address boundary rejects private, reserved, transition and documentation ranges', () => {
  for (const address of ['0.1.2.3','10.1.2.3','100.64.0.1','172.16.0.1','192.168.1.1','192.0.2.1','198.18.0.1','203.0.113.1','224.0.0.1','255.255.255.255','::','::ffff:8.8.8.8','64:ff9b::a00:1','2001:db8::1','2002:a00:1::1','3fff::1','fc00::1','fe80::1']) {
    assert.equal(isPublicAddress(address), false, address);
  }
  for (const address of ['8.8.8.8','93.184.216.34','2606:4700:4700::1111','2001:4860:4860::8888']) assert.equal(isPublicAddress(address), true, address);
});

test('mixed public/private DNS is rejected and a checked address is passed directly to transport', async () => {
  await assert.rejects(resolvePublicAddress(new URL('https://example.com'), async () => [
    { address: '93.184.216.34', family: 4 }, { address: '10.0.0.1', family: 4 },
  ]), /private|reserved/);
  let resolutions = 0;
  await fetchPublicPage('https://example.com', {
    resolver: async () => { resolutions++; return publicResolver(); },
    transport: async ({ address, url }) => {
      assert.deepEqual(address, { address: '93.184.216.34', family: 4 });
      assert.equal(url.hostname, 'example.com');
      return { status: 200, headers: { 'content-type': 'text/html' }, body: '<h1>Public</h1>' };
    },
  });
  assert.equal(resolutions, 1, 'transport receives checked address instead of re-resolving hostname');
});

test('redirects recheck DNS and private destinations are never requested', async () => {
  let calls = 0;
  await assert.rejects(fetchPublicPage('https://example.com', {
    resolver: publicResolver,
    transport: async () => { calls++; return { status: 302, headers: { location: 'http://127.0.0.1/private' }, body: '' }; },
  }), /Private|reserved/);
  assert.equal(calls, 1);
  await assert.rejects(fetchPublicPage('https://example.com', {
    resolver: async (hostname) => hostname === 'internal.example' ? [{ address: '192.168.0.1', family: 4 }] : publicResolver(),
    transport: async () => ({ status: 302, headers: { location: 'https://internal.example' }, body: '' }),
  }), /private|reserved/);
});

test('redirect hook enforces crawl policy before the redirected page is fetched', async () => {
  const requested = [];
  await assert.rejects(fetchPublicPage('https://example.com', {
    resolver: publicResolver,
    beforeRedirect: async (destination) => {
      const policy = parseRobots('User-agent: *\nDisallow: /private');
      if (!robotsAllows(policy, destination.href)) throw new Error('robots denied');
    },
    transport: async ({ url }) => { requested.push(url.href); return { status: 302, headers: { location: '/private' }, body: '' }; },
  }), /robots denied/);
  assert.deepEqual(requested, ['https://example.com/']);
});

test('redirect loops and HTTPS downgrades stop within limits', async () => {
  let calls = 0;
  await assert.rejects(fetchPublicPage('https://example.com', {
    resolver: publicResolver, maxRedirects: 2,
    transport: async () => { calls++; return { status: 302, headers: { location: '/again' }, body: '' }; },
  }), /redirect limit/);
  assert.equal(calls, 3);
  await assert.rejects(fetchPublicPage('https://example.com', {
    resolver: publicResolver,
    transport: async () => ({ status: 302, headers: { location: 'http://example.com/' }, body: '' }),
  }), /insecure/);
});

test('robots chooses specific agents, longest rules, allow ties and wildcard/end anchors', () => {
  const policy = parseRobots('User-agent: *\nDisallow: /\nUser-agent: RivalScopeBot\nDisallow: /private\nAllow: /private/open\nDisallow: /*.pdf$\nDisallow: /same\nAllow: /same');
  assert.equal(robotsAllows(policy, 'https://example.com/'), true);
  assert.equal(robotsAllows(policy, 'https://example.com/private/no'), false);
  assert.equal(robotsAllows(policy, 'https://example.com/private/open'), true);
  assert.equal(robotsAllows(policy, 'https://example.com/report.pdf'), false);
  assert.equal(robotsAllows(policy, 'https://example.com/report.pdf/page'), true);
  assert.equal(robotsAllows(policy, 'https://example.com/same'), true);
  assert.equal(parseRobots('User-agent: *\nCrawl-delay: 2').crawlDelay, 2);
  assert.throws(() => parseRobots(`User-agent: *\nDisallow: /${'a'.repeat(1025)}`), /limits/);
  assert.throws(() => parseRobots(`User-agent: *\n${'Disallow: /x\n'.repeat(501)}`), /limits/);
});

test('social discovery canonicalizes profile URLs and ignores share links and malformed paths', () => {
  const base = 'https://brand.example/';
  assert.equal(normalizeSocialProfile('https://www.instagram.com/brand/?utm_source=web', base)?.url, 'https://instagram.com/brand');
  assert.equal(normalizeSocialProfile('https://twitter.com/brand/status/123', base)?.url, 'https://x.com/brand');
  assert.equal(normalizeSocialProfile('https://youtube.com/channel/UC123', base)?.handle, 'UC123');
  assert.equal(normalizeSocialProfile('https://facebook.com/profile.php?id=123&utm_source=x', base)?.url, 'https://facebook.com/profile.php?id=123');
  for (const link of ['https://facebook.com/sharer.php?u=brand','https://x.com/intent/tweet','https://instagram.com/p/abc','https://tiktok.com/login','https://www.instagram.com/%E0%A4%A']) assert.equal(normalizeSocialProfile(link, base), undefined, link);
});

test('crawl discovers footer socials, current dated website content and source-backed themes', async () => {
  const requested = [];
  const now = new Date('2026-10-27T12:00:00Z');
  const html = `<!doctype html><html><head><title>Acme | Better equipment</title><meta property="og:site_name" content="Acme"><meta name="description" content="Equipment for creative teams"><script type="application/ld+json">{"@type":"Organization","name":"Acme","sameAs":["https://instagram.com/acme","https://linkedin.com/company/acme"]}</script></head><body><main><h1>Built for creative teams</h1><p>Save 20% on selected equipment.</p><a href="/blog">Learn more</a><article><h2><a href="/blog/guide">How to choose equipment</a></h2><time datetime="2026-10-20"></time><p>A practical guide.</p></article><article><h2>Old post</h2><time datetime="2026-08-01"></time></article></main><footer><a href="https://facebook.com/acme?utm=footer">Facebook</a><a href="https://facebook.com/sharer.php?u=site">Share</a></footer></body></html>`;
  const fetcher = async (url) => {
    requested.push(url);
    if (url.endsWith('/robots.txt')) return page(url, 'User-agent: *\nDisallow: /blog/guide', 'text/plain');
    if (url === 'https://acme.example/') return page(url, html);
    if (url === 'https://acme.example/blog') return page(url, '<title>Acme blog</title><h1>Tips and guides</h1>');
    throw new Error('Unexpected fixture URL');
  };
  const report = await researchWebsite({ url: 'https://acme.example/', maxPages: 4 }, { fetcher, now });
  assert.equal(report.brand, 'Acme');
  assert.equal(report.pages.length, 2);
  assert.deepEqual(report.socialProfiles.map((item) => item.platform).sort(), ['facebook','instagram','linkedin']);
  assert.equal(report.content.length, 1);
  assert.equal(report.content[0].title, 'How to choose equipment');
  assert.equal(report.content[0].sourceUrl, 'https://acme.example/');
  assert.ok(report.headlines.every((item) => item.sourceUrl));
  assert.ok(report.themes.some((theme) => theme.name === 'Education'));
  assert.ok(report.offers.some((item) => item.text.includes('20%')));
  assert.equal(report.coverage.social, 'discovery-only');
  assert.equal(report.coverage.traffic, 'not-connected');
  assert.ok(!requested.some((url) => url.endsWith('/blog/guide')));
});

test('RSS content honors the last 30 days and website crawl is bounded', async () => {
  const calls = [];
  const fetcher = async (url) => {
    calls.push(url);
    if (url.endsWith('/robots.txt')) return page(url, '', 'text/plain', 404);
    if (url.endsWith('/feed')) return page(url, '<rss><channel><item><title>Recent guide</title><link>https://brand.example/post</link><pubDate>20 Oct 2026 12:00:00 GMT</pubDate></item><item><title>Old guide</title><pubDate>20 Aug 2026 12:00:00 GMT</pubDate></item></channel></rss>', 'application/rss+xml');
    return page(url, '<title>Brand</title><link rel="alternate" type="application/rss+xml" href="/feed"><a href="/blog">Blog</a><a href="/about">About</a>');
  };
  const report = await researchWebsite({ url:'https://brand.example', maxPages:2 }, {fetcher,now:new Date('2026-10-27T12:00:00Z')});
  assert.equal(calls.length, 3, 'robots plus two bounded page requests');
  assert.equal(report.content.length, 1);
  assert.equal(report.content[0].title, 'Recent guide');
  assert.ok(report.warnings.some((warning) => warning.includes('sample limit')));
});

test('root access failures and robots restrictions do not produce fabricated reports', async () => {
  await assert.rejects(researchWebsite({url:'https://brand.example'}, {fetcher:async (url)=>page(url,'User-agent: *\nDisallow: /','text/plain')}), /disallows/);
  await assert.rejects(researchWebsite({url:'https://brand.example'}, {fetcher:async (url)=>page(url,'','text/plain',403)}), /robots.txt could not be checked/);
  await assert.rejects(researchWebsite({url:'https://brand.example'}, {fetcher:async (url)=>url.endsWith('/robots.txt')?page(url,'','text/plain',404):page(url,'Denied','text/html',403)}), /could not collect/);
  await assert.rejects(researchWebsite({url:'https://brand.example'}, {fetcher:async (url)=>page(url,'User-agent: *\nCrawl-delay: 30','text/plain')}), /crawl delay/);
});

test('secondary errors give partial coverage and undated content is not claimed as recent', async () => {
  const report = await researchWebsite({url:'https://brand.example'}, {fetcher:async (url)=> {
    if (url.endsWith('/robots.txt')) return page(url,'','text/plain',404);
    if (url.endsWith('/blog')) return page(url,'Unavailable','text/html',503);
    return page(url,'<title>Brand</title><a href="/blog">Blog</a><article><h2>Undated post</h2></article>');
  }});
  assert.equal(report.pages.length,1);
  assert.equal(report.content.length,0);
  assert.equal(report.coverage.website,'partial');
  assert.ok(report.warnings.some((warning)=>warning.includes('No dated')));
});
