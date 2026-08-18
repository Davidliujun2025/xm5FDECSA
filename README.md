# bot-rag

RAG chatbot workspace with an Express backend, React frontend, PostgreSQL/pgvector persistence, and Docker-based local development.

## Quick start

```bash
cp .env.example .env
npm install
npm run dev
```

The API runs on `http://localhost:3000`. Start the frontend separately with `npm run dev --workspace frontend`.

See [docs/API.md](docs/API.md), [docs/DEPLOYMENT.md](docs/DEPLOYMENT.md), and [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) for the project contracts and operational notes.
