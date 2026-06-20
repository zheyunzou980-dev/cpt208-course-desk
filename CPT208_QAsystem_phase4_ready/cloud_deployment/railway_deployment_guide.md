# Cloud Deployment Guide: Railway

Railway can host both the Node backend and PostgreSQL.

## 1. Create Railway Project

1. Create a new Railway project.
2. Add a PostgreSQL database.
3. Add this GitHub repository as a service.

## 2. Configure Service

Set:

```text
Start Command: npm start
```

Add variables:

```text
DATABASE_URL=${{Postgres.DATABASE_URL}}
DATABASE_SSL=true
COZE_SERVICE_KEY=your_optional_coze_secret
OPENAI_API_KEY=optional
PINECONE_API_KEY=optional
PINECONE_INDEX_HOST=optional
PINECONE_NAMESPACE=cpt208
```

## 3. Deploy

Railway will install dependencies and run:

```bash
npm start
```

## 4. Verify

Open:

```text
https://YOUR_RAILWAY_DOMAIN/api/health
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

## 5. Notes

Railway is convenient for prototypes because PostgreSQL and app hosting are in the same project.

For production, configure backups and monitor usage limits.
