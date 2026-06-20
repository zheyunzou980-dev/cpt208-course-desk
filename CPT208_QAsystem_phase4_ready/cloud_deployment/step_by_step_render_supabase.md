# Step-by-step: Deploy CPT208 Course Desk With Render + Supabase

## Goal

After this setup, anyone can open the system from another computer through a public HTTPS URL.

## Part A: Supabase Database

1. Create a Supabase account.
2. Create a new project.
3. Open `Project Settings -> Database`.
4. Copy the PostgreSQL connection string.
5. Replace the password placeholder with your real database password.
6. Open `SQL Editor`.
7. Run `cloud_deployment/postgres_schema.sql`.

Expected result:

The database should contain tables such as:

- `app_users`
- `qa_items`
- `inquiry_logs`
- `qa_history`
- `sessions`

## Part B: GitHub Repository

1. Create a new GitHub repository.
2. Upload/push this project folder.
3. Do not upload `.env`.
4. Confirm GitHub contains:

- `server/server.mjs`
- `src/app.js`
- `data/knowledge-base.json`
- `package.json`
- `render.yaml`
- `cloud_deployment/postgres_schema.sql`

## Part C: Render Web Service

1. Create a Render account.
2. Click `New +`.
3. Choose `Web Service`.
4. Connect your GitHub repository.
5. Use:

```text
Build Command: npm install
Start Command: npm start
```

6. Add environment variables:

```text
DATABASE_URL=your_supabase_postgres_connection_string
DATABASE_SSL=true
COZE_SERVICE_KEY=any-long-random-string
```

Optional:

```text
OPENAI_API_KEY=
PINECONE_API_KEY=
PINECONE_INDEX_HOST=
PINECONE_NAMESPACE=cpt208
```

7. Deploy.

## Part D: Verify

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

Use demo accounts:

```text
Student: student / cpt208
Teacher: teacher / cpt208-admin
```

## Part E: Multi-device Test

1. Open the Render URL on another computer or phone.
2. Register a student account.
3. Ask a question.
4. Sign in as teacher on your computer.
5. Check `Teacher -> Inquiry Review`.

If the question appears there, the cloud database is working.
