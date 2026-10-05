const $ = (s) => document.querySelector(s);
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

const SEED_ANSWERS = [
  "Why do you want to work at {company}?",
  "Why are you interested in this role?",
  "Why are you interested in quantitative trading / research?",
  "Tell us about a project you are proud of.",
  "Describe a challenging technical problem you solved.",
  "What programming languages are you proficient in?",
  "Do you have competitive programming or math olympiad experience?",
  "What are your research interests?",
  "Statement of purpose: why this master's program?",
  "Is there anything else you would like us to know?",
].map((q) => ({ q, a: "" }));

const DOCS = [["cv", "CV / Résumé"], ["cover", "Cover letter (generic)"], ["transcript", "Transcript"]];
let state = { profile: {}, answers: [], docs: {}, settings: {} };

function renderProfile() {
  $("#profile").innerHTML = AH_FIELDS.map((f) => {
    if (f.section) return `<h2 style="grid-column:1/-1;margin-top:10px">${esc(f.section)}</h2>`;
    const v = state.profile[f.key] ?? "";
    const input = f.type === "select"
      ? `<select data-k="${f.key}"><option value=""></option>${f.options.map((o) => `<option ${o === v ? "selected" : ""}>${esc(o)}</option>`).join("")}</select>`
      : `<input data-k="${f.key}" type="${f.type || "text"}" value="${esc(v)}" placeholder="${esc(f.placeholder || "")}">`;
    return `<div><label class="f">${esc(f.label)}${f.hint ? ` <span class="hint">· ${esc(f.hint)}</span>` : ""}</label>${input}</div>`;
  }).join("");
}

function renderDocs() {
  $("#docs").innerHTML = DOCS.map(([k, label]) => {
    const d = state.docs[k];
    return `<div class="doc"><div><b class="small">${label}</b><div class="tiny muted">${d ? `${esc(d.name)} · ${Math.round(d.size / 1024)} KB` : "Not uploaded"}</div></div>
      <div class="row" style="flex:0 0 auto"><label class="btn">${d ? "Replace" : "Upload"}<input type="file" data-doc="${k}" accept=".pdf,.doc,.docx" hidden></label>${d ? `<button class="btn danger" data-deldoc="${k}">Remove</button>` : ""}</div></div>`;
  }).join("");
}

function renderAnswers() {
  $("#answers").innerHTML = state.answers.map((a, i) => `
    <div class="ans" data-i="${i}">
      <input data-a="q" value="${esc(a.q)}" placeholder="Question (keywords matter)">
      <textarea data-a="a" placeholder="Your answer (use {company} / {role})">${esc(a.a)}</textarea>
      <div class="row between"><span class="tiny muted">${a.from ? "saved from " + esc(a.from) : ""}${a.a ? "" : " · empty answers are skipped"}</span><button class="btn danger" data-del="${i}">Delete</button></div>
    </div>`).join("");
}

async function renderApplied() {
  const { applied = [] } = await chrome.storage.local.get("applied");
  $("#applied-count").textContent = `(${applied.length})`;
  $("#applied").innerHTML = applied.slice(0, 50).map((a) => `<div>${new Date(a.added).toLocaleDateString()} · <b>${esc(a.org)}</b>: ${esc(a.title)} · <span class="muted">${esc(a.status)}</span></div>`).join("") || `<span class="muted">Nothing logged yet.</span>`;
}

function collect() {
  document.querySelectorAll("[data-k]").forEach((el) => (state.profile[el.dataset.k] = el.value.trim()));
  document.querySelectorAll(".ans").forEach((row) => {
    const i = +row.dataset.i;
    state.answers[i] = { ...state.answers[i], q: row.querySelector('[data-a="q"]').value, a: row.querySelector('[data-a="a"]').value };
  });
  state.settings = { ghToken: $("#ghToken").value.trim(), gistId: $("#gistId").value.trim(), showEverywhere: $("#showEverywhere").checked };
}

async function save() {
  collect();
  await chrome.storage.local.set({ profile: state.profile, answers: state.answers, settings: state.settings });
  $("#saved").textContent = "Saved ✓ " + new Date().toLocaleTimeString();
}

document.addEventListener("click", async (e) => {
  const t = e.target;
  if (t.id === "save") save();
  if (t.id === "add-answer") { collect(); state.answers.unshift({ q: "", a: "" }); renderAnswers(); }
  if (t.dataset.del) { collect(); state.answers.splice(+t.dataset.del, 1); renderAnswers(); await save(); }
  if (t.dataset.deldoc) { delete state.docs[t.dataset.deldoc]; await chrome.storage.local.set({ docs: state.docs }); renderDocs(); }
  if (t.id === "export") {
    collect();
    const a = document.createElement("a");
    a.href = URL.createObjectURL(new Blob([JSON.stringify({ profile: state.profile, answers: state.answers }, null, 1)], { type: "application/json" }));
    a.download = "apply-hub-profile.json"; a.click();
  }
});

document.addEventListener("change", async (e) => {
  const t = e.target;
  if (t.dataset.doc && t.files[0]) {
    const f = t.files[0];
    if (f.size > 8 * 1024 * 1024) return alert("File is over 8 MB, so please compress it.");
    const data = await new Promise((res) => { const r = new FileReader(); r.onload = () => res(r.result); r.readAsDataURL(f); });
    state.docs[t.dataset.doc] = { name: f.name, type: f.type, size: f.size, data };
    await chrome.storage.local.set({ docs: state.docs });
    renderDocs();
  }
  if (t.id === "import" && t.files[0]) {
    try {
      const j = JSON.parse(await t.files[0].text());
      state.profile = { ...state.profile, ...(j.profile || {}) };
      state.answers = j.answers || state.answers;
      if (j.docs) { state.docs = { ...state.docs, ...j.docs }; await chrome.storage.local.set({ docs: state.docs }); renderDocs(); }
      if (j.settings?.gistId && !$("#gistId").value) $("#gistId").value = j.settings.gistId;
      renderProfile(); renderAnswers(); await save();
      $("#saved").textContent = `Imported ✓ ${Object.keys(j.profile || {}).length} fields, ${(j.answers || []).filter((a) => a.a).length} answers${j.docs ? ", " + Object.values(j.docs).map((d) => d.name).join(", ") : ""}`;
    } catch { alert("Not a valid Apply Hub profile file."); }
  }
});

(async function init() {
  const s = await chrome.storage.local.get(["profile", "answers", "docs", "settings"]);
  state = { profile: s.profile || {}, answers: s.answers || SEED_ANSWERS, docs: s.docs || {}, settings: s.settings || {} };
  renderProfile(); renderDocs(); renderAnswers(); renderApplied();
  $("#ghToken").value = state.settings.ghToken || "";
  $("#gistId").value = state.settings.gistId || "";
  $("#showEverywhere").checked = !!state.settings.showEverywhere;
  document.addEventListener("keydown", (e) => { if ((e.ctrlKey || e.metaKey) && e.key === "s") { e.preventDefault(); save(); } });
})();
