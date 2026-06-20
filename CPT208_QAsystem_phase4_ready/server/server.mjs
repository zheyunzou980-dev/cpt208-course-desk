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
