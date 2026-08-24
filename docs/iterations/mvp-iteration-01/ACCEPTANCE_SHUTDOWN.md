# T1.6 Runtime Shutdown

`startServer()` returns one idempotent `close()` operation and installs `SIGINT`/`SIGTERM` handlers that use the same path. Closing first marks readiness unavailable, stops accepting HTTP requests, waits for the ingestion Job loop, terminates the parser worker, closes SQLite, and finally releases `runtime.lock`. A failure from one resource does not prevent the remaining resources from receiving their close operation; the first failure is still reported.

Startup cleanup uses the same resource path. If the HTTP port is already occupied, the original `EADDRINUSE` remains available to the acceptance entry and is mapped to `RAG_ACCEPTANCE_PORT_IN_USE`, while the newly acquired data lock is released. If another live runtime owns the DATA_DIR, startup fails with `RAG_INSTANCE_ALREADY_RUNNING` before opening the HTTP listener.

`tests/integration/runtime-shutdown.test.js` covers a completed TXT ingestion so that the Job loop and parser worker are both exercised, immediate readiness closure, duplicate close calls, an empty queue, occupied-port cleanup, active data-lock rejection, persisted data, and restart on the same port and DATA_DIR. A terminal smoke test additionally sent a real Ctrl+C to an isolated process, verified that the lock disappeared, and restarted on the same port and directory with `/health/ready` returning 200.
