# T1.3 Acceptance Topic Bootstrap

`npm run acceptance` owns exactly one isolated workflow Topic:

- ID: `topic_616363657074616e63655f6d76705f31`
- Name: `本机 Mock 验收 Topic`
- Purpose: synthetic or sanitized local workflow evidence only

The fixed ID is injected as `FRONTEND_DEFAULT_TOPIC_ID` by the version-controlled acceptance entry, not read from a user environment variable. The compatibility chat endpoint therefore uses the same Topic that the upload context will expose in T1.4.

Before readiness opens, the acceptance-only runtime bootstrap lists inactive Topics, verifies that the fixed ID and normalized name do not conflict, creates the Topic as `DRAFT` when absent, and then performs the normal explicit `DRAFT -> ACTIVE` transition. A later start reuses the same row without adding Topic or idempotency records. If the Topic was explicitly disabled, bootstrap reactivates that same Topic with a state-versioned idempotency key.

Identity conflict, missing default binding, missing Topic service, or database failure keeps readiness closed and fails startup. There is no fallback to another Topic. The ordinary `local` and `team` runtime paths do not receive the bootstrap callback and continue to create no Topics automatically.

This bootstrap does not register `/api/acceptance`, approve business Topics, upload files, or publish documents. Those boundaries remain assigned to later TODO tasks.
