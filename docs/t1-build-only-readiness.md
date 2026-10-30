# T1 receipt-bound CRM handoff — build-only candidate

This change lets the private bridge recognize contacts from confirmed CRM delivery receipts in addition to the three diagnostic contacts. The durable manifest binds task, batch, client and normalized phone. Replayed receipts cannot change composition or revive cancellation. Conflicting active phone/client bindings fail rather than silently losing contacts.

CRM validates the task and delivery before accepting a call. Ringing does not assign a card. Answering releases the assignment guard and assigns the card in one database transaction. A call chain cannot change client or operator. Phone changes/deletion and repeat delivery remain blocked after handoff until native queue reconciliation. Cancelling a used batch is blocked, including a cancellation acknowledgement racing call ingestion.

## Validation
Synthetic tests cover receipt replay, conflicting batches, cancellation, late events, unknown/wrong-task delivery, answer-only handoff, immutable actor and retained reservations. Existing diagnostic call and delivery tests remain applicable. CI builds and tests the packaged CRM without real calls.

## Installation boundary
Build only: no merge, deployment, source attachment, real customer import or calls. The bridge changes are separate from the CRM release and need a coordinated later installation. Existing three-contact diagnostics remain compatible. SQLite additions preserve existing data.

## Still required before a real campaign
- Reconcile native queue and final failures before releasing reservations or reusing clients. Completed forms alone do not prove queue removal.
- Safely attach a CRM source, checking native IdInList collisions with the old diagnostic list; do not blindly reuse its task queue.
- Confirm full retry/business-result rules, timezone handling and pre-call exclusions against the reference workflow. Current customer timezone data is incomplete.
- Verify the flagged operators and licensed concurrent capacity live, plus three simultaneous answered calls and reconnect/restart recovery.
- Resolve the observed provider refusal on the third diagnostic number; verify monitoring, recordings and restore procedure.

This build is not certification that the full real-base campaign is ready.
