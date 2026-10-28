# Native T1 pilot

The pilot uses the native Oktell task, not a browser dial loop. The CRM never activates the task. Connecting a headset does not set the operator ready. Task activation remains a separate administrator action in Oktell.

The separately installed bridge reads `/etc/sm-oktell-bridge/pilot.json`: `taskId`, exactly two `operators` (`actor`, `userid`), exactly three `contacts` (`phone`, `clientId`), and the allowed CRM `results`. Keep this file and the persistent `/var/lib/sm-oktell-bridge/pilot.sqlite` outside the repository. Validate against the live native task and the CRM setting `oktell-pilot-t1` when commissioning. No secrets or real contact numbers belong in fixtures.

On headset login the bridge enables native result forms for these two users. A browser INVITE is accepted only after a matching PBX task event for that actor, task and one of the three contacts. The operator accepts the incoming call. The CRM assigns that test card to the receiving operator and opens it; other cards keep their normal access rules. Existing manual calls retain their separate authorization path.

After hangup, the native stop form supplies the result form. The operator chooses a CRM outcome and optional callback time. The bridge sends `dlgcard_setstopformresult` exactly once per command ID. Callback uses the native `numberafter` action; the other outcomes exclude the test subscriber. A native result with the same label is used when supplied, otherwise the exact CRM label remains in the native comment. Creating an order remains an explicit action in the client card.

The bridge journal survives browser and adapter restarts. CRM polling copies calls, durations and results into the existing call and client histories, including pending or uncertain acknowledgements. `dlgcard_closeall` confirms completion. A lost acknowledgement is never silently retried. An administrator must reconcile an unknown result against Oktell before clearing it. Deployment is deferred while a call or native result form is unfinished.

For the test: both operators sign into their own CRM accounts, connect their headsets, allow the microphone and select Ready. Only after a separate user instruction may the administrator activate T1. Check acceptance and two-way audio, opened card, result, callback, and delivery to the other operator. Stop the native task after the test. The tests in CI use synthetic PBX/SIP events and temporary databases; they do not prove live audio or native scheduling.

Native scheduling, pre-operator failed attempts and recording retention are controlled by Oktell. The saved Skorozvon template is not itself an installed native retry policy. Native recordings are not served by this CRM pilot endpoint.
