# Deployment

The backend image is defined in `docker/Dockerfile.backend`. The compose file starts the API with PostgreSQL and pgvector for local integration.

Set production secrets through the hosting platform rather than committing `.env` files. The deployment workflow currently runs validation and leaves the hosting-specific command as a deliberate configuration point.
