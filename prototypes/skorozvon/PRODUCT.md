# Product scope: local operator prototype

This directory is a disposable-data prototype for the operators of the existing SM CRM. The user requested a Skorozvon prototype without production deployment on 24 November 2026.

The operator receives a synthetic project or incoming call, sees the corresponding test customer, holds/resumes or simulates a transfer, ends the call and records an outcome. Manual dialing is simulated. An unknown external identity must not open the previous customer's card. Results and optional callback time (Moscow timezone) are stored only in this tab's memory; reload resets them.

The prototype is for desktop operator workflows with a usable narrow-screen fallback. It inherits the existing CRM identity. It is not a redesign, a provider SDK implementation or a claim of working WebRTC. It contains no credentials, production data, external API transport or deployable CRM route. Microphone and external connections are blocked by the local server.

Completion means a locally runnable interactive demo, tests of state transitions and isolation, browser verification of the core flow and responsive layouts, documented limitations, and an unmerged Draft PR. Actual test-account integration, live calls, result synchronization, public deployment and production changes are separate work requiring a later decision.
