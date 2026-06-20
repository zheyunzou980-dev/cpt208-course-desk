# CPT208 Course Desk

Morandi green version of the CPT208 QA system. It can still open directly from `index.html`, and Phase 1 also includes a small Node backend with a JSON database for shared users, QA entries, and inquiry logs.

## Open

Static fallback:

```text
index.html
```

Backend mode:

```bash
npm start
```

Then open:

```text
http://localhost:5173
```

Backend mode stores shared data in:

```text
data/database.json
```

When `DATABASE_URL` is configured, backend mode uses PostgreSQL instead of the local JSON file. This is the recommended path for cloud deployment and multi-user access.

## Demo Accounts

- Student: `student` / `cpt208`
- Teacher: `teacher` / `cpt208-admin`

## Registration

Users can register directly from the login page.

- Student accounts can be created without an access code.
- Teacher accounts require the teacher access code: `cpt208-admin`.
- In static fallback mode, registered users are stored in browser `localStorage` under `cpt208.qa.users`.
- In backend mode, registered users are stored in `data/database.json`.

This is prototype storage only. For production, replace it with backend authentication, password hashing, server-side sessions/JWTs, and a database-backed user table.

## Phase 1 Backend

The included Node backend provides:

- `GET /api/bootstrap` for users, QA entries, inquiry logs, and documents
- `POST /api/auth/login`
- `POST /api/auth/register`
- `PUT /api/qa`
- `PUT /api/inquiries`

The frontend automatically uses the backend when served from `http://localhost:5173`. If opened with `file://`, it falls back to local browser storage.

## Phase 2 Authentication And Permissions

The backend now adds a prototype authentication layer:

- Passwords are stored as PBKDF2-SHA256 hashes in `data/database.json`.
- Login returns a 12-hour bearer token.
- Logout invalidates the current token.
- Teacher-only APIs reject students and unauthenticated users.
- Public bootstrap does not expose inquiry logs or draft QA entries.
- Teacher bootstrap returns full QA and inquiry review data.
- Student inquiry logs are appended through an authenticated endpoint.

Protected endpoints:

- `PUT /api/qa` requires a teacher token.
- `PUT /api/inquiries` requires a teacher token.
- `POST /api/inquiries` requires any signed-in user.

This is still a prototype auth layer. For production, move to a real database, add HTTPS, secure cookies or hardened JWT/session handling, rate limiting, audit logs, and admin-side user management.

## Phase 3 Knowledge Management

The teacher knowledge workflow now records an audit trail:

- QA creation, update, approval, archive, and removal events are recorded in `qa_history`.
- Inquiry review and removal events are recorded in `inquiry_history`.
- QA records include creation/update metadata such as `created_by_name`, `updated_by_name`, and timestamps.
- Teacher bootstrap returns the audit history.
- The Teacher dashboard includes a `Knowledge Activity` panel for recent QA changes.

This makes the knowledge base easier to review over time and prepares the project for a database-backed audit log later.

## Phase 4 RAG API Integration Points

Phase 4 leaves the production AI/vector interfaces ready for your own API keys.

- Student questions now call `POST /api/ask` in backend mode.
- The backend chooses Pinecone retrieval when Pinecone is configured.
- The backend chooses OpenAI answer generation when OpenAI is configured.
- If API keys are not configured, the system safely falls back to the local approved JSON knowledge base.
- Teacher mode shows an `RAG Integration` status panel so you can see whether OpenAI and Pinecone are active.

Create a local `.env` file from `.env.example`:

```bash
cp .env.example .env
```

Then fill in your own values:

```text
OPENAI_API_KEY=
OPENAI_BASE_URL=https://api.openai.com/v1
OPENAI_ANSWER_MODEL=gpt-4.1-mini
OPENAI_EMBEDDING_MODEL=text-embedding-3-small

PINECONE_API_KEY=
PINECONE_INDEX_HOST=
PINECONE_NAMESPACE=cpt208
PINECONE_TOP_K=5
PINECONE_MIN_SCORE=0.58
```

Useful backend routes:

- `GET /api/health` returns server and integration status.
- `GET /api/integrations/status` returns teacher-only integration status.
- `POST /api/ask` accepts `{ "question": "..." }` and returns `{ answer, sources, confidence, retrieval_mode, answer_mode }`.
- `POST /api/coze/ask` is the Coze/扣子 service endpoint. It requires the `X-Coze-Service-Key` header and logs Coze questions into Teacher Inquiry Review.

The current implementation uses native `fetch`, so no OpenAI or Pinecone npm SDK is required for the prototype. For production, you can keep these routes and replace the JSON database with Postgres/Supabase plus a proper Pinecone upsert pipeline.

## Cloud Database Deployment

The project is now cloud-database ready.

- Local development without `DATABASE_URL`: uses `data/database.json`.
- Cloud deployment with `DATABASE_URL`: uses PostgreSQL.
- Initial QA data is seeded from `data/knowledge-base.json` when the PostgreSQL `qa_items` table is empty.

Recommended production-style setup:

```text
Render / Railway Node Web Service
  -> PostgreSQL / Supabase
  -> optional Pinecone
  -> optional OpenAI
```

Environment variables:

```text
DATABASE_URL=your_postgres_connection_string
DATABASE_SSL=true
```

Cloud deployment guides are in:

```text
cloud_deployment/render_deployment_guide.md
cloud_deployment/railway_deployment_guide.md
cloud_deployment/postgres_schema.sql
cloud_deployment/cloud_migration_checklist.md
```

After deployment, check:

```text
https://YOUR_PUBLIC_DOMAIN/api/health
```

The response should include:

```json
{
  "database_mode": "postgres"
}
```

## Coze / 扣子 Integration

The `coze_integration` folder contains a ready-to-configure Coze package:

- `coze_plugin_openapi.yaml` for plugin import
- `coze_bot_prompt.md` for the bot instruction
- `coze_workflow_design.md` for workflow setup
- `coze_setup_guide.md` for step-by-step deployment and Coze configuration
- `sample_requests.json` for API tests
- `deployment_checklist.md` for release checks

Coze cannot call `localhost`, so deploy this backend to a public HTTPS domain first, then replace `https://YOUR_PUBLIC_DOMAIN` in the OpenAPI file.

## Included Features

Student:

- Left chat history panel
- Middle chat window
- Right citation/source references
- Source tags on answers
- Conservative response when no approved answer is found

Teacher:

- QA management
- Student question statistics
- Frequently asked questions
- Category breakdown
- Inquiry review queue
- Approve / edit QA / create QA / delete inquiry actions
- `Mark All as Seen` and `Show Resolved` review controls
- PDF, image, and TXT source upload panel for draft QA generation

Analytics:

- Student question hot topics
- High-frequency question list
- Answer-confidence/accuracy overview
- Usage trend from local inquiry logs
- Local registered-user count

## Files

```text
index.html
styles.css
src/app.js
data/knowledge-base.json
data/knowledge-base.js
server/pineconeAdapter.example.mjs
server/server.mjs
.env.example
coze_integration/*.md
coze_integration/*.yaml
coze_integration/*.json
cloud_deployment/*.md
cloud_deployment/*.sql
data/database.json
extracted/*.txt
```

## Backend Extension

The current backend can use either a local JSON database or PostgreSQL. For real class-wide use, deploy with PostgreSQL/Supabase, add HTTPS, hardened session storage, API rate limits, audit logs, database backups, cloud file storage, and Pinecone vector search.
