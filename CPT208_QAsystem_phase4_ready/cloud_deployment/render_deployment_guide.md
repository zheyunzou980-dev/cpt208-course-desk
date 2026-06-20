# Cloud Deployment Guide: Render + Supabase

This is the recommended setup for making the CPT208 Course Desk accessible from other computers.

## Target Architecture

```text
Browser on any computer
  -> Render Web Service HTTPS URL
  -> Node backend
  -> Supabase PostgreSQL
  -> optional Pinecone
  -> optional OpenAI
```

## 1. Create Supabase Project

1. Go to Supabase.
2. Create a new project.
3. Open `Project Settings -> Database`.
4. Copy the PostgreSQL connection string.
5. Use the pooled or direct connection string depending on your deployment platform.

The connection string should look like:

```text
postgresql://postgres.xxxxx:password@aws-0-region.pooler.supabase.com:6543/postgres
```

## 2. Initialize Database

Open Supabase SQL Editor and run:

```text
cloud_deployment/postgres_schema.sql
```

This step is optional because the backend can auto-create tables, but running it manually is clearer for demonstration and debugging.

## 3. Deploy Backend To Render

1. Push this folder to GitHub.
2. Go to Render.
3. Create `New Web Service`.
4. Connect the GitHub repository.
5. Configure:

```text
Build Command: npm install
Start Command: npm start
```

6. Add environment variables:

```text
DATABASE_URL=your_supabase_postgres_connection_string
DATABASE_SSL=true
COZE_SERVICE_KEY=your_optional_coze_secret
OPENAI_API_KEY=optional
PINECONE_API_KEY=optional
PINECONE_INDEX_HOST=optional
PINECONE_NAMESPACE=cpt208
```

7. Deploy.

Render will provide a public URL like:

```text
https://cpt208-course-desk.onrender.com
```

## 4. Verify Deployment

Open:

```text
https://YOUR_RENDER_URL/api/health
```

Expected:

```json
{
  "ok": true,
  "integrations": {
    "database_mode": "postgres"
  }
}
```

Then open:

```text
https://YOUR_RENDER_URL
```

Sign in:

```text
Teacher: teacher / cpt208-admin
Student: student / cpt208
```

## 5. Confirm Multi-device Access

Open the Render URL on another computer or phone.

Register a student account.

Ask a question.

Then sign in as teacher and check:

```text
Teacher -> Inquiry Review
```

The inquiry should appear because both devices now share the same PostgreSQL database.

## 6. Production Notes

Before real class-wide use:

- Replace demo teacher password.
- Use stronger teacher registration control.
- Consider Supabase Auth / Auth0 / Clerk for production authentication.
- Add rate limiting.
- Add regular database backups.
- Move uploaded files to S3 / Cloudflare R2 / Supabase Storage.
- Use Pinecone for larger multi-course vector retrieval.
