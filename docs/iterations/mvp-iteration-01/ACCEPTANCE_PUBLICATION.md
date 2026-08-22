# T1.5 Manual Publication Gate

The acceptance adapter delegates to the canonical `DocumentService` and does not contain an automatic publication callback. Upload creates an `UPLOADED` document and a `QUEUED` ingestion job. The worker alone advances the document through `PROCESSING` to `READY`; it never writes `PUBLISHED`.

Publication requires a separate, same-origin browser `POST /api/acceptance/documents/{documentId}/publish`. Before that explicit request, both `PROCESSING` and `READY` documents are absent from retrieval because the retrieval repository selects only `PUBLISHED` rows. A publication request before `READY`, or a second publication request after `PUBLISHED`, fails with `RAG_DOCUMENT_NOT_READY`.

Before calling the canonical publication service, the adapter reads the document and compares its `topicId` with the fixed acceptance context. Document IDs and Job IDs belonging to another Topic return the same scoped 404 and cannot be read, published, or downloaded through the acceptance prefix.

The integration evidence uses the formal acceptance model, Topic bootstrap, route registrar, HttpOnly browser session, and a deterministic Embedding gate. It observes `UPLOADED`, `PROCESSING`, `READY`, and `PUBLISHED`, proves search is empty before publication and populated afterward, exercises early and repeated publication errors, and verifies cross-Topic 404 behavior.
