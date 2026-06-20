import { createServer } from "node:http";
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { existsSync, readFileSync } from "node:fs";
import { pbkdf2Sync, randomBytes, timingSafeEqual } from "node:crypto";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, "..");
const dbPath = path.join(rootDir, "data", "database.json");
const kbPath = path.join(rootDir, "data", "knowledge-base.json");
const port = Number(process.env.PORT || 5173);
const teacherRegistrationCode = "cpt208-admin";

function loadEnvFile(filePath) {
  if (!existsSync(filePath)) return;
  const lines = readFileSync(filePath, "utf8").split(/\r?\n/);
  lines.forEach((line) => {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#") || !trimmed.includes("=")) return;
    const [key, ...valueParts] = trimmed.split("=");
    if (process.env[key]) return;
    process.env[key] = valueParts.join("=").replace(/^["']|["']$/g, "");
  });
}

loadEnvFile(path.join(rootDir, ".env"));

const integrationConfig = {
  databaseUrl: process.env.DATABASE_URL || "",
  databaseSsl: process.env.DATABASE_SSL !== "false",
  openaiApiKey: process.env.OPENAI_API_KEY || "",
  openaiBaseUrl: (process.env.OPENAI_BASE_URL || "https://api.openai.com/v1").replace(/\/$/, ""),
  openaiAnswerModel: process.env.OPENAI_ANSWER_MODEL || "gpt-4.1-mini",
  openaiEmbeddingModel: process.env.OPENAI_EMBEDDING_MODEL || "text-embedding-3-small",
  pineconeApiKey: process.env.PINECONE_API_KEY || "",
  pineconeIndexHost: (process.env.PINECONE_INDEX_HOST || "").replace(/\/$/, ""),
  pineconeNamespace: process.env.PINECONE_NAMESPACE || "",
  pineconeTopK: Number(process.env.PINECONE_TOP_K || 5),
  pineconeMinScore: Number(process.env.PINECONE_MIN_SCORE || 0.58),
  cozeServiceKey: process.env.COZE_SERVICE_KEY || "",
};

let pgPoolPromise = null;

async function getPgPool() {
  if (!integrationConfig.databaseUrl) return null;
  if (!pgPoolPromise) {
    pgPoolPromise = import("pg").then(({ Pool }) => new Pool({
      connectionString: integrationConfig.databaseUrl,
      ssl: integrationConfig.databaseSsl ? { rejectUnauthorized: false } : false,
    }));
  }
  return pgPoolPromise;
}

const defaultUsers = [
  { id: "user_demo_student", username: "student", password: "cpt208", role: "student", name: "Student Demo", source: "demo" },
  { id: "user_demo_teacher", username: "teacher", password: "cpt208-admin", role: "teacher", name: "Teacher Demo", source: "demo" },
];

const stopWords = new Set([
  "a", "an", "and", "are", "about", "can", "do", "does", "for", "from", "have", "how",
  "i", "is", "need", "of", "on", "or", "should", "student", "students", "that", "the",
  "this", "to", "what", "when", "where", "which", "who", "with", "cpt208",
]);

const localSearchThresholds = {
  minScore: 2.6,
  minCoverage: 0.34,
  strongScore: 4.2,
  strongCoverage: 0.45,
};

const mimeTypes = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".txt": "text/plain; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp",
};

function uid(prefix) {
  return `${prefix}_${Date.now()}_${Math.random().toString(16).slice(2, 8)}`;
}

function hashPassword(password, salt = randomBytes(16).toString("hex")) {
  return {
    password_salt: salt,
    password_hash: pbkdf2Sync(String(password), salt, 120000, 32, "sha256").toString("hex"),
    password_algorithm: "pbkdf2-sha256",
  };
}

function verifyPassword(user, password) {
  if (!user?.password_hash || !user?.password_salt) {
    return user?.password === password;
  }
  const incoming = Buffer.from(hashPassword(password, user.password_salt).password_hash, "hex");
  const stored = Buffer.from(user.password_hash, "hex");
  return incoming.length === stored.length && timingSafeEqual(incoming, stored);
}

function normalizeStoredUser(user) {
  const nextUser = {
    id: user.id || uid("user"),
    username: String(user.username || "").trim(),
    role: user.role === "teacher" ? "teacher" : "student",
    name: String(user.name || user.username || "").trim(),
    source: user.source || "registered",
    created_at: user.created_at || new Date().toISOString(),
    password_salt: user.password_salt,
    password_hash: user.password_hash,
    password_algorithm: user.password_algorithm,
  };
  if (!nextUser.password_hash && user.password) {
    Object.assign(nextUser, hashPassword(user.password));
  }
  return nextUser;
}

async function readJson(filePath, fallback) {
  try {
    return JSON.parse(await readFile(filePath, "utf8"));
  } catch {
    return fallback;
  }
}

async function writeJson(filePath, data) {
  await mkdir(path.dirname(filePath), { recursive: true });
  await writeFile(filePath, `${JSON.stringify(data, null, 2)}\n`, "utf8");
}

async function ensureDatabase() {
  if (existsSync(dbPath)) return;
  const qaItems = await readJson(kbPath, []);
  await writeJson(dbPath, {
    users: defaultUsers.map(normalizeStoredUser),
    qa_items: qaItems,
    qa_history: [],
    inquiry_logs: [],
    inquiry_history: [],
    documents: [],
    sessions: [],
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  });
}

async function ensurePostgresDatabase(pool) {
  await pool.query(`
    create table if not exists app_users (
      id text primary key,
      username text not null unique,
      role text not null,
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

    create table if not exists qa_history (
      id text primary key,
      qa_id text,
      action text,
      changed_at timestamptz,
      payload jsonb not null
    );

    create table if not exists inquiry_logs (
      id text primary key,
      question text,
      asked_at timestamptz,
      reviewed boolean default false,
      review_status text,
      payload jsonb not null
    );

    create table if not exists inquiry_history (
      id text primary key,
      log_id text,
      action text,
      changed_at timestamptz,
      payload jsonb not null
    );

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
  `);
}

async function seedPostgresIfEmpty(pool) {
  const userCount = Number((await pool.query("select count(*) as count from app_users")).rows[0].count);
  const qaCount = Number((await pool.query("select count(*) as count from qa_items")).rows[0].count);
  if (userCount === 0) {
    const users = defaultUsers.map(normalizeStoredUser);
    for (const user of users) await upsertPostgresRow(pool, "app_users", user, user);
  }
  if (qaCount === 0) {
    const qaItems = await readJson(kbPath, []);
    for (const item of qaItems) await upsertPostgresRow(pool, "qa_items", item, item);
  }
}

function rowPayload(row) {
  return row.payload || {};
}

async function readPostgresDatabase(pool) {
  await ensurePostgresDatabase(pool);
  await seedPostgresIfEmpty(pool);
  const [users, qaItems, qaHistory, inquiryLogs, inquiryHistory, documents, sessions] = await Promise.all([
    pool.query("select payload from app_users order by created_at nulls last, username"),
    pool.query("select payload from qa_items order by id"),
    pool.query("select payload from qa_history order by changed_at desc nulls last limit 500"),
    pool.query("select payload from inquiry_logs order by asked_at desc nulls last limit 1000"),
    pool.query("select payload from inquiry_history order by changed_at desc nulls last limit 500"),
    pool.query("select payload from documents order by created_at desc nulls last"),
    pool.query("select payload from sessions where expires_at is null or expires_at > now()"),
  ]);
  return {
    users: users.rows.map(rowPayload).map(normalizeStoredUser),
    qa_items: qaItems.rows.map(rowPayload),
    qa_history: qaHistory.rows.map(rowPayload),
    inquiry_logs: inquiryLogs.rows.map(rowPayload),
    inquiry_history: inquiryHistory.rows.map(rowPayload),
    documents: documents.rows.map(rowPayload),
    sessions: sessions.rows.map(rowPayload),
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  };
}

async function upsertPostgresRow(pool, table, item, payload) {
  const jsonPayload = JSON.stringify(payload);
  if (table === "app_users") {
    await pool.query(
      `insert into app_users (id, username, role, name, source, created_at, password_salt, password_hash, password_algorithm, payload)
       values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10::jsonb)
       on conflict (id) do update set username=$2, role=$3, name=$4, source=$5, created_at=$6,
       password_salt=$7, password_hash=$8, password_algorithm=$9, payload=$10::jsonb`,
      [item.id, item.username, item.role, item.name, item.source, item.created_at || null, item.password_salt || null, item.password_hash || null, item.password_algorithm || null, jsonPayload],
    );
    return;
  }
  if (table === "qa_items") {
    await pool.query(
      `insert into qa_items (id, status, question, source, source_document, payload)
       values ($1,$2,$3,$4,$5,$6::jsonb)
       on conflict (id) do update set status=$2, question=$3, source=$4, source_document=$5, payload=$6::jsonb`,
      [item.id, item.status || null, item.question || null, item.source || null, item.source_document || null, jsonPayload],
    );
    return;
  }
  if (table === "qa_history") {
    await pool.query(
      `insert into qa_history (id, qa_id, action, changed_at, payload)
       values ($1,$2,$3,$4,$5::jsonb)
       on conflict (id) do update set qa_id=$2, action=$3, changed_at=$4, payload=$5::jsonb`,
      [item.id, item.qa_id || null, item.action || null, item.changed_at || null, jsonPayload],
    );
    return;
  }
  if (table === "inquiry_logs") {
    await pool.query(
      `insert into inquiry_logs (id, question, asked_at, reviewed, review_status, payload)
       values ($1,$2,$3,$4,$5,$6::jsonb)
       on conflict (id) do update set question=$2, asked_at=$3, reviewed=$4, review_status=$5, payload=$6::jsonb`,
      [item.id, item.question || null, item.asked_at || null, Boolean(item.reviewed), item.review_status || null, jsonPayload],
    );
    return;
  }
  if (table === "inquiry_history") {
    await pool.query(
      `insert into inquiry_history (id, log_id, action, changed_at, payload)
       values ($1,$2,$3,$4,$5::jsonb)
       on conflict (id) do update set log_id=$2, action=$3, changed_at=$4, payload=$5::jsonb`,
      [item.id, item.log_id || null, item.action || null, item.changed_at || null, jsonPayload],
    );
    return;
  }
  if (table === "documents") {
    await pool.query(
      `insert into documents (id, created_at, payload)
       values ($1,$2,$3::jsonb)
       on conflict (id) do update set created_at=$2, payload=$3::jsonb`,
      [item.id, item.created_at || null, jsonPayload],
    );
    return;
  }
  if (table === "sessions") {
    await pool.query(
      `insert into sessions (token, user_id, created_at, expires_at, payload)
       values ($1,$2,$3,$4,$5::jsonb)
       on conflict (token) do update set user_id=$2, created_at=$3, expires_at=$4, payload=$5::jsonb`,
      [item.token, item.user_id, item.created_at || null, item.expires_at || null, jsonPayload],
    );
  }
}

async function savePostgresDatabase(pool, nextDb) {
  await ensurePostgresDatabase(pool);
  const client = await pool.connect();
  try {
    await client.query("begin");
    await client.query("delete from sessions");
    await client.query("delete from documents");
    await client.query("delete from inquiry_history");
    await client.query("delete from inquiry_logs");
    await client.query("delete from qa_history");
    await client.query("delete from qa_items");
    await client.query("delete from app_users");
    for (const user of nextDb.users || []) await upsertPostgresRow(client, "app_users", user, user);
    for (const item of nextDb.qa_items || []) await upsertPostgresRow(client, "qa_items", item, item);
    for (const item of nextDb.qa_history || []) await upsertPostgresRow(client, "qa_history", item, item);
    for (const item of nextDb.inquiry_logs || []) await upsertPostgresRow(client, "inquiry_logs", item, item);
    for (const item of nextDb.inquiry_history || []) await upsertPostgresRow(client, "inquiry_history", item, item);
    for (const item of nextDb.documents || []) await upsertPostgresRow(client, "documents", item, item);
    for (const item of nextDb.sessions || []) await upsertPostgresRow(client, "sessions", item, item);
    await client.query("commit");
  } catch (error) {
    await client.query("rollback");
    throw error;
  } finally {
    client.release();
  }
}

async function readDatabase() {
  const pool = await getPgPool();
  if (pool) return readPostgresDatabase(pool);
  await ensureDatabase();
  const db = await readJson(dbPath, {});
  const users = Array.isArray(db.users) ? db.users.map(normalizeStoredUser) : defaultUsers.map(normalizeStoredUser);
  const existingNames = new Set(users.map((user) => user.username.toLowerCase()));
  defaultUsers.forEach((user) => {
    if (!existingNames.has(user.username.toLowerCase())) users.push(normalizeStoredUser(user));
  });
  const normalizedDb = {
    users,
    qa_items: Array.isArray(db.qa_items) ? db.qa_items : [],
    qa_history: Array.isArray(db.qa_history) ? db.qa_history : [],
    inquiry_logs: Array.isArray(db.inquiry_logs) ? db.inquiry_logs : [],
    inquiry_history: Array.isArray(db.inquiry_history) ? db.inquiry_history : [],
    documents: Array.isArray(db.documents) ? db.documents : [],
    sessions: Array.isArray(db.sessions) ? db.sessions.filter((session) => new Date(session.expires_at) > new Date()) : [],
    created_at: db.created_at || new Date().toISOString(),
    updated_at: db.updated_at || new Date().toISOString(),
  };
  if (JSON.stringify(db.users) !== JSON.stringify(normalizedDb.users) || JSON.stringify(db.sessions) !== JSON.stringify(normalizedDb.sessions)) {
    await saveDatabase(normalizedDb);
  }
  return normalizedDb;
}

async function saveDatabase(nextDb) {
  const pool = await getPgPool();
  if (pool) {
    await savePostgresDatabase(pool, nextDb);
    return;
  }
  await writeJson(dbPath, { ...nextDb, updated_at: new Date().toISOString() });
}

async function saveSessionRecord(db, session) {
  const pool = await getPgPool();
  if (pool) {
    await ensurePostgresDatabase(pool);
    await upsertPostgresRow(pool, "sessions", session, session);
    return;
  }
  await saveDatabase(db);
}

function sendJson(res, status, payload) {
  res.writeHead(status, { "Content-Type": "application/json; charset=utf-8" });
  res.end(JSON.stringify(payload));
}

function normalizeWhitespace(text) {
  return String(text || "")
    .replace(/\r/g, "\n")
    .replace(/\u0000/g, " ")
    .replace(/[ \t]+/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function tokenize(text) {
  return String(text || "")
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, " ")
    .split(/\s+/)
    .filter((token) => token.length > 1 && !stopWords.has(token));
}

function integrationStatus() {
  const openaiConfigured = Boolean(integrationConfig.openaiApiKey);
  const pineconeConfigured = Boolean(integrationConfig.pineconeApiKey && integrationConfig.pineconeIndexHost);
  return {
    database_mode: integrationConfig.databaseUrl ? "postgres" : "local-json",
    openai_configured: openaiConfigured,
    pinecone_configured: pineconeConfigured,
    coze_endpoint_configured: Boolean(integrationConfig.cozeServiceKey),
    retrieval_mode: pineconeConfigured ? "pinecone" : "local-json",
    answer_mode: openaiConfigured ? "openai" : "extractive",
    embedding_model: openaiConfigured ? integrationConfig.openaiEmbeddingModel : "",
    answer_model: openaiConfigured ? integrationConfig.openaiAnswerModel : "",
  };
}

function sourceSnippet(item) {
  return normalizeWhitespace(item?.answer || "").slice(0, 220);
}

function publicSource(item, score = null) {
  return {
    id: item.id,
    title: item.question,
    question: item.question,
    answer: item.answer,
    snippet: sourceSnippet(item),
    source: item.source,
    source_document: item.source_document,
    source_year: item.source_year,
    tags: Array.isArray(item.tags) ? item.tags : [],
    score,
  };
}

async function readRequestJson(req) {
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  if (!chunks.length) return {};
  return JSON.parse(Buffer.concat(chunks).toString("utf8"));
}

function publicUser(user) {
  const { password, password_hash, password_salt, password_algorithm, ...safeUser } = user;
  return safeUser;
}

function createSession(db, user) {
  const token = randomBytes(32).toString("hex");
  const session = {
    token,
    user_id: user.id,
    created_at: new Date().toISOString(),
    expires_at: new Date(Date.now() + 1000 * 60 * 60 * 12).toISOString(),
  };
  db.sessions = [...(db.sessions || []), session];
  return session;
}

function authenticate(db, req) {
  const header = req.headers.authorization || "";
  const token = header.startsWith("Bearer ") ? header.slice(7) : "";
  if (!token) return null;
  const session = (db.sessions || []).find((candidate) => candidate.token === token && new Date(candidate.expires_at) > new Date());
  if (!session) return null;
  const user = db.users.find((candidate) => candidate.id === session.user_id);
  return user ? { user, session } : null;
}

function requireAuth(db, req, res) {
  const auth = authenticate(db, req);
  if (!auth) {
    sendJson(res, 401, { error: "Please sign in first." });
    return null;
  }
  return auth;
}

function requireTeacher(db, req, res) {
  const auth = requireAuth(db, req, res);
  if (!auth) return null;
  if (auth.user.role !== "teacher") {
    sendJson(res, 403, { error: "Teacher permission is required." });
    return null;
  }
  return auth;
}

function requireCozeService(req, res) {
  if (!integrationConfig.cozeServiceKey) {
    sendJson(res, 503, { error: "COZE_SERVICE_KEY is not configured on the server." });
    return false;
  }
  const headerKey = req.headers["x-coze-service-key"] || "";
  if (headerKey !== integrationConfig.cozeServiceKey) {
    sendJson(res, 401, { error: "Invalid Coze service key." });
    return false;
  }
  return true;
}

function comparableQa(item) {
  return JSON.stringify({
    question: item?.question || "",
    answer: item?.answer || "",
    status: item?.status || "",
    source: item?.source || "",
    source_document: item?.source_document || "",
    tags: Array.isArray(item?.tags) ? item.tags : [],
    aliases: Array.isArray(item?.aliases) ? item.aliases : [],
  });
}

function qaAction(previous, next) {
  if (!previous) return "created";
  if (previous.status !== "archived" && next.status === "archived") return "archived";
  if (previous.status !== "approved" && next.status === "approved") return "approved";
  if (comparableQa(previous) !== comparableQa(next)) return "updated";
  return "";
}

function decorateQaItem(item, previous, actor, now) {
  const createdAt = previous?.created_at || item.created_at || now;
  const createdBy = previous?.created_by || item.created_by || actor.id;
  const createdByName = previous?.created_by_name || item.created_by_name || actor.name;
  return {
    ...item,
    created_at: createdAt,
    created_by: createdBy,
    created_by_name: createdByName,
    updated_at: now,
    updated_by: actor.id,
    updated_by_name: actor.name,
  };
}

function buildQaHistory(previousItems, nextItems, actor) {
  const now = new Date().toISOString();
  const previousById = new Map(previousItems.map((item) => [item.id, item]));
  const nextById = new Map(nextItems.map((item) => [item.id, item]));
  const decoratedItems = nextItems.map((item) => {
    const previous = previousById.get(item.id);
    return qaAction(previous, item) ? decorateQaItem(item, previous, actor, now) : previous;
  });
  const history = [];

  nextItems.forEach((item, index) => {
    const previous = previousById.get(item.id);
    const decorated = decoratedItems[index];
    const action = qaAction(previous, item);
    if (!action) return;
    history.push({
      id: uid("qa_history"),
      qa_id: decorated.id,
      question: decorated.question,
      action,
      actor_id: actor.id,
      actor_name: actor.name,
      changed_at: now,
      previous_status: previous?.status || "",
      next_status: decorated.status || "",
      previous_answer: previous?.answer || "",
      next_answer: decorated.answer || "",
    });
  });

  previousItems.forEach((item) => {
    if (nextById.has(item.id)) return;
    history.push({
      id: uid("qa_history"),
      qa_id: item.id,
      question: item.question,
      action: "removed",
      actor_id: actor.id,
      actor_name: actor.name,
      changed_at: now,
      previous_status: item.status || "",
      next_status: "",
      previous_answer: item.answer || "",
      next_answer: "",
    });
  });

  return { decoratedItems, history };
}

function buildInquiryHistory(previousLogs, nextLogs, actor) {
  const now = new Date().toISOString();
  const previousById = new Map(previousLogs.map((log) => [log.id, log]));
  const nextById = new Map(nextLogs.map((log) => [log.id, log]));
  const decoratedLogs = nextLogs.map((log) => {
    const previous = previousById.get(log.id);
    const changed = previous && (previous.review_status !== log.review_status || Boolean(previous.reviewed) !== Boolean(log.reviewed));
    return changed ? {
      ...log,
      reviewed_by: actor.id,
      reviewed_by_name: actor.name,
      reviewed_at: now,
    } : log;
  });
  const history = [];

  decoratedLogs.forEach((log) => {
    const previous = previousById.get(log.id);
    if (!previous || (previous.review_status === log.review_status && Boolean(previous.reviewed) === Boolean(log.reviewed))) return;
    history.push({
      id: uid("inquiry_history"),
      log_id: log.id,
      question: log.question,
      action: "reviewed",
      actor_id: actor.id,
      actor_name: actor.name,
      changed_at: now,
      previous_status: previous.review_status || "pending",
      next_status: log.review_status || "pending",
    });
  });

  previousLogs.forEach((log) => {
    if (nextById.has(log.id)) return;
    history.push({
      id: uid("inquiry_history"),
      log_id: log.id,
      question: log.question,
      action: "removed",
      actor_id: actor.id,
      actor_name: actor.name,
      changed_at: now,
      previous_status: log.review_status || "pending",
      next_status: "",
    });
  });

  return { decoratedLogs, history };
}

function searchLocalKnowledge(qaItems, query, includeDrafts = false) {
  const querySet = new Set(tokenize(query));
  if (!querySet.size) return [];

  return qaItems
    .filter((item) => includeDrafts || item.status === "approved")
    .map((item) => {
      const questionText = [item.question, ...(item.aliases || [])].join(" ");
      const questionSet = new Set(tokenize(questionText));
      const answerSet = new Set(tokenize(item.answer));
      const tagSet = new Set(tokenize((item.tags || []).join(" ")));
      const questionOverlap = [...querySet].filter((token) => questionSet.has(token)).length;
      const answerOverlap = [...querySet].filter((token) => answerSet.has(token)).length;
      const tagOverlap = [...querySet].filter((token) => tagSet.has(token)).length;
      const coverage = Math.max(questionOverlap + tagOverlap, questionOverlap + answerOverlap * 0.45) / querySet.size;
      const exactQuestionBonus = questionText.toLowerCase().includes(String(query).toLowerCase()) ? 5 : 0;
      const compactQuery = [...querySet].join(" ");
      const compactQuestion = tokenize(questionText).join(" ");
      const compactAnswer = tokenize(item.answer).join(" ");
      const phraseBonus = compactQuestion.includes(compactQuery) ? 4 : compactAnswer.includes(compactQuery) ? 3 : 0;
      const currentYearBonus = String(item.source_year || "").includes("2025-26") ? 0.6 : 0;
      const historicalPenalty = String(item.source_year || "").includes("historical") ? 0.35 : 0;
      const score = questionOverlap * 3 + tagOverlap * 2 + answerOverlap * 0.85 + exactQuestionBonus + phraseBonus + currentYearBonus - historicalPenalty;
      return { item, score, coverage, questionOverlap, tagOverlap, answerOverlap, exactQuestionBonus, phraseBonus, querySize: querySet.size };
    })
    .filter((result) => {
      const strongQuestionMatch = result.questionOverlap >= Math.min(3, Math.max(1, Math.ceil(result.querySize * 0.35)));
      const exactIntentMatch = result.exactQuestionBonus > 0 || result.phraseBonus >= 4;
      const scoreMatch = result.score >= Math.max(localSearchThresholds.minScore, localSearchThresholds.strongScore);
      const coverageMatch = result.coverage >= Math.max(localSearchThresholds.minCoverage, localSearchThresholds.strongCoverage);
      const topicalMatch = result.questionOverlap >= 2 && result.tagOverlap >= 1 && result.coverage >= 0.5;
      return exactIntentMatch || (strongQuestionMatch && scoreMatch && coverageMatch) || topicalMatch;
    })
    .sort((a, b) => b.score - a.score)
    .slice(0, 5);
}

function localAnswer(question, qaItems) {
  const hits = searchLocalKnowledge(qaItems, question);
  const primaryHit = hits[0];
  const isReliable = primaryHit && (
    primaryHit.exactQuestionBonus > 0 ||
    primaryHit.phraseBonus >= 4 ||
    (primaryHit.score >= localSearchThresholds.strongScore && primaryHit.coverage >= localSearchThresholds.strongCoverage && primaryHit.questionOverlap >= 2)
  );
  if (!hits.length || !isReliable) {
    return {
      answer: "I could not verify this from the approved course knowledge base yet. Your question has been logged for teacher review so the teaching team can add or confirm an official answer.",
      sources: [],
      confidence: "low",
      unanswered: true,
      retrieval_mode: "local-json",
      answer_mode: "extractive",
    };
  }
  return {
    answer: primaryHit.item.answer,
    sources: hits.slice(0, 3).map((hit) => publicSource(hit.item, Number(hit.score.toFixed(3)))),
    confidence: primaryHit.score >= 5 || primaryHit.coverage >= 0.58 ? "high" : "medium",
    unanswered: false,
    retrieval_mode: "local-json",
    answer_mode: "extractive",
  };
}

async function openaiEmbedding(text) {
  const response = await fetch(`${integrationConfig.openaiBaseUrl}/embeddings`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${integrationConfig.openaiApiKey}`,
    },
    body: JSON.stringify({
      model: integrationConfig.openaiEmbeddingModel,
      input: text,
    }),
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(payload.error?.message || "OpenAI embedding request failed.");
  return payload.data?.[0]?.embedding || [];
}

function pineconeSourceFromMatch(match) {
  const metadata = match.metadata || {};
  return {
    id: match.id,
    question: metadata.question || metadata.title || match.id,
    answer: metadata.answer || metadata.text || "",
    source: metadata.source || "pinecone",
    source_document: metadata.source_document || metadata.document || "",
    source_year: metadata.source_year || "",
    tags: Array.isArray(metadata.tags) ? metadata.tags : [],
    status: metadata.status || "approved",
  };
}

async function pineconeSearch(question) {
  const vector = await openaiEmbedding(question);
  const body = {
    vector,
    topK: integrationConfig.pineconeTopK,
    includeMetadata: true,
    filter: { status: { $eq: "approved" } },
  };
  if (integrationConfig.pineconeNamespace) body.namespace = integrationConfig.pineconeNamespace;
  const response = await fetch(`${integrationConfig.pineconeIndexHost}/query`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Api-Key": integrationConfig.pineconeApiKey,
    },
    body: JSON.stringify(body),
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(payload.message || "Pinecone query failed.");
  return (payload.matches || [])
    .filter((match) => Number(match.score || 0) >= integrationConfig.pineconeMinScore)
    .map((match) => ({
      item: pineconeSourceFromMatch(match),
      score: Number(match.score || 0),
    }));
}

function extractResponseText(payload) {
  if (payload.output_text) return payload.output_text;
  const parts = [];
  (payload.output || []).forEach((item) => {
    (item.content || []).forEach((content) => {
      if (content.text) parts.push(content.text);
    });
  });
  return parts.join("\n").trim();
}

async function openaiAnswer(question, sources) {
  const context = sources.map((source, index) => {
    const item = source.item || source;
    return `[${index + 1}] Source id: ${item.id}\nQuestion: ${item.question}\nAnswer: ${item.answer}\nDocument: ${item.source_document || item.source || "knowledge base"}`;
  }).join("\n\n");
  const response = await fetch(`${integrationConfig.openaiBaseUrl}/responses`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${integrationConfig.openaiApiKey}`,
    },
    body: JSON.stringify({
      model: integrationConfig.openaiAnswerModel,
      input: [
        {
          role: "system",
          content: "You answer CPT208 student questions in English. Use only the provided approved QA context. Preserve the original meaning. If the context is insufficient, say that the answer cannot be verified from the knowledge base. Do not invent dates, rules, or requirements.",
        },
        {
          role: "user",
          content: `Student question: ${question}\n\nApproved QA context:\n${context}`,
        },
      ],
    }),
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(payload.error?.message || "OpenAI answer request failed.");
  return extractResponseText(payload);
}

async function answerQuestionWithRag(db, question) {
  const status = integrationStatus();
  const remoteReady = status.openai_configured && status.pinecone_configured;

  if (remoteReady) {
    try {
      const pineconeHits = await pineconeSearch(question);
      if (pineconeHits.length) {
        const answer = status.openai_configured
          ? await openaiAnswer(question, pineconeHits.slice(0, 4))
          : pineconeHits[0].item.answer;
        return {
          answer,
          sources: pineconeHits.slice(0, 4).map((hit) => publicSource(hit.item, Number(hit.score.toFixed(3)))),
          confidence: pineconeHits[0].score >= 0.75 ? "high" : "medium",
          unanswered: false,
          retrieval_mode: "pinecone",
          answer_mode: "openai",
        };
      }
    } catch (error) {
      console.warn(`Remote RAG unavailable: ${error.message}`);
    }
  }

  const local = localAnswer(question, db.qa_items);
  if (status.openai_configured && !local.unanswered) {
    try {
      const generated = await openaiAnswer(question, local.sources.map((source) => ({ item: source })));
      return {
        ...local,
        answer: generated,
        answer_mode: "openai",
      };
    } catch (error) {
      console.warn(`OpenAI answer fallback unavailable: ${error.message}`);
    }
  }
  return local;
}

async function handleApi(req, res, pathname) {
  const db = await readDatabase();

  if (req.method === "GET" && pathname === "/api/health") {
    sendJson(res, 200, { ok: true, integrations: integrationStatus() });
    return;
  }

  if (req.method === "GET" && pathname === "/api/bootstrap") {
    const auth = authenticate(db, req);
    const isTeacher = auth?.user.role === "teacher";
    sendJson(res, 200, {
      user: auth ? publicUser(auth.user) : null,
      user_count: db.users.length,
      qa_items: isTeacher ? db.qa_items : db.qa_items.filter((item) => item.status === "approved"),
      qa_history: isTeacher ? db.qa_history : [],
      inquiry_logs: isTeacher ? db.inquiry_logs : [],
      inquiry_history: isTeacher ? db.inquiry_history : [],
      documents: isTeacher ? db.documents : [],
      integrations: integrationStatus(),
    });
    return;
  }

  if (req.method === "GET" && pathname === "/api/integrations/status") {
    const auth = requireTeacher(db, req, res);
    if (!auth) return;
    sendJson(res, 200, { integrations: integrationStatus() });
    return;
  }

  if (req.method === "POST" && pathname === "/api/ask") {
    const auth = requireAuth(db, req, res);
    if (!auth) return;
    const body = await readRequestJson(req);
    const question = normalizeWhitespace(body.question);
    if (!question) {
      sendJson(res, 400, { error: "Question is required." });
      return;
    }
    const answer = await answerQuestionWithRag(db, question);
    sendJson(res, 200, answer);
    return;
  }

  if (req.method === "POST" && pathname === "/api/coze/ask") {
    if (!requireCozeService(req, res)) return;
    const body = await readRequestJson(req);
    const question = normalizeWhitespace(body.question);
    if (!question) {
      sendJson(res, 400, { error: "Question is required." });
      return;
    }
    const answer = await answerQuestionWithRag(db, question);
    const log = {
      id: uid("log"),
      question,
      answer_preview: String(answer.answer || "").slice(0, 220),
      matched: (answer.sources || []).length > 0,
      confidence: answer.confidence,
      unanswered: Boolean(answer.unanswered || answer.confidence === "low" || !(answer.sources || []).length),
      reviewed: false,
      review_status: "pending",
      source_ids: (answer.sources || []).map((source) => source.id),
      source_documents: [...new Set((answer.sources || []).map((source) => source.source_document || source.source).filter(Boolean))],
      asked_at: new Date().toISOString(),
      user_id: body.user_id || "coze_user",
      user_name: body.user_name || "Coze Student",
      username: body.user_id || "coze",
      channel: "coze",
    };
    db.inquiry_logs = [log, ...db.inquiry_logs.filter((entry) => entry.id !== log.id)].slice(0, 1000);
    await saveDatabase(db);
    sendJson(res, 200, {
      ...answer,
      inquiry_id: log.id,
      channel: "coze",
    });
    return;
  }

  if (req.method === "POST" && pathname === "/api/auth/login") {
    const body = await readRequestJson(req);
    const user = db.users.find((candidate) => candidate.username?.toLowerCase() === String(body.username || "").toLowerCase());
    if (!user || !verifyPassword(user, body.password)) {
      sendJson(res, 401, { error: "Invalid username or password." });
      return;
    }
    const session = createSession(db, user);
    await saveSessionRecord(db, session);
    sendJson(res, 200, { user: publicUser(user), token: session.token, expires_at: session.expires_at });
    return;
  }

  if (req.method === "POST" && pathname === "/api/auth/logout") {
    const auth = authenticate(db, req);
    if (auth) {
      db.sessions = db.sessions.filter((session) => session.token !== auth.session.token);
      await saveDatabase(db);
    }
    sendJson(res, 200, { ok: true });
    return;
  }

  if (req.method === "POST" && pathname === "/api/auth/register") {
    const body = await readRequestJson(req);
    const username = String(body.username || "").trim();
    if (!/^[a-zA-Z0-9._-]{3,24}$/.test(username) || String(body.password || "").length < 6) {
      sendJson(res, 400, { error: "Invalid registration details." });
      return;
    }
    if (db.users.some((user) => user.username.toLowerCase() === username.toLowerCase())) {
      sendJson(res, 409, { error: "This username is already registered." });
      return;
    }
    if (body.role === "teacher" && body.teacherCode !== teacherRegistrationCode) {
      sendJson(res, 403, { error: "Teacher access code is incorrect." });
      return;
    }
    const user = {
      id: uid("user"),
      username,
      ...hashPassword(body.password),
      role: body.role === "teacher" ? "teacher" : "student",
      name: String(body.name || username).trim(),
      source: "registered",
      created_at: new Date().toISOString(),
    };
    db.users.push(user);
    const session = createSession(db, user);
    await saveDatabase(db);
    sendJson(res, 201, { user: publicUser(user), token: session.token, expires_at: session.expires_at });
    return;
  }

  if (req.method === "PUT" && pathname === "/api/qa") {
    const auth = requireTeacher(db, req, res);
    if (!auth) return;
    const body = await readRequestJson(req);
    const nextItems = Array.isArray(body.qa_items) ? body.qa_items : [];
    if (db.qa_items.length > 0 && nextItems.length === 0 && !body.allow_empty) {
      sendJson(res, 400, { error: "Refusing to replace the knowledge base with an empty list." });
      return;
    }
    const { decoratedItems, history } = buildQaHistory(db.qa_items, nextItems, auth.user);
    db.qa_items = decoratedItems;
    db.qa_history = [...history, ...(db.qa_history || [])].slice(0, 500);
    await saveDatabase(db);
    sendJson(res, 200, { ok: true, qa_items: db.qa_items, qa_history: db.qa_history });
    return;
  }

  if (req.method === "POST" && pathname === "/api/inquiries") {
    const auth = requireAuth(db, req, res);
    if (!auth) return;
    const body = await readRequestJson(req);
    if (!body.log?.id || !body.log?.question) {
      sendJson(res, 400, { error: "Invalid inquiry log." });
      return;
    }
    const log = {
      ...body.log,
      user_id: auth.user.id,
      user_name: auth.user.name,
      username: auth.user.username,
    };
    db.inquiry_logs = [log, ...db.inquiry_logs.filter((entry) => entry.id !== log.id)].slice(0, 1000);
    await saveDatabase(db);
    sendJson(res, 201, { ok: true, log });
    return;
  }

  if (req.method === "PUT" && pathname === "/api/inquiries") {
    const auth = requireTeacher(db, req, res);
    if (!auth) return;
    const body = await readRequestJson(req);
    const nextLogs = Array.isArray(body.inquiry_logs) ? body.inquiry_logs : [];
    const { decoratedLogs, history } = buildInquiryHistory(db.inquiry_logs, nextLogs, auth.user);
    db.inquiry_logs = decoratedLogs;
    db.inquiry_history = [...history, ...(db.inquiry_history || [])].slice(0, 500);
    await saveDatabase(db);
    sendJson(res, 200, { ok: true, inquiry_logs: db.inquiry_logs, inquiry_history: db.inquiry_history });
    return;
  }

  sendJson(res, 404, { error: "API route not found." });
}

async function serveStatic(req, res, pathname) {
  const safePath = pathname === "/" ? "/index.html" : decodeURIComponent(pathname);
  const filePath = path.normalize(path.join(rootDir, safePath));
  if (!filePath.startsWith(rootDir)) {
    res.writeHead(403);
    res.end("Forbidden");
    return;
  }
  try {
    const file = await readFile(filePath);
    res.writeHead(200, { "Content-Type": mimeTypes[path.extname(filePath)] || "application/octet-stream" });
    res.end(file);
  } catch {
    res.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
    res.end("Not found");
  }
}

const server = createServer(async (req, res) => {
  try {
    const url = new URL(req.url || "/", `http://${req.headers.host}`);
    if (url.pathname.startsWith("/api/")) {
      await handleApi(req, res, url.pathname);
      return;
    }
    await serveStatic(req, res, url.pathname);
  } catch (error) {
    sendJson(res, 500, { error: error.message || "Server error." });
  }
});

server.listen(port, "0.0.0.0", () => {
  console.log(`CPT208 Course Desk running at http://localhost:${port}`);
});
