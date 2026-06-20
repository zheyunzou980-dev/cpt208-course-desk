# Coze Workflow Design

This workflow lets Coze/扣子 run the student-facing CPT208 QA experience while the existing Web system remains the teacher/admin dashboard.

## Workflow Name

`CPT208 QA Retrieval Workflow`

## Inputs

- `question`: string, required
- `user_id`: string, optional
- `user_name`: string, optional

## Nodes

### 1. Start Node

Collect the student's message as:

```text
question = user input
user_id = Coze user id if available
user_name = Coze display name if available
```

### 2. Intent Guard Node

Purpose: decide whether the message is related to CPT208.

Suggested condition:

- If the question mentions coursework, deadline, poster, portfolio, video, demo, AI use, attendance, module, teacher, submission, group project, or CPT208, continue.
- Otherwise return:

```text
I can only answer CPT208 course and coursework questions.
```

### 3. Plugin Node

Call plugin action:

```text
askCpt208Question
```

Request body:

```json
{
  "question": "{{question}}",
  "user_id": "{{user_id}}",
  "user_name": "{{user_name}}"
}
```

Header:

```text
X-Coze-Service-Key: YOUR_COZE_SERVICE_KEY
```

### 4. Response Decision Node

If:

```text
unanswered == true
```

Return:

```text
I cannot verify this from the approved CPT208 knowledge base yet. I have logged the question for teacher review.
```

Otherwise, continue.

### 5. Citation Formatting Node

Build the final answer:

```text
{{answer}}

Sources: {{source_ids}}
Reference documents: {{source_documents}}
```

Where:

- `source_ids` = join `sources[].id`
- `source_documents` = unique join `sources[].source_document`

## Outputs

- Final answer text
- Citation source ids
- Source documents

## Teacher Review Flow

Every Coze question is also logged into the existing Web dashboard:

```text
Teacher -> Inquiry Review
```

If the system cannot verify an answer, the inquiry appears as a review item so the teacher can:

- approve the answer
- edit an existing QA
- create a new QA
- delete irrelevant inquiry records
