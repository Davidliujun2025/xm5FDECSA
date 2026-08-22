# T1.4 Acceptance Route Mount

The version-controlled acceptance entry is the only composition root that calls `createAcceptanceRouteRegistrar()`. It mounts `createLocalAcceptanceRouter()` at `/api/acceptance` and passes the same mutable context that the Topic bootstrap fills before readiness opens.

There is no `RUN_PROFILE`, `NODE_ENV`, `ACCEPTANCE_MODE`, or other environment branch in the backend that mounts this router. Ordinary local, team, and production runtimes therefore return the standard 404 for `/api/acceptance/*`, even if an unknown acceptance-like environment value is supplied.

Every acceptance route applies these gates in order:

1. the remote socket must be loopback and the Origin, when present, must be same-origin;
2. write requests must include the same-origin Origin;
3. a valid HttpOnly browser query session is required;
4. the fixed acceptance Topic context must be ACTIVE, otherwise the response is `RAG_NOT_READY` with `INITIALIZING` details.

The router remains an acceptance adapter over canonical services. It is intentionally absent from `/api/rag/v1/openapi.json` and Swagger, whose public contract remains the 16 standard operations. Cross-Topic document scoping and explicit publication remain in the adapter and are tested in their ordered TODO tasks.
