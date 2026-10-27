import { createHash } from 'node:crypto';

const DAY = 86_400_000;
const MAX_POSTS = 1000;
const MAX_ADS = 500;
const platforms = new Set(['instagram', 'facebook', 'tiktok', 'youtube', 'linkedin', 'x', 'pinterest', 'website', 'meta', 'other']);

export class ImportValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ImportValidationError';
  }
}

export interface ContentPost {
  id: string;
  platform: string;
  url: string;
  date: string;
  text: string;
  likes?: number;
  comments?: number;
  shares?: number;
  views?: number;
  source: 'import';
}

export interface AdRecord {
  id: string;
  platform: string;
  url: string;
  startDate: string;
  status: 'active' | 'inactive';
  headline?: string;
  creative?: string;
  endDate?: string;
  pageName?: string;
  source: 'import';
}

export interface ImportedData {
  posts: ContentPost[];
  ads: AdRecord[];
}

export interface AnalyzedPost extends ContentPost {
  interactions: number | null;
  metricCoverage: 'complete' | 'partial' | 'unavailable';
  /** Observed interactions divided by views (%), not verified engagement or traffic. */
  interactionRate: number | null;
}

export interface AnalyzedAd extends AdRecord {
  daysRunning: number | null;
  rank: number | null;
  label: 'Winner candidate' | 'Active ad' | 'Inactive ad';
  signal: string;
}

export interface IntelligenceReport {
  windowStart: string;
  windowEnd: string;
  posts: AnalyzedPost[];
  topPosts: AnalyzedPost[];
  ads: AnalyzedAd[];
  themes: Array<{ name: string; count: number; share: number; evidenceUrls: string[] }>;
  platformMix: Array<{ platform: string; count: number; share: number }>;
  cadence: { postsPerWeek: number; activeDays: number; postsInWindow: number };
  coverage: {
    totalPosts: number;
    recentPosts: number;
    excludedOlderPosts: number;
    postsWithMetrics: number;
    postsWithPartialMetrics: number;
    totalAds: number;
    activeAds: number;
    inactiveAds: number;
  };
  summary: string[];
  limitations: string[];
}

function record(value: unknown, path: string): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new ImportValidationError(`${path} must be an object.`);
  }
  return value as Record<string, unknown>;
}

function text(value: unknown, path: string, limit: number, required = true): string | undefined {
  if (value === undefined && !required) return undefined;
  if (typeof value !== 'string' || !value.trim() || value.length > limit) {
    throw new ImportValidationError(`${path} must be a non-empty string of at most ${limit} characters.`);
  }
  return value.trim();
}

function sourceUrl(value: unknown, path: string): string {
  const input = text(value, path, 2048)!;
  try {
    const url = new URL(input);
    if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) throw new Error();
    url.hash = '';
    return url.href;
  } catch {
    throw new ImportValidationError(`${path} must be an absolute HTTP(S) URL without embedded credentials.`);
  }
}

function platform(value: unknown, path: string): string {
  const result = text(value, path, 40)!.toLowerCase();
  const normalized = result === 'twitter' ? 'x' : result === 'web' ? 'website' : result;
  if (!platforms.has(normalized)) {
    throw new ImportValidationError(`${path} must be instagram, facebook, tiktok, youtube, linkedin, x, pinterest, website, meta, or other.`);
  }
  return normalized;
}

function date(value: unknown, path: string, now: number): string {
  const input = text(value, path, 40)!;
  // Reject ambiguous local timestamps and Date.parse's normalization of impossible dates.
  const match = /^(\d{4})-(\d{2})-(\d{2})(?:T(\d{2}):(\d{2})(?::(\d{2})(?:\.(\d{1,3}))?)?(Z|[+-]\d{2}:\d{2}))?$/.exec(input);
  if (!match) throw new ImportValidationError(`${path} must be YYYY-MM-DD or an ISO timestamp with a timezone.`);
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const leap = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
  const monthDays = [31, leap ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
  if (year < 1970 || month < 1 || month > 12 || day < 1 || day > (monthDays[month - 1] ?? 0) ||
      Number(match[4] ?? 0) > 23 || Number(match[5] ?? 0) > 59 || Number(match[6] ?? 0) > 59) {
    throw new ImportValidationError(`${path} is not a valid calendar date.`);
  }
  const zone = match[8];
  if (zone && zone !== 'Z') {
    const hours = Number(zone.slice(1, 3));
    const minutes = Number(zone.slice(4, 6));
    if (hours > 14 || minutes > 59 || (hours === 14 && minutes !== 0)) {
      throw new ImportValidationError(`${path} has an invalid timezone offset.`);
    }
  }
  const timestamp = Date.parse(input);
  if (!Number.isFinite(timestamp) || timestamp > now) {
    throw new ImportValidationError(`${path} must be a valid date that is not in the future.`);
  }
  return new Date(timestamp).toISOString();
}

function metric(value: unknown, path: string): number | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0) {
    throw new ImportValidationError(`${path} must be a non-negative safe integer; omit unknown metrics.`);
  }
  return value;
}

function rows(value: unknown, path: string, maximum: number): unknown[] {
  if (value === undefined) return [];
  if (!Array.isArray(value) || value.length > maximum) {
    throw new ImportValidationError(`${path} must be an array with at most ${maximum} records.`);
  }
  return value;
}

/** Import canonical JSON records; this does not fetch or verify platform data. */
export function parseImport(input: unknown, now = new Date()): ImportedData {
  const nowMs = now.getTime();
  if (!Number.isFinite(nowMs)) throw new ImportValidationError('Analysis time must be a valid date.');
  const root = record(input, 'Import');
  if (root.posts === undefined && root.ads === undefined) {
    throw new ImportValidationError('Import must contain a posts array, an ads array, or both.');
  }
  const postUrls = new Set<string>();
  const postIds = new Set<string>();
  const adIds = new Set<string>();
  const posts = rows(root.posts, 'posts', MAX_POSTS).map((value, index): ContentPost => {
    const path = `posts[${index}]`;
    const row = record(value, path);
    const network = platform(row.platform, `${path}.platform`);
    const url = sourceUrl(row.url, `${path}.url`);
    const id = text(row.id, `${path}.id`, 160, false) ?? `post-${createHash('sha256').update(`${network}:${url}`).digest('hex').slice(0, 20)}`;
    const key = `${network}:${url}`;
    const idKey = `${network}:${id}`;
    if (postUrls.has(key) || postIds.has(idKey)) throw new ImportValidationError(`${path} duplicates a post URL or ID.`);
    postUrls.add(key);
    postIds.add(idKey);
    const result: ContentPost = {
      id, platform: network, url,
      date: date(row.date, `${path}.date`, nowMs),
      text: text(row.text, `${path}.text`, 20_000)!,
      source: 'import',
    };
    for (const name of ['likes', 'comments', 'shares', 'views'] as const) {
      const count = metric(row[name], `${path}.${name}`);
      if (count !== undefined) result[name] = count;
    }
    return result;
  });
  const ads = rows(root.ads, 'ads', MAX_ADS).map((value, index): AdRecord => {
    const path = `ads[${index}]`;
    const row = record(value, path);
    const network = platform(row.platform, `${path}.platform`);
    const id = text(row.id, `${path}.id`, 160)!;
    const key = `${network}:${id}`;
    if (adIds.has(key)) throw new ImportValidationError(`${path} duplicates an ad platform and ID.`);
    adIds.add(key);
    if (row.status !== 'active' && row.status !== 'inactive') throw new ImportValidationError(`${path}.status must be active or inactive.`);
    const result: AdRecord = {
      id, platform: network,
      url: sourceUrl(row.url, `${path}.url`),
      startDate: date(row.startDate, `${path}.startDate`, nowMs),
      status: row.status,
      source: 'import',
    };
    for (const [name, limit] of [['headline', 2000], ['creative', 20_000], ['pageName', 300]] as const) {
      const content = text(row[name], `${path}.${name}`, limit, false);
      if (content !== undefined) result[name] = content;
    }
    if (row.endDate !== undefined) {
      result.endDate = date(row.endDate, `${path}.endDate`, nowMs);
      if (result.endDate < result.startDate) throw new ImportValidationError(`${path}.endDate must not precede startDate.`);
      if (result.status === 'active') throw new ImportValidationError(`${path} cannot be active with an endDate; omit endDate for an active ad.`);
    }
    return result;
  });
  return { posts, ads };
}

const themeRules: Array<{ name: string; pattern: RegExp }> = [
  { name: 'Offers & promotions', pattern: /\b(sale|discount|promo(?:tion)?|offer|save|deal|coupon|free shipping|limited time|percent off)\b/i },
  { name: 'Education & how-to', pattern: /\b(how to|guide|tips?|tutorial|learn|explained|mistakes?|step by step|did you know)\b/i },
  { name: 'Social proof', pattern: /\b(review|testimonial|customer|customers|results|before and after|trusted|rated)\b/i },
  { name: 'Product & launches', pattern: /\b(new|launch|launching|introducing|introduce|collection|arriv(?:al|als|ed)|product|features?)\b/i },
  { name: 'Community & behind the scenes', pattern: /\b(community|behind the scenes|team|founder|story|stories|giveaway|join us)\b/i },
];

function rounded(value: number): number {
  return Math.round(value * 10) / 10;
}

/** Analyze the supplied sample, without claiming platform-complete or conversion data. */
export function analyzeIntelligence(posts: ContentPost[], ads: AdRecord[], now = new Date()): IntelligenceReport {
  const data = parseImport({ posts, ads }, now);
  const nowMs = now.getTime();
  const start = nowMs - 30 * DAY;
  const recent: AnalyzedPost[] = data.posts.filter((post) => Date.parse(post.date) >= start).map((post) => {
    const counts = [post.likes, post.comments, post.shares].filter((value): value is number => value !== undefined);
    const interactions = counts.length ? counts.reduce((sum, value) => sum + value, 0) : null;
    // Even individually safe integers can overflow when summed.
    if (interactions !== null && !Number.isSafeInteger(interactions)) {
      throw new ImportValidationError(`Post ${post.id} has an interaction total exceeding the safe integer limit.`);
    }
    return {
      ...post,
      interactions,
      metricCoverage: counts.length === 3 ? 'complete' : counts.length ? 'partial' : 'unavailable',
      interactionRate: interactions !== null && post.views !== undefined && post.views > 0 ? rounded(interactions / post.views * 100) : null,
    };
  });
  recent.sort((a, b) => b.date.localeCompare(a.date) || a.id.localeCompare(b.id));
  const topPosts = recent.filter((post) => post.interactions !== null)
    .sort((a, b) => b.interactions! - a.interactions! || b.date.localeCompare(a.date) || a.id.localeCompare(b.id))
    .slice(0, 5);
  const themes = themeRules.map((rule) => {
    const matches = recent.filter((post) => rule.pattern.test(post.text));
    return { name: rule.name, count: matches.length, share: rounded(matches.length / (recent.length || 1) * 100), evidenceUrls: matches.slice(0, 8).map((post) => post.url) };
  }).filter((theme) => theme.count > 0).sort((a, b) => b.count - a.count || a.name.localeCompare(b.name));
  const other = recent.filter((post) => !themeRules.some((rule) => rule.pattern.test(post.text)));
  if (other.length) themes.push({ name: 'Other content', count: other.length, share: rounded(other.length / recent.length * 100), evidenceUrls: other.slice(0, 8).map((post) => post.url) });
  const counts = new Map<string, number>();
  for (const post of recent) counts.set(post.platform, (counts.get(post.platform) ?? 0) + 1);
  const platformMix = [...counts].map(([network, count]) => ({ platform: network, count, share: rounded(count / recent.length * 100) }))
    .sort((a, b) => b.count - a.count || a.platform.localeCompare(b.platform));
  const active = data.ads.filter((ad) => ad.status === 'active').sort((a, b) => a.startDate.localeCompare(b.startDate) || a.id.localeCompare(b.id));
  const inactive = data.ads.filter((ad) => ad.status === 'inactive').sort((a, b) => b.startDate.localeCompare(a.startDate) || a.id.localeCompare(b.id));
  const earliest = active[0]?.startDate;
  const analyzedAds: AnalyzedAd[] = [
    ...active.map((ad): AnalyzedAd => ({
      ...ad,
      daysRunning: Math.floor((nowMs - Date.parse(ad.startDate)) / DAY),
      rank: active.findIndex((candidate) => candidate.startDate === ad.startDate) + 1,
      label: ad.startDate === earliest ? 'Winner candidate' : 'Active ad',
      signal: ad.startDate === earliest
        ? 'Oldest reported active ad in the imported sample. Longevity signal only; performance and uninterrupted delivery are unverified.'
        : 'Reported active in the imported sample. Start date does not establish conversions or uninterrupted delivery.',
    })),
    ...inactive.map((ad): AnalyzedAd => ({
      ...ad,
      daysRunning: ad.endDate ? Math.floor((Date.parse(ad.endDate) - Date.parse(ad.startDate)) / DAY) : null,
      rank: null,
      label: 'Inactive ad',
      signal: ad.endDate ? 'Reported inactive; duration is based on imported start and end dates.' : 'Reported inactive; end date and total running duration are unknown.',
    })),
  ];
  const cadence = { postsPerWeek: rounded(recent.length / 30 * 7), activeDays: new Set(recent.map((post) => post.date.slice(0, 10))).size, postsInWindow: recent.length };
  const measured = recent.filter((post) => post.interactions !== null);
  const summary: string[] = recent.length
    ? [`${recent.length} supplied posts fall within the rolling 30-day window (${cadence.postsPerWeek} posts per week in this sample).`]
    : ['No supplied posts fall within the last 30 days. There is insufficient evidence to describe a recent content strategy.'];
  const leadingTheme = themes.find((theme) => theme.name !== 'Other content');
  if (leadingTheme) summary.push(`${leadingTheme.name} appears in ${leadingTheme.count} of ${recent.length} recent posts. Themes are assigned by keyword rules and can overlap.`);
  if (recent.length && !measured.length) summary.push('No interaction counts were supplied, so top-performing content cannot be identified.');
  if (active.length) summary.push(`${active.filter((ad) => ad.startDate === earliest).length} oldest reported active ad(s) marked as winner candidates by longevity only.`);
  return {
    windowStart: new Date(start).toISOString(),
    windowEnd: now.toISOString(),
    posts: recent,
    topPosts,
    ads: analyzedAds,
    themes,
    platformMix,
    cadence,
    coverage: {
      totalPosts: data.posts.length, recentPosts: recent.length, excludedOlderPosts: data.posts.length - recent.length,
      postsWithMetrics: measured.length, postsWithPartialMetrics: recent.filter((post) => post.metricCoverage === 'partial').length,
      totalAds: data.ads.length, activeAds: active.length, inactiveAds: inactive.length,
    },
    summary,
    limitations: [
      'Coverage is limited to supplied records. Social history and Meta Ads Library completeness have not been verified.',
      'Likes, comments and shares are observed interactions, not website traffic, conversions, revenue or return on ad spend. Missing metrics remain unknown.',
      'Post ranking sums the supplied likes, comments and shares; partial metrics and platform differences can make comparisons misleading. Views are not added to interactions.',
      'Interaction rate means supplied interactions divided by supplied views. It is a proxy, not a verified platform engagement rate.',
      'Winner candidates are the oldest reported active ads in this sample. Ad age does not prove continuous delivery, profitability or a winning creative.',
      'Content themes are transparent keyword matches, can overlap and require human review. Cadence describes this sample rather than a complete publishing schedule.',
    ],
  };
}
