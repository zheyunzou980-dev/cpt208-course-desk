const KB_STORAGE_KEY = "cpt208.qa.knowledge";
const KB_VERSION_STORAGE_KEY = "cpt208.qa.knowledgeVersion";
const INQUIRY_LOG_STORAGE_KEY = "cpt208.qa.inquiryLogs";
const SESSION_STORAGE_KEY = "cpt208.qa.session";
const CHAT_SESSION_STORAGE_KEY = "cpt208.qa.chatSessions";
const USER_STORAGE_KEY = "cpt208.qa.users";
const KB_VERSION = "2026-06-16-static-morandi-alerts";
const MIN_CONFIDENCE_SCORE = 2.6;
const MIN_TOKEN_COVERAGE = 0.34;
const STRONG_MATCH_SCORE = 4.2;
const STRONG_MATCH_COVERAGE = 0.45;
const TEACHER_REGISTRATION_CODE = "cpt208-admin";

const DEFAULT_USERS = [
  { id: "user_demo_student", username: "student", password: "cpt208", role: "student", name: "Student Demo", source: "demo" },
  { id: "user_demo_teacher", username: "teacher", password: "cpt208-admin", role: "teacher", name: "Teacher Demo", source: "demo" },
];

const STOP_WORDS = new Set([
  "a", "an", "and", "are", "about", "can", "do", "does", "for", "from", "have", "how",
  "i", "is", "need", "of", "on", "or", "should", "student", "students", "that", "the",
  "this", "to", "what", "when", "where", "which", "who", "with", "cpt208",
]);

const state = {
  items: [],
  inquiryLogs: [],
  qaHistory: [],
  inquiryHistory: [],
  integrations: {
    database_mode: "local-json",
    openai_configured: false,
    pinecone_configured: false,
    retrieval_mode: "local-json",
    answer_mode: "extractive",
  },
  users: [],
  userCount: 0,
  backendReady: false,
  session: null,
  mode: "student",
  chatSessions: [],
  activeSessionId: "",
  activeSources: [],
  showResolvedInquiries: false,
  pendingIngestFiles: [],
};

const $ = (selector) => document.querySelector(selector);

function readJson(key, fallback) {
  try {
    const raw = localStorage.getItem(key);
    return raw ? JSON.parse(raw) : fallback;
  } catch {
    return fallback;
  }
}

function writeJson(key, value) {
  localStorage.setItem(key, JSON.stringify(value));
}

async function apiRequest(path, options = {}) {
  if (!state.backendReady && path !== "/api/bootstrap" && path !== "/api/health") {
    throw new Error("Backend is not active.");
  }
  const response = await fetch(path, {
    ...options,
    headers: {
      "Content-Type": "application/json",
      ...(state.session?.token ? { Authorization: `Bearer ${state.session.token}` } : {}),
      ...(options.headers || {}),
    },
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(payload.error || "API request failed.");
  return payload;
}

function uid(prefix) {
  return `${prefix}_${Date.now()}_${Math.random().toString(16).slice(2, 8)}`;
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
    .filter((token) => token.length > 1 && !STOP_WORDS.has(token));
}

function normalizeItem(item) {
  return {
    ...item,
    tags: Array.isArray(item.tags) ? item.tags : String(item.tags || "").split(",").map((tag) => tag.trim()).filter(Boolean),
    aliases: Array.isArray(item.aliases) ? item.aliases : [],
    embedding: item.embedding || "[vector generated during ingestion]",
    status: item.status || "draft",
    source: item.source || "teacher",
  };
}

function normalizeUser(user) {
  return {
    id: user.id || uid("user"),
    username: String(user.username || "").trim(),
    password: String(user.password || ""),
    role: user.role === "teacher" ? "teacher" : "student",
    name: String(user.name || user.username || "").trim(),
    source: user.source || "registered",
    created_at: user.created_at || new Date().toISOString(),
  };
}

function loadUsers() {
  const storedUsers = readJson(USER_STORAGE_KEY, []).map(normalizeUser);
  const storedNames = new Set(storedUsers.map((user) => user.username.toLowerCase()));
  state.users = [
    ...DEFAULT_USERS.filter((user) => !storedNames.has(user.username.toLowerCase())).map(normalizeUser),
    ...storedUsers,
  ];
  persistUsers();
}

function persistUsers() {
  writeJson(USER_STORAGE_KEY, state.users);
}

async function loadBackendData() {
  if (!["http:", "https:"].includes(window.location.protocol)) return false;
  try {
    const data = await apiRequest("/api/bootstrap");
    state.backendReady = true;
    state.userCount = data.user_count || 0;
    if (data.user && state.session) {
      state.session = { ...state.session, ...data.user, token: state.session.token };
      persistSession();
    } else if (state.session?.token) {
      state.session = null;
      persistSession();
    }
    state.items = (data.qa_items || []).map(normalizeItem);
    state.qaHistory = data.qa_history || [];
    state.inquiryLogs = data.inquiry_logs || [];
    state.inquiryHistory = data.inquiry_history || [];
    state.integrations = data.integrations || state.integrations;
    writeJson(KB_STORAGE_KEY, state.items);
    writeJson(INQUIRY_LOG_STORAGE_KEY, state.inquiryLogs);
    return true;
  } catch (error) {
    console.warn(`Backend unavailable: ${error.message}`);
    state.backendReady = false;
    return false;
  }
}

function findUser(username) {
  const normalized = String(username || "").trim().toLowerCase();
  return state.users.find((user) => user.username.toLowerCase() === normalized) || null;
}

function loadKnowledgeBase() {
  const cached = localStorage.getItem(KB_STORAGE_KEY);
  const cachedVersion = localStorage.getItem(KB_VERSION_STORAGE_KEY);
  const defaults = (window.CPT208_KNOWLEDGE_BASE || []).map(normalizeItem);
  if (cached && cachedVersion === KB_VERSION) {
    const cachedItems = JSON.parse(cached).map(normalizeItem);
    const cachedIds = new Set(cachedItems.map((item) => item.id));
    state.items = [...cachedItems, ...defaults.filter((item) => !cachedIds.has(item.id))];
  } else {
    state.items = defaults;
  }
  persistKnowledgeBase();
}

function persistKnowledgeBase() {
  writeJson(KB_STORAGE_KEY, state.items);
  localStorage.setItem(KB_VERSION_STORAGE_KEY, KB_VERSION);
  if (state.backendReady) {
    apiRequest("/api/qa", {
      method: "PUT",
      body: JSON.stringify({ qa_items: state.items }),
    }).then((data) => {
      state.qaHistory = data.qa_history || state.qaHistory;
      renderKnowledgeActivity();
    }).catch((error) => console.warn(error.message));
  }
}

function loadInquiryLogs() {
  state.inquiryLogs = readJson(INQUIRY_LOG_STORAGE_KEY, []);
  deriveConfidenceForOldLogs();
}

function persistInquiryLogs() {
  writeJson(INQUIRY_LOG_STORAGE_KEY, state.inquiryLogs);
  if (state.backendReady && isTeacher()) {
    apiRequest("/api/inquiries", {
      method: "PUT",
      body: JSON.stringify({ inquiry_logs: state.inquiryLogs }),
    }).then((data) => {
      state.inquiryHistory = data.inquiry_history || state.inquiryHistory;
    }).catch((error) => console.warn(error.message));
  }
}

function loadChatSessions() {
  state.chatSessions = readJson(CHAT_SESSION_STORAGE_KEY, []);
  if (!state.chatSessions.length) createChatSession(false);
  state.activeSessionId = state.chatSessions[0].id;
}

function persistChatSessions() {
  writeJson(CHAT_SESSION_STORAGE_KEY, state.chatSessions);
}

function loadSession() {
  const raw = sessionStorage.getItem(SESSION_STORAGE_KEY);
  state.session = raw ? JSON.parse(raw) : null;
}

function persistSession() {
  if (state.session) sessionStorage.setItem(SESSION_STORAGE_KEY, JSON.stringify(state.session));
  else sessionStorage.removeItem(SESSION_STORAGE_KEY);
}

function isTeacher() {
  return state.session?.role === "teacher";
}

function showAuthMode(mode) {
  const isRegister = mode === "register";
  $("#login-form").classList.toggle("is-hidden", isRegister);
  $("#register-form").classList.toggle("is-hidden", !isRegister);
  $("#login-error").textContent = "";
  $("#register-error").textContent = "";
}

function startSessionForUser(user, token = "") {
  state.session = {
    id: user.id,
    username: user.username,
    role: user.role,
    name: user.name,
    token: token || user.token || "",
  };
  state.mode = user.role === "teacher" ? "teacher" : "student";
  persistSession();
  renderAuthState();
}

function searchKnowledge(query, includeDrafts = false) {
  const querySet = new Set(tokenize(query));
  if (!querySet.size) return [];

  return state.items
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
      const exactQuestionBonus = questionText.toLowerCase().includes(query.toLowerCase()) ? 5 : 0;
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
      const scoreMatch = result.score >= Math.max(MIN_CONFIDENCE_SCORE, STRONG_MATCH_SCORE);
      const coverageMatch = result.coverage >= Math.max(MIN_TOKEN_COVERAGE, STRONG_MATCH_COVERAGE);
      const topicalMatch = result.questionOverlap >= 2 && result.tagOverlap >= 1 && result.coverage >= 0.5;
      return exactIntentMatch || (strongQuestionMatch && scoreMatch && coverageMatch) || topicalMatch;
    })
    .sort((a, b) => b.score - a.score)
    .slice(0, 4);
}

function answerQuestion(question) {
  const hits = searchKnowledge(question);
  const primaryHit = hits[0];
  const isReliable = primaryHit && (
    primaryHit.exactQuestionBonus > 0 ||
    primaryHit.phraseBonus >= 4 ||
    (primaryHit.score >= STRONG_MATCH_SCORE && primaryHit.coverage >= STRONG_MATCH_COVERAGE && primaryHit.questionOverlap >= 2)
  );
  if (!hits.length || !isReliable) {
    return {
      answer: "I could not verify this from the approved course knowledge base yet. Your question has been logged for teacher review so the teaching team can add or confirm an official answer.",
      sources: [],
      confidence: "low",
      unanswered: true,
    };
  }
  const primary = primaryHit.item;
  return {
    answer: primary.answer,
    sources: hits.slice(0, 3).map(({ item }) => item),
    confidence: primaryHit.score >= 5 || primaryHit.coverage >= 0.58 ? "high" : "medium",
    unanswered: false,
  };
}

async function askQuestion(question) {
  if (state.backendReady && state.session?.token) {
    return apiRequest("/api/ask", {
      method: "POST",
      body: JSON.stringify({ question }),
    });
  }
  return answerQuestion(question);
}

function createChatSession(render = true) {
  const session = {
    id: uid("session"),
    title: "Course Question Desk",
    updatedAt: "Just now",
    messages: [
      {
        id: uid("message"),
        role: "assistant",
        content: "Welcome. Ask about CPT208 coursework, poster requirements, portfolio, video demo, attendance, or module contacts.",
        sources: [],
      },
    ],
  };
  state.chatSessions.unshift(session);
  state.activeSessionId = session.id;
  persistChatSessions();
  if (render) renderStudent();
}

function activeSession() {
  return state.chatSessions.find((session) => session.id === state.activeSessionId) || state.chatSessions[0];
}

function addMessageToActive(role, content, sources = []) {
  const session = activeSession();
  session.messages.push({ id: uid("message"), role, content, sources });
  session.updatedAt = "Just now";
  if (role === "user") session.title = content.slice(0, 44);
  persistChatSessions();
}

function setMode(mode) {
  const nextMode = mode === "teacher" || mode === "analytics" ? (isTeacher() ? mode : "student") : "student";
  state.mode = nextMode;
  document.querySelectorAll(".mode-button").forEach((button) => button.classList.toggle("active", button.dataset.mode === nextMode));
  document.querySelectorAll(".view").forEach((view) => view.classList.toggle("active", view.id === `${nextMode}-view`));
  renderAll();
}

function renderAuthState() {
  document.body.classList.toggle("is-authenticated", Boolean(state.session));
  document.querySelectorAll(".teacher-only").forEach((node) => node.classList.toggle("is-hidden", !isTeacher()));
  $("#account-chip").textContent = state.session ? `${state.session.name} · ${state.session.role}` : "";
  setMode(isTeacher() ? state.mode : "student");
}

function escapeHtml(value) {
  return String(value || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

function renderStudent() {
  const session = activeSession();
  $("#active-session-title").textContent = session?.title || "Course Question Desk";
  $("#session-list").innerHTML = state.chatSessions.map((item) => `
    <button type="button" class="${item.id === state.activeSessionId ? "active" : ""}" data-session="${item.id}">
      <strong>${escapeHtml(item.title)}</strong>
      <small>${escapeHtml(item.updatedAt)}</small>
    </button>
  `).join("");

  $("#chat-log").innerHTML = (session?.messages || []).map((message) => `
    <article class="message ${message.role === "user" ? "user" : "assistant"}">
      <div class="message-role">${message.role === "user" ? "You" : "CPT208 Course Desk"}</div>
      <div class="message-body">${escapeHtml(message.content)}</div>
      ${message.sources?.length ? `<div class="message-sources">${message.sources.map((source) => `<button class="citation" type="button" data-source="${source.id}">${source.id}</button>`).join("")}</div>` : ""}
    </article>
  `).join("");

  $("#chat-log").scrollTop = $("#chat-log").scrollHeight;
  state.activeSources = (session?.messages || []).flatMap((message) => message.sources || []);
  renderSources();
}

function renderSources(activeId = "") {
  const unique = new Map();
  state.activeSources.forEach((source) => unique.set(source.id, source));
  const sources = [...unique.values()];
  $("#source-list").innerHTML = sources.length
    ? sources.map((source) => `
      <article class="source-card ${source.id === activeId ? "open" : ""}">
        <button type="button" data-source-card="${source.id}">
          <strong>${escapeHtml(source.question)}</strong>
          <small>${escapeHtml(source.id)} · ${escapeHtml(source.source_document || source.source)}</small>
        </button>
        <div class="source-detail">${escapeHtml(source.answer)}</div>
      </article>
    `).join("")
    : '<div class="empty-state">Citation sources will appear after an answer is retrieved.</div>';
}

function recordInquiry(question, response) {
  const log = {
    id: uid("log"),
    question,
    answer_preview: response.answer.slice(0, 220),
    matched: response.sources.length > 0,
    confidence: response.confidence,
    unanswered: response.unanswered || response.confidence === "low" || response.sources.length === 0,
    reviewed: false,
    source_ids: response.sources.map((source) => source.id),
    source_documents: [...new Set(response.sources.map((source) => source.source_document || source.source).filter(Boolean))],
    asked_at: new Date().toISOString(),
  };
  state.inquiryLogs.unshift(log);
  state.inquiryLogs = state.inquiryLogs.slice(0, 500);
  persistInquiryLogs();
  if (state.backendReady && state.session?.token) {
    apiRequest("/api/inquiries", {
      method: "POST",
      body: JSON.stringify({ log }),
    }).catch((error) => console.warn(error.message));
  }
}

async function submitQuestion(questionText) {
  const question = questionText.trim();
  if (!question) return;
  addMessageToActive("user", question);
  $("#question-input").value = "";
  renderAll();
  try {
    const response = await askQuestion(question);
    addMessageToActive("assistant", response.answer, response.sources || []);
    recordInquiry(question, response);
  } catch (error) {
    const response = {
      answer: "The QA service is temporarily unavailable. Your question has not been answered yet, so please try again or contact the teaching team.",
      sources: [],
      confidence: "low",
      unanswered: true,
    };
    addMessageToActive("assistant", response.answer, []);
    recordInquiry(question, response);
  }
  renderAll();
}

function categoryCounts() {
  const counts = {};
  state.items.forEach((item) => (item.tags || []).slice(0, 2).forEach((tag) => {
    counts[tag] = (counts[tag] || 0) + 1;
  }));
  return Object.entries(counts).sort((a, b) => b[1] - a[1]).slice(0, 8).map(([label, value]) => ({ label, value }));
}

function questionCounts() {
  const counts = {};
  state.inquiryLogs.forEach((log) => {
    counts[log.question] = (counts[log.question] || 0) + 1;
  });
  return Object.entries(counts).sort((a, b) => b[1] - a[1]).slice(0, 10).map(([label, value]) => ({ label, value }));
}

function topicCounts() {
  const topics = ["poster", "video", "portfolio", "submission", "ai", "backend", "attendance"];
  const rows = topics.map((topic) => ({
    label: topic,
    value: state.inquiryLogs.filter((log) => log.question.toLowerCase().includes(topic)).length,
  })).filter((row) => row.value > 0).sort((a, b) => b.value - a.value);
  return rows;
}

function renderRankList(selector, rows) {
  $(selector).innerHTML = rows.length ? rows.map((row, index) => `
    <div class="rank-item">
      <span>${index + 1}</span>
      <strong>${escapeHtml(row.label)}</strong>
      <small>${row.value}</small>
    </div>
  `).join("") : '<div class="empty-state">No data yet.</div>';
}

function renderBars(selector, rows) {
  if (!rows.length) {
    $(selector).innerHTML = '<div class="empty-state">No data yet.</div>';
    return;
  }
  const max = Math.max(...rows.map((row) => row.value), 1);
  $(selector).innerHTML = rows.map((row) => `
    <div class="bar-row">
      <span>${escapeHtml(row.label)}</span>
      <div><i style="width:${(row.value / max) * 100}%"></i></div>
      <strong>${row.value}</strong>
    </div>
  `).join("");
}

function renderTrend() {
  const dateCounts = {};
  state.inquiryLogs.forEach((log) => {
    const key = new Date(log.asked_at).toLocaleDateString("en-GB", { month: "short", day: "numeric" });
    dateCounts[key] = (dateCounts[key] || 0) + 1;
  });
  const rows = Object.entries(dateCounts).slice(-7).map(([label, value]) => ({ label, value }));
  if (!rows.length) {
    $("#usage-trend").innerHTML = '<div class="empty-state">No usage data yet.</div>';
    return;
  }
  const max = Math.max(...rows.map((row) => row.value));
  $("#usage-trend").innerHTML = rows.map((row) => `
    <div class="trend-bar">
      <i style="height:${(row.value / max) * 100}%"></i>
      <span>${row.label}</span>
    </div>
  `).join("");
}

function renderMetrics() {
  const unanswered = state.inquiryLogs.filter((log) => log.unanswered && log.review_status !== "approved_response");
  const reviewQueue = state.inquiryLogs.filter((log) => requiresTeacherAction(log));
  $("#metric-total-questions").textContent = state.inquiryLogs.length;
  $("#metric-unanswered").textContent = unanswered.length;
  $("#metric-approved").textContent = state.items.filter((item) => item.status === "approved").length;
  $("#metric-draft").textContent = state.items.filter((item) => item.status === "draft").length;
  $("#analytics-total").textContent = state.inquiryLogs.length;
  $("#analytics-review").textContent = reviewQueue.length;
  const high = state.inquiryLogs.filter((log) => log.confidence === "high").length;
  $("#analytics-accuracy").textContent = state.inquiryLogs.length ? `${Math.round((high / state.inquiryLogs.length) * 100)}%` : "No data";
  $("#analytics-users").textContent = state.backendReady ? state.userCount : state.users.length;

  renderRankList("#teacher-frequency-list", questionCounts());
  renderBars("#teacher-category-bars", categoryCounts());
  renderBars("#hot-topic-bars", topicCounts());
  renderRankList("#top-question-list", questionCounts());
  renderBars("#accuracy-bars", [
    { label: "High confidence", value: state.inquiryLogs.filter((log) => log.confidence === "high").length },
    { label: "Needs review", value: state.inquiryLogs.filter((log) => log.confidence === "medium").length },
    { label: "Unanswered", value: unanswered.length },
  ].filter((row) => row.value > 0));
  renderTrend();
}

function renderIntegrationStatus() {
  if (!$("#integration-openai")) return;
  const integrations = state.integrations || {};
  $("#integration-database").textContent = integrations.database_mode || "local-json";
  $("#integration-openai").textContent = integrations.openai_configured ? "Configured" : "Not configured";
  $("#integration-pinecone").textContent = integrations.pinecone_configured ? "Configured" : "Not configured";
  $("#integration-retrieval").textContent = integrations.retrieval_mode || "local-json";
  $("#integration-answer").textContent = integrations.answer_mode || "extractive";
  $("#integration-note").textContent = integrations.openai_configured && integrations.pinecone_configured
    ? "Remote RAG is ready. Student answers can use Pinecone retrieval and OpenAI generation."
    : "Remote API keys are not set yet. The system is using the local approved knowledge base as a safe fallback.";
}

function deriveConfidenceForOldLogs() {
  state.inquiryLogs = state.inquiryLogs.map((log) => ({
    ...log,
    confidence: log.confidence || "unknown",
    reviewed: Boolean(log.reviewed),
    unanswered: typeof log.unanswered === "boolean" ? log.unanswered : !log.matched,
    review_status: log.review_status || "pending",
  }));
  persistInquiryLogs();
}

function inquiryConfidenceLabel(log) {
  if (log.unanswered) return "No verified answer found";
  if (log.confidence === "high") return "High-confidence match";
  if (log.confidence === "medium") return "Needs teacher review";
  return "Confidence not scored";
}

function inquiryDecisionLabel(log) {
  if (log.review_status === "approved_response") return "Teacher decision: Approved response";
  if (log.review_status === "needs_kb_update") return "Teacher decision: Needs KB update";
  if (log.review_status === "teacher_follow_up") return "Teacher decision: Teacher follow-up required";
  return "Teacher decision: Pending decision";
}

function inquirySeenLabel(log) {
  return log.reviewed ? "Seen status: Seen by teacher" : "Seen status: Not seen yet";
}

function requiresTeacherAction(log) {
  return !log.reviewed || log.review_status === "needs_kb_update" || log.review_status === "teacher_follow_up" || (log.unanswered && log.review_status !== "approved_response");
}

function syncReviewButtonLabel() {
  const button = $("#clear-logs");
  if (!button) return;
  const hasPending = state.inquiryLogs.some((log) => !log.reviewed);
  button.textContent = hasPending ? "Mark All as Seen" : "Undo Seen Status";
}

function syncInquiryViewButton() {
  const button = $("#toggle-inquiry-view");
  if (!button) return;
  button.textContent = state.showResolvedInquiries ? "Show Active Only" : "Show Resolved";
}

function renderTeacherList() {
  const query = $("#teacher-search").value.toLowerCase();
  const status = $("#status-filter").value;
  const items = state.items.filter((item) => {
    const matchesStatus = status === "all" || item.status === status;
    const blob = `${item.id} ${item.question} ${item.answer} ${(item.tags || []).join(" ")} ${item.source_document}`.toLowerCase();
    return matchesStatus && blob.includes(query);
  });
  $("#qa-list").innerHTML = items.map((item) => `
    <article class="qa-item">
      <header>
        <div>
          <h4>${escapeHtml(item.question)}</h4>
          <span class="status ${item.status}">${item.status}</span>
        </div>
        <div class="item-actions">
          <button type="button" data-edit="${item.id}">Edit</button>
          <button type="button" data-archive="${item.id}">Archive</button>
        </div>
      </header>
      <p>${escapeHtml(item.answer)}</p>
      <small>${escapeHtml(item.id)} · ${escapeHtml(item.source_document || item.source)} · ${(item.tags || []).map(escapeHtml).join(", ")}</small>
    </article>
  `).join("");
}

function actionLabel(action) {
  const labels = {
    created: "Created",
    updated: "Updated",
    approved: "Approved",
    archived: "Archived",
    removed: "Removed",
  };
  return labels[action] || "Changed";
}

function renderKnowledgeActivity() {
  if (!$("#qa-history-list")) return;
  const rows = (state.qaHistory || []).slice(0, 8);
  $("#qa-history-list").innerHTML = rows.length
    ? rows.map((entry) => `
      <article class="activity-item">
        <span class="status">${escapeHtml(actionLabel(entry.action))}</span>
        <div>
          <strong>${escapeHtml(entry.question || entry.qa_id)}</strong>
          <small>${escapeHtml(entry.actor_name || "Teacher")} · ${escapeHtml(new Date(entry.changed_at).toLocaleString())}</small>
          ${entry.previous_status !== entry.next_status ? `<p>${escapeHtml(entry.previous_status || "none")} -> ${escapeHtml(entry.next_status || "none")}</p>` : ""}
        </div>
      </article>
    `).join("")
    : '<div class="empty-state compact">No knowledge changes recorded yet.</div>';
}

function renderInquiryLogs() {
  if (!$("#inquiry-list")) return;
  const visibleLogs = state.showResolvedInquiries
    ? state.inquiryLogs
    : state.inquiryLogs.filter((log) => requiresTeacherAction(log));
  $("#inquiry-list").innerHTML = visibleLogs.length
    ? visibleLogs.map((log) => `
      <article class="inquiry-item">
        <div>
          <h4>${escapeHtml(log.question)}</h4>
          <p>${escapeHtml(log.answer_preview)}${log.answer_preview.length >= 220 ? "..." : ""}</p>
          <small>Sources: ${log.source_ids.length ? escapeHtml(log.source_ids.join(", ")) : "No approved match"}</small>
          <div class="item-actions inquiry-actions">
            <button type="button" data-inquiry-action="approve" data-log-id="${log.id}">Approve</button>
            <button type="button" data-inquiry-action="open-editor" data-log-id="${log.id}">${escapeHtml(inquiryEditorLabel(log))}</button>
            <button type="button" class="danger-action" data-inquiry-action="delete" data-log-id="${log.id}">Delete</button>
          </div>
        </div>
        <div class="inquiry-meta">
          <span class="status ${log.unanswered ? "archived" : ""}">${log.unanswered ? "needs answer" : "answered"}</span>
          <div>System match: ${escapeHtml(inquiryConfidenceLabel(log))}</div>
          <div>${escapeHtml(inquiryDecisionLabel(log))}</div>
          <div>${escapeHtml(inquirySeenLabel(log))}</div>
        </div>
      </article>
    `).join("")
    : `<div class="empty-state">${state.showResolvedInquiries ? "No student inquiries have been recorded yet." : "No active review items right now."}</div>`;
  syncReviewButtonLabel();
  syncInquiryViewButton();
}

function buildDraftFromInquiry(log) {
  const sourceItem = log.source_ids?.length ? state.items.find((item) => item.id === log.source_ids[0]) : null;
  return {
    question: log.question,
    answer: log.unanswered ? "" : (sourceItem?.answer || ""),
    status: "draft",
    source: "teacher",
    tags: sourceItem?.tags?.length ? sourceItem.tags : ["needs-teacher-review"],
    source_document: sourceItem?.source_document || "",
  };
}

function linkedQaForInquiry(log) {
  return log.source_ids?.length ? state.items.find((item) => item.id === log.source_ids[0]) || null : null;
}

function inquiryEditorLabel(log) {
  return linkedQaForInquiry(log) ? "Edit QA" : "Create QA";
}

function openInquiryEditor(log) {
  const linkedItem = linkedQaForInquiry(log);
  fillEditor(linkedItem || buildDraftFromInquiry(log));
  state.inquiryLogs = state.inquiryLogs.map((entry) => entry.id === log.id ? {
    ...entry,
    reviewed: true,
    review_status: "needs_kb_update",
  } : entry);
  persistInquiryLogs();
  renderAll();
  $("#qa-question").focus();
}

function updateInquiryDecision(logId, reviewStatus) {
  state.inquiryLogs = state.inquiryLogs.map((log) => log.id === logId ? {
    ...log,
    reviewed: true,
    review_status: reviewStatus,
  } : log);
  persistInquiryLogs();
  renderAll();
}

function deleteInquiryLog(logId) {
  state.inquiryLogs = state.inquiryLogs.filter((log) => log.id !== logId);
  persistInquiryLogs();
  renderAll();
}

function fillEditor(item) {
  $("#editor-title").textContent = item ? "Edit Course Answer" : "Add Course Answer";
  $("#qa-id").value = item?.id || "";
  $("#qa-question").value = item?.question || "";
  $("#qa-answer").value = item?.answer || "";
  $("#qa-status").value = item?.status || "approved";
  $("#qa-source").value = item?.source || "teacher";
  $("#qa-tags").value = (item?.tags || []).join(", ");
  $("#qa-doc").value = item?.source_document || "";
}

function nextQaId() {
  const ids = state.items.map((item) => Number(String(item.id).replace(/\D/g, ""))).filter(Number.isFinite);
  return `qa_${String(Math.max(0, ...ids) + 1).padStart(3, "0")}`;
}

function nextQaIdFrom(value) {
  return `qa_${String(value).padStart(3, "0")}`;
}

function extractTextFromPdfBuffer(arrayBuffer) {
  const raw = new TextDecoder("latin1").decode(new Uint8Array(arrayBuffer));
  const fragments = [...raw.matchAll(/\((?:\\.|[^\\()]){3,}\)/g)]
    .map((match) => match[0].slice(1, -1))
    .map((fragment) => fragment
      .replace(/\\n/g, "\n")
      .replace(/\\r/g, " ")
      .replace(/\\t/g, " ")
      .replace(/\\\(/g, "(")
      .replace(/\\\)/g, ")")
      .replace(/\\\\/g, "\\"))
    .filter((fragment) => /[A-Za-z]{3,}/.test(fragment));
  return normalizeWhitespace(fragments.join("\n"));
}

function extractQaPairsFromText(text) {
  const lines = normalizeWhitespace(text).split("\n").map((line) => line.trim()).filter(Boolean);
  const pairs = [];
  let currentQuestion = "";
  let currentAnswer = "";
  let mode = "";

  const pushPair = () => {
    if (!currentQuestion || !currentAnswer) return;
    pairs.push({
      question: normalizeWhitespace(currentQuestion),
      answer: normalizeWhitespace(currentAnswer),
    });
    currentQuestion = "";
    currentAnswer = "";
    mode = "";
  };

  lines.forEach((line) => {
    const questionMatch = line.match(/^(?:q(?:uestion)?\s*\d*|question)\s*[:.\-]\s*(.+)$/i);
    const answerMatch = line.match(/^(?:a(?:nswer)?\s*\d*|answer)\s*[:.\-]\s*(.+)$/i);
    if (questionMatch) {
      pushPair();
      currentQuestion = questionMatch[1].trim();
      mode = "question";
      return;
    }
    if (answerMatch) {
      currentAnswer = answerMatch[1].trim();
      mode = "answer";
      return;
    }
    if (/^q\d+\s*[:.\-]/i.test(line)) {
      pushPair();
      currentQuestion = line.replace(/^q\d+\s*[:.\-]\s*/i, "").trim();
      mode = "question";
      return;
    }
    if (/^a\d+\s*[:.\-]/i.test(line)) {
      currentAnswer = line.replace(/^a\d+\s*[:.\-]\s*/i, "").trim();
      mode = "answer";
      return;
    }
    if (mode === "question") {
      currentQuestion = `${currentQuestion} ${line}`.trim();
      return;
    }
    if (mode === "answer") {
      currentAnswer = `${currentAnswer} ${line}`.trim();
    }
  });

  pushPair();
  return pairs.filter((pair) => pair.question && pair.answer);
}

function buildDraftItemsFromPairs(pairs, sourceDocument) {
  const ids = state.items.map((item) => Number(String(item.id).replace(/\D/g, ""))).filter(Number.isFinite);
  let nextId = Math.max(0, ...ids) + 1;
  return pairs.map((pair) => normalizeItem({
    id: nextQaIdFrom(nextId++),
    question: pair.question,
    answer: pair.answer,
    status: "draft",
    source: "teacher-upload",
    source_document: sourceDocument,
    tags: ["imported", "needs-teacher-review"],
    updated_at: new Date().toISOString(),
  }));
}

async function readIngestedSource(file) {
  const lowerName = file.name.toLowerCase();
  if (lowerName.endsWith(".txt")) {
    return { kind: "text", sourceDocument: file.name, text: normalizeWhitespace(await file.text()) };
  }
  if (lowerName.endsWith(".pdf")) {
    const text = extractTextFromPdfBuffer(await file.arrayBuffer());
    if (!text || text.length < 40) {
      return {
        kind: "error",
        message: `${file.name}: This PDF could not be reliably read in the static browser version. Please paste extracted text or use a backend OCR/PDF parser.`,
      };
    }
    return { kind: "text", sourceDocument: file.name, text };
  }
  if (file.type.startsWith("image/")) {
    return {
      kind: "error",
      message: `${file.name}: Image OCR is not available in this offline static prototype yet. Please paste OCR text for this image or connect a backend OCR service.`,
    };
  }
  return {
    kind: "error",
    message: `${file.name}: Unsupported file type.`,
  };
}

async function ingestSources() {
  const pastedText = normalizeWhitespace($("#ingest-text")?.value || "");
  const files = state.pendingIngestFiles || [];
  const notes = [];
  const allDrafts = [];

  if (!files.length && !pastedText) {
    $("#ingest-feedback").textContent = "Please upload a PDF/TXT/image file or paste extracted text first.";
    return;
  }

  for (const file of files) {
    const result = await readIngestedSource(file);
    if (result.kind === "error") {
      notes.push(result.message);
      continue;
    }
    const pairs = extractQaPairsFromText(result.text);
    if (!pairs.length) {
      notes.push(`${result.sourceDocument}: No explicit Q/A pairs were detected. Use Question:/Answer: formatting or paste a clearer text extract.`);
      continue;
    }
    const drafts = buildDraftItemsFromPairs(pairs, result.sourceDocument);
    allDrafts.push(...drafts);
    notes.push(`${result.sourceDocument}: ${drafts.length} draft QA entr${drafts.length === 1 ? "y" : "ies"} generated.`);
  }

  if (pastedText) {
    const pairs = extractQaPairsFromText(pastedText);
    if (!pairs.length) {
      notes.push("Pasted text: No explicit Q/A pairs were detected. Use Question:/Answer: formatting for best results.");
    } else {
      const drafts = buildDraftItemsFromPairs(pairs, "Pasted text");
      allDrafts.push(...drafts);
      notes.push(`Pasted text: ${drafts.length} draft QA entr${drafts.length === 1 ? "y" : "ies"} generated.`);
    }
  }

  if (allDrafts.length) {
    state.items = [...allDrafts, ...state.items];
    persistKnowledgeBase();
    renderTeacherList();
    renderMetrics();
  }

  $("#ingest-feedback").innerHTML = notes.map(escapeHtml).join("<br>") || "No source processed yet.";
}

function csvCell(value) {
  return `"${String(value ?? "").replace(/"/g, '""')}"`;
}

function downloadInquiryLogs() {
  const headers = ["id", "question", "answer_preview", "matched", "confidence", "review_status", "seen_status", "source_ids", "asked_at"];
  const rows = state.inquiryLogs.map((log) => [
    log.id,
    log.question,
    log.answer_preview,
    log.matched ? "matched" : "unmatched",
    log.confidence,
    log.review_status,
    log.reviewed ? "seen" : "not seen",
    (log.source_ids || []).join("; "),
    log.asked_at,
  ]);
  const csv = [headers.map(csvCell).join(","), ...rows.map((row) => row.map(csvCell).join(","))].join("\n");
  const url = URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8" }));
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = "cpt208-student-inquiry-logs.csv";
  anchor.click();
  URL.revokeObjectURL(url);
}

function renderAll() {
  renderStudent();
  renderTeacherList();
  renderKnowledgeActivity();
  renderInquiryLogs();
  renderMetrics();
  renderIntegrationStatus();
}

function bindEvents() {
  $("#show-login").addEventListener("click", () => showAuthMode("login"));
  $("#show-register").addEventListener("click", () => showAuthMode("register"));
  $("#register-show-login").addEventListener("click", () => showAuthMode("login"));
  $("#register-show-register").addEventListener("click", () => showAuthMode("register"));
  $("#register-role").addEventListener("change", () => {
    $("#teacher-code-row").classList.toggle("is-hidden", $("#register-role").value !== "teacher");
  });

  $("#login-form").addEventListener("submit", async (event) => {
    event.preventDefault();
    const username = $("#login-username").value.trim();
    const password = $("#login-password").value;
    try {
      if (state.backendReady) {
        const { user, token } = await apiRequest("/api/auth/login", {
          method: "POST",
          body: JSON.stringify({ username, password }),
        });
        startSessionForUser(normalizeUser(user), token);
        await loadBackendData();
      } else {
        const account = findUser(username);
        if (!account || account.password !== password) {
          $("#login-error").textContent = "Invalid username or password.";
          return;
        }
        startSessionForUser(account);
      }
      renderAll();
      $("#login-error").textContent = "";
    } catch (error) {
      $("#login-error").textContent = error.message;
    }
  });

  $("#register-form").addEventListener("submit", async (event) => {
    event.preventDefault();
    const name = $("#register-name").value.trim();
    const username = $("#register-username").value.trim();
    const password = $("#register-password").value;
    const role = $("#register-role").value;
    const teacherCode = $("#register-teacher-code").value;
    const usernamePattern = /^[a-zA-Z0-9._-]{3,24}$/;

    if (!usernamePattern.test(username)) {
      $("#register-error").textContent = "Use 3-24 letters, numbers, dots, underscores, or hyphens for username.";
      return;
    }
    if (password.length < 6) {
      $("#register-error").textContent = "Password must be at least 6 characters.";
      return;
    }
    if (findUser(username)) {
      $("#register-error").textContent = "This username is already registered.";
      return;
    }
    if (role === "teacher" && teacherCode !== TEACHER_REGISTRATION_CODE) {
      $("#register-error").textContent = "Teacher access code is incorrect.";
      return;
    }

    try {
      let account;
      if (state.backendReady) {
        const response = await apiRequest("/api/auth/register", {
          method: "POST",
          body: JSON.stringify({ name, username, password, role, teacherCode }),
        });
        account = normalizeUser(response.user);
        account.token = response.token;
      } else {
        account = normalizeUser({
          username,
          password,
          role,
          name,
          source: "registered",
          created_at: new Date().toISOString(),
        });
        state.users.push(account);
        persistUsers();
      }
      if (!state.users.some((user) => user.username.toLowerCase() === account.username.toLowerCase())) {
        state.users.push(account);
        if (!state.backendReady) persistUsers();
      }
      $("#register-error").textContent = "";
      startSessionForUser(account, account.token);
      if (state.backendReady) await loadBackendData();
      renderAll();
    } catch (error) {
      $("#register-error").textContent = error.message;
    }
  });

  $("#logout-button").addEventListener("click", () => {
    if (state.backendReady && state.session?.token) {
      apiRequest("/api/auth/logout", { method: "POST", body: JSON.stringify({}) }).catch(() => {});
    }
    state.session = null;
    state.mode = "student";
    persistSession();
    showAuthMode("login");
    renderAuthState();
  });

  document.querySelectorAll(".mode-button").forEach((button) => button.addEventListener("click", () => setMode(button.dataset.mode)));
  $("#new-chat").addEventListener("click", () => createChatSession(true));
  $("#reset-chat").addEventListener("click", () => {
    activeSession().messages = [];
    addMessageToActive("assistant", "Welcome. Ask about CPT208 coursework, poster requirements, portfolio, video demo, attendance, or module contacts.");
    renderAll();
  });
  $("#session-list").addEventListener("click", (event) => {
    const button = event.target.closest("[data-session]");
    if (!button) return;
    state.activeSessionId = button.dataset.session;
    renderAll();
  });
  $("#ask-form").addEventListener("submit", (event) => {
    event.preventDefault();
    submitQuestion($("#question-input").value);
  });
  document.querySelectorAll(".quick-topics button").forEach((button) => button.addEventListener("click", () => submitQuestion(button.dataset.question)));
  $("#chat-log").addEventListener("click", (event) => {
    const button = event.target.closest("[data-source]");
    if (button) renderSources(button.dataset.source);
  });
  $("#source-list").addEventListener("click", (event) => {
    const button = event.target.closest("[data-source-card]");
    if (!button) return;
    button.closest(".source-card").classList.toggle("open");
  });
  $("#qa-editor").addEventListener("submit", (event) => {
    event.preventDefault();
    const id = $("#qa-id").value || nextQaId();
    const item = normalizeItem({
      id,
      question: $("#qa-question").value.trim(),
      answer: $("#qa-answer").value.trim(),
      status: $("#qa-status").value,
      source: $("#qa-source").value.trim() || "teacher",
      source_document: $("#qa-doc").value.trim(),
      tags: $("#qa-tags").value.split(",").map((tag) => tag.trim()).filter(Boolean),
      updated_at: new Date().toISOString(),
    });
    state.items = state.items.some((candidate) => candidate.id === id)
      ? state.items.map((candidate) => candidate.id === id ? item : candidate)
      : [item, ...state.items];
    persistKnowledgeBase();
    fillEditor(null);
    renderAll();
  });
  $("#clear-editor").addEventListener("click", () => fillEditor(null));
  $("#teacher-search").addEventListener("input", renderTeacherList);
  $("#status-filter").addEventListener("change", renderTeacherList);
  $("#toggle-inquiry-view").addEventListener("click", () => {
    state.showResolvedInquiries = !state.showResolvedInquiries;
    renderInquiryLogs();
  });
  $("#inquiry-list").addEventListener("click", (event) => {
    const action = event.target.closest("[data-inquiry-action]");
    if (!action) return;
    const log = state.inquiryLogs.find((entry) => entry.id === action.dataset.logId);
    if (!log) return;
    if (action.dataset.inquiryAction === "approve") {
      updateInquiryDecision(log.id, "approved_response");
      return;
    }
    if (action.dataset.inquiryAction === "open-editor") {
      openInquiryEditor(log);
      return;
    }
    if (action.dataset.inquiryAction === "delete") {
      if (!confirm(`Delete this inquiry record?\n\n${log.question}`)) return;
      deleteInquiryLog(log.id);
    }
  });
  $("#qa-list").addEventListener("click", (event) => {
    const edit = event.target.closest("[data-edit]");
    const archive = event.target.closest("[data-archive]");
    if (edit) fillEditor(state.items.find((item) => item.id === edit.dataset.edit));
    if (archive) {
      const item = state.items.find((candidate) => candidate.id === archive.dataset.archive);
      if (!item || !confirm(`Archive this course answer?\n\n${item.question}`)) return;
      item.status = "archived";
      item.updated_at = new Date().toISOString();
      persistKnowledgeBase();
      renderAll();
    }
  });
  $("#export-json").addEventListener("click", () => {
    const url = URL.createObjectURL(new Blob([JSON.stringify(state.items, null, 2)], { type: "application/json" }));
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = "cpt208-knowledge-base.json";
    anchor.click();
    URL.revokeObjectURL(url);
  });
  $("#import-json").addEventListener("change", async (event) => {
    const file = event.target.files[0];
    if (!file) return;
    state.items = JSON.parse(await file.text()).map(normalizeItem);
    persistKnowledgeBase();
    renderAll();
  });
  $("#ingest-files").addEventListener("change", (event) => {
    state.pendingIngestFiles = [...(event.target.files || [])];
    $("#ingest-feedback").textContent = state.pendingIngestFiles.length
      ? `${state.pendingIngestFiles.length} file${state.pendingIngestFiles.length === 1 ? "" : "s"} selected.`
      : "No source processed yet.";
  });
  $("#ingest-generate").addEventListener("click", ingestSources);
  $("#ingest-clear").addEventListener("click", () => {
    state.pendingIngestFiles = [];
    $("#ingest-files").value = "";
    $("#ingest-text").value = "";
    $("#ingest-feedback").textContent = "Source input cleared.";
  });
  $("#export-logs").addEventListener("click", downloadInquiryLogs);
  $("#clear-logs").addEventListener("click", () => {
    const hasPending = state.inquiryLogs.some((log) => !log.reviewed);
    state.inquiryLogs = state.inquiryLogs.map((log) => ({ ...log, reviewed: hasPending }));
    persistInquiryLogs();
    renderAll();
  });
}



async function initApp() {
  loadKnowledgeBase();
  loadInquiryLogs();
  loadChatSessions();
  loadUsers();
  loadSession();
  await loadBackendData();
  bindEvents();
  renderAuthState();
}

initApp();
