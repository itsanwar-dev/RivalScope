import { load } from 'cheerio';
import { fetchPublicPage, validatePublicUrl } from './safe-fetch.ts';
import type { PublicPage } from './safe-fetch.ts';

export interface Evidence { text: string; sourceUrl: string }
export interface SocialProfile {
  platform: 'instagram' | 'facebook' | 'tiktok' | 'youtube' | 'linkedin' | 'x' | 'pinterest';
  url: string;
  handle: string;
  sourceUrl: string;
}
export interface CrawlPage {
  url: string;
  title: string;
  description: string;
  headings: string[];
  excerpt: string;
  fetchedAt: string;
}
export interface WebsiteContent {
  title: string;
  url: string;
  sourceUrl: string;
  publishedAt: string;
  excerpt: string;
  platform: 'website';
}
export interface WebsiteResearch {
  url: string;
  domain: string;
  brand: string;
  title: string;
  description: string;
  collectedAt: string;
  windowStart: string;
  pages: CrawlPage[];
  socialProfiles: SocialProfile[];
  content: WebsiteContent[];
  headlines: Evidence[];
  offers: Evidence[];
  callsToAction: Evidence[];
  themes: { name: string; count: number; evidence: Evidence[] }[];
  warnings: string[];
  coverage: {
    website: 'complete' | 'partial';
    social: 'discovery-only';
    ads: 'not-connected';
    traffic: 'not-connected';
    notes: string[];
  };
}
export type ResearchFetcher = (url: string) => Promise<PublicPage>;
export interface ResearchOptions { fetcher?: ResearchFetcher; now?: Date }

const clean = (text: string | undefined, length = 500) => (text ?? '').replace(/\s+/g, ' ').trim().slice(0, length);
const unique = <T>(values: T[], key: (value: T) => string): T[] => [...new Map(values.map((value) => [key(value), value])).values()];

export function normalizeSocialProfile(input: string, sourceUrl: string): SocialProfile | undefined {
  let url: URL;
  try { url = new URL(input, sourceUrl); } catch { return; }
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) return;
  const host = url.hostname.toLowerCase().replace(/^www\./, '').replace(/^m\./, '');
  const segments = url.pathname.split('/').filter(Boolean);
  const first = segments[0];
  if (!first || /^(share|sharer|sharer\.php|share\.php|intent|login|signup|dialog|privacy|policies|terms|ads|ads-library|hashtag|explore|reel|reels|p|stories|status|watch|shorts|groups|events)$/i.test(first)) return;
  let platform: SocialProfile['platform'];
  let path = `/${first}`;
  let handle = first.replace(/^@/, '');
  if (host === 'instagram.com') platform = 'instagram';
  else if (host === 'facebook.com' || host === 'fb.com') {
    platform = 'facebook';
    if (first === 'profile.php') {
      const id = url.searchParams.get('id');
      if (!id || !/^\d+$/.test(id)) return;
      path = `/profile.php?id=${id}`;
      handle = id;
    } else if (first === 'pages') {
      if (segments.length < 3) return;
      path = `/${segments.slice(0, 3).join('/')}`;
      handle = segments[1]!;
    }
  } else if (host === 'tiktok.com') {
    if (!first.startsWith('@')) return;
    platform = 'tiktok';
  } else if (host === 'youtube.com') {
    if (first === 'channel' || first === 'c' || first === 'user') {
      if (!segments[1]) return;
      path = `/${first}/${segments[1]}`;
      handle = segments[1];
    } else if (!first.startsWith('@')) return;
    platform = 'youtube';
  } else if (host === 'linkedin.com') {
    if (!['company', 'in', 'school'].includes(first) || !segments[1]) return;
    platform = 'linkedin';
    path = `/${first}/${segments[1]}`;
    handle = segments[1];
  } else if (host === 'x.com' || host === 'twitter.com') platform = 'x';
  else if (host === 'pinterest.com') platform = 'pinterest';
  else return;
  const canonicalHost = { instagram: 'instagram.com', facebook: 'facebook.com', tiktok: 'tiktok.com', youtube: 'youtube.com', linkedin: 'linkedin.com', x: 'x.com', pinterest: 'pinterest.com' }[platform];
  try { handle = decodeURIComponent(handle); } catch { return; }
  return { platform, url: `https://${canonicalHost}${path}`, handle: clean(handle, 100), sourceUrl };
}

interface RobotsRule { allow: boolean; path: string }
export interface RobotsPolicy { rules: RobotsRule[]; crawlDelay: number }

export function parseRobots(text: string): RobotsPolicy {
  if (text.length > 500_000) throw new Error('robots.txt exceeds safe parsing limits; use a dedicated crawl provider.');
  let ruleCount = 0;
  const groups: { agents: string[]; rules: RobotsRule[]; crawlDelay: number }[] = [];
  let current: { agents: string[]; rules: RobotsRule[]; crawlDelay: number } | undefined;
  let hasDirectives = false;
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.replace(/#.*$/, '').trim();
    const separator = line.indexOf(':');
    if (separator < 0) continue;
    const field = line.slice(0, separator).trim().toLowerCase();
    const value = line.slice(separator + 1).trim();
    if (field === 'user-agent') {
      if (!current || hasDirectives) {
        current = { agents: [], rules: [], crawlDelay: 0 };
        groups.push(current);
        hasDirectives = false;
      }
      if (value) current.agents.push(value.toLowerCase());
      if (groups.length > 200) throw new Error('robots.txt exceeds safe parsing limits.');
    } else if (current) {
      hasDirectives = true;
      if ((field === 'allow' || field === 'disallow') && value.startsWith('/')) {
        if (++ruleCount > 500 || value.length > 1024) throw new Error('robots.txt exceeds safe rule limits; use a dedicated crawl provider.');
        current.rules.push({ allow: field === 'allow', path: value });
      }
      if (field === 'crawl-delay' && /^\d+(\.\d+)?$/.test(value)) current.crawlDelay = Number(value);
    }
  }
  const scored = groups.map((group) => ({ group, score: Math.max(-1, ...group.agents.map((agent) => agent === '*' ? 0 : 'rivalscopebot'.includes(agent) ? agent.length : -1)) }));
  const best = Math.max(-1, ...scored.map((entry) => entry.score));
  const selected = scored.filter((entry) => entry.score === best && best >= 0).map((entry) => entry.group);
  return { rules: selected.flatMap((group) => group.rules), crawlDelay: Math.max(0, ...selected.map((group) => group.crawlDelay)) };
}

// Match '*' and the optional trailing '$' without constructing an attacker-
// controlled regular expression. Each fixed segment is found in sequence.
function robotsPatternMatches(pattern: string, path: string): boolean {
  const anchored = pattern.endsWith('$');
  const parts = (anchored ? pattern.slice(0, -1) : pattern).split('*');
  const first = parts[0] ?? '';
  if (!path.startsWith(first)) return false;
  let position = first.length;
  if (parts.length === 1) return !anchored || position === path.length;
  for (let index = 1; index < parts.length; index++) {
    const part = parts[index]!;
    if (anchored && index === parts.length - 1) return path.endsWith(part) && path.length - part.length >= position;
    const found = path.indexOf(part, position);
    if (found < 0) return false;
    position = found + part.length;
  }
  return true;
}

export function robotsAllows(policy: RobotsPolicy, input: string): boolean {
  const url = new URL(input);
  const path = url.pathname + url.search;
  let longest = -1;
  let allowed = true;
  for (const rule of policy.rules) {
    const length = rule.path.replace(/\*/g, '').length;
    if (robotsPatternMatches(rule.path, path) && (length > longest || (length === longest && rule.allow))) {
      longest = length;
      allowed = rule.allow;
    }
  }
  return allowed;
}

function jsonDocuments($: ReturnType<typeof load>): Record<string, unknown>[] {
  const documents: Record<string, unknown>[] = [];
  const visit = (value: unknown, depth = 0) => {
    if (depth > 10 || !value || typeof value !== 'object') return;
    if (Array.isArray(value)) { for (const child of value.slice(0, 100)) visit(child, depth + 1); return; }
    const object = value as Record<string, unknown>;
    documents.push(object);
    if (object['@graph']) visit(object['@graph'], depth + 1);
    if (object.mainEntity) visit(object.mainEntity, depth + 1);
    if (object.publisher) visit(object.publisher, depth + 1);
  };
  $('script[type="application/ld+json"]').slice(0, 20).each((_index, element) => {
    try { visit(JSON.parse($(element).text())); } catch { /* Invalid publisher JSON-LD does not stop a crawl. */ }
  });
  return documents;
}

function publicContentUrl(value: unknown, base: string): string {
  if (typeof value !== 'string') return base;
  try { return validatePublicUrl(new URL(value, base).href).href; } catch { return base; }
}

function datedContent(input: { title: unknown; date: unknown; url?: unknown; excerpt?: unknown }, base: string, now: Date): WebsiteContent | undefined {
  if (typeof input.date !== 'string' || typeof input.title !== 'string') return;
  const date = new Date(input.date);
  if (!Number.isFinite(date.getTime()) || date.getTime() > now.getTime() || date.getTime() < now.getTime() - 30 * 86400_000) return;
  const title = clean(input.title, 300);
  if (!title) return;
  return { title, publishedAt: date.toISOString(), url: publicContentUrl(input.url, base), sourceUrl: base, excerpt: clean(typeof input.excerpt === 'string' ? input.excerpt : '', 600), platform: 'website' };
}

function readFeed(body: string, base: string, now: Date): WebsiteContent[] {
  const $ = load(body, { xmlMode: true });
  const content: WebsiteContent[] = [];
  $('item, entry').slice(0, 100).each((_index, element) => {
    const node = $(element);
    const item = datedContent({ title: node.find('title').first().text(), date: node.find('pubDate, published, updated, dc\\:date').first().text(), url: node.find('link').first().attr('href') || node.find('link').first().text(), excerpt: node.find('description, summary, content').first().text() }, base, now);
    if (item) content.push(item);
  });
  return content;
}

export async function researchWebsite(input: { url: string; maxPages?: number }, options: ResearchOptions = {}): Promise<WebsiteResearch> {
  const initial = validatePublicUrl(input.url);
  const policyFetcher = options.fetcher ?? fetchPublicPage;
  const policies = new Map<string, RobotsPolicy>();
  const loadPolicy = async (website: URL): Promise<RobotsPolicy> => {
    const cached = policies.get(website.origin);
    if (cached) return cached;
    const response = await policyFetcher(new URL('/robots.txt', website).href);
    if (response.status >= 400 && response.status !== 404 && response.status !== 410) throw new Error(`Website robots.txt could not be checked (HTTP ${response.status}); crawling was not attempted.`);
    const policy = parseRobots(response.status < 400 ? response.body : '');
    policies.set(website.origin, policy);
    return policy;
  };
  const ensureAllowed = async (destination: URL) => {
    const policy = await loadPolicy(destination);
    if (!robotsAllows(policy, destination.href)) throw new Error('The website robots.txt disallows crawling this page.');
    if (policy.crawlDelay > 3) throw new Error(`The website requests a ${policy.crawlDelay}-second crawl delay. Use a dedicated crawl provider that can honor it.`);
  };
  const fetcher: ResearchFetcher = options.fetcher ?? ((url) => fetchPublicPage(url, { beforeRedirect: ensureAllowed }));
  const now = options.now ?? new Date();
  const maxPages = Math.min(8, Math.max(1, Math.floor(input.maxPages ?? 6)));
  const warnings: string[] = [];
  let robots: RobotsPolicy;
  try {
    robots = await loadPolicy(initial);
    await ensureAllowed(initial);
  } catch (error) {
    throw new Error(`Could not check crawl permissions: ${error instanceof Error ? error.message : 'network request failed'}`);
  }

  const report: WebsiteResearch = {
    url: initial.href, domain: initial.hostname, brand: initial.hostname.replace(/^www\./, ''), title: '', description: '',
    collectedAt: now.toISOString(), windowStart: new Date(now.getTime() - 30 * 86400_000).toISOString(),
    pages: [], socialProfiles: [], content: [], headlines: [], offers: [], callsToAction: [], themes: [], warnings,
    coverage: { website: 'complete', social: 'discovery-only', ads: 'not-connected', traffic: 'not-connected', notes: [
      'Website research is a bounded sample of public pages, not a complete site index.',
      'Social profiles are discovered from website links; account ownership and the last 30 days of social posts have not been verified.',
      'No Meta ads, social engagement, visits, or conversion data has been collected by the website crawler.',
    ] },
  };
  const queue: { url: string; feed: boolean }[] = [{ url: initial.href, feed: false }];
  const queued = new Set([initial.href]);
  const visited = new Set<string>();
  let attempts = 0;
  let origin = initial.origin;
  let lastFetched = Date.now();
  while (queue.length && attempts < maxPages) {
    const next = queue.shift()!;
    if (visited.has(next.url)) continue;
    visited.add(next.url);
    if (!robotsAllows(robots, next.url)) { warnings.push(`robots.txt excluded ${new URL(next.url).pathname}.`); continue; }
    const wait = Math.max(200, robots.crawlDelay * 1000) - (Date.now() - lastFetched);
    if (attempts && wait > 0) await new Promise((resolve) => setTimeout(resolve, wait));
    attempts++;
    try {
      const result = await fetcher(next.url);
      lastFetched = Date.now();
      if (result.status < 200 || result.status >= 300) throw new Error(`HTTP ${result.status}`);
      const actual = validatePublicUrl(result.url);
      // A canonical www/HTTPS redirect on the first page is common. Further
      // navigations stay on that resolved origin and use its robots policy.
      if (actual.origin !== origin) {
        if (report.pages.length || attempts > 1) throw new Error('Page redirected outside the website origin.');
        robots = await loadPolicy(actual);
        await ensureAllowed(actual);
        origin = actual.origin;
        report.url = actual.href;
        report.domain = actual.hostname;
      }
      if (next.feed || /(?:rss|atom|xml)/i.test(result.contentType)) {
        report.content.push(...readFeed(result.body, actual.href, now));
        continue;
      }
      if (!/(?:text\/html|application\/xhtml\+xml)/i.test(result.contentType)) throw new Error('Response is not a readable HTML page.');
      const $ = load(result.body);
      const documents = jsonDocuments($);
      const title = clean($('meta[property="og:title"]').attr('content') || $('title').first().text(), 300);
      const description = clean($('meta[name="description"]').attr('content') || $('meta[property="og:description"]').attr('content'), 600);
      const pageHeadings = $('h1, h2, h3').map((_index, element) => clean($(element).text(), 250)).get().filter(Boolean).slice(0, 30);
      for (const node of documents) {
        const sameAs = Array.isArray(node.sameAs) ? node.sameAs : [node.sameAs];
        for (const link of sameAs) if (typeof link === 'string') {
          const profile = normalizeSocialProfile(link, actual.href);
          if (profile) report.socialProfiles.push(profile);
        }
        if (String(node['@type']).match(/(?:Article|BlogPosting|NewsArticle)/)) {
          const article = datedContent({ title: node.headline || node.name, date: node.datePublished, url: node.url, excerpt: node.description }, actual.href, now);
          if (article) report.content.push(article);
        }
      }
      $('article').slice(0, 50).each((_index, element) => {
        const article = $(element);
        const item = datedContent({ title: article.find('h1,h2,h3').first().text() || article.find('a').first().text(), date: article.find('time').first().attr('datetime'), url: article.find('a[href]').first().attr('href'), excerpt: article.find('p').first().text() }, actual.href, now);
        if (item) report.content.push(item);
      });
      const published = $('meta[property="article:published_time"]').attr('content');
      if (published) {
        const item = datedContent({ title, date: published, url: actual.href, excerpt: description }, actual.href, now);
        if (item) report.content.push(item);
      }
      for (const heading of pageHeadings) report.headlines.push({ text: heading, sourceUrl: actual.href });
      $('a[href], button').slice(0, 250).each((_index, element) => {
        const node = $(element);
        const text = clean(node.text(), 150);
        if (/\b(shop|buy|subscribe|try|book|start|join|sign up|learn more|request|download|get started)\b/i.test(text) && text.length < 100) report.callsToAction.push({ text, sourceUrl: actual.href });
      });
      const pageText = clean($('body').text(), 60_000);
      for (const sentence of pageText.split(/(?<=[.!?])\s+|\n/).slice(0, 200)) {
        if (/\b\d+\s*%|\b(free shipping|free trial|money.back|save \d+|discount|limited.time|guarantee)\b/i.test(sentence)) report.offers.push({ text: clean(sentence, 300), sourceUrl: actual.href });
      }
      if (!report.pages.length) {
        const org = documents.find((node) => /Organization|Corporation|Store/.test(String(node['@type'])) && typeof node.name === 'string');
        report.brand = clean($('meta[property="og:site_name"]').attr('content') || (typeof org?.name === 'string' ? org.name : ''), 150) || title.split(/[|–—]/)[0]?.trim() || actual.hostname;
        report.title = title;
        report.description = description;
      }
      $('script, style, nav, footer, header, noscript').remove();
      report.pages.push({ url: actual.href, title, description, headings: pageHeadings, excerpt: clean($('main').text() || $('body').text(), 1800), fetchedAt: now.toISOString() });
      const candidates: { url: string; feed: boolean; rank: number }[] = [];
      // Read links from the full original DOM, including footer links removed for excerpts.
      const all = load(result.body);
      all('a[href], link[rel="alternate"]').slice(0, 600).each((_index, element) => {
        const href = all(element).attr('href');
        if (!href) return;
        const profile = normalizeSocialProfile(href, actual.href);
        if (profile) { report.socialProfiles.push(profile); return; }
        let link: URL;
        try { link = validatePublicUrl(new URL(href, actual).href); } catch { return; }
        if (link.origin !== origin || queued.has(link.href) || /\.(?:pdf|png|jpe?g|svg|webp|gif|zip|mp4|css|js)$/i.test(link.pathname)) return;
        if (/\b(cart|checkout|logout|login|account|search)\b/i.test(link.pathname)) return;
        link.search = '';
        const feed = /rss|atom|xml/i.test(all(element).attr('type') ?? '') || /\/(?:feed|rss|atom)(?:\/|\.|$)/i.test(link.pathname);
        const rank = feed ? 0 : /blog|news|insight|article|journal|learn|resource/i.test(link.pathname) ? 1 : /about|product|pricing|contact|collection/i.test(link.pathname) ? 2 : 3;
        candidates.push({ url: link.href, feed, rank });
      });
      for (const candidate of candidates.sort((a, b) => a.rank - b.rank).slice(0, 20)) if (!queued.has(candidate.url)) {
        queued.add(candidate.url);
        queue.push({ url: candidate.url, feed: candidate.feed });
      }
    } catch (error) {
      if (!report.pages.length) throw new Error(`Website crawl could not collect a readable page: ${error instanceof Error ? error.message : 'request failed'}`);
      warnings.push(`Could not read ${new URL(next.url).pathname}: ${error instanceof Error ? error.message : 'request failed'}`);
    }
  }
  if (!report.pages.length) throw new Error('Website crawl did not collect any readable HTML pages.');
  report.socialProfiles = unique(report.socialProfiles, (profile) => profile.url.toLowerCase());
  report.content = unique(report.content, (item) => `${item.url}\n${item.title}`).sort((a, b) => b.publishedAt.localeCompare(a.publishedAt));
  report.headlines = unique(report.headlines, (item) => item.text.toLowerCase()).slice(0, 30);
  report.offers = unique(report.offers, (item) => item.text.toLowerCase()).slice(0, 15);
  report.callsToAction = unique(report.callsToAction, (item) => item.text.toLowerCase()).slice(0, 20);
  const themeRules = [
    ['Education', /\b(how to|guide|learn|tips|explained|tutorial)\b/i],
    ['Offers & promotions', /\b(sale|save|discount|offer|free|deal)\b/i],
    ['Product benefits', /\b(benefit|built for|designed|introducing|features|performance)\b/i],
    ['Social proof', /\b(review|testimonial|trusted|customer|case study|results)\b/i],
    ['Brand story', /\b(our story|mission|about us|sustainab|founded|values)\b/i],
  ] as const;
  const evidence = [...report.headlines, ...report.content.map((item) => ({ text: item.title, sourceUrl: item.url }))];
  report.themes = themeRules.map(([name, expression]) => {
    const matching = evidence.filter((item) => expression.test(item.text));
    return { name, count: matching.length, evidence: matching.slice(0, 5) };
  }).filter((theme) => theme.count > 0).sort((a, b) => b.count - a.count);
  if (!report.content.length) warnings.push('No dated website posts from the last 30 days were found in the pages sampled. Social history was not fetched.');
  if (!report.socialProfiles.length) warnings.push('No supported social profile links were found on the pages sampled.');
  if (queue.length) warnings.push(`Crawl stopped at the ${maxPages}-request sample limit; additional site pages may contain more evidence.`);
  report.coverage.website = warnings.some((warning) => warning.startsWith('Could not read') || warning.startsWith('robots.txt')) ? 'partial' : 'complete';
  return report;
}
