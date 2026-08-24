# Deployment

The backend image is defined in `docker/Dockerfile.backend`. The compose file starts the API with PostgreSQL and pgvector for local integration.

Set production secrets through the hosting platform rather than committing `.env` files. The repository currently includes validation only; it does not publish or deploy automatically.

Add a provider-specific deployment workflow after the hosting target, registry, and production secret strategy are confirmed.
