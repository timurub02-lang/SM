# Product scope: local operator prototype

## Confirmed extension — 2026-11-25

The user explicitly requested a real Skorozvon widget locally, without production publication. `live.html` and `serve-live.mjs` add a separate loopback-only page on port4179. It loads the official SDK on demand and uses the vendor's own sign-in and calling controls. One locally entered test card is matched by the documented external ID. No production CRM data or webhook storage is connected. Authentication, audio and live-call verification remain pending the user's test account. The original offline demo on4178 remains separate. The historical scope below applies to that demo.

This directory is a disposable-data prototype for the operators of the existing SM CRM. The user requested a Skorozvon prototype without production deployment on 24 November 2026.

The operator receives a synthetic project or incoming call, sees the corresponding test customer, holds/resumes or simulates a transfer, ends the call and records an outcome. Manual dialing is simulated. An unknown external identity must not open the previous customer's card. Results and optional callback time (Moscow timezone) are stored only in this tab's memory; reload resets them.

The prototype is for desktop operator workflows with a usable narrow-screen fallback. It inherits the existing CRM identity. It is not a redesign, a provider SDK implementation or a claim of working WebRTC. It contains no credentials, production data, external API transport or deployable CRM route. Microphone and external connections are blocked by the local server.

Completion means a locally runnable interactive demo, tests of state transitions and isolation, browser verification of the core flow and responsive layouts, documented limitations, and an unmerged Draft PR. Actual test-account integration, live calls, result synchronization, public deployment and production changes are separate work requiring a later decision.
