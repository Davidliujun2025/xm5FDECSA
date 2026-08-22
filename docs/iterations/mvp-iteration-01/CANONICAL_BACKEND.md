# T3.1 Canonical Backend Acceptance

The supported backend contract remains the 16-operation OpenAPI 3.1 document under `/api/rag/v1/openapi.json`, with interactive Swagger UI at `/api/rag/v1/docs`. `/api/acceptance` is not part of that document and remains a local browser acceptance adapter. The stable Error schema now enumerates the supported business error codes.

The production-DI E2E creates and activates a Topic, uploads one synthetic TXT file, observes its Job, confirms the final document is `READY`, and proves search is empty before publication. It then explicitly publishes, verifies `PUBLISHED`, exercises search and both Chat routes, checks citation numbering/topic/document identity, downloads the original file, disables the document and confirms retrieval becomes empty again. Health loading/ready, browser session, 429 capacity error and redacted structured logs are included in the same run.

README provides both Swagger and PowerShell entry points. HANDOFF contains the complete click sequence and a copyable PowerShell flow with explicit IDs, controlled polling, READY assertion, pre-publication empty check, manual publication, search/chat citation verification and original-file download. Neither path depends on acceptance mode or places the backend API Key in frontend code.
