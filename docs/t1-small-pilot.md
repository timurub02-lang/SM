# Limited real-base pilot

Install `scripts/oktell-bridge/sql/t1-pilot-scope.sql` after the delivery schema
while T1 and its sessions are stopped. It changes only CRM-owned SQL objects.
The default scope is empty: existing batches, reservations and history remain,
but the external source exposes no customers for selection.

An administrator must review the current CRM eligibility and explicitly choose
at most 1000 native contact IDs from the delivered batches. Configure that exact
list with the narrow `CRM_T1_SetPilotScope` procedure and an expiry within four
hours (UTC); the procedure is deliberately not exposed through generic WSS SQL.
For example, on an isolated fixture only:

```sql
DECLARE @until datetime2=DATEADD(hour,1,SYSUTCDATETIME());
EXEC dbo.CRM_T1_SetPilotScope '[1000001,1000002]',@until;
```

Never copy those example IDs into production. Verify the selected IDs against
the reviewed clients, source membership, time windows and native pending queue.
The procedure rejects changes while the task is active or any session exists.
It does not start a task, reset attempts or cancel queued native calls. Expiration
blocks subsequent selection; it does not hang up an existing call. Stop the task
and reconcile pending calls before replacing the scope. Clear with `[]`, NULL
while stopped. Future uploads cannot expand the selected set.

`GET /delivery` reports total imported contacts separately from `pilotContacts`
and `pilotUntil`. The CRM delivery dialog displays the restriction. A missing
scope field indicates that the corresponding native migration is not installed.

Install the updated separate bridge while all phones are disconnected. Its
deployment guard now reads native task activity and sessions, including external
dialing before an operator receives a call. A missing native response returns
503 and prevents automatic CRM publication.

Verify the saved source hash and unchanged attempts/session counters after
installation. Tests use disposable SQL fixtures; never run fixtures on production.
Actual dialing, audio, provider refusal, queued-call behavior and the full callback
cycle still require an authorized acceptance call.
