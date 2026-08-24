# API

## `GET /health`

Returns `{ "status": "ok" }` when the service is available.

## `POST /api/chat`

Request:

```json
{ "message": "How does this work?", "conversationId": "optional-id" }
```

Response:

```json
{ "answer": "...", "sources": [], "conversationId": "..." }
```
