# RivalScope product brief

## Goal

Help a media buyer turn a competitor's website URL into a reusable research brief, reducing manual discovery and organizing the evidence needed to plan content and advertising tests.

The requested experience is: enter a website, discover the competitor's social accounts, review roughly the last month of content, locate its Meta ads, identify the oldest currently running ads, understand recurring content themes, and see which observable posts appear to gain more attention.

## Evidence contract

Every finding should identify its source and collection window. Website copy, discovered accounts, supplied post metrics, and ad start dates are observations. Content themes are transparent interpretations of those observations. Recommendations are hypotheses to test.

Ad longevity does not establish profitable performance. Label the oldest active records “Winner candidate”, with an explanation that this is a longevity signal within the collected set. Visible post engagement does not establish traffic, conversions, CTR, revenue, spend, or ROAS. Actual traffic and conversion analysis requires an authorized analytics source.

An absent source is not a zero. A crawler block, missing provider, or uncollected account must remain visible as a coverage gap.

## Version-one scope

1. Accept and validate a public competitor URL.
2. Crawl a small bounded set of public, same-origin website pages, respecting supported robots rules and safe-fetch boundaries.
3. Extract the brand/title/description, source-linked headlines, offers, calls to action, dated content, and linked social profiles.
4. Save the report and expose its collection status, source URLs, and coverage limitations.
5. Import user-supplied social post and ad records through a documented JSON format.
6. Analyze recent posts within an explicit rolling 30-day window: cadence, platform mix, rule-based themes, and top posts by supplied interactions. Identify partial or missing metric coverage.
7. Keep all supplied ad records visible; rank active ads by observed longevity and identify the oldest active candidate or tied candidates.
8. Present a readable research workspace with saved competitors, overview, website evidence, content, ads, and sources. Allow the brief to be exported without introducing unsupported claims.

No database credentials or external AI key are needed for the bounded website crawl and deterministic analysis. The initial implementation can use local persistence suitable for a development workspace. Deployment for multiple users requires authentication, tenancy, quotas, and production persistence before treating it as a shared service.

## Automation that needs provider access

Automatically reading a month of social history and collecting the full commercial Meta ads library cannot be assumed to work from a website crawl. Platform access, coverage, permissions, and supported API/provider terms need to be established first. Discovering a profile URL is only discovery.

The next integration phase should select and verify a supported social-content and ads provider, configure its credentials securely, test pagination and date filtering, record collection timestamps and provenance, and expose partial failures. Do not request credentials before choosing a concrete supported integration or claim imports provide the requested one-click automation.

Traffic estimates, if introduced later, need a named source, a date window, and an explicit estimate label. Verified conversion winners require authorized first-party performance data; public longevity remains a candidate signal.

## Primary workflow

1. **Create research:** enter a competitor website and start a job.
2. **Watch collection:** see actual job stage and specific blocked/available sources.
3. **Read the overview:** inspect positioning, discovered profiles, supported counts, and evidence gaps.
4. **Add missing evidence:** import recent posts and ad records; preserve provenance and validate each record.
5. **Investigate:** compare content themes, measured engagement, and ad longevity through direct source links.
6. **Use the brief:** export or revisit the saved report to plan creative hypotheses.

## Design direction

Use the companion `.superdesign/design-system.md`: a responsive editorial research workspace with a restrained left rail, navy/off-white foundations, indigo primary actions, mint collected states, and amber coverage gaps. Prioritize scanning, source inspection, and actionable next steps over decorative charts.

The user selected Superdesign before frontend implementation. A generated draft and user approval are therefore pending while Superdesign connectivity is resolved. Backend work can continue independently; no frontend implementation should be represented as an approved design.

## Readiness criteria

- A valid public website can produce a persisted report or a specific, honest failure.
- Unsafe/internal target URLs are rejected; redirects, timeouts, response size, and crawl count are bounded.
- Social links and website findings retain their source pages.
- Report status separates complete website discovery from missing social/ad history.
- Imports reject malformed records and never fabricate absent metrics.
- The 30-day window, ad ordering, inactive handling, tied oldest candidates, and metric-coverage labels are tested.
- The interface is keyboard usable, responsive, and readable with empty, loading, partial, error, and imported-data states.
- Claims in the UI match the actual data and tested provider access.
