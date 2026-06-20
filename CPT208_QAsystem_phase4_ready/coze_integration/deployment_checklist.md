# Deployment Checklist For Coze Integration

## Before Deployment

- [ ] Confirm `node --check server/server.mjs` passes.
- [ ] Confirm `node --check src/app.js` passes.
- [ ] Confirm `data/database.json` contains the latest approved QA items.
- [ ] Confirm no real `.env` file is committed or shared publicly.

## Backend Deployment

- [ ] Deploy the project to a public HTTPS domain.
- [ ] Set `COZE_SERVICE_KEY`.
- [ ] Optional: set `OPENAI_API_KEY`.
- [ ] Optional: set `PINECONE_API_KEY`.
- [ ] Optional: set `PINECONE_INDEX_HOST`.
- [ ] Restart the backend after setting environment variables.

## Backend Verification

Test:

```bash
curl https://YOUR_PUBLIC_DOMAIN/api/health
```

Expected:

```json
{
  "ok": true,
  "integrations": {
    "coze_endpoint_configured": true
  }
}
```

Test:

```bash
curl -X POST https://YOUR_PUBLIC_DOMAIN/api/coze/ask \
  -H "Content-Type: application/json" \
  -H "X-Coze-Service-Key: YOUR_COZE_SERVICE_KEY" \
  -d '{"question":"What should we put in the poster?"}'
```

Expected:

- HTTP 200
- answer text
- citation sources
- `channel: "coze"`

## Coze Configuration

- [ ] Import `coze_plugin_openapi.yaml`.
- [ ] Replace `https://YOUR_PUBLIC_DOMAIN`.
- [ ] Configure `X-Coze-Service-Key`.
- [ ] Create workflow using `coze_workflow_design.md`.
- [ ] Add bot prompt from `coze_bot_prompt.md`.
- [ ] Test known CPT208 question.
- [ ] Test unknown CPT208 question.

## Teacher Dashboard Verification

- [ ] Ask a question in Coze.
- [ ] Open Web dashboard.
- [ ] Sign in as teacher.
- [ ] Check `Teacher -> Inquiry Review`.
- [ ] Confirm Coze question appears in the review list.
