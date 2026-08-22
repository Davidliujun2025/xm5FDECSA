# T2.3 Five-Stage Acceptance Flow

The browser workflow exposes the five user-facing phases `selected`, `uploaded`, `processing`, `ready` and `published`. Selection is local-only; a successful upload response supplies the document/job identifiers, and subsequent backend Job responses are the source of truth for `uploaded` (`QUEUED`), `processing` (`PROCESSING`) and `ready` (`SUCCEEDED` followed by a `READY` document). `published` remains reachable only through the explicit publication action covered by T2.4; polling never publishes a document.

`pollAcceptanceJob` is an independently tested controller. It polls at a controlled 650 ms default interval, enforces a hard 120-second total deadline, and aborts an in-flight request when that deadline is reached. Component cleanup aborts the controller and prevents all later state updates, including updates from a response that completes after unmount.

A backend `FAILED` Job is surfaced with its stable `errorCode`, readable message and `traceId`. The same trace is also captured from JSON responses or the `X-Trace-Id` response header. Failure and timeout states retain a visible reset path: selecting a new file clears the previous job/document/error state and starts again from `selected`.

Automated evidence covers the loading/idle shell, QUEUED-to-PROCESSING-to-READY success, backend failure details, exact timeout behavior, a hanging request at the deadline, unmount cancellation and reset. The frontend production build remains part of the acceptance check.
