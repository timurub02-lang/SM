# T1: phone-based local calling time (build-only)

## Behavior

Resolve the dialled number against the public Ministry of Digital Development ABC/DEF allocation ranges, locally. CRM city is not used or required. Formats +7 and domestic 8 normalize to 7. Prefix alone is insufficient: the full number must fall inside its allocation range.

The default T1 client window remains 09:00 inclusive to 20:00 exclusive, combined with the existing weekly project schedule in Europe/Moscow. Predictive mode and attempt-count order remain unchanged. Repeat attempts must pass the same current-time decision as initial attempts.

For a range covering multiple known zones, allow only the intersection of their calling windows. This is an explicit conservative choice, not a verified claim about Skorozvon's handling of ambiguous ranges. Unknown territories/nationwide allocations, malformed numbers and expired registry data are not assigned Moscow time. Their cards are retained in the delivery; the dial decision explains why they must wait. A number's registered geography is not live subscriber location.

The preview API returns `timezoneSource: phone_number` and counts of resolved, multiple, unknown, invalid and stale numbers for the selected batch. These diagnostics do not change selection or remove cards without a city.

## Data and refresh

`data/phone-timezones/ranges.json` contains only public allocation ranges and zone IDs, no customer records. It records download date, source URLs, source SHA256 hashes and row counts. `regions.json` maps the registry's territory labels to IANA zones; unmapped labels are explicit unknowns. Yakutia currently uses the shared window of its three zones, without guessing a district. Regions with incomplete GAR ancestry are also unknown. Review unknown territory counts after each refresh.

Official source: https://opendata.digital.gov.ru/registry/numeric/downloads
Files: https://opendata.digital.gov.ru/downloads/ABC-3xx.csv, ABC-4xx.csv, ABC-8xx.csv, DEF-9xx.csv.
Timezone reference: https://github.com/eggert/tz/blob/main/europe (Node ICU applies IANA zones).

Download all four source CSVs locally, then run:

    python scripts/compile-phone-timezones.py <directory> --as-of YYYY-MM-DD
    node tests/phone-timezone.cjs

Do not replace the date without fetching and reviewing current data. The directory expires after 90 days. No external requests occur during resolution or dial checks. Refresh is not a scheduled production job yet.

## Separate Oktell installation artifact — not installed by the CRM package

1. Keep task stopped. Back up own SQL objects. Install `scripts/oktell-bridge/call-time-schema.sql` into the database containing CRM_DeliveryContacts. It writes only CRM_* objects.
2. Export the CURRENT CRM T1 project configuration to a private file, then generate data/policy SQL:

       node --experimental-strip-types scripts/export-call-time-sql.mjs <private-project.json> <time-data.sql>

   Review and execute this generated SQL in the same database. It atomically replaces the public range table and updates only the selected task's own time policy. Never commit the private project file. Re-export whenever the project schedule changes. The exporter rejects timezone transitions inside its validity interval rather than freezing a wrong offset.
3. Integrate `CRM_CallTimeDecision(task,phone,SYSUTCDATETIME())` into the supported subscriber-search scenario before returning candidate ID/number. Select only Allowed=1, retaining native attempt/time/result filters. Do not set Return value 3 to 10 (that disables native filters). A closed time window is temporary, not an exhausted list: keep the task available to retry later; do not mark clients complete or increment attempts for waiting.
4. Immediately BEFORE the existing Dial component, call `w_crm_t1_time_gate` with the native task ID, CRM source row ID and actual dialled number. Continue only for one row with Allowed=1. On missing/error/denied result, never enter Dial. Preserve the existing MTS line selection and predictive manager handoff. The procedure checks source/receipt identity and uses server UTC at this boundary. No caller-supplied date is accepted.
5. Verify the supported native scenario's waiting/denial behavior and counters in an isolated task before attaching it to production. Neither this SQL script nor the CRM runtime automatically edits native A_* tables or attaches a scenario. Source-ID collision isolation is still required before replacing the diagnostic list.

**Deployment gate:** the CRM preview alone and filtering a source view are NOT enforcement. Oktell caches lists; the search and dial scenarios must both be wired and tested before real-base activation. Native scenario wiring and live predictive/retry acceptance are not claimed complete by this build. Native scenario XML is not fabricated from undocumented formats.

Official supported integration points:
- https://wiki.oktellstudio.ru/Служебный_сценарий_поиска_абонента
- https://wiki.oktellstudio.ru/Задачи:Дополнительно
- https://wiki.oktellstudio.ru/Менеджер_задач

## Verification

`tests/phone-timezone.cjs` checks every compiled interval endpoint, normalization, no fallback, expiry, Moscow schedule, midnight and exact 09:00/20:00 boundaries.
`tests/phone-timezone-sql.mjs` generates an isolated SQL Server fixture. CI installs the actual schema and exported registry, checks the same decisions across all mapped single zones, multi-zone and unknown examples, and rejects unbound dial requests. It has no phone provider or connection to production. SQL Server checks must pass before any main release can publish.

No production installation, customer upload or calls is part of this change.
