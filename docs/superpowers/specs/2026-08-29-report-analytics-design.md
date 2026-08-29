# Report Analytics Design

## Goal
Add a privacy-first Report dashboard to the extension that explains what protection has blocked over time, where blocks originated, which sites/categories are most affected, and how each item was detected.

## Privacy and retention
- Analytics is local-only in `chrome.storage.local`.
- Do not transmit report events or aggregates to a server.
- Do not store page titles, query strings, URL fragments, or a full browsing history.
- Normalize page and source URLs to hostnames before persistence.
- Keep detailed events for 30 days.
- Keep compact daily aggregates long-term until the user clears statistics.
- Preserve the existing lightweight `adBlockHistory` for popup recent-history behavior.
- The existing remote ad-rule download is independent of analytics and remains unchanged.

## Category classification
Use a hybrid classifier:
1. Bundled high-confidence domain/category mappings.
2. Existing known streaming/comic signals where applicable.
3. Lightweight hostname/path/page-metadata heuristics for unknown domains.
4. Cache the resolved category locally by normalized domain.

Initial categories: News, Social, Shopping, Video/Streaming, Gaming, Technology, Search, Productivity, Finance, Education, Entertainment, Adult, Other.

## Data model
A detailed report event contains only compact normalized fields:
- timestamp
- pageDomain
- pageCategory
- sourceDomain
- blockType: ad | tracker | popup
- detectionMethod: network | heuristic | ai
- resourceType: image | video | banner | overlay | popup | script | pixel | iframe | other
- blockedTargetDomain for popup events when applicable

Daily aggregates maintain counters keyed by day plus dimensions needed by the dashboard: site, category, source, block type, detection method, and resource type.

## Architecture
- `src/reporting.ts`: event normalization, 30-day retention, daily aggregation, queries/export/clear operations.
- `src/site-category.ts`: offline mappings, heuristic fallback, normalized category results, local cache integration.
- `src/background.ts`: integration point; records report events when protection reports a block and serves report queries/messages.
- `src/report.html`, `src/report.ts`, `src/report.css`: full extension-page dashboard.
- `src/popup.html` / `src/popup.ts`: add a Reports action that opens the extension report page.

## Dashboard
Time filters: Today, 7 days, 30 days, All time.

Overview KPI cards:
- Ads blocked
- Trackers blocked
- Popups blocked
- Websites protected
- AI-detected blocks

Report sections:
- Blocking trend by day/hour, split by Ads / Trackers / Popups / AI-detected.
- Top websites with category, totals, block-type breakdown, and last blocked time.
- Website category distribution.
- Top blocked source domains.
- Detection method distribution: network, heuristic, AI.
- Blocked resource/content type distribution.
- Most aggressive sites measured as blocks per observed protected visit when visit data is available; otherwise omit the ratio rather than inventing it.
- Recent protection activity with filters/search.

Popup events expose an `Open blocked link` action. Persist only the normalized blocked destination domain. Opening reconstructs `https://<domain>/`; the original query/path is deliberately unavailable for privacy.

## User controls
- Export report data as JSON and CSV.
- Clear Statistics removes detailed events, aggregates, and category cache used only by reporting, without changing protection settings/rules.
- Report UI clearly states that statistics stay on this device.

## Derived metrics
Do not include estimated bandwidth saved, estimated time saved, or a Protection Score in the first release. They require assumptions that are not yet backed by measured data and can be added later with explicit methodology.

## Testing
Use Node's existing `node:test` test stack for pure reporting/category modules and Playwright for report-page smoke/interactions. Tests cover normalization/privacy stripping, category resolution/fallback/cache behavior, event aggregation, retention pruning, filters, export shape, clearing data, popup-link reconstruction, and report-page rendering.

## Compatibility
Remain Manifest V3 and Chromium-compatible. Use existing `storage` permission; no new analytics/network permission is required. The project currently builds with Parcel and TypeScript and tests with Node test + Playwright.