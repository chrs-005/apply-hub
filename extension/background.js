/* Apply Hub Autofill: background service worker.
 * - keyboard shortcut (Alt+Shift+F) -> fill the active tab
 * - right-click menu: "Save this answer to Apply Hub"
 * - "Mark as applied" -> adds the job to your tracker (secret GitHub gist shared with the app)
 */
const GIST_FILE = "apply-hub-tracker.json";

chrome.runtime.onInstalled.addListener((d) => {
  chrome.contextMenus.create({ id: "ah-save-answer", title: "Save this answer to Apply Hub", contexts: ["editable"] });
  chrome.contextMenus.create({ id: "ah-fill", title: "Autofill this application", contexts: ["page", "editable"] });
  if (d.reason === "install") chrome.runtime.openOptionsPage();
});

chrome.contextMenus.onClicked.addListener((info, tab) => {
  if (info.menuItemId === "ah-save-answer") chrome.tabs.sendMessage(tab.id, { type: "AH_SAVE_ANSWER" }, { frameId: info.frameId });
  if (info.menuItemId === "ah-fill") chrome.tabs.sendMessage(tab.id, { type: "AH_FILL" });
});

chrome.commands.onCommand.addListener(async (cmd) => {
  if (cmd !== "fill-form") return;
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (tab) chrome.tabs.sendMessage(tab.id, { type: "AH_FILL" });
});

async function addToTracker(entry) {
  const { settings = {}, applied = [] } = await chrome.storage.local.get(["settings", "applied"]);
  const now = new Date().toISOString();
  const id = "ext:" + (entry.url || now).replace(/[?#].*$/, "");
  const item = { id, kind: entry.kind || "job", title: entry.role || "Application", org: entry.company || "", url: entry.url || "",
                 location: "", status: entry.status || "Applied", deadline: "", notes: entry.notes || "",
                 added: now, updated: now, history: [{ status: entry.status || "Applied", at: now }] };
  applied.unshift(item);
  await chrome.storage.local.set({ applied: applied.slice(0, 500) });
  if (!settings.ghToken || !settings.gistId) return { ok: true, synced: false };
  const headers = { Authorization: `token ${settings.ghToken}`, Accept: "application/vnd.github+json" };
  const g = await (await fetch(`https://api.github.com/gists/${settings.gistId}`, { headers })).json();
  const tracker = JSON.parse(g.files?.[GIST_FILE]?.content || '{"version":1,"items":{},"deleted":{}}');
  const prev = tracker.items[id];
  tracker.items[id] = prev ? { ...prev, status: item.status, updated: now, history: [...(prev.history || []), { status: item.status, at: now }] } : item;
  const r = await fetch(`https://api.github.com/gists/${settings.gistId}`, {
    method: "PATCH", headers, body: JSON.stringify({ files: { [GIST_FILE]: { content: JSON.stringify(tracker, null, 1) } } }),
  });
  return { ok: r.ok, synced: r.ok, status: r.status };
}

// ------------------------------------------------------------------ Claude (your own Anthropic API key)
// Plain fetch to the Messages API: MV3 extensions can't load remote code, so no SDK bundle here.
const PRICES = { // $ per million tokens: [input, output, cache read]
  "claude-opus-5-5": [4, 20, 0.2], "claude-sonnet-5-5": [2, 10, 0.2], "claude-haiku-5-5": [0.1, 0.5, 0.01],
};
const RULES = `You help a student fill in job/internship and university application forms quickly and HONESTLY.
You get the candidate's CV, their profile, answers they wrote before, the page (job or program description) and a list of form fields that are still empty.

For each field return an answer, or ask the candidate.
- Use ONLY facts found in the CV, profile, saved answers or page. Never invent facts: no made-up dates, numbers, IDs, addresses, names, referee details, test scores, salaries, or experiences.
- Eligibility/legal questions (work authorisation, visas/sponsorship, criminal record, non-compete, relatives at the company, previous employment there, security clearance, availability dates): answer only if the profile or saved answers state it; otherwise needs_user=true.
- Diversity/EEO questions (gender, ethnicity, disability, veteran, sexual orientation): use the profile's answer, otherwise pick the "prefer not to say / decline" option.
- "How did you hear about us": use the profile default.
- For fields with options (select/radio), the answer MUST be exactly one of the given options, copied character for character. For "dropdown" fields without listed options, answer with the plain value (e.g. "Lebanon").
- Keep short-text answers short (a value, not a sentence) unless the label asks a question.
- If a field asks something only the candidate can know, or you are unsure, set needs_user=true, answer "" (or your best guess) and write ask_user: a short, friendly note telling them what is needed.
- confidence: "high" = directly stated in their data; "medium" = clear inference; "low" = guess.`;

const ANSWER_SCHEMA = {
  type: "object", additionalProperties: false, required: ["answers"],
  properties: { answers: { type: "array", items: { type: "object", additionalProperties: false,
    required: ["id", "answer", "confidence", "needs_user", "ask_user"],
    properties: { id: { type: "string" }, answer: { type: "string" }, confidence: { type: "string", enum: ["high", "medium", "low"] },
                  needs_user: { type: "boolean" }, ask_user: { type: "string" } } } } },
};

async function candidateBlocks() {
  // Stable, cacheable prefix: CV document + profile + saved answers.
  const { profile = {}, answers = [], docs = {}, settings = {} } = await chrome.storage.local.get(["profile", "answers", "docs", "settings"]);
  const blocks = [];
  if (docs.cv?.data && settings.sendCv !== false)
    blocks.push({ type: "document", source: { type: "base64", media_type: "application/pdf", data: docs.cv.data.split(",")[1] }, title: "Candidate CV" });
  const saved = answers.filter((a) => a.a && String(a.a).trim()).slice(0, 150).map((a) => `Q: ${a.q}\nA: ${a.a}`).join("\n\n");
  blocks.push({ type: "text", cache_control: { type: "ephemeral" },
    text: `CANDIDATE PROFILE (JSON):\n${JSON.stringify(profile, Object.keys(profile).sort())}\n\nANSWERS THE CANDIDATE GAVE BEFORE (their own words; reuse them):\n${saved || "(none yet)"}` });
  return { blocks, settings };
}

async function callClaude({ system, content, effort, schema, maxTokens = 16000 }) {
  const { settings = {} } = await chrome.storage.local.get("settings");
  if (!settings.anthropicKey) throw new Error("Add your Anthropic API key in Apply Hub settings.");
  const model = settings.claudeModel || "claude-opus-5-5";
  const body = { model, max_tokens: maxTokens, system, messages: [{ role: "user", content }], output_config: { effort } };
  if (schema) body.output_config.format = { type: "json_schema", schema };
  const headers = { "content-type": "application/json", "x-api-key": settings.anthropicKey, "anthropic-version": "2023-06-01",
                    "anthropic-dangerous-direct-browser-access": "true" };
  if (model === "claude-opus-5-5" || model === "claude-sonnet-5-5") { // retry on another model if a safety classifier declines
    body.fallbacks = "default"; headers["anthropic-beta"] = "server-side-fallback-2026-07-01";
  }
  const r = await fetch("https://api.anthropic.com/v1/messages", { method: "POST", headers, body: JSON.stringify(body) });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) {
    const msg = j?.error?.message || `HTTP ${r.status}`;
    if (r.status === 401) throw new Error("API key rejected: check it in settings.");
    if (r.status === 429) throw new Error("Rate limited: wait a minute and retry.");
    if (r.status === 402 || /credit/i.test(msg)) throw new Error("Your Anthropic account is out of credits.");
    throw new Error(msg);
  }
  if (j.stop_reason === "refusal") throw new Error("Claude declined this request.");
  if (j.stop_reason === "max_tokens") throw new Error("The answer was cut off.");
  const text = (j.content || []).filter((b) => b.type === "text").map((b) => b.text).join("");
  const [pin, pout, pcache] = PRICES[j.model] || PRICES[model] || PRICES["claude-opus-5-5"];
  const u = j.usage || {};
  const cost = ((u.input_tokens || 0) * pin + (u.cache_creation_input_tokens || 0) * pin * 1.25 + (u.cache_read_input_tokens || 0) * pcache + (u.output_tokens || 0) * pout) / 1e6;
  return { text, cost, usage: u, model: j.model };
}

const pageBlock = (page) => `APPLICATION PAGE (${page.mode}): ${page.title}\nURL: ${page.url}\nCompany/organisation: ${page.company || "?"} · Role/program: ${page.role || "?"}\n\nPAGE TEXT (job/program description, may include the form):\n${page.text || ""}`;

async function answerFields(page, fields) {
  const { blocks } = await candidateBlocks();
  const res = await callClaude({
    system: RULES, effort: "low", schema: ANSWER_SCHEMA,
    content: [...blocks, { type: "text", text: `${pageBlock(page)}\n\nEMPTY FORM FIELDS (JSON):\n${JSON.stringify(fields)}\n\nReturn one entry per field id.` }],
  });
  return { answers: JSON.parse(res.text).answers || [], cost: res.cost, model: res.model };
}

async function draftEssay(page, question, limit) {
  const { blocks } = await candidateBlocks();
  const res = await callClaude({
    effort: "high", maxTokens: 8000,
    system: `You draft application answers in the candidate's own first-person voice, for them to edit.
Use only facts from their CV, profile and earlier answers; tie them to this specific ${page.mode} using the page text. Be concrete and specific, not generic; no clichés, no flattery of the company.
Where a fact you would need is unknown, write a short [placeholder in square brackets] instead of inventing it.
Plain text paragraphs only (no markdown, no title). Respect the length limit if one is given.`,
    content: [...blocks, { type: "text", text: `${pageBlock(page)}\n\nQUESTION TO ANSWER: ${question}\nLENGTH LIMIT: ${limit || "none stated (aim for ~150-250 words)"}` }],
  });
  return { text: res.text.trim(), cost: res.cost };
}

chrome.runtime.onMessage.addListener((msg, _s, reply) => {
  if (msg.type === "AH_TRACK") { addToTracker(msg.entry).then(reply).catch((e) => reply({ ok: false, error: String(e) })); return true; }
  if (msg.type === "AH_CLAUDE_FIELDS") { answerFields(msg.page, msg.fields).then(reply).catch((e) => reply({ error: e.message || String(e) })); return true; }
  if (msg.type === "AH_CLAUDE_DRAFT") { draftEssay(msg.page, msg.question, msg.limit).then(reply).catch((e) => reply({ error: e.message || String(e) })); return true; }
  if (msg.type === "AH_CLAUDE_TEST") {
    callClaude({ system: "Reply with exactly: OK", effort: "low", maxTokens: 1000, content: [{ type: "text", text: "ping" }] })
      .then((r) => reply({ ok: true, model: r.model, text: r.text })).catch((e) => reply({ ok: false, error: e.message }));
    return true;
  }
});
