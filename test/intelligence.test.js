import assert from 'node:assert/strict';
import { test } from 'node:test';
import { analyzeIntelligence, ImportValidationError, parseImport } from '../dist/intelligence.js';

const now = new Date('2026-10-27T12:00:00Z');
const post = (extra = {}) => ({ platform: 'instagram', url: 'https://instagram.com/p/one', date: '2026-10-20', text: 'New collection and a customer review', ...extra });
const ad = (extra = {}) => ({ id: 'one', platform: 'meta', url: 'https://facebook.com/ads/library/?id=one', startDate: '2026-08-01', status: 'active', ...extra });

test('import normalizes timestamps and leaves unknown metrics absent', () => {
  const result = parseImport({ posts: [post({ date: '2026-10-20T14:00:00+02:00' })] }, now);
  assert.equal(result.posts[0].date, '2026-10-20T12:00:00.000Z');
  assert.equal(result.posts[0].source, 'import');
  assert.equal(Object.hasOwn(result.posts[0], 'likes'), false);
  assert.match(result.posts[0].id, /^post-/);
  assert.deepEqual(result.ads, []);
});

test('invalid dates, ambiguous timestamps, future dates and unsafe links fail validation', () => {
  for (const date of ['2026-02-30', '2026-10-20T12:00:00', '2026-10-20T24:01:00Z', '2026-10-28', '2026-10-20T12:00:00+14:01']) {
    assert.throws(() => parseImport({ posts: [post({ date })] }, now), ImportValidationError, date);
  }
  for (const url of ['javascript:alert(1)', 'data:text/html,example', 'https://user:password@example.com/post', '/relative']) {
    assert.throws(() => parseImport({ posts: [post({ url })] }, now), /HTTP\(S\) URL/);
  }
  assert.doesNotThrow(() => parseImport({ posts: [post({ date: '2024-02-29' })] }, now));
  assert.throws(() => parseImport({ posts: [post({ date: '2025-02-29' })] }, now), /calendar date/);
});

test('bad metrics, duplicate records and oversized imports cannot inflate analysis', () => {
  for (const likes of [-1, 1.2, Infinity, NaN, null, '20', Number.MAX_SAFE_INTEGER + 1]) {
    assert.throws(() => parseImport({ posts: [post({ likes })] }, now), /safe integer/);
  }
  assert.throws(() => parseImport({ posts: [post(), post()] }, now), /duplicates/);
  assert.doesNotThrow(() => parseImport({ posts: [post({ id: '1' }), post({ id: '1', platform: 'facebook', url: 'https://facebook.com/post/1' })] }, now));
  assert.throws(() => parseImport({ ads: [ad(), ad()] }, now), /duplicates/);
  assert.throws(() => parseImport({ posts: Array.from({ length: 1001 }, () => post()) }, now), /at most 1000/);
  const overflow = parseImport({ posts: [post({ likes: Number.MAX_SAFE_INTEGER, comments: 1 })] }, now);
  assert.throws(() => analyzeIntelligence(overflow.posts, [], now), /interaction total/);
});

test('rolling window includes the exact boundary and excludes older posts', () => {
  const result = parseImport({ posts: [
    post({ url: 'https://instagram.com/p/boundary', date: '2026-09-27T12:00:00Z' }),
    post({ url: 'https://instagram.com/p/older', date: '2026-09-27T11:59:59.999Z' }),
    post({ url: 'https://instagram.com/p/end', date: now.toISOString() }),
  ] }, now);
  const report = analyzeIntelligence(result.posts, [], now);
  assert.equal(report.windowStart, '2026-09-27T12:00:00.000Z');
  assert.equal(report.coverage.recentPosts, 2);
  assert.equal(report.coverage.excludedOlderPosts, 1);
  assert.equal(report.cadence.activeDays, 2);
  assert.equal(report.topPosts.length, 0);
});

test('content ranking separates views, measured zeros, partial counts and unknowns', () => {
  const result = parseImport({ posts: [
    post({ url: 'https://instagram.com/p/views', views: 1_000_000 }),
    post({ url: 'https://instagram.com/p/partial', likes: 20, views: 100 }),
    post({ url: 'https://instagram.com/p/complete', likes: 10, comments: 8, shares: 5, views: 0 }),
    post({ url: 'https://instagram.com/p/zero', likes: 0, comments: 0, shares: 0 }),
  ] }, now);
  const report = analyzeIntelligence(result.posts, [], now);
  assert.deepEqual(report.topPosts.map((item) => item.interactions), [23, 20, 0]);
  assert.equal(report.topPosts[0].interactionRate, null);
  assert.equal(report.topPosts[1].interactionRate, 20);
  assert.equal(report.topPosts[1].metricCoverage, 'partial');
  assert.equal(report.posts.find((item) => item.url.endsWith('/views')).interactions, null);
  assert.equal(report.coverage.postsWithPartialMetrics, 1);
  assert.match(report.limitations.join(' '), /not website traffic/);
});

test('oldest active ads win longevity ranking, ties share rank, and inactive ads remain', () => {
  const result = parseImport({ ads: [
    ad({ id: 'new', startDate: '2026-10-01' }),
    ad({ id: 'old-a', startDate: '2026-06-01' }),
    ad({ id: 'old-b', startDate: '2026-06-01' }),
    ad({ id: 'inactive', status: 'inactive', startDate: '2026-01-01' }),
    ad({ id: 'ended', status: 'inactive', startDate: '2026-08-01', endDate: '2026-08-15' }),
  ] }, now);
  const report = analyzeIntelligence([], result.ads, now);
  assert.deepEqual(report.ads.slice(0, 3).map((item) => [item.id, item.label, item.rank]), [
    ['old-a', 'Winner candidate', 1], ['old-b', 'Winner candidate', 1], ['new', 'Active ad', 3],
  ]);
  assert.equal(report.ads.length, 5);
  assert.equal(report.ads.find((item) => item.id === 'inactive').daysRunning, null);
  assert.equal(report.ads.find((item) => item.id === 'ended').daysRunning, 14);
  assert.match(report.ads[0].signal, /performance and uninterrupted delivery are unverified/);
  assert.equal(report.coverage.activeAds, 3);
  assert.equal(report.coverage.inactiveAds, 2);
});

test('inconsistent ad dates fail rather than creating misleading durations', () => {
  assert.throws(() => parseImport({ ads: [ad({ startDate: '2026-10-28' })] }, now), /future/);
  assert.throws(() => parseImport({ ads: [ad({ status: 'inactive', endDate: '2026-07-31' })] }, now), /precede/);
  assert.throws(() => parseImport({ ads: [ad({ endDate: '2026-10-01' })] }, now), /cannot be active/);
});

test('themes include source evidence, can overlap, and empty samples avoid strategy claims', () => {
  const result = parseImport({ posts: [post({ text: 'New collection: a customer review, plus a limited time offer' })] }, now);
  const report = analyzeIntelligence(result.posts, [], now);
  assert.ok(report.themes.length >= 3);
  assert.ok(report.themes.every((theme) => theme.evidenceUrls[0] === result.posts[0].url));
  const empty = analyzeIntelligence([], [], now);
  assert.equal(empty.topPosts.length, 0);
  assert.equal(empty.themes.length, 0);
  assert.equal(empty.ads.length, 0);
  assert.equal(empty.cadence.postsPerWeek, 0);
  assert.match(empty.summary[0], /insufficient evidence/);
});
