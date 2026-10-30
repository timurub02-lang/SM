# T1 callback operator affinity — staged, not deployed

CRM already creates a reminder for the employee who saved a confirmed callback. The reminder does not route an Oktell call. Historical LeadVertex `ope-who` assignment is also separate: it chooses a card owner, not a callback recipient. A fallback recipient must not overwrite the CRM card owner.

## Behavior

- Never before the requested timestamp, native retry delay, project schedule or client's permitted local time.
- Due callbacks precede ordinary contacts; the original callback timestamp retains priority after busy/no-answer retries.
- Until 30 minutes after that timestamp, the former operator must be available in T1. Other contacts continue when that operator is unavailable.
- If that operator is unavailable at/after the threshold, release the binding permanently for this callback and allow the task's operator pool. If still available, prefer the original operator. A newly scheduled callback creates a new binding and deadline.
- Missing/unconfirmed routing data blocks that callback. Terminal confirmed results clear affinity. Reset native history does not resurrect old bindings.

Reference: [Skorozvon project FAQ](https://skorozvon.ru/manual/proekty-dialer/voprosy-i-otvety-2). Routing uses [Oktell's documented custom operator procedure](https://wiki.oktellstudio.ru/Примеры_пользовательских_процедур), not writes to native task tables.

## Data path

The bridge captures `operatorUserId`, `taskId` and `listId` from validated server-side configuration when saving a result. Browser-supplied identity is rejected. Only `dlgcard_closeall` confirmation enters synchronization. The journal survives restart, verifies an exact command receipt, retries transport errors, and continues other results if one cannot be correlated. Synchronization never replays native call commands.

`w_crm_t1_callback_sync` correlates task, list, phone and native connection chain with a persisted native effort. It writes only CRM-owned routing records. A callback requires native effort result 8. Timestamp ordering comes from native history; late delivery of an older message cannot replace a newer callback. History may have been cleared during test resets: old commands then require reconciliation, never a guess by phone.

`CRM_T1_Select` combines the installed time/priority gate with callback readiness. `A_TaskManager_OperatorsAll_Get_Custom` enforces the operator restriction again and rechecks the client window. Native membership, busy-state checks, attempt limits and call control remain authoritative. The default custom-procedure behavior is retained for other tasks.

## Installation sequence — keep calls disabled

This PR is build-only. The standalone CRM release does **not** automatically update the separate bridge or native SQL. Follow these steps only after publication is separately authorized.

1. Verify T1 stopped and no active calls. Back up databases and definitions of `CRM_T1_Select` and `A_TaskManager_OperatorsAll_Get_Custom`. Verify the latter is still the inspected default; preserve any intervening custom logic.
2. Require installed `CRM_T1TimeCandidates`, `CRM_T1CandidateTiming`, `CRM_CallTimeDecision`, cursor and offer tables from the 30 October time/priority installation. Apply `scripts/oktell-bridge/sql/t1-callback-routing.sql` in one transaction, stopping and rolling back on any batch error. Never apply test fixtures to Oktell.
3. Register only `w_crm_t1_callback_sync` in the predefined-procedure allowlist with its declared parameters. Deploy tested bridge files separately; add current native `listId` to private `pilot.json`, then enable `callbackRouting` in private bridge configuration.
4. Reconcile pending confirmed records, verify exact receipts and absence of `callback_route_sync_failed` events. Never infer historical operator IDs from today's mapping. Callbacks saved before this version need explicit reconciliation. Do not reset native history with pending receipts.
5. In Oktell, set **T1 only** to custom operator selection (resource choice 11). Keep subscriber search `CRM T1 Time Select v3`. Readiness currently supports explicitly assigned operators; expand group membership before enabling group-based resources.
6. With T1 still stopped, validate live procedure signatures/allowlist, list association, clock offset, operator states and registry validity. Restore previous procedures, resource mode and bridge configuration on failure. Do not start the task as part of verification.
7. A separately authorized test must confirm native end-to-end routing with a real saved callback and availability changes. Unit/SQL tests cannot establish audio delivery or scheduler behavior under load.

## Verification

- `node scripts/oktell-bridge/callback-routing.test.cjs`: spoofed identity rejected, confirmation required, wrong/missing receipt retried, identity mapping change, restart, concurrent sync, terminal result, failed-entry isolation, no dial commands.
- Existing pilot-control and CRM sync tests: result behavior, reminder ownership, accepted fallback without card reassignment.
- `tests/t1-callback-routing.ps1`: disposable **local** SQL database, actual new procedures, frozen installed time-gate definitions, synthetic contacts. Tests priority, offline owner, 30-minute threshold, retry delay, permanent release, terminal/new callbacks, history reset and 34,848 combinations of windows and owner state. The runner has no remote-server argument; only cross-database references and clocks are substituted.
- GitHub runs SQL fixtures on Windows and application/bridge checks on Linux. Publication requires both jobs.

Remaining commissioning checks: native custom-selection lifecycle and procedure wire-parameter binding, followed by a separately authorized end-to-end callback test. This build does not prove three simultaneous answered calls, MTS capacity, or a final pre-SIP time gate. It is not a production rollout.
