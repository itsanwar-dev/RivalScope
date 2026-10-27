# RivalScope

Evidence-based competitor research for media buyers. The backend accepts a competitor website, crawls a bounded sample of public pages, discovers linked social profiles, and saves a source-linked report. Imported social posts and ad records add recent-content analysis and active-ad longevity ranking.

**Current state:** the research API is implemented. The user requested a Superdesign draft before frontend implementation, so the website interface is not built yet. This is a single-workspace development service with no authentication; it is not ready to expose as a shared public application.

## What works and what remains

| Capability | Current implementation |
| --- | --- |
| Website research | Automatic, up to six page/feed attempts per report, subject to robots rules and public network access |
| Social account discovery | Profile links extracted from website links and supported structured data |
| Last 30 days of social content | User-supplied JSON imports; automatic social history is not connected |
| Meta ads | User-supplied ad records; automatic Ads Library collection is not connected |
| Content strategy signals | Source-linked website themes and keyword-based analysis of imported recent posts |
| Top observed content | Ranking from supplied interaction metrics, with partial/missing coverage identified |
| Oldest active ads | Active records sorted by reported start date; oldest ties receive `Winner candidate` |
| Traffic and conversion performance | Unavailable without an appropriate analytics provider |

`Winner candidate` is a longevity signal within the supplied records, not proof of profitability or uninterrupted delivery. Post interactions do not measure website traffic or conversions. Missing sources remain visible rather than becoming invented metrics.

## Development

Use Node.js 24.19.0 (`.nvmrc`) and npm 11 (developed with 11.9.0). No database or API credential is required for the implemented crawl/import workflow. Crawling does require working public DNS and permitted outbound HTTP(S) access.

Run from the repository root (`/workspace/RivalScope` in this cloud environment):

```sh
npm ci --include=dev
npm run check
npm run dev
```

`dev` runs the TypeScript source with Node's built-in watcher. The server defaults to `HOST=127.0.0.1` and `PORT=3000`; process environment variables can override them. No `.env` loader is used. The npm cache lives in ignored `.cache/npm`, so installation does not need to write to the user's home directory.

For compiled operation:

```sh
npm run build
npm start
```

Stop the actual Node process you started with Ctrl-C or SIGTERM. A terminal wrapper exiting can leave a child process running; check the listener before restarting on the same port.

## API workflow

Use local requests for development validation:

```sh
curl --fail --silent --show-error http://127.0.0.1:3000/health
curl --fail --silent --show-error http://127.0.0.1:3000/api/capabilities
curl --fail-with-body --silent --show-error \
  -H 'Content-Type: application/json' \
  -d '{"url":"https://example.com"}' \
  http://127.0.0.1:3000/api/reports
```

Creating a report returns HTTP 202 and a report ID. Poll its detail endpoint until collection finishes; use the import endpoint to add canonical post/ad records. See [API reference](docs/api.md) and [import format](docs/import-format.md) for the complete workflow.

`GET /health` returns `{"status":"ok"}`. `GET /` returns research-API metadata, not a rendered website.

## Persistence and limits

Reports are JSON files in ignored `.data/reports/`, written with private file permissions. Set `RIVALSCOPE_DATA_DIR` to use another directory. Reports persist across server restarts when that directory is retained. Jobs do not resume after a restart: interrupted queued/running reports are marked failed when read, and a new report must be created to retry.

At most two research jobs may run at once, and a workspace holds at most 500 reports. Imports accept at most 1,000 posts and 500 ads within a 2 MB request. Records merge by platform and ID; repeated records replace their earlier versions. Imports and deletion wait until that report's crawl has finished. See the API reference for response codes and validation rules.

Before a multi-user deployment, add authentication, tenant isolation, production persistence, and deployment-level limits. Keep the development server bound to loopback while those capabilities are absent.

## Checks

| Command | Purpose |
| --- | --- |
| `npm run typecheck` | Check TypeScript without generating output |
| `npm run build` | Compile source to `dist/` |
| `npm test` | Build and run the existing backend test suites |
| `npm run check` | Run type checking, compilation, and tests |

The suites cover safe target handling and crawl parsing, content/ad analysis, HTTP/API behavior, persistence, imports, concurrency, and process lifecycle. Deterministic injected website fixtures exercise successful collection without relying on the public internet. Passing fixture tests does not establish that a particular live website is reachable in the cloud environment. CI is configured to run the same check command on Node 24.

## Cloud setup and next steps

Use the existing checkout: each Codex cloud task is already isolated, so no Git worktree is needed unless explicitly requested. Reusable install and startup instructions are saved separately in the cloud environment configuration. Publishing can retain prepared filesystem state, but live processes must restart in future tasks.

During the current cloud setup, Superdesign requests returned HTTP 403 under the existing allowlist. A draft adding `api.superdesign.dev` and `superdesign.dev` was saved; saving a draft does not apply it to the running machine. Public crawling also encountered DNS `EAI_AGAIN`, so live crawl readiness remains unverified. TLS and safe-fetch checks remain enabled; there is no unsafe fallback.

The next product step is to establish Superdesign connectivity, generate and review the research-workspace draft, then implement the approved frontend. Automatic social history and Meta ad collection need a concrete supported provider and verified access; traffic analysis additionally needs a suitable analytics source. See [product brief](docs/product-brief.md) for scope and evidence rules.
