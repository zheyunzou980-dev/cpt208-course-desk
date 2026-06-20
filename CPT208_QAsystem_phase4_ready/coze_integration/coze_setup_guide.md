# Coze / 扣子 Setup Guide

## 1. Overall Architecture

Recommended deployment:

```text
Student
  -> Coze Bot
  -> Coze Plugin / Workflow
  -> CPT208 Course Desk backend /api/coze/ask
  -> Local JSON knowledge base or Pinecone
  -> OpenAI answer generation if configured

Teacher
  -> CPT208 Course Desk Web dashboard
  -> QA management, inquiry review, analytics, audit trail
```

Coze is used as the student-facing conversation entry.

The existing Web app remains the teacher-side management system.

## 2. Why Not Move Everything Into Coze?

Coze is good for:

- bot conversations
- knowledge retrieval
- workflows
- plugin calls

The current Web app is better for:

- teacher login
- QA add/edit/archive/delete
- inquiry review
- analytics
- audit trail
- custom UI

So the best solution is a hybrid system.

## 3. Backend Requirement

Coze cannot call:

```text
http://localhost:5173
```

You must deploy the backend to a public HTTPS domain, for example:

```text
https://cpt208-course-desk.example.com
```

Then Coze calls:

```text
POST https://cpt208-course-desk.example.com/api/coze/ask
```

## 4. Environment Variables

Copy `.env.example` to `.env`:

```bash
cp .env.example .env
```

Set at least:

```text
COZE_SERVICE_KEY=use-a-long-random-secret
```

Optional AI/vector configuration:

```text
OPENAI_API_KEY=
PINECONE_API_KEY=
PINECONE_INDEX_HOST=
PINECONE_NAMESPACE=cpt208
```

If OpenAI/Pinecone are not configured, the backend safely uses the local approved JSON knowledge base.

## 5. Create Coze Plugin

1. Open Coze / 扣子.
2. Create a plugin.
3. Import `coze_plugin_openapi.yaml`.
4. Replace:

```text
https://YOUR_PUBLIC_DOMAIN
```

with your deployed backend domain.

5. Configure the required header:

```text
X-Coze-Service-Key: same value as COZE_SERVICE_KEY
```

## 6. Create Coze Workflow

Create a workflow using `coze_workflow_design.md`.

Main action:

```text
askCpt208Question
```

Input:

```json
{
  "question": "{{user message}}",
  "user_id": "{{user_id}}",
  "user_name": "{{user_name}}"
}
```

## 7. Configure Bot Prompt

Use:

```text
coze_bot_prompt.md
```

as the bot instruction.

Important rule:

The bot must not invent answers. If `unanswered` is true, it must tell the student that the question has been logged for teacher review.

## 8. Test Questions

Try:

```text
What should we put in the poster?
```

Expected:

- answer from CPT208 knowledge base
- citation source ids

Try:

```text
Can our group change topic after week 12?
```

Expected:

- if not covered by knowledge base, conservative answer
- logged into Teacher Inquiry Review

## 9. Teacher Follow-up

Open the Web dashboard:

```text
https://YOUR_PUBLIC_DOMAIN
```

Sign in as teacher and check:

```text
Teacher -> Inquiry Review
```

Coze questions should appear there with:

- source ids
- confidence
- review status
- channel: coze
