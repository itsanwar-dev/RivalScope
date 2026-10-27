# Research API

RivalScope currently exposes a local, single-workspace research API. It has no authentication or tenant isolation. Keep the service bound to loopback for development; do not treat these endpoints as a public multi-user API.

All responses are JSON with `Cache-Control: no-store`. Errors use `{"error":"message"}`. POST requests require `Content-Type: application/json`; an included browser `Origin` must match the request host. There is no cross-origin browser API support.

## Endpoints

| Method and path | Result |
| --- | --- |
| `GET /health` | HTTP 200, `{"status":"ok"}` |
| `GET /` | Research-API metadata; no frontend page is implemented |
| `GET /api/capabilities` | Current automation and data-source boundaries |
| `GET /api/reports` | HTTP 200, `{"reports":[...]}` with summaries ordered by latest update |
| `POST /api/reports` | Create asynchronous website research; HTTP 202 with the queued report and a `Location` header |
| `GET /api/reports/:id` | Full saved report, or 404 |
| `POST /api/reports/:id/import` | Validate and merge canonical post/ad records; HTTP 200 with the updated report |
| `GET /api/reports/:id/export` | Full report JSON with an attachment filename |
| `DELETE /api/reports/:id` | HTTP 200, `{"deleted":true}`, or 404 |

Use a report UUID returned by the creation endpoint for `:id`.

## Create and poll a report

With the server running from the repository root, submit a public website:

```sh
curl --fail-with-body --silent --show-error \
  -H 'Content-Type: application/json' \
  -d '{"url":"https://example.com"}' \
  http://127.0.0.1:3000/api/reports
```

The response is HTTP 202. Its JSON includes the report's `id`, normalized `url`, `status: "queued"`, timestamps, and empty initial data. Its `Location` header identifies the detail endpoint. The crawl continues after the HTTP request returns.

Set the returned ID for subsequent commands:

```sh
REPORT_ID='replace-with-the-returned-report-uuid'
curl --fail --silent --show-error \
  "http://127.0.0.1:3000/api/reports/$REPORT_ID"
```

Poll until `status` is no longer `queued` or `running`. A normal client can poll every one or two seconds. Terminal statuses are:

| Status | Meaning |
| --- | --- |
| `complete` | The bounded website sample finished without reported warnings; this does not mean social history, Meta ads, or traffic were collected |
| `partial` | Website evidence is available alongside collection warnings or coverage limits |
| `failed` | Website research failed; inspect `error` for the reason |

Collection can fail because of target validation, DNS, network policy, robots rules, redirects, TLS, timeouts, or unreadable responses. A failed crawl does not imply the competitor has no content or ads. Failed reports remain available and can still accept attributed imports after the job has ended.

The URL may omit its scheme, in which case HTTPS is added. It is limited to 2,048 characters. Only public HTTP(S) targets on standard web ports are supported; embedded credentials and private/reserved targets are rejected. The crawler attempts at most six website pages/feeds per report, checks supported robots rules, bounds response sizes and redirects, and retains source URLs. It is a sample rather than a full site index. It does not log in to websites or execute their JavaScript.

The workspace accepts at most two concurrent research jobs and 500 saved reports. A request exceeding either limit currently returns HTTP 400 with an explanatory message. After a server restart, interrupted queued/running reports are marked failed when read; create a new report to retry rather than expecting background work to resume.

## Report model

| Field | Contents |
| --- | --- |
| `id`, `url` | Report UUID and submitted/normalized target URL |
| `status`, `createdAt`, `updatedAt` | Collection state and ISO UTC timestamps |
| `research` | Website findings, or `null` if none were collected |
| `data` | Normalized imported records as `{posts:[], ads:[]}` |
| `intelligence` | Analysis derived from the imported records |
| `error` | Website collection failure text, or `null` |

`research` includes brand/title/description, crawled pages and excerpts, discovered social profile URLs with their source page, dated recent website content, headlines, offers, calls to action, rule-based themes, warnings, and explicit source coverage. Its date window and collection timestamp are retained. Account links are discovered references, not verified ownership or collected social history.

`intelligence` includes an explicit rolling 30-day UTC analysis window, recent posts, measured top posts, active/inactive ad records with longevity labels, rule-based themes and evidence URLs, platform mix, cadence, coverage counts, summary statements, and limitations. Website content and imported social/ad data remain separate sources.

List responses use compact summaries containing `id`, `url`, `status`, `brand`, creation/update timestamps, discovered social-account count, recent imported post count, and imported ad count.

## Import social posts and ads

Create a JSON file using the [canonical import format](import-format.md), then send it to a completed or failed report:

```sh
curl --fail-with-body --silent --show-error \
  -H 'Content-Type: application/json' \
  --data-binary @content-and-ads.json \
  "http://127.0.0.1:3000/api/reports/$REPORT_ID/import"
```

Either `posts` or `ads` may be omitted. Missing metrics must be omitted rather than replaced with zero. Do not include credentials or API tokens. Imported records are marked `source: "import"`; the API does not fetch the supplied post/ad links or claim a provider connection.

Records merge by platform and ID. A later record with the same pair replaces the earlier one; equal IDs on different platforms remain distinct. The merged report is revalidated against the 1,000-post and 500-ad limits. Each request body is limited to 2,000,000 bytes. An import refreshes derived intelligence and the report's update timestamp, but does not change a failed website crawl into a successful one. Importing while website collection is pending returns HTTP 409.

Analysis deliberately preserves uncertainty:

- The oldest reported active ad or tied oldest ads receive `Winner candidate`. This indicates observed longevity within the supplied set, not verified performance or uninterrupted delivery. Inactive ads remain visible.
- Top posts rank supplied likes, comments, and shares. Unknown metrics remain unknown; partial counts are flagged. Views are separate, and interaction-to-view percentages are descriptive proxies.
- Keyword-based themes cite their evidence. They are not an external AI strategy assessment.
- Traffic, conversions, spend, profitability, and ROAS are not available from these records alone.

## List, export, and remove

```sh
curl --fail --silent --show-error http://127.0.0.1:3000/api/reports

curl --fail --silent --show-error \
  "http://127.0.0.1:3000/api/reports/$REPORT_ID/export" \
  -o report.json

curl --fail-with-body --silent --show-error -X DELETE \
  "http://127.0.0.1:3000/api/reports/$REPORT_ID"
```

Deletion removes the saved report file. Deleting a report while its research job is pending returns HTTP 409.

## Errors and local storage

| HTTP status | Common cause |
| --- | --- |
| `400` | Invalid input/JSON/import records, an unsafe URL, or a workspace/job limit |
| `403` | Invalid or cross-origin browser request origin on a JSON-changing request |
| `404` | Unknown endpoint or report |
| `405` | Method not supported; inspect the `Allow` header |
| `409` | An import/deletion conflicts with running collection, or a report mutation could not be completed |
| `413` | Request body exceeds 2 MB |
| `415` | POST body is not sent as `application/json` |
| `500` | Unexpected workspace failure |

Reports are stored as private JSON files under ignored `.data/reports/`. `RIVALSCOPE_DATA_DIR` can select another directory. Retain that directory to preserve reports between runs. The store is intended for one running application process, not multiple independent processes sharing the same files.

## Current integration boundary

`GET /api/capabilities` reports automatic website crawling, social profile discovery plus imports, imported ads, and unavailable traffic data. Automatic social-history and Meta Ads Library collection require a concrete supported provider and verified access. Actual traffic/performance analysis needs an authorized analytics source.

Public crawl validation in the current cloud setup encountered DNS `EAI_AGAIN`; live reachability remains unverified despite deterministic backend tests. Superdesign design work is also pending connectivity and review, so this API should not be described as a finished website.
