# Architecture

The frontend sends chat requests to the backend API. The chat route validates input, asks the RAG service for relevant context, and passes the assembled prompt to the LLM service. PostgreSQL with pgvector is the planned persistence and vector-search layer.
