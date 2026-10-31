# Performance and security checks (2026-10-31)

The CRM serves client cards, orders and telephony integrations. The target is up to 100 operators; this change is not a certification of 100 concurrent calls.

## Confirmed problems and fixes

1. Full CRM reads could overlap every 15 seconds, including hidden tabs. A delayed read could replace a successful write. Reads now share one in-flight request, time out after 30 seconds, and are invalidated before a mutation. Writes are never retried automatically. Background refresh runs every 30 seconds while the page is visible and online, with refresh on return/reconnection.
2. Unchanged responses retransmitted all client, order and history data. Authenticated GET now compares a private, content-derived ETag after computing the authorized response. A 304 reuses the in-memory snapshot. There is no persistent browser data cache or shared server response cache, and authentication still precedes conditional handling.
3. Client selection decoded the free-client table on each request. A partial ownership index and a union of owned, ordered and explicitly requested client IDs avoid this scan. Full-state administrative operations retain their existing complete selection. The index is additive and compatible with older releases.
4. Client cards and order rows were all mounted at once. Lists now render 50 records per page. Search, counters, export and bulk selection still use the full filtered list. Repeated per-card scans use client/order maps. Inactive client lists are not recalculated when viewing other sections.
5. Unrelated sections inflated the initial bundle. Finance, warehouse, client-base settings, courier, timesheets and operator statistics load when rendered.
6. Phone masking removed only `phone`, leaving `linkedPhones` and imported phone columns in operator/head API responses. Both are omitted, including shared incoming clients. Admin and authorized calling routes retain their original access.
7. Request size checks ran after buffering the entire body. The shared API guard and bounded custom handlers now stop reading oversized streamed input. Existing character limits remain in place; byte caps preserve Unicode payload compatibility.
8. Audio range requests loaded the entire recording into memory. Authorized recordings now stream only the selected range; cancellation closes the stream. Malformed ranges and unsafe integer bounds are rejected.
9. Dependencies included published critical/high advisories. Next, React/RSC, Zod and preview tools are updated; compatible vulnerable transitives are pinned. Zod 4 migration preserves parsed defaults and partial enum mappings. The Excel import/export roundtrip is checked after transitive upgrades.
10. Common response headers now disable content-type sniffing, restrict referrer disclosure and prohibit object embedding and cross-origin framing. Existing strict Oktell page policies are preserved.

## Validation

`tests/performance-security.mjs` exercises coalesced reads, late replies, private conditional responses, chunked/Unicode body limits, ranges and phone masking. `tests/working-clients.mjs` checks indexed selection, explicit cards, ownership changes and duplicate order clients. `tests/auth-http.mjs` checks 304 after authentication, account isolation and hidden imported phone numbers in the actual built HTTP API. Existing release checks continue to cover authorization, orders and telephony without calls.

Dependency validation: `npm audit --omit=dev` reports zero advisories at the time of this change. The full development tree retains moderate minimatch warnings through ESLint's legacy API. These tools consume repository-controlled file patterns, are not part of the CRM request path, and are not fixed by forcing the incompatible minimatch 11 default export into ESLint. No claim of a completely vulnerability-free repository is made.

Security references: [Next.js October 14 update](https://nextjs.org/blog/nextjs-security-update-october-14-2026), [React RSC advisory](https://github.com/react/react/security/advisories/GHSA-xqc2-xf4c-x3h3).

## Remaining limits

Conditional responses reduce network/parse/render work, but still compute the authorized snapshot server-side. Large historical order/event collections remain a future scaling boundary; moving them to paginated APIs requires coordinated changes to history, reconciliation, counters and export. No production load test, real phone call, adversarial exploitation or external backup recovery is included. Browser measurements use synthetic records with CPU/network emulation, not the user's physical laptop.
