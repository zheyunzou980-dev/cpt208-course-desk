-- CPT208 Course Desk cloud database schema
-- Compatible with Supabase PostgreSQL, Render PostgreSQL, Railway PostgreSQL, and standard PostgreSQL.

create table if not exists app_users (
  id text primary key,
  username text not null unique,
  role text not null check (role in ('student', 'teacher')),
  name text not null,
  source text,
  created_at timestamptz,
  password_salt text,
  password_hash text,
  password_algorithm text,
  payload jsonb not null default '{}'::jsonb
);

create table if not exists qa_items (
  id text primary key,
  status text,
  question text,
  source text,
  source_document text,
  payload jsonb not null
);

create index if not exists idx_qa_items_status on qa_items(status);
create index if not exists idx_qa_items_question on qa_items using gin (to_tsvector('english', coalesce(question, '')));

create table if not exists qa_history (
  id text primary key,
  qa_id text,
  action text,
  changed_at timestamptz,
  payload jsonb not null
);

create index if not exists idx_qa_history_changed_at on qa_history(changed_at desc);
create index if not exists idx_qa_history_qa_id on qa_history(qa_id);

create table if not exists inquiry_logs (
  id text primary key,
  question text,
  asked_at timestamptz,
  reviewed boolean default false,
  review_status text,
  payload jsonb not null
);

create index if not exists idx_inquiry_logs_asked_at on inquiry_logs(asked_at desc);
create index if not exists idx_inquiry_logs_reviewed on inquiry_logs(reviewed);
create index if not exists idx_inquiry_logs_question on inquiry_logs using gin (to_tsvector('english', coalesce(question, '')));

create table if not exists inquiry_history (
  id text primary key,
  log_id text,
  action text,
  changed_at timestamptz,
  payload jsonb not null
);

create index if not exists idx_inquiry_history_changed_at on inquiry_history(changed_at desc);
create index if not exists idx_inquiry_history_log_id on inquiry_history(log_id);

create table if not exists documents (
  id text primary key,
  created_at timestamptz,
  payload jsonb not null
);

create table if not exists sessions (
  token text primary key,
  user_id text not null,
  created_at timestamptz,
  expires_at timestamptz,
  payload jsonb not null
);

create index if not exists idx_sessions_user_id on sessions(user_id);
create index if not exists idx_sessions_expires_at on sessions(expires_at);
