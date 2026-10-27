# RivalScope design system

## Product and audience

RivalScope is a research workspace for media buyers. A user enters a competitor's website and receives a saved, source-linked brief about its positioning, social presence, recent content, and advertising. The primary job is to reduce research time while keeping the evidence easy to inspect.

Version one automatically crawls public website pages and discovers linked social profiles. Users can import recent social posts and ad records when automated provider access is unavailable. Reports must accurately show which sources were collected, imported, blocked, or not connected. Do not imply that finding a profile also collected its posts.

## Visual direction

Build a calm editorial workspace with a strong information hierarchy: navy text, an off-white canvas, white working surfaces, an indigo primary action, mint confirmations, and amber evidence gaps. It should feel like a useful research instrument rather than a promotional landing page. Use restrained borders, generous spacing around decisions, and compact evidence rows where scanning matters.

No existing logo or brand assets have been supplied. Use the readable text wordmark “RivalScope”; do not invent a decorative logo or use a competitor's logo as product branding. Use simple, consistent 18–20px outline icons only where they improve scanning.

## Tokens

| Token | Value | Use |
| --- | --- | --- |
| `--canvas` | `#F6F7FB` | App background |
| `--surface` | `#FFFFFF` | Cards, tables, input surfaces |
| `--surface-subtle` | `#F0F2F8` | Selected sections and quiet fills |
| `--ink` | `#172238` | Headings and main text |
| `--muted` | `#59667A` | Secondary text; never use low-contrast gray for essential labels |
| `--border` | `#DFE4ED` | Decorative separators and card edges |
| `--input-border` | `#8290A6` | Input boundaries |
| `--primary` | `#5145CD` | Primary button, active navigation, links |
| `--primary-hover` | `#4035AD` | Primary hover |
| `--primary-soft` | `#EEECFF` | Selected item background |
| `--success` / `--success-soft` | `#146B52` / `#E4F5EE` | Collected and complete states |
| `--warning` / `--warning-soft` | `#7B4A05` / `#FFF3D6` | Partial coverage and missing evidence |
| `--danger` / `--danger-soft` | `#B42318` / `#FEECEB` | Failed requests and validation errors |
| `--focus` | `#5145CD` | Visible 3px focus ring with 2px offset |

Typography: `Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif`. Prefer installed/system fonts; the interface must work without a font download. Use 14px body text with 1.5 line height, 12px supporting labels with 1.45 line height, 16px section titles, 24px report titles, and 32px new-research titles. Use weights 400, 500, 600, and 700. Use tabular numerals for counts, dates, and ad durations. Avoid all-caps paragraphs or long uppercase navigation.

Spacing scale: 4, 8, 12, 16, 24, 32, 48px. Page padding 32px on desktop, 20px on tablet, 16px on mobile. Card padding 24px desktop and 16px mobile. Row spacing 12–16px. Input/button minimum height 44px. Radius: 8px controls, 12px cards, pill-shaped status badges. Shadows: only a subtle `0 2px 8px rgba(23,34,56,0.04)` on elevated surfaces; rely on borders and spacing elsewhere.

## App structure

- Desktop: a 232px left rail and a flexible main workspace capped near 1200px. The rail contains the wordmark, a prominent “New research” action, saved competitors, and a small coverage/help entry. Saved competitor rows show the domain, report status, and last researched date.
- Report header: competitor name/domain with a real external source link, researched timestamp, explicit 30-day content window, status, and export/import actions. Keep a clear route back to creating another report.
- Report navigation: Overview, Website, Content, Ads, and Sources. Tabs may control one report surface rather than creating unnecessary full-page flows.
- Overview: a source coverage strip, positioning summary with evidence links, discovered social accounts, a small set of supported counts, and research priorities. Use a two-column desktop grid with the main analysis wider than the supporting coverage column.
- Content: recent post list, platform mix and posting cadence when supported, observed engagement signals, theme groups, and top measured posts. Each conclusion links to the posts supporting it.
- Ads: all imported ads, active-first longevity ordering, filter by status, clear start date and days running, source link, and creative text when available. The oldest active ad or tied oldest ads may carry a “Winner candidate” badge.
- Sources: crawled URLs and collection dates, discovered profiles, import history, and explicit gaps or failures. Keep provenance accessible from every analysis area.

## Core surfaces and content rules

### New research

Lead with “Research a competitor” and one sentence explaining the result. Present a clearly labeled website URL input, an example-format placeholder such as `https://competitor.com`, and the primary “Start research” action. Explain that website discovery runs automatically and social/ad coverage depends on available data. Do not prefill a real brand or invent completed research as the initial state.

### Source coverage

Use distinct text states: “Collected”, “Imported”, “Partial”, “Blocked”, and “Not connected”. Pair color with a word or icon; color alone is insufficient. Show separate coverage for Website, Social content, and Meta ads. A discovered social profile must not turn the social-content source into a collected state.

### Counts and metrics

Show only counts that have been observed or imported. When no posts or ads were collected, use “Not collected” or an empty-state explanation instead of a misleading `0` performance metric. Do not render sample charts, invented growth percentages, traffic totals, CTR, ROAS, spend, or conversions.

Engagement totals and interactions per view are descriptive signals, not traffic or sales. Label partial metric coverage. Platform-to-platform comparisons need a visible caution because available metrics differ. Small charts must name their denominator, date window, and source; show them only when there is real data.

### Ad longevity

Use “Winner candidate” rather than “Winner”. Keep the explanation close to the badge: “Oldest active ad in the collected set. Longevity is a signal, not verified performance.” Inactive ads remain visible and never receive the active winner-candidate treatment. If there are no active ads or no records, say so rather than implying the competitor is not advertising.

### Strategy findings

Use observation-led language such as “Offer-led headlines appeared on 3 collected pages.” Separate observed evidence from a recommendation worth testing. Include source links and a short explanation of the rule or observation behind each theme. Do not label rule-based findings as an AI conclusion or imply comprehensive knowledge of the competitor.

### Import

Use a compact dialog or dedicated panel with the accepted JSON format, a file chooser or paste area, validation feedback, and a clear import action. State that records are supplied by the user and attributed as imported. A successful import refreshes counts, themes, ad ranking, and source coverage. Do not claim a generic JSON import is an official Meta export integration.

## States

- Empty: guide the first URL entry; show the output categories as a concise checklist, not populated charts.
- Queued/researching: show actual job stage and collected-page count where available. Use an indeterminate progress treatment unless progress can be measured; never invent a completion percentage.
- Complete: report is usable and source gaps remain visible.
- Partial: preserve successful website evidence alongside a clear list of unavailable sources and next actions.
- Failed: show a specific reason, retain the submitted URL, and offer retry or correction. Network policy blocks and robots exclusions must not appear as an empty competitor.
- Import validation error: identify the affected record/field and preserve the user's input.

## Responsive behavior and accessibility

At approximately 1000px, narrow the rail or replace it with a labeled drawer; use a single-column main grid below 760px. Below 640px, stack input/action and report header controls, keep tabs horizontally scrollable with visible focus, and render dense table rows as readable cards. Avoid horizontal page overflow and fixed-height text boxes. Long domains, ad text, and source URLs must wrap or truncate with an accessible full value.

Use landmarks, one page-level heading, real labels, semantic buttons, and real links. Interactive targets are at least 44px high. Provide visible keyboard focus, `aria-current` for navigation, and non-disruptive live announcements for research status. Dialogs must trap focus, close with Escape, and restore focus to their trigger. Charts require a textual or tabular equivalent. Validate text and control contrast; never rely solely on status color.

## Motion

Use 120–180ms opacity/color transitions and a restrained loading indicator. Respect `prefers-reduced-motion`. Avoid large entrance animations, parallax, looping decorative movement, or animated counters.

## Generation constraints

Use only the fonts, colors, spacing, and component styles defined above. Do not introduce gradients, decorative serif fonts, unrelated stock imagery, fictitious competitor findings, or unsupported analytics. Make missing-source and partial-coverage states feel useful and deliberate. A polished report must still tell the truth about what has and has not been collected.
