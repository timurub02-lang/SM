# Native T1 recordings

The existing `sync-base` job copies native recordings through the private bridge `/pilot-recording?chain=<uuid>` endpoint. Install the matching bridge before the runtime.

The bridge resolves only a completed, answered call and its exact commutation from the durable journal. Downloads use the commissioned private origin `http://10.21.103.2:4055/download/rec/`; redirects are disabled, with a 20-second timeout, a 32 MiB cap and WAV/MP3 signature validation. Files are atomically published outside releases before setting `phone_calls.recording`. The recording endpoint preserves CRM access checks and byte ranges for both formats.

`oktell-recording-health` reports pending and failed copies. Each run processes at most five calls; failed copies retry after 15 minutes without blocking the history cursor. Native originals are not deleted. This copies the operator commutation; multi-leg transfer recording needs a separately tested design. The workstation-to-PBX media path still requires an authorized live test.
