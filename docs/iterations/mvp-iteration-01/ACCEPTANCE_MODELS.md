# T1.2 Deterministic Acceptance Models

## Boundary

`npm run acceptance` injects `createAcceptanceModelProvider()` directly into the backend runtime. There is no environment variable, config profile, API parameter, or ordinary startup fallback that can enable these models.

The provider rejects startup if real model configuration is also present. Ordinary `npm start` in `local` or `team` mode keeps its existing behavior: without a complete real Embedding configuration it does not create ingestion or retrieval services, and without a complete Chat configuration it does not create the answer service.

## Isolated identity

- Provider marker: `TEST_ACCEPTANCE_ONLY`
- Embedding model: `test-acceptance-hash-embedding-v1`
- Chat model: `test-acceptance-evidence-chat-v1`
- Vector definition: deterministic 384-dimensional signed feature hashing, normalized for cosine comparison

The acceptance model ID is stored with every chunk and is part of the parse version. Retrieval filters by that exact model ID, so acceptance vectors cannot be read as real-model vectors even when a data directory is copied accidentally. Acceptance data remains under the isolated `data/acceptance` directory.

## Deterministic and offline behavior

The Embedding adapter uses only local Unicode normalization and SHA-256 feature hashing. The Chat adapter does not generate knowledge: it parses the escaped `knowledge_context`, selects the first ranked candidate, returns that candidate excerpt verbatim as one claim, and cites only that candidate's `citationId`. Missing or malformed candidate context produces `RAG_MODEL_OUTPUT_INVALID`, which the answer service converts to the fixed refusal.

Neither adapter accepts a fetch implementation or network address. Automated tests replace global `fetch` with a throwing function and cover deterministic output, forged citation isolation, invalid context, pre-publish empty retrieval, offline upload and answer, and the ordinary-runtime no-fallback state.

These adapters prove the application workflow and citation plumbing only. They are not evidence of semantic retrieval quality or real AI answer quality.
