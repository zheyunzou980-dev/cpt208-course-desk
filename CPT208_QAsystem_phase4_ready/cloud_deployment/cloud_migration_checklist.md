# Cloud Migration Checklist

## Code

- [ ] `package.json` includes `pg`.
- [ ] `.env.example` includes `DATABASE_URL`.
- [ ] `server/server.mjs` uses PostgreSQL when `DATABASE_URL` is configured.
- [ ] Local JSON fallback still works when `DATABASE_URL` is empty.

## Database

- [ ] PostgreSQL database created.
- [ ] `cloud_deployment/postgres_schema.sql` executed or backend auto-created tables.
- [ ] `/api/health` shows `database_mode: postgres`.
- [ ] Initial `qa_items` seeded from `data/knowledge-base.json`.

## Deployment

- [ ] Backend deployed to public HTTPS URL.
- [ ] `DATABASE_URL` configured in cloud environment variables.
- [ ] `DATABASE_SSL=true`.
- [ ] Demo accounts work.
- [ ] Registering a new user works.
- [ ] Student questions appear in Teacher Inquiry Review.

## Scale Readiness

- [ ] Use PostgreSQL instead of local JSON.
- [ ] Use Pinecone for larger or multi-course knowledge retrieval.
- [ ] Add rate limiting before real student rollout.
- [ ] Replace demo credentials before real use.
- [ ] Add database backup policy.
- [ ] Add file storage for uploaded PDFs/images.
