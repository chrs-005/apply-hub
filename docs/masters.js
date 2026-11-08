/* Apply Hub: Masters tab. Your applications, what each needs, and a dated plan.
   Loaded before app.js; uses S, esc, money, usd, fmtDate, fmtShort, daysUntil, toast, sheet, Sync, trackGrad, upsertTrack,
   removeTrack, trackedFor, checklistHtml from there at call time. Progress lives in S.tracker.masters (synced via the gist). */
"use strict";

const M_TABS = [["plan", "Plan"], ["apps", "Schools"], ["compare", "Compare"], ["prep", "Prep"]];
const M_GRE = { no: ["Not needed", "good"], optional: ["Optional", ""], recommended: ["Strongly rec.", "warn"], check: ["Check!", "bad"] };
const M_ENG = { none: ["Not required", "good"], "after-offer": ["After offer", ""], "letter-or-test": ["Letter or test", ""], test: ["Test", "warn"], "by-deadline": ["By deadline!", "bad"], check: ["Check!", "bad"] };
const M_REC_STATUS = ["Not asked", "Asked", "Agreed", "Packet sent", "Declined"];
const M_ACTIVE = new Set(["Saved", "Preparing"]);
const openDetails = new Set();
document.addEventListener("toggle", (e) => {
  const d = e.target;
  if (d.dataset && d.dataset.key) d.open ? openDetails.add(d.dataset.key) : openDetails.delete(d.dataset.key);
}, true);
const isOpen = (key, dflt = false) => (openDetails.has(key) || dflt ? "open" : "");

function mState() {
  const m = (S.tracker.masters = S.tracker.masters || {});
  for (const k of ["tasks", "customTasks", "recs", "tests", "hidden"]) m[k] = m[k] || {};
  return m;
}
function mSet(section, id, data) {
  const m = mState();
  m[section][id] = { ...(m[section][id] || {}), ...data, updated: new Date().toISOString() };
  Sync.save();
  return m[section][id];
}

// ---- which programs are yours
function boardPrograms() {
  const hidden = mState().hidden;
  return S.grad.filter((p) => trackedFor("grad:" + p.id) || (p.target === "core" && !hidden[p.id]?.on));
}
const customPrograms = () => Object.values(S.tracker.items).filter((t) => t.kind === "grad" && !String(t.id).startsWith("grad:"));
const mStatus = (p) => trackedFor("grad:" + p.id)?.status || "Saved";
const shortName = (p) => p.short || p.university.split(" (")[0];
function nextOpenDeadline(p) {
  const d = (p.deadlines || []).filter((x) => x.date && daysUntil(x.date) >= 0).sort((a, b) => a.date.localeCompare(b.date))[0];
  return d || null;
}
function dayBadge(date) {
  const n = daysUntil(date);
  if (n == null) return "";
  const cls = n < 0 ? "bad" : n <= 14 ? "bad" : n <= 35 ? "warn" : "";
  const txt = n < 0 ? `${-n}d late` : n === 0 ? "today" : `${n}d`;
  return `<span class="badge ${cls}">${fmtShort(date)} · ${txt}</span>`;
}

// ---- plan tasks
function planTasks() {
  const m = mState(), ids = new Set(boardPrograms().map((p) => p.id));
  const base = (S.plan?.tasks || []).filter((t) => !t.only || t.only.some((x) => ids.has(x)))
    .map((t) => ({ ...t, done: !!m.tasks[t.id]?.done }));
  const custom = Object.entries(m.customTasks).filter(([, c]) => !c.deleted)
    .map(([id, c]) => ({ id, title: c.title, due: c.due, done: !!c.done, custom: true, phase: "Your own tasks", cat: "Yours", how: c.how || "" }));
  return [...base, ...custom];
}
function taskRow(t) {
  const key = "task:" + t.id;
  const extra = t.how || t.ask?.length;
  return `<div class="m-task ${t.done ? "done" : ""}">
    <input type="checkbox" data-act="m-task" data-id="${esc(t.id)}" ${t.custom ? 'data-custom="1"' : ""} ${t.done ? "checked" : ""} aria-label="Done">
    <div class="m-task-main">
      <div class="m-task-title">${esc(t.title)}</div>
      <div class="row" style="margin-top:3px">${t.due && !t.done ? dayBadge(t.due) : ""}${t.cat ? `<span class="badge">${esc(t.cat)}</span>` : ""}</div>
      ${extra ? `<details data-key="${esc(key)}" ${isOpen(key)}><summary>How</summary>
        ${t.how ? `<p class="small" style="margin:6px 0">${esc(t.how)}</p>` : ""}
        ${t.ask?.length ? `<b class="small">Ask:</b><ul class="clean small">${t.ask.map((q) => `<li>${esc(q)}</li>`).join("")}</ul>` : ""}
        ${t.custom ? `<button class="btn sm ghost" data-act="m-task-del" data-id="${esc(t.id)}" style="color:var(--bad)">Delete</button>` : ""}
      </details>` : t.custom ? `<button class="btn sm ghost" data-act="m-task-del" data-id="${esc(t.id)}" style="color:var(--bad);margin-top:4px">Delete</button>` : ""}
    </div></div>`;
}
function renderPlan() {
  const tasks = planTasks();
  const dated = (a, b) => String(a.due || "9999").localeCompare(String(b.due || "9999"));
  const open = tasks.filter((t) => !t.done).sort(dated);
  const late = open.filter((t) => t.due && daysUntil(t.due) < 0);
  const week = open.filter((t) => t.due && daysUntil(t.due) >= 0 && daysUntil(t.due) <= 7);
  const shown = new Set([...late, ...week].map((t) => t.id));
  const later = open.filter((t) => !shown.has(t.id));
  const phases = [...new Set(later.map((t) => t.phase || "Later"))];
  const done = tasks.filter((t) => t.done);
  const pct = tasks.length ? Math.round((done.length / tasks.length) * 100) : 0;
  return `
    <div class="card">
      <div class="row between"><div class="title">Plan progress</div><b>${done.length}/${tasks.length}</b></div>
      <div class="m-bar"><span style="width:${pct}%"></span></div>
      <div class="row between" style="margin-top:8px"><span class="tiny muted">Ticks sync across your devices, and due tasks appear in your morning brief.</span>
      <button class="btn sm" data-act="m-task-add">+ Task</button></div>
    </div>
    ${late.length ? `<h2>⚠️ Overdue <span class="count">${late.length}</span></h2><div class="card">${late.map(taskRow).join("")}</div>` : ""}
    <h2>This week <span class="count">${week.length}</span></h2>
    <div class="card">${week.map(taskRow).join("") || `<div class="empty small">Nothing due in the next 7 days.</div>`}</div>
    ${phases.map((ph, i) => { const key = "phase:" + ph, list = later.filter((t) => (t.phase || "Later") === ph);
      return `<details class="m-phase" data-key="${esc(key)}" ${isOpen(key, i === 0)}><summary><b>${esc(ph)}</b> <span class="count">${list.length}</span></summary><div class="card">${list.map(taskRow).join("")}</div></details>`; }).join("")}
    ${done.length ? `<details class="m-phase" data-key="phase:done" ${isOpen("phase:done")}><summary><b>✓ Done</b> <span class="count">${done.length}</span></summary><div class="card">${done.map(taskRow).join("")}</div></details>` : ""}`;
}

// ---- applications board
function lettersLine(p) {
  const need = p.requires?.letters;
  if (!need) return "";
  const recs = activeRecs();
  const yes = recs.filter((r) => ["Agreed", "Packet sent"].includes(r.status)).length;
  const sub = recs.filter((r) => r.submitted?.[p.id]).length;
  const cls = sub >= need ? "good" : yes >= need ? "" : "warn";
  return `<span class="badge ${cls}">Letters: ${sub}/${need} in${yes ? ` · ${yes} agreed` : ""}</span>`;
}
function checklistDone(p) {
  const t = trackedFor("grad:" + p.id), list = t?.req?.items || p.checklist || [];
  return [list.filter((i) => t?.checklist?.[i.id]).length, list.length];
}
function statusSelect(tid, status) {
  const opts = [["Saved", "Not started"], ["Preparing", "Preparing"], ["Applied", "Submitted"], ["Interview", "Interview"], ["Offer", "Admitted"], ["Rejected", "Rejected"], ["Withdrawn", "Withdrawn"]];
  return `<select class="sel status-sel" data-act="m-status" data-tid="${esc(tid)}">${opts.map(([v, l]) => `<option value="${v}" ${v === status ? "selected" : ""}>${l}</option>`).join("")}</select>`;
}
function appCard(p) {
  const tid = "grad:" + p.id, status = mStatus(p), next = nextOpenDeadline(p), key = "app:" + p.id;
  const [done, total] = checklistDone(p), pct = total ? Math.round((done / total) * 100) : 0;
  const r = p.requires || {};
  const flag = FLAGS_M[p.country] || "🌍";
  return `<div class="card">
    <div class="row between"><div><span class="org">${flag} ${esc(p.university)}</span><div class="title">${esc(p.program)}</div></div>${statusSelect(tid, status)}</div>
    <div class="row" style="margin-top:8px">
      ${next ? dayBadge(next.date) : `<span class="badge">No date ahead</span>`}
      ${lettersLine(p)}
      ${r.gre ? `<span class="badge ${M_GRE[r.gre.status]?.[1] || ""}">GRE: ${M_GRE[r.gre.status]?.[0] || "?"}</span>` : ""}
    </div>
    ${next ? `<div class="tiny muted" style="margin-top:4px">${esc(next.label)}${next.time ? " · " + esc(next.time) : ""}</div>` : ""}
    ${total ? `<div class="m-bar" style="margin-top:8px"><span style="width:${pct}%"></span></div><div class="tiny muted" style="margin-top:3px">${done}/${total} checklist items</div>` : ""}
    ${checklistHtml(tid)}
    <details data-key="${esc(key)}" ${isOpen(key)}><summary>Details</summary>
      <dl class="kv">
        <dt>Deadlines</dt><dd>${(p.deadlines || []).map((d) => `<div>${fmtDate(d.date)} · <span class="muted">${esc(d.label)}${d.time ? " · " + esc(d.time) : ""}</span></div>`).join("") || "—"}</dd>
        <dt>App fee</dt><dd>${p.app_fee ? money(p.app_fee) : `<span class="muted">Not confirmed</span>`}${p.app_fee?.note ? `<div class="tiny muted">${esc(p.app_fee.note)}</div>` : ""}</dd>
        <dt>Tuition</dt><dd>${p.tuition ? `${money(p.tuition)}/${esc(p.tuition.per)}${p.tuition.note ? `<div class="tiny muted">${esc(p.tuition.note)}</div>` : ""}` : `<span class="muted">Check the page</span>`}</dd>
        <dt>Funding</dt><dd>${(p.scholarships || []).map((s) => `<div><b>${esc(s.name)}</b>${s.deadline ? ` · by ${fmtDate(s.deadline)}` : ""}<div class="tiny muted">${esc(s.covers || "")}${s.how ? " · " + esc(s.how) : ""}</div></div>`).join("") || `<span class="muted">None found</span>`}</dd>
        <dt>English</dt><dd>${esc(p.language || "—")}</dd>
        <dt>GRE</dt><dd>${esc(p.gre || "—")}</dd>
      </dl>
      ${p.notes ? `<p class="small" style="margin:8px 0 0">💡 ${esc(p.notes)}</p>` : ""}
      ${(p.verify || []).length ? `<p class="tiny" style="color:var(--warn);margin:6px 0 0">⚠ Couldn't confirm on an official page: ${esc(p.verify.join(", "))}</p>` : ""}
      <div class="row" style="margin-top:10px">
        <a class="btn sm" href="${esc(p.url)}" target="_blank" rel="noopener">Program page ↗</a>
        <button class="btn sm ghost" data-act="m-remove" data-id="${esc(p.id)}" style="color:var(--bad)">Remove</button>
      </div>
    </details></div>`;
}
const FLAGS_M = { Canada: "🇨🇦", Austria: "🇦🇹", "United Kingdom": "🇬🇧", Switzerland: "🇨🇭", France: "🇫🇷", Germany: "🇩🇪", Netherlands: "🇳🇱", "United Arab Emirates": "🇦🇪", "Saudi Arabia": "🇸🇦", "United States": "🇺🇸", Sweden: "🇸🇪" };

function customCard(t) {
  return `<div class="card trk" data-id="${esc(t.id)}">
    <div class="row between"><div><span class="org">${esc(t.org || "")}</span><div class="title">${esc(t.title)}</div></div>${statusSelect(t.id, t.status)}</div>
    <div class="row" style="margin-top:8px">${t.deadline ? dayBadge(t.deadline) : ""}</div>
    ${checklistHtml(t.id)}
    <div class="row" style="margin-top:8px">${t.url ? `<a class="btn sm" href="${esc(t.url)}" target="_blank" rel="noopener">Open ↗</a>` : ""}<button class="btn sm ghost" data-act="remove" style="color:var(--bad)">Remove</button></div>
  </div>`;
}
function renderApps() {
  const board = boardPrograms().sort((a, b) => {
    const x = nextOpenDeadline(a)?.date || "9999", y = nextOpenDeadline(b)?.date || "9999";
    return x.localeCompare(y);
  });
  const customs = customPrograms();
  const ids = new Set(board.map((p) => p.id));
  const suggested = S.grad.filter((p) => p.target === "suggested" && !ids.has(p.id));
  const others = S.grad.filter((p) => !p.target && !ids.has(p.id));
  const unsent = board.filter((p) => M_ACTIVE.has(mStatus(p)));
  const fees = unsent.reduce((s, p) => s + (p.app_fee_usd || 0), 0);
  const unknown = unsent.filter((p) => !p.app_fee).map(shortName);
  const sent = board.filter((p) => !M_ACTIVE.has(mStatus(p))).length;
  return `
    <div class="card">
      <div class="row between"><div><div class="title">💸 Fees still to pay</div>
        <div class="small muted">${unsent.length} to send · ${sent} sent${unknown.length ? ` · plus ${esc(unknown.join(", "))} (fee not confirmed)` : ""}</div></div>
        <div style="font-size:24px;font-weight:750">${usd(fees)}</div></div>
      <div class="tiny muted" style="margin-top:6px">Application fees only, not including the GRE or English test. Fee waivers exist at several schools: see this week's plan.</div>
    </div>
    <h2>Your applications <span class="count">${board.length + customs.length}</span></h2>
    ${board.map(appCard).join("")}${customs.map(customCard).join("")}
    ${suggested.length ? `<h2>Worth adding? <span class="count">${suggested.length}</span></h2>
      ${suggested.map((p) => { const n = nextOpenDeadline(p); return `<div class="card"><div class="row between"><div style="flex:1;min-width:0"><span class="org">${FLAGS_M[p.country] || "🌍"} ${esc(p.university)}</span><div class="title">${esc(p.program)}</div></div>
        <button class="btn sm primary" data-act="m-add" data-id="${esc(p.id)}">Add</button></div>
        <div class="row" style="margin-top:6px">${n ? dayBadge(n.date) : ""}<span class="badge">${p.app_fee ? money(p.app_fee) : "Fee?"}</span></div>
        <p class="small muted" style="margin:6px 0 0">${esc(p.why || "")}</p></div>`; }).join("")}` : ""}
    <div class="card row between">
      <div style="flex:1;min-width:0"><div class="title">📄 Another school?</div><div class="small muted">Upload its requirements PDF, and it becomes a checklist here.</div></div>
      <button class="btn sm" data-act="pdf-picker">Upload PDF</button>
    </div>
    ${others.length ? `<details class="m-phase" data-key="catalog" ${isOpen("catalog")}><summary><b>Other programs</b> <span class="count">${others.length}</span></summary>
      <div class="card small">${others.map((p) => `<div class="row between m-line"><span style="flex:1;min-width:0">${esc(p.university.split(" (")[0])}: ${esc(p.program)}</span><button class="btn sm" data-act="m-add" data-id="${esc(p.id)}">Add</button></div>`).join("")}</div></details>` : ""}`;
}

// ---- compare table
function renderCompare() {
  const board = boardPrograms().sort((a, b) => (nextOpenDeadline(a)?.date || "9999").localeCompare(nextOpenDeadline(b)?.date || "9999"));
  const v = (p, f) => (p.verify || []).includes(f) ? ` <span title="Not confirmed on an official page" style="color:var(--warn)">⚠</span>` : "";
  const greNeeded = board.filter((p) => ["check", "recommended"].includes(p.requires?.gre?.status)).map(shortName);
  const greOpt = board.filter((p) => p.requires?.gre?.status === "optional").map(shortName);
  const maxLetters = Math.max(0, ...board.map((p) => p.requires?.letters || 0));
  const testNeeded = board.filter((p) => ["test", "by-deadline", "after-offer"].includes(p.requires?.english?.status)).map(shortName);
  return `
    <div class="card small">
      <div class="m-line"><b>GRE:</b> ${greNeeded.length ? `check or plan for it at ${esc(greNeeded.join(", "))}` : "not needed at your schools"}${greOpt.length ? `; optional at ${esc(greOpt.join(", "))}` : ""}.</div>
      <div class="m-line"><b>Referees:</b> you need ${maxLetters} at most. Line up 3 academics plus a backup.</div>
      <div class="m-line"><b>English test:</b> expected at ${esc(testNeeded.join(", ") || "none")}. One good IELTS covers most of these.</div>
    </div>
    <div class="m-table-wrap"><table class="m-table">
      <thead><tr><th>School</th><th>Next deadline</th><th>Letters</th><th>GRE</th><th>English</th><th>Essay</th><th>Fee</th></tr></thead>
      <tbody>${board.map((p) => { const r = p.requires || {}, n = nextOpenDeadline(p), g = M_GRE[r.gre?.status], e = M_ENG[r.english?.status];
        return `<tr><th><span title="${esc(p.program)}">${esc(shortName(p))}</span></th>
          <td>${n ? dayBadge(n.date) : "—"}${v(p, "deadlines")}</td>
          <td>${r.letters ?? "—"}${v(p, "letters")}</td>
          <td>${g ? `<span class="badge ${g[1]}">${g[0]}</span>` : "—"}${v(p, "gre")}</td>
          <td>${e ? `<span class="badge ${e[1]}">${e[0]}</span>` : "—"}${v(p, "english")}</td>
          <td class="tiny">${esc(r.statement || "—")}${v(p, "statement")}</td>
          <td>${p.app_fee ? `${money(p.app_fee)}` : "?"}${v(p, "app_fee")}</td></tr>`; }).join("")}</tbody>
    </table></div>
    <p class="tiny muted" style="margin-top:8px">⚠ = couldn't confirm on an official page (Oxford's and Columbia's requirement pages block automated reading): check it yourself. Details and notes are on each card under Schools. Checked 1 Nov 2026.</p>`;
}

// ---- prep: referees, tests, questions, CV
const activeRecs = () => Object.entries(mState().recs).filter(([, r]) => !r.deleted).map(([id, r]) => ({ id, ...r }));
function recCard(r, programs) {
  return `<div class="card">
    <div class="row between"><div style="flex:1;min-width:0"><div class="title">${esc(r.name)}</div><div class="small muted">${esc(r.role || "")}</div></div>
      <select class="sel status-sel" data-act="m-rec-status" data-id="${esc(r.id)}">${M_REC_STATUS.map((s) => `<option ${s === (r.status || "Not asked") ? "selected" : ""}>${s}</option>`).join("")}</select></div>
    <div class="small muted" style="margin:8px 0 4px">Letter submitted for:</div>
    <div class="checklist">${programs.filter((p) => p.requires?.letters).map((p) => `<label><input type="checkbox" data-act="m-rec-sub" data-id="${esc(r.id)}" data-p="${esc(p.id)}" ${r.submitted?.[p.id] ? "checked" : ""}>${esc(shortName(p))}</label>`).join("")}</div>
    <div class="row" style="margin-top:8px"><input class="m-input" data-act="m-rec-notes" data-id="${esc(r.id)}" value="${esc(r.notes || "")}" placeholder="Notes: email, when you last reminded them…"></div>
    <button class="btn sm ghost" data-act="m-rec-del" data-id="${esc(r.id)}" style="color:var(--bad);margin-top:6px">Remove</button>
  </div>`;
}
function testCard(t) {
  return `<div class="m-line row between">
    <div style="flex:1;min-width:0"><b>${esc(t.type)}</b> · ${t.date ? fmtDate(t.date) : "no date"}${t.status !== "Taken" && t.date ? " " + dayBadge(t.date) : ""}${t.score ? `<div class="small">Score: ${esc(t.score)}</div>` : ""}</div>
    <button class="btn sm" data-act="m-test-edit" data-id="${esc(t.id)}">Edit</button></div>`;
}
function renderPrep() {
  const programs = boardPrograms(), plan = S.plan || {}, rec = plan.recommenders || {}, gre = plan.gre || {};
  const recs = activeRecs();
  const tests = Object.entries(mState().tests).filter(([, t]) => !t.deleted).map(([id, t]) => ({ id, ...t })).sort((a, b) => String(a.date || "").localeCompare(String(b.date || "")));
  const agreed = recs.filter((r) => ["Agreed", "Packet sent"].includes(r.status)).length;
  return `
    <h2>✉️ Referees <span class="count">${agreed}/3 agreed</span></h2>
    <div class="card small"><p style="margin:0 0 6px">${esc(rec.summary || "")}</p>
      <details data-key="prep:who" ${isOpen("prep:who", !recs.length)}><summary>Who to ask</summary><ul class="clean">${(rec.who || []).map((x) => `<li>${esc(x)}</li>`).join("")}</ul></details>
      <details data-key="prep:packet" ${isOpen("prep:packet")}><summary>What to send them</summary><ul class="clean">${(rec.packet || []).map((x) => `<li>${esc(x)}</li>`).join("")}</ul></details>
    </div>
    ${recs.map((r) => recCard(r, programs)).join("")}
    <button class="btn" data-act="m-rec-add" style="width:100%">+ Add a referee</button>

    <h2>🧪 GRE & English tests</h2>
    <div class="card small"><p style="margin:0 0 6px">${esc(gre.summary || "")}</p>
      <div class="m-line"><b>Suggested GRE timeline</b></div>
      ${(gre.attempts || []).map((a) => `<div class="m-line"><b>${esc(a.label)}</b> by ${fmtShort(a.by)}<div class="tiny muted">${esc(a.why)}</div></div>`).join("")}
      <details data-key="prep:gre" ${isOpen("prep:gre")}><summary>GRE rules</summary><ul class="clean">${(gre.rules || []).map((x) => `<li>${esc(x)}</li>`).join("")}</ul></details>
    </div>
    <div class="card small">${tests.map(testCard).join("") || `<div class="muted">No test booked yet. Add it here and you'll get reminders.</div>`}
      <button class="btn sm" data-act="m-test-add" style="margin-top:8px">+ Add a test</button></div>

    <h2>💰 Scholarships & funding</h2>
    ${(plan.funding || []).map((f) => `<div class="card small"><div class="row between"><b>${esc(f.name)}</b><span class="badge ${/^(Open|Automatic)/.test(f.status) ? "good" : f.status === "Closed" ? "bad" : "warn"}">${esc(f.status)}</span></div>
      <div class="tiny muted" style="margin-top:3px">${esc(f.when)} · ${esc(f.covers)}</div><p style="margin:6px 0">${esc(f.note)}</p><a href="${esc(f.url)}" target="_blank" rel="noopener">Open ↗</a></div>`).join("")}

    <h2>🗣 What to ask professors</h2>
    ${(plan.professor_questions || []).map((g, i) => `<details class="m-phase" data-key="q:${i}" ${isOpen("q:" + i, i === 0)}><summary><b>${esc(g.title)}</b></summary><div class="card small"><ul class="clean">${g.items.map((q) => `<li>${esc(q)}</li>`).join("")}</ul></div></details>`).join("")}

    <h2>📄 Making your CV fit master's applications</h2>
    <div class="card small"><ul class="clean">${(plan.cv_changes || []).map((x) => `<li>${esc(x)}</li>`).join("")}</ul></div>`;
}

// ---- the tab
function renderMasters() {
  mState();
  const view = S.f.mView || "plan";
  const board = boardPrograms();
  const next = board.map((p) => ({ p, d: nextOpenDeadline(p) })).filter((x) => x.d && M_ACTIVE.has(mStatus(x.p))).sort((a, b) => a.d.date.localeCompare(b.d.date)).slice(0, 4);
  const body = { plan: renderPlan, apps: renderApps, compare: renderCompare, prep: renderPrep }[view] || renderPlan;
  return `
    <div class="m-next">${next.map(({ p, d }) => `<div class="m-next-item"><b>${daysUntil(d.date)}d</b><span>${esc(shortName(p))}</span></div>`).join("") || `<span class="small muted">No upcoming deadlines.</span>`}</div>
    <div class="m-tabs">${M_TABS.map(([v, l]) => `<button class="${v === view ? "on" : ""}" data-act="m-view" data-v="${v}">${l}</button>`).join("")}</div>
    ${body()}`;
}

// ---- sheets
function mTaskAdd() {
  const bg = sheet(`<h3>Add a task</h3>
    <div class="field"><label>What</label><input id="mt-title" placeholder="e.g. Ask Prof. X about the lab"></div>
    <div class="field"><label>Due</label><input id="mt-due" type="date"></div>
    <div class="row"><button class="btn primary" id="mt-save">Add</button><button class="btn" data-close>Cancel</button></div>`);
  $("#mt-save", bg).onclick = () => {
    const title = $("#mt-title", bg).value.trim();
    if (!title) return toast("Give it a name");
    mSet("customTasks", "c" + Date.now(), { title, due: $("#mt-due", bg).value, done: false });
    bg.remove(); route();
  };
}
function mRecAdd() {
  const bg = sheet(`<h3>Add a referee</h3>
    <div class="field"><label>Name</label><input id="mr-name" placeholder="Prof. …"></div>
    <div class="field"><label>Role</label><input id="mr-role" placeholder="e.g. AUB Math, research supervisor"></div>
    <div class="row"><button class="btn primary" id="mr-save">Add</button><button class="btn" data-close>Cancel</button></div>`);
  $("#mr-save", bg).onclick = () => {
    const name = $("#mr-name", bg).value.trim();
    if (!name) return toast("Add a name");
    mSet("recs", "r" + Date.now(), { name, role: $("#mr-role", bg).value.trim(), status: "Not asked", submitted: {} });
    bg.remove(); route();
  };
}
function mTestSheet(id) {
  const t = id ? mState().tests[id] : { type: "GRE", status: "Planned" };
  const bg = sheet(`<h3>${id ? "Edit test" : "Add a test"}</h3>
    <div class="field"><label>Test</label><select id="mx-type">${["GRE", "IELTS", "TOEFL", "Other"].map((x) => `<option ${x === t.type ? "selected" : ""}>${x}</option>`).join("")}</select></div>
    <div class="field"><label>Date</label><input id="mx-date" type="date" value="${esc(t.date || "")}"></div>
    <div class="field"><label>Status</label><select id="mx-status">${["Planned", "Booked", "Taken"].map((x) => `<option ${x === t.status ? "selected" : ""}>${x}</option>`).join("")}</select></div>
    <div class="field"><label>Score</label><input id="mx-score" value="${esc(t.score || "")}" placeholder="e.g. Q169 V158 AW4.5, or IELTS 8.0"></div>
    <div class="row"><button class="btn primary" id="mx-save">Save</button>${id ? `<button class="btn" id="mx-del" style="color:var(--bad)">Delete</button>` : ""}<button class="btn" data-close>Cancel</button></div>`);
  $("#mx-save", bg).onclick = () => {
    mSet("tests", id || "t" + Date.now(), { type: $("#mx-type", bg).value, date: $("#mx-date", bg).value, status: $("#mx-status", bg).value, score: $("#mx-score", bg).value.trim() });
    bg.remove(); route();
  };
  const del = $("#mx-del", bg);
  if (del) del.onclick = () => { mSet("tests", id, { deleted: true }); bg.remove(); route(); };
}

// ---- events
document.addEventListener("click", (e) => {
  const el = e.target.closest("[data-act]");
  if (!el) return;
  const act = el.dataset.act, id = el.dataset.id;
  if (act === "m-view") { S.f.mView = el.dataset.v; saveFilters(); route(); window.scrollTo(0, 0); }
  else if (act === "m-add") {
    const p = S.grad.find((x) => x.id === id);
    if (mState().hidden[id]?.on) mSet("hidden", id, { on: false });
    trackGrad(p); upsertTrack("grad:" + id, { status: "Saved" }); toast(`${shortName(p)} added`); route();
  }
  else if (act === "m-remove") {
    const p = S.grad.find((x) => x.id === id);
    if (!confirm(`Remove ${shortName(p)} from your applications?`)) return;
    if (trackedFor("grad:" + id)) removeTrack("grad:" + id);
    mSet("hidden", id, { on: true }); route();
  }
  else if (act === "m-task-add") mTaskAdd();
  else if (act === "m-task-del") { mSet("customTasks", id, { deleted: true }); route(); }
  else if (act === "m-rec-add") mRecAdd();
  else if (act === "m-rec-del" && confirm("Remove this referee?")) { mSet("recs", id, { deleted: true }); route(); }
  else if (act === "m-test-add") mTestSheet(null);
  else if (act === "m-test-edit") mTestSheet(id);
});
document.addEventListener("change", (e) => {
  const el = e.target, act = el.dataset?.act, id = el.dataset?.id;
  if (act === "m-task") {
    mSet(el.dataset.custom ? "customTasks" : "tasks", id, { done: el.checked });
    setTimeout(route, 250);
  } else if (act === "m-status") {
    const tid = el.dataset.tid;
    if (!trackedFor(tid)) { const p = S.grad.find((x) => "grad:" + x.id === tid); if (p) trackGrad(p); }
    upsertTrack(tid, { status: el.value }); route();
  } else if (act === "m-rec-status") { mSet("recs", id, { status: el.value }); route(); }
  else if (act === "m-rec-sub") {
    const r = mState().recs[id];
    mSet("recs", id, { submitted: { ...(r.submitted || {}), [el.dataset.p]: el.checked } }); route();
  } else if (act === "m-rec-notes") mSet("recs", id, { notes: el.value });
});
