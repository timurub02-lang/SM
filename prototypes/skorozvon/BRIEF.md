# Scope

Operate mode. Local extension prototype of the existing CRM operator workspace. User asked for a prototype without production deployment. Inherit existing app/globals.css teal/white/Arial identity; no redesign or concept selection is needed. All people and calls are synthetic. The user confirmed automatic calling and opening the customer card as the primary scenario.

## Direction contract

THESIS: An operator handles the call and customer in one workspace; the active call owns its card until the result is saved.

OWN-WORLD: Existing CRM teal actions, pale neutral ground, white bordered surfaces, Arial and restrained 8–12px corners.

STORY: Start demo, receive call, see matching card, hold/transfer, end, save a result, continue.

FIRST VIEWPORT: Customer selector/card on the left, 354px call panel on the right, history below; phone panel comes first on narrow screens. Primary action starts the synthetic shift.

FORM: Local extension of incumbent operator workspace; no concept seed or approved comp. Signature interaction is the card changing with a synthetic call, followed by gated result capture.

Applicable exemption: Impeccable `reference/new-work.md`, section 3, “Extend an existing surface”: “Inherit its world and composition. Resolve only the new purpose, content, hierarchy, states, interaction, and how the addition joins the surrounding experience.” The following section explicitly says: “Never run the script for a local extension or a precisely specified narrow request; shape those directly.” This prototype extracts the existing operator card/call workflow into an isolated local harness; no new visual world is requested. No retrospective seed is invented.

FINISH: unreviewed and undocumented is unfinished; this build ends with the finish review, the verdict, DESIGN.md, and every shipping raster carrying its provenance

## Quality bar / evidence

Visible synthetic-mode notices, actionable controls, clear current call and result phase, accessible labels/focus, no horizontal overflow at 1440px, 390px and actual user viewport. No shipping rasters. Browser-tested auto call, hold/resume, transfer, callback/result save, next-card change and unknown incoming contact. Unit tests cover stale call IDs, duplicate result save, callback timezone and local server network guards. Vendor integration is explicitly not implemented or tested.
