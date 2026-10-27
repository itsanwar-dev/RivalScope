import { randomUUID } from 'node:crypto';
import { mkdir, readFile, readdir, rename, unlink, writeFile } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { researchWebsite } from './research.ts';
import type { WebsiteResearch } from './research.ts';
import { analyzeIntelligence, parseImport } from './intelligence.ts';
import { validatePublicUrl } from './safe-fetch.ts';

type ImportedData = ReturnType<typeof parseImport>;
export interface ResearchReport {
  id: string;
  url: string;
  status: 'queued' | 'running' | 'complete' | 'partial' | 'failed';
  createdAt: string;
  updatedAt: string;
  research: WebsiteResearch | null;
  data: ImportedData;
  intelligence: ReturnType<typeof analyzeIntelligence>;
  error: string | null;
}

export interface ReportStoreOptions {
  dataDir?: string;
  researcher?: typeof researchWebsite;
  now?: () => Date;
}

export class ReportStore {
  private readonly directory: string;
  private readonly researcher: typeof researchWebsite;
  private readonly now: () => Date;
  private readonly pending = new Set<string>();
  private readonly writes = new Map<string, Promise<void>>();
  private readonly mutations = new Map<string, Promise<unknown>>();

  constructor(options: ReportStoreOptions = {}) {
    this.directory = resolve(options.dataDir ?? process.env.RIVALSCOPE_DATA_DIR ?? '.data/reports');
    this.researcher = options.researcher ?? researchWebsite;
    this.now = options.now ?? (() => new Date());
  }

  private file(id: string) {
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(id)) {
      throw new Error('Report not found.');
    }
    return join(this.directory, `${id}.json`);
  }

  private async write(report: ResearchReport): Promise<void> {
    const previous = this.writes.get(report.id) ?? Promise.resolve();
    const next = previous.catch(() => {}).then(async () => {
      await mkdir(this.directory, { recursive: true, mode: 0o700 });
      const temporary = `${this.file(report.id)}.${randomUUID()}.tmp`;
      try {
        await writeFile(temporary, JSON.stringify(report), { mode: 0o600 });
        await rename(temporary, this.file(report.id));
      } finally {
        await unlink(temporary).catch(() => {});
      }
    });
    this.writes.set(report.id, next);
    try { await next; } finally { if (this.writes.get(report.id) === next) this.writes.delete(report.id); }
  }

  async get(id: string): Promise<ResearchReport | null> {
    return this.mutate(id, () => this.getUnlocked(id));
  }

  private async getUnlocked(id: string): Promise<ResearchReport | null> {
    let file: string;
    try { file = this.file(id); } catch { return null; }
    let report: ResearchReport;
    try { report = JSON.parse(await readFile(file, 'utf8')) as ResearchReport; }
    catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null;
      throw new Error('The saved report could not be read.');
    }
    if ((report.status === 'queued' || report.status === 'running') && !this.pending.has(id)) {
      report.status = 'failed';
      report.error = 'Research was interrupted by a server restart. Start a new report to try again.';
      report.updatedAt = this.now().toISOString();
      await this.write(report);
    }
    return report;
  }

  async list() {
    await mkdir(this.directory, { recursive: true, mode: 0o700 });
    const files = (await readdir(this.directory)).filter((name) => /^[0-9a-f-]{36}\.json$/i.test(name));
    const reports = [];
    for (const name of files) {
      const report = await this.get(name.slice(0, -5));
      if (report) reports.push({
        id: report.id, url: report.url, status: report.status,
        brand: report.research?.brand ?? new URL(report.url).hostname,
        createdAt: report.createdAt, updatedAt: report.updatedAt,
        socialAccounts: report.research?.socialProfiles.length ?? 0,
        posts: report.intelligence.coverage.recentPosts,
        ads: report.intelligence.coverage.totalAds,
      });
    }
    return reports.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  }

  async create(input: unknown): Promise<ResearchReport> {
    if (!input || typeof input !== 'object' || typeof (input as { url?: unknown }).url !== 'string') {
      throw new Error('A competitor website URL is required.');
    }
    const raw = (input as { url: string }).url.trim();
    if (raw.length > 2048) throw new Error('Website URL is too long.');
    const url = validatePublicUrl(/^[a-z][a-z\d+.-]*:/i.test(raw) ? raw : `https://${raw}`).href;
    if ((await this.list()).length >= 500) throw new Error('This workspace already has 500 reports. Delete an old report before adding another.');
    if (this.pending.size >= 2) throw new Error('Two research jobs are already running. Wait for one to finish.');
    const now = this.now();
    const report: ResearchReport = {
      id: randomUUID(), url, status: 'queued', createdAt: now.toISOString(), updatedAt: now.toISOString(),
      research: null, data: { posts: [], ads: [] },
      intelligence: analyzeIntelligence([], [], now), error: null,
    };
    this.pending.add(report.id);
    try { await this.write(report); }
    catch (error) { this.pending.delete(report.id); throw error; }
    // The HTTP request returns immediately; clients poll the report for completion.
    void this.run(report).catch(() => { this.pending.delete(report.id); });
    return { ...report, status: 'queued' };
  }

  private async run(report: ResearchReport) {
    try {
      report.status = 'running';
      await this.write(report);
      report.research = await this.researcher({ url: report.url, maxPages: 6 });
      report.status = report.research.coverage.website === 'partial' || report.research.warnings.length ? 'partial' : 'complete';
    } catch (error) {
      report.status = 'failed';
      report.error = error instanceof Error ? error.message : 'Research could not be completed.';
    } finally {
      report.updatedAt = this.now().toISOString();
      try { await this.write(report); } finally { this.pending.delete(report.id); }
    }
  }

  private async mutate<T>(id: string, operation: () => Promise<T>): Promise<T> {
    const previous = this.mutations.get(id) ?? Promise.resolve();
    const next = previous.catch(() => {}).then(operation);
    this.mutations.set(id, next);
    try { return await next; } finally { if (this.mutations.get(id) === next) this.mutations.delete(id); }
  }

  async import(id: string, input: unknown): Promise<ResearchReport | null> {
    return this.mutate(id, () => this.importData(id, input));
  }

  private async importData(id: string, input: unknown): Promise<ResearchReport | null> {
    const data = parseImport(input, this.now());
    const report = await this.getUnlocked(id);
    if (!report) return null;
    if (this.pending.has(id)) throw new Error('Wait for website research to finish before importing content.');
    const posts = [...new Map([...report.data.posts, ...data.posts].map((post) => [`${post.platform}\0${post.id}`, post])).values()];
    const ads = [...new Map([...report.data.ads, ...data.ads].map((ad) => [`${ad.platform}\0${ad.id}`, ad])).values()];
    // Revalidate the merged data so repeated imports cannot exceed item limits.
    report.data = parseImport({ posts, ads }, this.now());
    report.intelligence = analyzeIntelligence(report.data.posts, report.data.ads, this.now());
    report.updatedAt = this.now().toISOString();
    await this.write(report);
    return report;
  }

  async remove(id: string): Promise<boolean> {
    return this.mutate(id, () => this.removeData(id));
  }

  private async removeData(id: string): Promise<boolean> {
    if (this.pending.has(id)) throw new Error('Wait for website research to finish before deleting this report.');
    const report = await this.getUnlocked(id);
    if (!report) return false;
    await unlink(this.file(id));
    return true;
  }
}
