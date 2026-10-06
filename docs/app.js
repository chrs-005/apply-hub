/* Apply Hub: internships + grad school tracker (vanilla JS, no build step). */
"use strict";

// ------------------------------------------------------------------ helpers
const $ = (s, el = document) => el.querySelector(s);
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const LS = {
  get(k, d) { try { const v = localStorage.getItem("ah_" + k); return v === null ? d : JSON.parse(v); } catch { return d; } },
  set(k, v) { try { localStorage.setItem("ah_" + k, JSON.stringify(v)); } catch {} },
};
const todayStr = () => new Date().toLocaleDateString("en-CA"); // YYYY-MM-DD local
function daysUntil(dateStr) {
  if (!dateStr) return null;
  const a = new Date(todayStr() + "T00:00:00"), b = new Date(String(dateStr).slice(0, 10) + "T00:00:00");
  return Math.round((b - a) / 86400000);
}
const fmtDate = (d) => d ? new Date(String(d).slice(0, 10) + "T00:00:00").toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" }) : "—";
const fmtShort = (d) => d ? new Date(String(d).slice(0, 10) + "T00:00:00").toLocaleDateString("en-GB", { day: "numeric", month: "short" }) : "";
const ago = (iso) => {
  if (!iso) return "";
  const m = Math.round((Date.now() - new Date(iso)) / 60000);
  if (m < 60) return `${m}m ago`; if (m < 1440) return `${Math.round(m / 60)}h ago`;
  return `${Math.round(m / 1440)}d ago`;
};
const usd = (n) => n == null ? "—" : "$" + Math.round(n).toLocaleString("en-US");
const money = (m) => !m || m.amount == null ? "—" : m.amount === 0 ? "Free" : `${m.currency} ${Number(m.amount).toLocaleString("en-US")}`;
const FLAGS = { "United Kingdom": "🇬🇧", Switzerland: "🇨🇭", France: "🇫🇷", Germany: "🇩🇪", Netherlands: "🇳🇱", "United Arab Emirates": "🇦🇪", "Saudi Arabia": "🇸🇦", Austria: "🇦🇹", Qatar: "🇶🇦" };
const REGION_LABEL = { UK: "UK & Ireland", CH: "Switzerland", EU: "EU", GULF: "Gulf" };
const CAT_LABEL = { swe: "SWE", quant: "Quant", ml: "ML/AI", research: "Research", data: "Data" };
const STATUSES = ["Saved", "Preparing", "Applied", "Test / OA", "Interview", "Offer", "Rejected", "Withdrawn"];
const ACTIVE = new Set(["Saved", "Preparing"]);
const GRAD_CHECK = ["CV", "Transcript", "Statement of purpose", "Reference 1", "Reference 2", "Reference 3", "English test", "Fee paid"];
function toast(msg) { const t = $("#toast"); t.textContent = msg; t.classList.add("show"); clearTimeout(toast._t); toast._t = setTimeout(() => t.classList.remove("show"), 2200); }
function daysBadge(n) {
  if (n == null) return `<div class="days">?<small>TBC</small></div>`;
  const cls = n <= 7 ? "r" : n <= 21 ? "o" : "g";
  return `<div class="days ${cls}">${n === 0 ? "!" : n}<small>${n === 0 ? "TODAY" : n === 1 ? "day" : "days"}</small></div>`;
}

// ------------------------------------------------------------------ state
const S = {
  jobs: [], companies: [], watch: [], grad: [], research: [], meta: {},
  tracker: LS.get("tracker", { version: 1, items: {}, deleted: {} }),
  f: LS.get("filters", { q: "", region: "ALL", cat: "ALL", hidePhd: true, newOnly: false, sort: "priority",
                         gSort: "deadline", gRegion: "ALL", gField: "ALL", tKind: "ALL" }),
  lastVisit: LS.get("last_visit", null),
};
const saveFilters = () => LS.set("filters", S.f);

// ------------------------------------------------------------------ tracker sync (secret GitHub gist)
const GIST_FILE = "apply-hub-tracker.json";
const Sync = {
  token: LS.get("gh_token", ""), gist: LS.get("gist_id", ""), state: "local", timer: null,
  headers() { return { Authorization: `token ${this.token}`, Accept: "application/vnd.github+json" }; },
  on() { return !!(this.token && this.gist); },
  setState(s) { this.state = s; const el = $("#sync-state"); if (el) el.textContent = this.label(); },
  label() { return { local: "Saved on this device only", syncing: "Syncing…", synced: "Synced ✓", error: "Sync error: check settings" }[this.state]; },
  merge(remote) {
    const a = S.tracker, b = remote || { items: {}, deleted: {} };
    const deleted = { ...(b.deleted || {}), ...(a.deleted || {}) };
    const items = {};
    for (const src of [b.items || {}, a.items || {}]) for (const [id, it] of Object.entries(src)) {
      if (!items[id] || (it.updated || "") > (items[id].updated || "")) items[id] = it;
    }
    for (const [id, ts] of Object.entries(deleted)) if (items[id] && (items[id].updated || "") <= ts) delete items[id];
    S.tracker = { version: 1, items, deleted };
    LS.set("tracker", S.tracker);
  },
  async pull() {
    if (!this.on()) return;
    this.setState("syncing");
    try {
      const r = await fetch(`https://api.github.com/gists/${this.gist}`, { headers: this.headers(), cache: "no-store" });
      if (!r.ok) throw new Error(r.status);
      const g = await r.json();
      this.merge(JSON.parse(g.files[GIST_FILE]?.content || "{}"));
      this.setState("synced");
    } catch (e) { console.warn(e); this.setState("error"); }
  },
  save() {
    LS.set("tracker", S.tracker);
    if (!this.on()) return;
    clearTimeout(this.timer);
    this.timer = setTimeout(() => this.push(), 1200);
  },
  async push() {
    this.setState("syncing");
    try {
      await this.pull();
      const r = await fetch(`https://api.github.com/gists/${this.gist}`, {
        method: "PATCH", headers: this.headers(),
        body: JSON.stringify({ files: { [GIST_FILE]: { content: JSON.stringify(S.tracker, null, 1) } } }),
      });
      if (!r.ok) throw new Error(r.status);
      this.setState("synced");
    } catch (e) { console.warn(e); this.setState("error"); }
  },
  async create() {
    const r = await fetch("https://api.github.com/gists", {
      method: "POST", headers: this.headers(),
      body: JSON.stringify({ description: "Apply Hub tracker (private)", public: false,
                             files: { [GIST_FILE]: { content: JSON.stringify(S.tracker, null, 1) } } }),
    });
    if (!r.ok) throw new Error(`GitHub said ${r.status}. Check the token has the 'gist' scope.`);
    const g = await r.json();
    this.gist = g.id; LS.set("gist_id", g.id);
    return g.id;
  },
};

// ------------------------------------------------------------------ push notifications (Web Push)
// The public half of the scanner's signing key. The private half is the GitHub secret VAPID_PRIVATE_KEY.
const VAPID_PUBLIC = "BEu42YU8Tu6N_86FBQjDffeDlu0Ldv4kU1thYBPfUQk-gUvckgXH8ezQAMLT7qUX2XpM9Sa9iUWAJpMAKaLbub8";
const PUSH_FILE = "apply-hub-push.json";
const Push = {
  supported: () => "serviceWorker" in navigator && "PushManager" in window && "Notification" in window,
  isIOS: () => /iphone|ipad|ipod/i.test(navigator.userAgent),
  standalone: () => window.matchMedia("(display-mode: standalone)").matches || navigator.standalone === true,
  enabled: () => Push.supported() && Notification.permission === "granted" && LS.get("push_endpoint", ""),
  // why notifications can't be turned on here yet (null = ready)
  blocker() {
    if (Push.isIOS() && !Push.standalone()) return "On iPhone, open Apply Hub from its Home Screen icon first (Safari → Share → Add to Home Screen).";
    if (!Push.supported()) return "This browser doesn't support push notifications (iPhone needs iOS 16.4+).";
    if (Notification.permission === "denied") return "Notifications are blocked. Allow them in Settings → Notifications → Apply Hub.";
    if (!Sync.on()) return "First set up tracker sync above (token + Create tracker). Your device's notification address is stored there.";
    return null;
  },
  deviceName() { return Push.isIOS() ? "iPhone" : /android/i.test(navigator.userAgent) ? "Android" : /mac/i.test(navigator.userAgent) ? "Mac" : "Laptop"; },
  key() {
    const b = atob(VAPID_PUBLIC.replace(/-/g, "+").replace(/_/g, "/") + "===".slice((VAPID_PUBLIC.length + 3) % 4));
    return Uint8Array.from(b, (c) => c.charCodeAt(0));
  },
  async enable() {
    const why = Push.blocker(); if (why) throw new Error(why);
    const perm = await Notification.requestPermission();
    if (perm !== "granted") throw new Error("Permission not granted.");
    const reg = await navigator.serviceWorker.ready;
    const sub = (await reg.pushManager.getSubscription()) || (await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: Push.key() }));
    await Push.save(sub);
    await reg.showNotification("🔔 Notifications are on", { body: "You'll get new internships and deadline reminders here.", icon: "icons/icon-192.png" });
  },
  async save(sub) {
    // store this device's subscription in the tracker gist, where the scanner reads it
    const r = await fetch(`https://api.github.com/gists/${Sync.gist}`, { headers: Sync.headers(), cache: "no-store" });
    if (!r.ok) throw new Error(`Couldn't read your tracker gist (${r.status}).`);
    const g = await r.json();
    let data = {}; try { data = JSON.parse(g.files[PUSH_FILE]?.content || "{}"); } catch {}
    const subs = data.subs || {};
    const json = sub.toJSON();
    const id = json.endpoint.slice(-24).replace(/[^\w]/g, "");
    subs[id] = { subscription: json, device: Push.deviceName(), updated: new Date().toISOString() };
    const w = await fetch(`https://api.github.com/gists/${Sync.gist}`, {
      method: "PATCH", headers: Sync.headers(),
      body: JSON.stringify({ files: { [PUSH_FILE]: { content: JSON.stringify({ subs }, null, 1) } } }),
    });
    if (!w.ok) throw new Error(`Couldn't save to your tracker gist (${w.status}).`);
    LS.set("push_endpoint", json.endpoint);
  },
  async refresh() {
    // iOS can rotate subscriptions; re-save if this device's endpoint changed
    if (!Push.supported() || Notification.permission !== "granted" || !Sync.on()) return;
    try {
      const reg = await navigator.serviceWorker.ready;
      const sub = (await reg.pushManager.getSubscription()) || (await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: Push.key() }));
      if (sub && sub.endpoint !== LS.get("push_endpoint", "")) await Push.save(sub);
    } catch (e) { console.warn("push refresh", e); }
  },
  async disable() {
    const reg = await navigator.serviceWorker.ready;
    const sub = await reg.pushManager.getSubscription();
    if (sub) await sub.unsubscribe();
    LS.set("push_endpoint", "");
  },
};

function trackedFor(id) { return S.tracker.items[id]; }
function upsertTrack(id, data) {
  const now = new Date().toISOString();
  const prev = S.tracker.items[id];
  const it = { ...(prev || { id, added: now, history: [] }), ...data, updated: now };
  if (data.status && (!prev || prev.status !== data.status)) it.history = [...(it.history || []), { status: data.status, at: now }];
  S.tracker.items[id] = it;
  delete S.tracker.deleted?.[id];
  Sync.save();
  return it;
}
function removeTrack(id) {
  delete S.tracker.items[id];
  S.tracker.deleted = { ...(S.tracker.deleted || {}), [id]: new Date().toISOString() };
  Sync.save();
}
function trackJob(j) {
  return upsertTrack(j.id, { kind: "job", title: j.title, org: j.company, url: j.url, location: j.location, status: "Saved", deadline: "" });
}
function trackGrad(p) {
  return upsertTrack("grad:" + p.id, { kind: "grad", title: p.program, org: p.university, url: p.url, location: p.country,
    status: "Preparing", deadline: p.next_deadline || "", fee_usd: p.app_fee_usd, checklist: {} });
}
function trackResearch(p) {
  return upsertTrack("research:" + p.id, { kind: "research", title: p.name, org: p.org, url: p.url, location: p.country,
    status: "Preparing", deadline: p.deadline || "" });
}

// ------------------------------------------------------------------ data
async function loadData() {
  const get = (f) => fetch(`data/${f}?t=${Date.now()}`).then((r) => r.ok ? r.json() : null).catch(() => null);
  const [jobs, companies, watch, grad, research, meta] = await Promise.all(
    ["jobs.json", "companies.json", "watch.json", "grad.json", "research.json", "meta.json"].map(get));
  S.jobs = jobs?.jobs || []; S.companies = companies || []; S.watch = watch || [];
  S.grad = grad || []; S.research = research || []; S.meta = meta || {};
  const sub = S.meta.last_scan ? `Updated ${ago(S.meta.last_scan)} · ${S.meta.open_internships} open internships` : "No data yet: run the scanner";
  $("#hdr-sub").textContent = sub;
  const fresh = S.jobs.filter((j) => j.open && isNew(j)).length;
  const dot = $("#dot-jobs"); dot.hidden = !fresh; dot.textContent = fresh;
}
const isNew = (j) => S.lastVisit ? j.first_seen > S.lastVisit : (Date.now() - new Date(j.first_seen)) < 3 * 86400000;

// ------------------------------------------------------------------ deadlines
function deadlineEvents() {
  const ev = [];
  for (const p of S.grad) {
    for (const d of p.deadlines || []) if (d.date) ev.push({ date: d.date, title: `${p.university}: ${p.program}`, sub: d.label + (d.estimate ? " (estimated)" : ""), url: p.url, id: "grad:" + p.id, kind: "grad" });
    for (const s of p.scholarships || []) if (s.deadline) ev.push({ date: s.deadline, title: `💰 ${s.name}`, sub: `${p.university}: ${s.covers || ""}`, url: p.url, id: "grad:" + p.id, kind: "scholarship" });
  }
  for (const r of S.research) if (r.deadline) ev.push({ date: r.deadline, title: `🔬 ${r.name}`, sub: r.deadline_note || "", url: r.url, id: "research:" + r.id, kind: "research" });
  for (const t of Object.values(S.tracker.items)) if (t.deadline && t.kind !== "grad" && t.kind !== "research" && !["Rejected", "Withdrawn", "Offer"].includes(t.status))
    ev.push({ date: t.deadline, title: `${t.org}: ${t.title}`, sub: `Tracker · ${t.status}`, url: t.url, id: t.id, kind: "tracked" });
  return ev.map((e) => ({ ...e, days: daysUntil(e.date) })).filter((e) => e.days >= 0).sort((a, b) => a.days - b.days);
}

// ------------------------------------------------------------------ views
function renderToday() {
  const items = Object.values(S.tracker.items);
  const applied = items.filter((t) => !ACTIVE.has(t.status) && t.status !== "Withdrawn").length;
  const open = S.jobs.filter((j) => j.open);
  const fresh = open.filter(isNew);
  const ev = deadlineEvents().filter((e) => e.days <= 60);
  const changed = S.watch.filter((w) => w.last_changed && (Date.now() - new Date(w.last_changed)) < 7 * 86400000);
  const failing = S.companies.filter((c) => c.ok === false);
  const freshTop = [...fresh].sort((a, b) => a.tier - b.tier).slice(0, 8);
  const pushBanner = Push.enabled() ? "" : `<div class="card" style="border-color:var(--accent)">
      <div class="title">🔔 Get notified the moment an internship opens</div>
      <p class="small muted" style="margin:4px 0 8px">${esc(Push.blocker() || "Turn on notifications for this device.")}</p>
      <button class="btn sm primary" data-act="open-settings">Set up notifications</button></div>`;
  return `${pushBanner}
    <div class="stats">
      <div class="stat"><b>${open.length}</b><span>open internships</span></div>
      <div class="stat"><b>${fresh.length}</b><span>new since last visit</span></div>
      <div class="stat"><b>${items.length}</b><span>in your tracker</span></div>
      <div class="stat"><b>${applied}</b><span>applications sent</span></div>
    </div>
    <h2>⏰ Next 60 days <span class="count">${ev.length} deadlines</span></h2>
    <div class="card">${ev.length ? ev.slice(0, 25).map((e) => `
      <div class="dl">${daysBadge(e.days)}
        <div style="flex:1;min-width:0">
          <div class="title">${esc(e.title)}</div>
          <div class="small muted">${esc(e.sub)} · ${fmtDate(e.date)}</div>
        </div>
        ${e.url ? `<a class="btn sm ghost" href="${esc(e.url)}" target="_blank" rel="noopener">Open ↗</a>` : ""}
      </div>`).join("") : `<div class="empty">No deadlines in the next 60 days 🎉</div>`}
    </div>
    <h2>🆕 New internships <span class="count">${fresh.length}</span></h2>
    ${freshTop.length ? freshTop.map(jobCard).join("") + (fresh.length > 8 ? `<a class="btn" href="#jobs" data-act="new-only">See all ${fresh.length} new →</a>` : "")
      : `<div class="card empty">Nothing new since your last visit.</div>`}
    ${changed.length ? `<h2>👀 Pages that changed this week</h2>${changed.map((w) => `
      <div class="card"><div class="row between"><div class="title">${esc(w.name)}</div><span class="badge warn">${ago(w.last_changed)}</span></div>
      ${(w.changes || []).length ? `<ul class="clean small">${w.changes.map((c) => `<li>${esc(c)}</li>`).join("")}</ul>` : ""}
      <a class="small" href="${esc(w.url)}" target="_blank" rel="noopener">Open page ↗</a></div>`).join("")}` : ""}
    <p class="tiny muted" style="margin-top:20px">Last scan ${S.meta.last_scan ? ago(S.meta.last_scan) : "never"}${failing.length ? ` · ⚠️ ${failing.length} source(s) failing: ${esc(failing.map((c) => c.name).join(", "))}` : " · all sources OK"}.</p>`;
}

function jobCard(j) {
  const t = trackedFor(j.id);
  const tags = [
    isNew(j) ? `<span class="badge new">NEW</span>` : "",
    ...j.categories.map((c) => `<span class="badge">${CAT_LABEL[c] || c}</span>`),
    j.tags.includes("2027") ? `<span class="badge good">2027</span>` : "",
    j.tags.includes("phd") ? `<span class="badge warn">PhD</span>` : "",
    !j.open ? `<span class="badge bad">Closed</span>` : "",
  ].join("");
  return `<div class="card">
    <div class="row between"><span class="org">${j.tier === 1 ? "★ " : ""}${esc(j.company)}</span><span class="tiny muted">seen ${fmtShort(j.first_seen)}</span></div>
    <div class="title" style="margin:3px 0">${esc(j.title)}</div>
    <div class="small muted">📍 ${esc(j.location)}</div>
    <div class="row" style="margin-top:8px">${tags}</div>
    <div class="row" style="margin-top:10px">
      <a class="btn primary sm" href="${esc(j.url)}" target="_blank" rel="noopener">Apply ↗</a>
      <button class="btn sm ${t ? "on" : ""}" data-act="track-job" data-id="${esc(j.id)}">${t ? "✓ " + esc(t.status) : "+ Track"}</button>
    </div></div>`;
}

function renderJobs() {
  const f = S.f;
  const q = f.q.trim().toLowerCase();
  let list = S.jobs.filter((j) => j.open)
    .filter((j) => f.region === "ALL" || j.regions.includes(f.region))
    .filter((j) => f.cat === "ALL" || j.categories.includes(f.cat))
    .filter((j) => !f.hidePhd || !j.tags.includes("phd"))
    .filter((j) => !f.newOnly || isNew(j))
    .filter((j) => !q || `${j.company} ${j.title} ${j.location}`.toLowerCase().includes(q));
  if (f.sort === "newest") list.sort((a, b) => b.first_seen.localeCompare(a.first_seen));
  else if (f.sort === "company") list.sort((a, b) => a.company.localeCompare(b.company));
  else list.sort((a, b) => a.tier - b.tier || b.first_seen.localeCompare(a.first_seen));
  const chip = (key, val, label) => `<button class="chip ${f[key] === val ? "on" : ""}" data-act="filter" data-k="${key}" data-v="${val}">${label}</button>`;
  const toggle = (key, label) => `<button class="chip ${f[key] ? "on" : ""}" data-act="toggle" data-k="${key}">${label}</button>`;

  const notYet = S.companies.filter((c) => c.ok && c.open_internships === 0).sort((a, b) => a.tier - b.tier);
  const manual = S.companies.filter((c) => c.ats === "manual").sort((a, b) => a.tier - b.tier);
  return `
    <div class="toolbar">
      <input class="search" id="q" placeholder="Search company, role, city…" value="${esc(f.q)}">
      <div class="chips">${chip("region", "ALL", "All regions")}${chip("region", "UK", "🇬🇧 UK/IE")}${chip("region", "CH", "🇨🇭 Switzerland")}${chip("region", "EU", "🇪🇺 EU")}${chip("region", "GULF", "🇦🇪 Gulf")}</div>
      <div class="chips">${chip("cat", "ALL", "All roles")}${chip("cat", "swe", "SWE")}${chip("cat", "quant", "Quant")}${chip("cat", "ml", "ML/AI")}${chip("cat", "research", "Research")}</div>
      <div class="row between">
        <div class="chips">${toggle("hidePhd", "Hide PhD-only")}${toggle("newOnly", "New only")}</div>
        <select class="sel" data-act="sort" data-k="sort">
          <option value="priority" ${f.sort === "priority" ? "selected" : ""}>Dream companies first</option>
          <option value="newest" ${f.sort === "newest" ? "selected" : ""}>Newest</option>
          <option value="company" ${f.sort === "company" ? "selected" : ""}>Company A–Z</option>
        </select>
      </div>
    </div>
    <h2>Open now <span class="count">${list.length} roles</span></h2>
    ${list.length ? list.map(jobCard).join("") : `<div class="card empty">No internships match these filters.</div>`}
    <h2>⏳ Not posted yet <span class="count">${notYet.length} companies</span></h2>
    <div class="card small">${notYet.map((c) => `<div class="row between" style="padding:5px 0;border-bottom:1px solid var(--line)">
      <span>${c.tier === 1 ? "★ " : ""}<b>${esc(c.name)}</b></span><span class="muted tiny">usually ${esc(c.opens)}</span></div>`).join("") || "All companies have open roles."}
      <p class="tiny muted">The scanner checks these every 3 hours, and you'll get a notification the moment one posts.</p></div>
    <h2>🔗 Check manually <span class="count">no public API</span></h2>
    <div class="card small">${manual.map((c) => `<div class="row between" style="padding:5px 0;border-bottom:1px solid var(--line)">
      <span>${c.tier === 1 ? "★ " : ""}<b>${esc(c.name)}</b> <span class="muted tiny">· ${esc(c.opens)}</span></span>
      <a class="btn sm ghost" href="${esc(c.careers)}" target="_blank" rel="noopener">Open ↗</a></div>`).join("")}</div>`;
}

function gradCard(p) {
  const t = trackedFor("grad:" + p.id);
  const flag = FLAGS[p.country] || "🌍";
  const nd = daysUntil(p.next_deadline);
  const statusBadge = p.status === "closed" ? `<span class="badge bad">Closed</span>`
    : p.status === "not_open_yet" ? `<span class="badge">Opens ${fmtShort(p.opens)}</span>` : `<span class="badge good">Open</span>`;
  const tuition = p.tuition ? `${money(p.tuition)}/${p.tuition.per}${p.tuition_year_usd != null ? ` <span class="muted">(~${usd(p.tuition_year_usd)}/yr)</span>` : ""}${p.tuition.note ? `<div class="tiny muted">${esc(p.tuition.note)}</div>` : ""}` : `<span class="muted">Check the page</span>`;
  const srcBadge = { official: "good", aggregator: "", estimate: "warn" }[p.source] ?? "";
  return `<div class="card">
    <div class="row between"><span class="org">${flag} ${esc(p.university)}</span>${statusBadge}</div>
    <div class="title" style="margin:3px 0">${esc(p.program)}</div>
    <div class="row" style="margin-top:4px">
      <span class="badge ${p.app_fee_usd === 0 ? "good" : ""}">Fee: ${money(p.app_fee)}${p.app_fee_usd ? ` ≈ ${usd(p.app_fee_usd)}` : ""}</span>
      ${nd != null ? `<span class="badge ${nd <= 7 ? "bad" : nd <= 21 ? "warn" : ""}">Next: ${fmtShort(p.next_deadline)} (${nd}d)</span>` : ""}
      ${(p.scholarships || []).some((s) => /full|tuition|\+/i.test(s.covers || "")) || p.tuition?.amount === 0 ? `<span class="badge good">Funding available</span>` : ""}
    </div>
    <dl class="kv">
      <dt>Deadlines</dt><dd>${(p.deadlines || []).map((d) => `<div>${d.date && daysUntil(d.date) < 0 ? "<s>" : ""}${fmtDate(d.date)}${d.date && daysUntil(d.date) < 0 ? "</s>" : ""} · <span class="muted">${esc(d.label)}${d.estimate ? " (est.)" : ""}${d.time ? " · " + esc(d.time) : ""}</span></div>`).join("")}</dd>
      <dt>App fee</dt><dd><span class="money">${money(p.app_fee)}</span>${p.app_fee?.note ? `<div class="tiny muted">${esc(p.app_fee.note)}</div>` : ""}</dd>
      <dt>Tuition</dt><dd>${tuition}</dd>
      <dt>Scholarships</dt><dd>${(p.scholarships || []).length ? (p.scholarships.map((s) => `<div><b>${esc(s.name)}</b>${s.deadline ? ` · by ${fmtDate(s.deadline)}` : ""}<div class="tiny muted">${esc(s.covers || "")}${s.how ? " · " + esc(s.how) : ""}</div></div>`).join("")) : `<span class="muted">None listed</span>`}</dd>
      <dt>English</dt><dd>${esc(p.language || "—")}</dd>
      <dt>GRE</dt><dd>${esc(p.gre || "—")}</dd>
    </dl>
    ${p.notes ? `<p class="small" style="margin:8px 0 0">💡 ${esc(p.notes)}</p>` : ""}
    <div class="tiny muted" style="margin-top:6px"><span class="badge ${srcBadge}">${esc(p.source)}</span>${(p.verify || []).length ? ` Verify: ${esc(p.verify.join(", "))}` : ""}</div>
    ${checklistHtml("grad:" + p.id)}
    <div class="row" style="margin-top:10px">
      <a class="btn primary sm" href="${esc(p.url)}" target="_blank" rel="noopener">Program page ↗</a>
      <button class="btn sm ${t ? "on" : ""}" data-act="track-grad" data-id="${esc(p.id)}">${t ? "✓ " + esc(t.status) : "+ Track"}</button>
    </div></div>`;
}

function renderGrad() {
  const f = S.f;
  let list = S.grad.filter((p) => f.gRegion === "ALL" || p.region === f.gRegion)
    .filter((p) => f.gField === "ALL" || (p.fields || []).includes(f.gField))
    .filter((p) => f.gField !== "funded" || true);
  if (f.gField === "funded") list = S.grad.filter((p) => (f.gRegion === "ALL" || p.region === f.gRegion) && (p.tuition?.amount === 0 || (p.scholarships || []).some((s) => /full|tuition/i.test(s.covers || ""))));
  const nullLast = (v, asc = true) => v == null ? Infinity * (asc ? 1 : -1) : v;
  const sorts = {
    deadline: (a, b) => (a.next_deadline || "9999").localeCompare(b.next_deadline || "9999"),
    fee_asc: (a, b) => nullLast(a.app_fee_usd) - nullLast(b.app_fee_usd),
    fee_desc: (a, b) => nullLast(b.app_fee_usd, false) - nullLast(a.app_fee_usd, false),
    tuition: (a, b) => nullLast(a.tuition_year_usd) - nullLast(b.tuition_year_usd),
    name: (a, b) => a.university.localeCompare(b.university),
  };
  list.sort(sorts[f.gSort] || sorts.deadline);
  const tracked = S.grad.filter((p) => trackedFor("grad:" + p.id));
  const totalFees = tracked.reduce((s, p) => s + (p.app_fee_usd || 0), 0);
  const chip = (key, val, label) => `<button class="chip ${f[key] === val ? "on" : ""}" data-act="filter" data-k="${key}" data-v="${val}">${label}</button>`;
  return `
    <div class="card">
      <div class="row between"><div><div class="title">💸 Your application budget</div>
      <div class="small muted">${tracked.length} programs tracked · fees only (tuition not included)</div></div>
      <div style="font-size:24px;font-weight:750">${usd(totalFees)}</div></div>
      ${tracked.length ? `<div class="small" style="margin-top:6px">${tracked.map((p) => `${esc(p.university.split(" (")[0])}: ${money(p.app_fee)}`).join(" · ")}</div>` : `<div class="small muted" style="margin-top:6px">Tap “+ Track” on programs to build your list.</div>`}
    </div>
    <div class="toolbar">
      <div class="chips">${chip("gRegion", "ALL", "All")}${chip("gRegion", "CH", "🇨🇭 Switzerland")}${chip("gRegion", "UK", "🇬🇧 UK")}${chip("gRegion", "EU", "🇪🇺 EU")}${chip("gRegion", "GULF", "🇦🇪🇸🇦 Gulf")}</div>
      <div class="chips">${chip("gField", "ALL", "All fields")}${chip("gField", "funded", "💰 Funded")}${chip("gField", "cs", "CS")}${chip("gField", "ml", "ML/AI")}${chip("gField", "math", "Math")}${chip("gField", "quant", "Quant finance")}${chip("gField", "research", "Research")}</div>
      <div class="row"><span class="small muted">Sort</span>
        <select class="sel" data-act="sort" data-k="gSort">
          ${[["deadline", "Next deadline"], ["fee_asc", "Application fee: low → high"], ["fee_desc", "Application fee: high → low"], ["tuition", "Tuition: low → high"], ["name", "University"]].map(([v, l]) => `<option value="${v}" ${f.gSort === v ? "selected" : ""}>${l}</option>`).join("")}
        </select></div>
    </div>
    <div class="card row between">
      <div><div class="title">📄 Got a requirements PDF?</div><div class="small muted">Upload a program's checklist and it becomes a tickable checklist.</div></div>
      <button class="btn sm primary" data-act="pdf-picker">Upload PDF</button>
    </div>
    <h2>Master's programs · Fall 2027 <span class="count">${list.length}</span></h2>
    ${list.map(gradCard).join("") || `<div class="card empty">No programs match.</div>`}
    <p class="tiny muted">USD amounts are approximate (rates in config/settings.yaml). To add a program, edit <code>data/grad_programs.yaml</code> on GitHub.</p>`;
}

// ------------------------------------------------------------------ application checklists
// Priority: checklist you uploaded (tracker item .req) > program's official checklist (yaml) > generic.
const openChecklists = new Set();
document.addEventListener("toggle", (e) => {
  const d = e.target;
  if (d.matches && d.matches("details.cl")) d.open ? openChecklists.add(d.dataset.tid) : openChecklists.delete(d.dataset.tid);
}, true);
const programFor = (tid) => tid.startsWith("grad:") ? S.grad.find((p) => "grad:" + p.id === tid) : null;
function checklistFor(tid) {
  const t = trackedFor(tid), p = programFor(tid);
  if (t?.req?.items?.length) return { items: t.req.items, facts: t.req.facts || [], source: t.req.source, uploaded: true };
  if (p?.checklist?.length) return { items: p.checklist, facts: p.checklist_facts || [], source: p.checklist_source };
  return { items: GRAD_CHECK.map((c) => ({ id: c, label: c })), facts: [], source: "Generic checklist. Upload the program's PDF for the real one", generic: true };
}
function checklistHtml(tid) {
  const t = trackedFor(tid), cl = checklistFor(tid);
  const done = cl.items.filter((i) => t?.checklist?.[i.id]).length;
  const pct = Math.round((done / Math.max(cl.items.length, 1)) * 100);
  return `<details class="cl" data-tid="${esc(tid)}" ${openChecklists.has(tid) ? "open" : ""}>
    <summary>📋 Application checklist · <b class="cl-count">${done}/${cl.items.length}</b> done ${cl.generic ? "" : `<span class="badge ${pct === 100 ? "good" : ""}">${pct}%</span>`}</summary>
    <div class="tiny muted" style="margin:6px 0">${esc(cl.source || "")}</div>
    ${cl.items.map((i) => `<label class="cl-item"><input type="checkbox" data-act="cl-check" data-tid="${esc(tid)}" data-c="${esc(i.id)}" ${t?.checklist?.[i.id] ? "checked" : ""}>
      <span><b>${esc(i.label)}</b>${i.detail ? `<span class="tiny muted cl-detail">${esc(i.detail)}</span>` : ""}${i.tip ? `<span class="tiny cl-tip">💡 ${esc(i.tip)}</span>` : ""}</span></label>`).join("")}
    ${cl.facts.length ? `<div class="tiny" style="margin-top:8px"><b>Good to know</b><ul class="clean">${cl.facts.map((f) => `<li>${esc(f)}</li>`).join("")}</ul></div>` : ""}
    <label class="btn sm ghost" style="margin-top:8px">📄 ${cl.uploaded ? "Replace with another PDF" : "Add checklist from PDF"}<input type="file" accept="application/pdf" data-act="cl-pdf" data-tid="${esc(tid)}" hidden></label>
  </details>`;
}
function ensureTracked(tid) {
  if (trackedFor(tid)) return;
  const p = programFor(tid);
  if (p) trackGrad(p);
}

// ---- PDF → checklist (runs in the browser; the PDF never leaves your device)
const PDFJS = "https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.min.js";
async function loadPdfJs() {
  if (window.pdfjsLib) return window.pdfjsLib;
  await new Promise((res, rej) => {
    const s = document.createElement("script");
    s.src = PDFJS; s.onload = res; s.onerror = () => rej(new Error("Couldn't load the PDF reader (are you offline?)"));
    document.head.appendChild(s);
  });
  window.pdfjsLib.GlobalWorkerOptions.workerSrc = PDFJS.replace("pdf.min.js", "pdf.worker.min.js");
  return window.pdfjsLib;
}
function unspace(line) {
  // Designed PDFs often letter-space text: "T w o  l e t t e r s" -> "Two letters"
  const toks = line.trim().split(" ");
  if (toks.length > 4 && toks.filter((t) => t.length === 1).length / toks.length > 0.6)
    return line.trim().split(/\s{2,}/).map((w) => w.replace(/ /g, "")).join(" ");
  return line.trim();
}
async function pdfText(file) {
  const lib = await loadPdfJs();
  const doc = await lib.getDocument({ data: await file.arrayBuffer() }).promise;
  const pages = [];
  for (let n = 1; n <= doc.numPages; n++) {
    const content = await (await doc.getPage(n)).getTextContent();
    const lines = []; let line = "", lastY = null;
    for (const it of content.items) {
      const y = it.transform ? it.transform[5] : null;
      if (lastY !== null && y !== null && Math.abs(y - lastY) > 2) { lines.push(line); line = ""; }
      line += it.str; lastY = y;
      if (it.hasEOL) { lines.push(line); line = ""; lastY = null; }
    }
    lines.push(line);
    pages.push(lines.map(unspace).filter(Boolean).join("\n"));
  }
  return pages.join("\n\n");
}
const NUMW = { one: 1, two: 2, three: 3, four: 4, five: 5 };
function detectRequirements(text) {
  const flat = text.replace(/\s+/g, " ");
  const sentences = flat.split(/(?<=[.!?:])\s+(?=[A-Z])/);
  const around = (re) => sentences.filter((s) => re.test(s)).slice(0, 3).join(" ").slice(0, 420);
  const items = [];
  const add = (id, label, re, extra = {}) => { if (re.test(flat)) items.push({ id, label, detail: around(re), ...extra }); };
  add("account", "Create an account on the application portal", /create an account|register (on|an account)|online application (form|portal)/i);
  const ref = flat.match(/\b(one|two|three|four|five|[1-5])\s+(?:academic\s+|professional\s+)?(?:letters? of recommendation|recommendation letters?|references|referees|reference letters?)/i);
  if (ref || /recommendation|referee/i.test(flat))
    items.push({ id: "referees", label: `${ref ? (NUMW[ref[1].toLowerCase()] || ref[1]) + " " : ""}recommendation letters (ask early)`, detail: around(/recommend|referee/i) });
  const pages = flat.match(/(?:maximum|max\.?|up to|no more than|not exceed)\s*(?:of\s*)?(\d+)\s*pages?/i);
  add("cv", `CV / résumé${pages ? ` (max ${pages[1]} pages)` : ""}`, /\b(cv|curriculum vitae|r[ée]sum[ée])\b/i);
  add("transcripts", "Transcripts (all post-secondary studies)", /transcript/i);
  add("enrolment", "Degree certificate / certificate of enrolment", /certificate of enrol|degree certificate|diploma|proof of enrol|enrol?ment certificate/i);
  const words = flat.match(/(\d[\d,]{2,})\s*words/i);
  add("statement", `Statement of purpose / motivation letter${words ? ` (max ${words[1]} words)` : ""}`, /personal statement|statement of purpose|motivation letter|letter of motivation|cover letter|motivational statement/i);
  add("proposal", "Research proposal", /research proposal|project proposal/i);
  add("writing", "Writing sample", /writing sample/i);
  const toefl = flat.match(/toefl[^\d]{0,40}?\b(\d{2,3})\b/i), ielts = flat.match(/ielts[^\d]{0,40}?\b([4-9](?:\.\d)?)\b/i);
  const cae = flat.match(/(?:\bcae\b|cambridge advanced?)[^\n]{0,40}?\b(C1|C2)\b/i), duo = flat.match(/duolingo[^\d]{0,40}?\b(\d{2,3})\b/i);
  const eng = [toefl && `TOEFL ${toefl[1]}`, ielts && `IELTS ${ielts[1]}`, cae && `CAE ${cae[1]}`, duo && `Duolingo ${duo[1]}`].filter(Boolean).join(" / ");
  add("english", `English test${eng ? `: ${eng}` : " (TOEFL / IELTS)"}`, /toefl|ielts|english proficiency|english language (test|requirement)|cambridge (advanced|english)/i);
  add("gre", "GRE / GMAT scores", /\bgre\b|\bgmat\b/i);
  add("passport", "Passport / ID copy", /passport|identity card|\bid card\b/i);
  add("photo", "ID photo", /\b(id )?(photo|picture)\b/i);
  const fee = flat.match(/(?:application|processing)[^.]{0,60}?fee[^.]{0,60}?(?:(€|£|\$|chf|eur|gbp|usd|aed)\s?(\d+)|(\d+)\s?(€|£|\$|chf|eur|gbp|usd|aed))/i);
  add("fee", `Pay the application fee${fee ? ` (${fee[1] ? fee[1] + fee[2] : fee[3] + " " + fee[4]})` : ""}`, /application (processing )?fee|processing fee/i);
  add("portfolio", "Portfolio / GitHub link", /portfolio/i);
  add("interview", "Prepare for the interview", /interview/i);
  items.push({ id: "submit", label: "Submit before the deadline", detail: around(/cannot (access|edit|modify)|once (you )?submit|deadline/i) });
  const facts = [];
  const emails = [...new Set(flat.match(/[\w.+-]+@[\w-]+\.[\w.-]+\w/g) || [])];
  if (emails.length) facts.push("Contact: " + emails.join(", "));
  const dates = [...new Set(flat.match(/\b\d{1,2}(?:st|nd|rd|th)?\s+(?:jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\.?,?\s+20\d\d\b|\b(?:jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\.?\s+\d{1,2},?\s+20\d\d\b/gi) || [])];
  if (dates.length) facts.push("Dates mentioned: " + dates.slice(0, 8).join(" · "));
  if (/translat/i.test(flat)) facts.push(around(/translat/i));
  if (/cannot (access|edit|modify)|once (you )?submit/i.test(flat)) facts.push(around(/cannot (access|edit|modify)|once (you )?submit/i));
  if (/non-?refundable/i.test(flat)) facts.push("The application fee is non-refundable.");
  const w = flat.search(/waive/i);
  if (w >= 0) {
    const cut = [...flat.slice(0, w).matchAll(/[.!?:]\s+(?=[A-Z])/g)].pop();
    facts.push(flat.slice(cut ? cut.index + cut[0].length : Math.max(0, w - 60), w + 320).trim() + "…");
  }
  return { items, facts: facts.filter(Boolean) };
}

function openChecklistReview(tid, title, file, text) {
  const { items, facts } = detectRequirements(text);
  const bg = sheet(`
    <h3>📄 Checklist from “${esc(file.name)}”</h3>
    <p class="small muted">For <b>${esc(title)}</b>. Found ${items.length} requirements. Untick anything wrong, edit labels, add what's missing.</p>
    <div id="r-items">${items.map((i, n) => `<div class="cl-item"><input type="checkbox" checked data-n="${n}">
      <span style="flex:1"><input class="r-label" data-n="${n}" value="${esc(i.label)}" style="width:100%;font-weight:600;padding:4px 6px;border:1px solid var(--line);border-radius:8px;background:var(--bg)">
      ${i.detail ? `<span class="tiny muted cl-detail">${esc(i.detail)}</span>` : ""}</span></div>`).join("")}</div>
    <div class="row" style="margin:8px 0"><input id="r-new" placeholder="Add another requirement…" style="flex:1;padding:8px 10px;border:1px solid var(--line);border-radius:10px;background:var(--bg)"><button class="btn sm" id="r-add">Add</button></div>
    ${facts.length ? `<div class="small"><b>Good to know</b><ul class="clean">${facts.map((f) => `<li>${esc(f)}</li>`).join("")}</ul></div>` : ""}
    <details><summary>Text read from the PDF</summary><pre style="white-space:pre-wrap;font-size:11px;max-height:240px;overflow:auto">${esc(text.slice(0, 15000))}</pre></details>
    <div class="row" style="margin-top:12px"><button class="btn primary" id="r-save">Save checklist</button><button class="btn" data-close>Cancel</button></div>`);
  const extra = [];
  $("#r-add", bg).onclick = () => {
    const v = $("#r-new", bg).value.trim(); if (!v) return;
    extra.push({ id: "x" + Date.now(), label: v });
    $("#r-items", bg).insertAdjacentHTML("beforeend", `<div class="cl-item"><input type="checkbox" checked disabled><span><b>${esc(v)}</b></span></div>`);
    $("#r-new", bg).value = "";
  };
  $("#r-save", bg).onclick = () => {
    const kept = items.filter((_, n) => bg.querySelector(`input[type=checkbox][data-n="${n}"]`).checked)
      .map((i) => ({ ...i, label: bg.querySelector(`.r-label[data-n="${items.indexOf(i)}"]`).value.trim() || i.label }));
    ensureTracked(tid);
    upsertTrack(tid, { req: { items: [...kept, ...extra], facts, source: `${file.name} (uploaded ${todayStr()})`, text: text.slice(0, 12000) } });
    openChecklists.add(tid);
    bg.remove(); toast("Checklist saved ✓"); route();
  };
}
async function handleChecklistPdf(tid, title, file) {
  if (!file) return;
  toast("Reading PDF…");
  try {
    const text = await pdfText(file);
    if (text.replace(/\s/g, "").length < 40) throw new Error("This PDF has no readable text (it may be a scanned image).");
    openChecklistReview(tid, title, file, text);
  } catch (e) { toast(e.message || "Couldn't read that PDF"); console.warn(e); }
}
function openPdfPicker() {
  const customs = Object.values(S.tracker.items).filter((t) => t.kind === "grad" && !t.id.startsWith("grad:"));
  const bg = sheet(`
    <h3>📄 Upload a requirements PDF</h3>
    <div class="field"><label>Which program is it for?</label>
      <select id="p-prog">
        ${S.grad.map((p) => `<option value="grad:${esc(p.id)}">${esc(p.university)}: ${esc(p.program)}</option>`).join("")}
        ${customs.map((t) => `<option value="${esc(t.id)}">${esc(t.org)}: ${esc(t.title)}</option>`).join("")}
        <option value="__new">➕ A program that's not in the list…</option>
      </select></div>
    <div id="p-new" hidden>
      <div class="field"><label>University</label><input id="p-uni" placeholder="e.g. KTH Royal Institute of Technology"></div>
      <div class="field"><label>Program</label><input id="p-name" placeholder="e.g. MSc Machine Learning"></div>
      <div class="field"><label>Deadline (optional)</label><input id="p-dl" type="date"></div>
      <div class="field"><label>Program link (optional)</label><input id="p-url" type="url" placeholder="https://…"></div>
    </div>
    <label class="btn primary" style="width:100%">Choose PDF…<input type="file" id="p-file" accept="application/pdf" hidden></label>
    <button class="btn" data-close style="width:100%;margin-top:8px">Cancel</button>`);
  $("#p-prog", bg).onchange = (e) => { $("#p-new", bg).hidden = e.target.value !== "__new"; };
  $("#p-file", bg).onchange = async (e) => {
    let tid = $("#p-prog", bg).value, title;
    if (tid === "__new") {
      const uni = $("#p-uni", bg).value.trim(), name = $("#p-name", bg).value.trim();
      if (!uni && !name) { toast("Name the university/program first"); e.target.value = ""; return; }
      tid = "custom:" + Date.now();
      upsertTrack(tid, { kind: "grad", org: uni, title: name || "Master's program", url: $("#p-url", bg).value.trim(),
                         deadline: $("#p-dl", bg).value, status: "Preparing", checklist: {} });
      title = `${uni}: ${name}`;
    } else title = $("#p-prog", bg).selectedOptions[0].textContent;
    const file = e.target.files[0];
    bg.remove();
    await handleChecklistPdf(tid, title, file);
  };
}

function renderResearch() {
  const list = S.research;
  return `
    <p class="small muted">University research internships for Summer 2027. These count as internships too, and they're great for grad applications (strong reference letters).</p>
    ${list.map((p) => {
      const t = trackedFor("research:" + p.id);
      const n = daysUntil(p.deadline);
      return `<div class="card">
        <div class="row between"><span class="org">${FLAGS[p.country] || "🌍"} ${esc(p.org)}</span>
          ${p.status === "closed" ? `<span class="badge bad">Closed</span>` : p.status === "not_open_yet" ? `<span class="badge">Opens ${fmtShort(p.opens)}</span>` : `<span class="badge good">Open / rolling</span>`}</div>
        <div class="title" style="margin:3px 0">${esc(p.name)}</div>
        <div class="row" style="margin-top:4px">
          ${p.deadline ? `<span class="badge ${n <= 7 ? "bad" : n <= 21 ? "warn" : ""}">Deadline ${fmtDate(p.deadline)}${n != null && n >= 0 ? ` (${n}d)` : ""}</span>` : `<span class="badge">Deadline TBC</span>`}
          ${p.pay ? `<span class="badge good">${esc(p.pay)}</span>` : ""}
        </div>
        <dl class="kv"><dt>When</dt><dd>${esc(p.duration || "—")}</dd><dt>Who</dt><dd>${esc(p.level || "—")}</dd><dt>Note</dt><dd>${esc(p.deadline_note || "")}</dd></dl>
        ${p.notes ? `<p class="small" style="margin:8px 0 0">💡 ${esc(p.notes)}</p>` : ""}
        <div class="row" style="margin-top:10px">
          ${p.url ? `<a class="btn primary sm" href="${esc(p.url)}" target="_blank" rel="noopener">Program page ↗</a>` : ""}
          <button class="btn sm ${t ? "on" : ""}" data-act="track-research" data-id="${esc(p.id)}">${t ? "✓ " + esc(t.status) : "+ Track"}</button>
        </div></div>`;
    }).join("")}
    <h2>👀 Watched pages</h2>
    <div class="card"><table class="src">${S.watch.map((w) => `<tr><td><a href="${esc(w.url)}" target="_blank" rel="noopener">${esc(w.name)}</a></td>
      <td><span class="badge ${w.status === "ok" ? "good" : w.status === "blocked" ? "warn" : "bad"}">${esc(w.status)}</span></td>
      <td class="tiny muted">${w.last_changed ? "changed " + ago(w.last_changed) : ""}</td></tr>`).join("")}</table>
      <p class="tiny muted">“blocked” means the site refuses robots, so check those by hand.</p></div>`;
}

function renderTracker() {
  const f = S.f;
  const items = Object.values(S.tracker.items).filter((t) => f.tKind === "ALL" || t.kind === f.tKind);
  const groups = STATUSES.map((s) => [s, items.filter((t) => t.status === s)]).filter(([, l]) => l.length);
  const chip = (val, label) => `<button class="chip ${f.tKind === val ? "on" : ""}" data-act="filter" data-k="tKind" data-v="${val}">${label}</button>`;
  return `
    <div class="row between">
      <div class="chips">${chip("ALL", "All")}${chip("job", "Internships")}${chip("grad", "Grad")}${chip("research", "Research")}${chip("custom", "Other")}</div>
      <button class="btn sm primary" data-act="add-custom">+ Add</button>
    </div>
    <p class="sync" id="sync-state">${Sync.label()}</p>
    ${groups.length ? groups.map(([s, l]) => `<h2>${esc(s)} <span class="count">${l.length}</span></h2>${l.sort((a, b) => (a.deadline || "9999").localeCompare(b.deadline || "9999")).map(trackCard).join("")}`).join("")
      : `<div class="card empty">Your tracker is empty.<br>Tap “+ Track” on any internship or program, or “+ Add” for anything else (e.g. a professor you emailed).</div>`}`;
}

function trackCard(t) {
  const n = daysUntil(t.deadline);
  const kindIcon = { job: "💼", grad: "🎓", research: "🔬", custom: "📌" }[t.kind] || "📌";
  return `<div class="card trk" data-id="${esc(t.id)}">
    <div class="row between"><span class="org">${kindIcon} ${esc(t.org || "")}</span>
      ${t.deadline ? `<span class="badge ${n != null && n <= 7 ? "bad" : n != null && n <= 21 ? "warn" : ""}">${n != null && n < 0 ? "Passed" : `Due ${fmtShort(t.deadline)}${n != null ? ` (${n}d)` : ""}`}</span>` : ""}</div>
    <div class="title" style="margin:3px 0">${esc(t.title)}</div>
    ${t.location ? `<div class="small muted">📍 ${esc(t.location)}</div>` : ""}
    <div class="row" style="margin-top:10px">
      <select class="sel status-sel" data-act="status">${STATUSES.map((s) => `<option ${s === t.status ? "selected" : ""}>${s}</option>`).join("")}</select>
      <input type="date" data-act="deadline" value="${esc((t.deadline || "").slice(0, 10))}" style="width:auto">
      ${t.url ? `<a class="btn sm" href="${esc(t.url)}" target="_blank" rel="noopener">Open ↗</a>` : ""}
    </div>
    ${t.kind === "grad" || t.req ? checklistHtml(t.id) : ""}
    <details ${t.notes ? "open" : ""}><summary>Notes${t.history?.length ? ` · ${t.history.length} updates` : ""}</summary>
      <textarea data-act="notes" placeholder="Referral, recruiter name, OA date, password hint…">${esc(t.notes || "")}</textarea>
      ${t.history?.length ? `<div class="tiny muted" style="margin-top:6px">${t.history.map((h) => `${esc(h.status)} · ${fmtShort(h.at)}`).join(" → ")}</div>` : ""}
      <button class="btn sm ghost" data-act="remove" style="margin-top:6px;color:var(--bad)">Remove</button>
    </details></div>`;
}

// ------------------------------------------------------------------ sheets
function sheet(html) {
  const bg = document.createElement("div");
  bg.className = "sheet-bg";
  bg.innerHTML = `<div class="sheet">${html}</div>`;
  bg.addEventListener("click", (e) => { if (e.target === bg || e.target.dataset.close !== undefined) bg.remove(); });
  document.body.appendChild(bg);
  return bg;
}

function openSettings() {
  const failing = S.companies.filter((c) => c.ok === false);
  const bg = sheet(`
    <h3>Settings</h3>
    <div class="card">
      <div class="title">🔄 Sync tracker (phone ↔ laptop ↔ Chrome extension)</div>
      <p class="small muted">Your tracker lives in a <b>secret GitHub gist</b>. Create a GitHub token with only the <code>gist</code> scope, paste it here, then press “Create tracker” once. On your other devices, paste the same token + Gist ID.</p>
      ${Push.isIOS() && !Sync.on() ? `<p class="small" style="background:var(--warn-soft);color:var(--warn);padding:8px 10px;border-radius:10px">📱 On iPhone, the Home Screen app has its <b>own storage, separate from Safari</b>. If you already created the tracker in Safari, paste the same token + Gist ID here and tap <b>Save &amp; sync</b>. Don't press Create again.</p>` : ""}
      <div class="field"><label>GitHub token (gist scope)</label><input id="s-token" type="password" autocomplete="off" value="${esc(Sync.token)}" placeholder="ghp_…"></div>
      <div class="field"><label>Gist ID</label><input id="s-gist" value="${esc(Sync.gist)}" placeholder="Leave empty, then press Create"></div>
      <div class="row"><button class="btn primary sm" id="s-save">Save & sync</button><button class="btn sm" id="s-create">Create tracker</button>
      <a class="btn sm ghost" href="https://github.com/settings/tokens/new?scopes=gist&description=Apply%20Hub%20${encodeURIComponent(Push.deviceName() + " " + new Date().toLocaleString("en-GB"))}" target="_blank" rel="noopener">Get a token ↗</a></div>
      <p class="sync" id="sync-state">${Sync.label()}</p>
    </div>
    <div class="card">
      <div class="title">🔔 Notifications on this device</div>
      <p class="small muted" id="push-state">${Push.enabled() ? "✓ On. New internships, page changes and the 9am deadline brief arrive here." : esc(Push.blocker() || "Off. Tap the button to turn them on.")}</p>
      <div class="row"><button class="btn sm primary" id="s-push" ${Push.blocker() && !Push.enabled() ? "disabled" : ""}>${Push.enabled() ? "Re-register this device" : "Turn on notifications"}</button>
      ${Push.enabled() ? `<button class="btn sm ghost" id="s-push-off">Turn off</button>` : ""}</div>
    </div>
    <div class="card">
      <div class="title">📦 Your data</div>
      <div class="row" style="margin-top:8px"><button class="btn sm" id="s-export">Export tracker (JSON)</button><label class="btn sm">Import<input type="file" id="s-import" accept="application/json" hidden></label></div>
    </div>
    <div class="card small">
      <div class="title">🤖 Scanner</div>
      <p class="muted">Last scan: ${S.meta.last_scan ? `${fmtDate(S.meta.last_scan)} (${ago(S.meta.last_scan)})` : "never"} · ${S.meta.companies_ok || 0} sources OK${failing.length ? ` · failing: ${esc(failing.map((c) => c.name).join(", "))}` : ""}</p>
      <table class="src">${S.companies.filter((c) => c.ats !== "manual").map((c) => `<tr><td>${esc(c.name)}</td><td class="muted">${esc(c.ats)}</td><td>${c.ok ? `${c.open_internships} open` : `<span class="badge bad">error</span>`}</td></tr>`).join("")}</table>
    </div>
    <button class="btn" data-close style="width:100%">Close</button>`);
  $("#s-push", bg).onclick = async (e) => {
    e.target.disabled = true; e.target.textContent = "Turning on…";
    try { await Push.enable(); toast("Notifications on ✓"); bg.remove(); openSettings(); route(); }
    catch (err) { $("#push-state", bg).textContent = err.message; e.target.disabled = false; e.target.textContent = "Turn on notifications"; }
  };
  const off = $("#s-push-off", bg);
  if (off) off.onclick = async () => { await Push.disable(); toast("Notifications off"); bg.remove(); openSettings(); route(); };
  const reopen = () => { bg.remove(); openSettings(); };
  $("#s-save", bg).onclick = async () => {
    Sync.token = $("#s-token", bg).value.trim();
    const g = $("#s-gist", bg).value.trim();
    Sync.gist = (g.match(/[0-9a-f]{20,}/i) || [g])[0];  // accepts a full gist link too
    LS.set("gh_token", Sync.token); LS.set("gist_id", Sync.gist);
    if (Sync.on()) { await Sync.pull(); await Sync.push(); toast(Sync.state === "synced" ? "Synced ✓" : "Sync failed"); route(); reopen(); }
  };
  $("#s-create", bg).onclick = async () => {
    Sync.token = $("#s-token", bg).value.trim(); LS.set("gh_token", Sync.token);
    if (!Sync.token) return toast("Paste a token first");
    try { const id = await Sync.create(); $("#s-gist", bg).value = id; Sync.setState("synced"); toast("Tracker created ✓ Gist ID copied"); navigator.clipboard?.writeText(id).catch(() => {}); reopen(); }
    catch (e) { toast(e.message); }
  };
  $("#s-export", bg).onclick = () => {
    const a = document.createElement("a");
    a.href = URL.createObjectURL(new Blob([JSON.stringify(S.tracker, null, 1)], { type: "application/json" }));
    a.download = `apply-hub-tracker-${todayStr()}.json`; a.click();
  };
  $("#s-import", bg).onchange = async (e) => {
    const file = e.target.files[0]; if (!file) return;
    try { Sync.merge(JSON.parse(await file.text())); Sync.save(); toast("Imported ✓"); route(); } catch { toast("Not a valid tracker file"); }
  };
}

function openAddCustom() {
  const bg = sheet(`
    <h3>Add to tracker</h3>
    <div class="field"><label>What</label><input id="c-title" placeholder="e.g. Research internship: Prof. X's lab"></div>
    <div class="field"><label>Organisation</label><input id="c-org" placeholder="e.g. EPFL"></div>
    <div class="field"><label>Link</label><input id="c-url" type="url" placeholder="https://…"></div>
    <div class="field"><label>Type</label><select id="c-kind"><option value="custom">Other</option><option value="job">Internship</option><option value="grad">Grad program</option><option value="research">Research</option></select></div>
    <div class="field"><label>Deadline</label><input id="c-deadline" type="date"></div>
    <div class="field"><label>Status</label><select id="c-status">${STATUSES.map((s) => `<option>${s}</option>`).join("")}</select></div>
    <div class="row"><button class="btn primary" id="c-save">Add</button><button class="btn" data-close>Cancel</button></div>`);
  $("#c-save", bg).onclick = () => {
    const title = $("#c-title", bg).value.trim();
    if (!title) return toast("Give it a name");
    upsertTrack("custom:" + Date.now(), { kind: $("#c-kind", bg).value, title, org: $("#c-org", bg).value.trim(),
      url: $("#c-url", bg).value.trim(), deadline: $("#c-deadline", bg).value, status: $("#c-status", bg).value, checklist: {} });
    bg.remove(); route(); toast("Added ✓");
  };
}

// ------------------------------------------------------------------ routing + events
const VIEWS = { today: renderToday, jobs: renderJobs, grad: renderGrad, research: renderResearch, tracker: renderTracker };
function route() {
  const tab = (location.hash || "#today").slice(1).split("?")[0];
  const v = VIEWS[tab] ? tab : "today";
  document.querySelectorAll("nav.tabs a").forEach((a) => a.classList.toggle("on", a.dataset.tab === v));
  const y = window.scrollY;
  $("#view").innerHTML = VIEWS[v]();
  if (route._last === v) window.scrollTo(0, y); else window.scrollTo(0, 0);
  route._last = v;
  if (v === "jobs") { const q = $("#q"); if (q) q.oninput = (e) => { S.f.q = e.target.value; saveFilters(); clearTimeout(route._qt); route._qt = setTimeout(() => { route(); const n = $("#q"); n.focus(); n.setSelectionRange(n.value.length, n.value.length); }, 250); }; }
}

document.addEventListener("click", (e) => {
  const el = e.target.closest("[data-act]");
  if (!el) return;
  const act = el.dataset.act, card = el.closest(".trk"), id = el.dataset.id;
  if (act === "filter") { S.f[el.dataset.k] = el.dataset.v; saveFilters(); route(); }
  else if (act === "toggle") { S.f[el.dataset.k] = !S.f[el.dataset.k]; saveFilters(); route(); }
  else if (act === "new-only") { S.f.newOnly = true; saveFilters(); }
  else if (act === "track-job") { const j = S.jobs.find((x) => x.id === id); if (trackedFor(id)) location.hash = "#tracker"; else { trackJob(j); toast("Added to tracker"); route(); } }
  else if (act === "track-grad") { const p = S.grad.find((x) => x.id === id); if (trackedFor("grad:" + id)) location.hash = "#tracker"; else { trackGrad(p); toast("Added to tracker"); route(); } }
  else if (act === "track-research") { const p = S.research.find((x) => x.id === id); if (trackedFor("research:" + id)) location.hash = "#tracker"; else { trackResearch(p); toast("Added to tracker"); route(); } }
  else if (act === "add-custom") openAddCustom();
  else if (act === "open-settings") openSettings();
  else if (act === "pdf-picker") openPdfPicker();
  else if (act === "remove" && card && confirm("Remove from tracker?")) { removeTrack(card.dataset.id); route(); }
});
document.addEventListener("change", (e) => {
  const el = e.target, act = el.dataset.act, card = el.closest(".trk");
  if (act === "sort") { S.f[el.dataset.k] = el.value; saveFilters(); route(); return; }
  if (act === "cl-check") {
    const tid = el.dataset.tid, wasTracked = !!trackedFor(tid);
    ensureTracked(tid);
    const t = trackedFor(tid);
    if (!t) return;
    upsertTrack(tid, { checklist: { ...(t.checklist || {}), [el.dataset.c]: el.checked } });
    openChecklists.add(tid);
    if (!wasTracked) { toast("Added to tracker"); route(); return; }
    const det = el.closest("details.cl"), cl = checklistFor(tid);
    const done = cl.items.filter((i) => trackedFor(tid).checklist?.[i.id]).length;
    det.querySelector(".cl-count").textContent = `${done}/${cl.items.length}`;
    const badge = det.querySelector("summary .badge");
    if (badge) { const pct = Math.round((done / cl.items.length) * 100); badge.textContent = pct + "%"; badge.classList.toggle("good", pct === 100); }
    return;
  }
  if (act === "cl-pdf") {
    const tid = el.dataset.tid, p = programFor(tid), t = trackedFor(tid);
    handleChecklistPdf(tid, p ? `${p.university}: ${p.program}` : `${t?.org || ""}: ${t?.title || ""}`, el.files[0]);
    el.value = "";
    return;
  }
  if (!card) return;
  const id = card.dataset.id;
  if (act === "status") { upsertTrack(id, { status: el.value }); toast(`→ ${el.value}`); route(); }
  else if (act === "deadline") { upsertTrack(id, { deadline: el.value }); route(); }
  else if (act === "check") { const t = trackedFor(id); upsertTrack(id, { checklist: { ...(t.checklist || {}), [el.dataset.c]: el.checked } }); }
  else if (act === "notes") { upsertTrack(id, { notes: el.value }); }
});

window.addEventListener("hashchange", () => {
  if (route._last === "jobs") { S.lastVisit = new Date().toISOString(); LS.set("last_visit", S.lastVisit); }
  route();
});
$("#btn-settings").onclick = openSettings;
$("#btn-refresh").onclick = async () => { toast("Refreshing…"); await Promise.all([loadData(), Sync.pull()]); route(); };

(async function init() {
  if ("serviceWorker" in navigator) navigator.serviceWorker.register("sw.js").catch(() => {});
  await loadData();
  route();
  if (Sync.on()) { await Sync.pull(); route(); Push.refresh(); }
  document.addEventListener("visibilitychange", async () => {
    if (document.visibilityState === "visible") { await Promise.all([loadData(), Sync.pull()]); route(); }
  });
})();
