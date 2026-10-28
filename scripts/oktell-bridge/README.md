# Oktell adapter

This directory versions the separate VM100 adapter, imported from the running
service on 2026-10-28. CRM releases do **not** install this service.

One authenticated Oktell control connection multiplexes requests by `qid` (up to
512 outstanding requests). Each linked CRM operator has an independent login,
browser lease, one-time WebSocket token, SIP connection and call authorization.
The adapter allows one browser owner per operator. Disconnecting an operator
does not log out other operators. An upstream control disconnect invalidates all
leases, including logins that have not finished yet.

The trusted `/etc/sm-oktell-bridge/operators.json` maps CRM employee IDs to
`{ "userid": "Oktell UUID", "userlogin": "Oktell login" }`. There is no fallback
employee. Missing mappings and duplicate Oktell identities are rejected. Changing
an active identity requires logout first; deleting a mapping still permits cleanup
of its old session. Provisioning must update this file and the employee's linked
Oktell status in CRM. Keep actual mappings and credentials outside this repository.

CRM authorizes using the authenticated employee's role and requested, linked
Oktell account. The browser cannot choose an employee ID for the adapter.

## Verification

With the repository's Node 24 dependencies installed:

```
node scripts/oktell-bridge/browser-phone.test.cjs
node scripts/oktell-bridge/browser-media.test.cjs
node scripts/oktell-bridge/multi-operator.test.cjs
node scripts/oktell-bridge/bridge.test.cjs
node scripts/oktell-bridge/test-control.cjs
```

The bridge integration test uses a Unix socket and runs on Linux in CI. The
multi-operator test opens 100 synthetic operator sessions and WebSockets against
a local fake SIP server. It does not measure actual Oktell media capacity or place
real calls. Licenses, trunks, media ports and server capacity remain separate limits.

## Separate installation

After the PR and main workflow pass, deploy these sources to a new adapter
directory on MIRAN VM100, retaining the existing configuration, operator mapping,
journal, dependencies and previous service directory for rollback. Verify no active
browser calls or operator sessions before restarting `sm-oktell-bridge`; a restart
disconnects phones. Change the service working directory through a systemd override,
restart, then verify the control connection and both operator identities read-only.
Never edit `/srv/crm/current` or build CRM on the server. Rollback of the adapter
uses its previous service working directory; CRM rollback uses its documented
release installer. Do not install this adapter automatically as part of CRM packaging.
