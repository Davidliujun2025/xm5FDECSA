# T2.4 Explicit Publication Interaction

The upload page keeps publication as a separate user decision. Reaching `READY` displays an explicit “发布到测试知识库” button and explains that the document is still unavailable to retrieval until that action succeeds. No effect, polling callback or upload completion path invokes publication.

`createAcceptancePublicationGate` owns one in-flight publication Promise. Rapid repeated actions receive that same Promise and therefore issue one backend request; the button also enters `publishing`, exposes a busy status and remains disabled until the request settles. The gate validates that a successful response explicitly reports `PUBLISHED` and otherwise fails closed.

On success, the page shows `PUBLISHED` and states that the document is now searchable. On an API or response-validation error, it preserves the backend error details, returns the page to `READY`, releases the in-flight gate and allows an intentional retry. Component unmount aborts the request and prevents later UI updates.

Automated evidence proves that constructing the gate never publishes, two immediate actions produce one request, the button is READY-only, publication uses the HttpOnly session, API and invalid-response failures unlock safely, retry succeeds, and the production frontend builds. The existing page-state suite continues to cover loading context, empty Topic and API-error rendering.
