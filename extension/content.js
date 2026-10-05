/* Apply Hub Autofill: content script.
 * Finds form fields, works out what each one asks (label, aria, placeholder, name...),
 * fills it from your profile / answer bank, attaches your CV, and highlights:
 *   green  = filled by Apply Hub
 *   orange = required and still empty (needs you)
 * It never submits anything.
 */
(() => {
  if (window.__applyHubLoaded) return;
  window.__applyHubLoaded = true;

  const ATS_HOSTS = /greenhouse\.io|lever\.co|ashbyhq\.com|myworkdayjobs\.com|workday\.com|smartrecruiters\.com|workable\.com|icims\.com|taleo\.net|successfactors|oraclecloud\.com|jobvite\.com|teamtailor\.com|recruitee\.com|personio\.|bamboohr\.com|eightfold\.ai|careers\.microsoft\.com|amazon\.jobs|janestreet\.com|avature\.net|join\.com|applytojob\.com|breezy\.hr/;
  const FILLABLE = 'input:not([type=hidden]):not([type=submit]):not([type=button]):not([type=reset]):not([type=image]):not([type=password]):not([type=checkbox]), textarea, select, button[aria-haspopup="listbox"]';
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const norm = (s) => String(s || "").replace(/([a-z])([A-Z])/g, "$1 $2").replace(/[_\-\[\]\.]+/g, " ").replace(/\s+/g, " ").trim().toLowerCase();
  const visible = (el) => { const r = el.getBoundingClientRect(); const s = getComputedStyle(el); return r.width > 0 && r.height > 0 && s.visibility !== "hidden" && s.display !== "none"; };

  // ---------------------------------------------------------------- describe a field
  function labelText(el) {
    const parts = [];
    if (el.id) {
      try { document.querySelectorAll(`label[for="${CSS.escape(el.id)}"]`).forEach((l) => parts.push(l.innerText)); } catch {}
    }
    const wrap = el.closest("label"); if (wrap) parts.push(wrap.innerText);
    const lb = el.getAttribute("aria-labelledby");
    if (lb) lb.split(/\s+/).forEach((id) => { const n = document.getElementById(id); if (n) parts.push(n.innerText); });
    if (el.getAttribute("aria-label")) parts.push(el.getAttribute("aria-label"));
    if (!parts.join("").trim()) {
      // walk up to find the question text near this field
      let node = el;
      for (let i = 0; i < 6 && node.parentElement; i++) {
        node = node.parentElement;
        const nInputs = node.querySelectorAll(FILLABLE).length;
        const lab = node.querySelector("label, legend, .application-label, [class*='label' i], [class*='question' i], [data-automation-id*='formLabel'], h3, h4");
        if (lab && !lab.contains(el) && lab.innerText && lab.innerText.trim().length < 400) { parts.push(lab.innerText); break; }
        if (nInputs > 3) break;
      }
    }
    if (el.type === "radio") {
      const fs = el.closest("fieldset"); const lg = fs && fs.querySelector("legend");
      if (lg) parts.unshift(lg.innerText);
    }
    return norm(parts.join(" ").replace(/\*/g, " "));
  }
  function attrText(el) {
    return norm([el.name, el.id, el.getAttribute("data-automation-id"), el.getAttribute("data-qa"), el.placeholder, el.getAttribute("autocomplete"), el.title].filter(Boolean).join(" "));
  }

  const AUTOCOMPLETE = { "given-name": "first_name", "family-name": "last_name", "email": "email", "tel": "phone", "tel-national": "phone", "postal-code": "postal_code", "address-line1": "address", "street-address": "address", "address-level2": "city", "country-name": "country", "country": "country", "bday": "dob", "name": "full_name", "url": "website" };

  function ruleFor(el) {
    const label = labelText(el), attrs = attrText(el);
    const ac = (el.getAttribute("autocomplete") || "").toLowerCase();
    const ctx = { text: label || attrs, placeholder: norm(el.placeholder), inputType: (el.type || "").toLowerCase(),
                  isSelect: el.tagName === "SELECT" || el.getAttribute("aria-haspopup") === "listbox" || el.getAttribute("role") === "combobox",
                  wantsFullPhone: false, wantsScale: /scale|out of/.test(label) };
    if (AUTOCOMPLETE[ac]) return { rule: AH_RULES.find((r) => r.key === AUTOCOMPLETE[ac]) || { key: AUTOCOMPLETE[ac] }, ctx, label };
    for (const text of [label, attrs]) {
      if (!text) continue;
      ctx.text = text;
      for (const r of AH_RULES) if (r.re.test(text) && !(r.not && r.not.test(text))) return { rule: r, ctx, label };
    }
    return { rule: null, ctx, label: label || attrs };
  }

  // ---------------------------------------------------------------- set values (React/Vue/Angular friendly)
  function setNative(el, value) {
    const proto = el.tagName === "TEXTAREA" ? HTMLTextAreaElement.prototype : el.tagName === "SELECT" ? HTMLSelectElement.prototype : HTMLInputElement.prototype;
    const setter = Object.getOwnPropertyDescriptor(proto, "value").set;
    el.focus({ preventScroll: true });
    setter.call(el, value);
    el.dispatchEvent(new Event("input", { bubbles: true }));
    el.dispatchEvent(new Event("change", { bubbles: true }));
    el.dispatchEvent(new Event("blur", { bubbles: true }));
  }

  const YES = /^(yes|oui|ja|si|sí|true|y)\b/i, NO = /^(no|non|nein|false|n)\b/i;
  const DECLINE = /decline|prefer not|don.?t wish|do not wish|not to (say|answer|disclose)|rather not|choose not/i;
  function bestOption(options, value) {
    // options: [{text, el}] -> best match for value
    const v = String(value || "").trim().toLowerCase();
    if (!v) return null;
    const clean = options.filter((o) => o.text && !/^(select|choose|please select|--|—)/i.test(o.text));
    const t = (o) => o.text.trim().toLowerCase();
    return clean.find((o) => t(o) === v)
      || (YES.test(v) && clean.find((o) => YES.test(t(o))))
      || (NO.test(v) && clean.find((o) => NO.test(t(o))))
      || (DECLINE.test(v) && clean.find((o) => DECLINE.test(t(o))))
      || clean.find((o) => t(o).startsWith(v))
      || clean.find((o) => t(o).includes(v))
      || clean.find((o) => v.includes(t(o)) && t(o).length > 2)
      || null;
  }

  async function fillListbox(btn, value) {
    // Workday-style <button aria-haspopup=listbox> dropdowns
    btn.click();
    await sleep(350);
    const opts = [...document.querySelectorAll('[role="option"]')].filter(visible).map((o) => ({ text: o.innerText, el: o }));
    const best = bestOption(opts, value);
    if (best) { best.el.click(); await sleep(150); return true; }
    document.body.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    return false;
  }

  async function fillCombobox(el, value) {
    // react-select / Ashby / Greenhouse comboboxes: type, then pick the option
    setNative(el, String(value));
    el.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowDown", bubbles: true }));
    await sleep(500);
    const opts = [...document.querySelectorAll('[role="option"], .select__option, [class*="option" i]')].filter(visible).map((o) => ({ text: o.innerText, el: o }));
    const best = bestOption(opts, value) || (opts.length === 1 ? opts[0] : null);
    if (best) { best.el.dispatchEvent(new MouseEvent("mousedown", { bubbles: true })); best.el.click(); await sleep(150); return true; }
    return false;
  }

  async function fillOne(el, value) {
    if (value == null || value === "") return false;
    if (el.tagName === "SELECT") {
      const best = bestOption([...el.options].map((o) => ({ text: o.text, el: o })), value);
      if (!best) return false;
      setNative(el, best.el.value);
      return true;
    }
    if (el.tagName === "BUTTON") return fillListbox(el, value);
    if (el.getAttribute("role") === "combobox" || el.getAttribute("aria-autocomplete") === "list") return fillCombobox(el, value);
    setNative(el, String(value));
    return true;
  }

  async function fillRadioGroup(radios, value) {
    const opts = radios.map((r) => {
      const l = (r.id && document.querySelector(`label[for="${CSS.escape(r.id)}"]`)) || r.closest("label");
      return { text: (l ? l.innerText : r.value) || r.value, el: r };
    });
    const best = bestOption(opts, value);
    if (!best) return false;
    best.el.click();
    return true;
  }

  // ---------------------------------------------------------------- answer bank
  const STOP = new Set("a an the to of for in on at and or you your are is do does did with this that what why how which would please describe tell us about".split(" "));
  const words = (s) => new Set(norm(s).replace(/[^a-z0-9à-ÿ ]/g, " ").split(" ").filter((w) => w.length > 2 && !STOP.has(w)));
  function matchAnswer(label, bank) {
    const L = words(label); if (L.size < 2) return null;
    let best = null, score = 0;
    for (const a of bank) {
      if (!a.a || !a.a.trim()) continue;
      const Q = words(a.q); if (!Q.size) continue;
      const inter = [...Q].filter((w) => L.has(w)).length;
      const s = inter / Math.min(Q.size, L.size);
      if (s > score) { score = s; best = a; }
    }
    return score >= 0.6 ? best : null;
  }
  function pageContext() {
    const t = document.title || "";
    let company = (document.querySelector('meta[property="og:site_name"]') || {}).content || "";
    const m = t.match(/(?:at|@|chez|bei)\s+([^|\-–—]+)/i);
    if (m) company = m[1].trim();
    const gh = location.pathname.match(/greenhouse\.io\/([^/]+)/) || location.href.match(/boards\.greenhouse\.io\/([^/?]+)/) || location.href.match(/jobs\.(?:lever\.co|ashbyhq\.com)\/([^/?]+)/);
    if (!company && gh) company = gh[1];
    const h1 = document.querySelector("h1, .posting-headline h2, [data-automation-id='jobPostingHeader']");
    const role = (h1 && h1.innerText.trim().slice(0, 120)) || t.split(/[|\-–—]/)[0].trim();
    return { company: company.replace(/careers?|jobs?/ig, "").trim(), role };
  }
  const fillTemplate = (s, ctx) => String(s).replace(/\{company\}/gi, ctx.company || "your company").replace(/\{role\}/gi, ctx.role || "this role");

  // ---------------------------------------------------------------- files
  async function attachFiles(docs, report) {
    for (const input of document.querySelectorAll('input[type="file"]')) {
      if (input.files && input.files.length) continue;
      const ctx = norm(labelText(input) + " " + attrText(input) + " " + (input.closest("div,section,fieldset")?.innerText || "").slice(0, 200));
      const doc = /cover/.test(ctx) ? docs.cover : /transcript|grade|relev[ée]|marks/.test(ctx) ? docs.transcript : /resume|cv\b|curriculum|lebenslauf/.test(ctx) ? docs.cv : null;
      if (!doc) continue;
      try {
        const blob = await (await fetch(doc.data)).blob();
        const dt = new DataTransfer();
        dt.items.add(new File([blob], doc.name, { type: doc.type || blob.type }));
        input.files = dt.files;
        input.dispatchEvent(new Event("input", { bubbles: true }));
        input.dispatchEvent(new Event("change", { bubbles: true }));
        report.files.push(doc.name);
        const box = input.closest("div") || input; box.style.outline = "2px solid #2f9e44";
      } catch (e) { console.warn("Apply Hub: could not attach", e); }
    }
  }

  // ---------------------------------------------------------------- main fill
  async function fill() {
    const { profile = {}, answers = [], docs = {} } = await chrome.storage.local.get(["profile", "answers", "docs"]);
    if (!profile.first_name && !profile.email) { showToast("Set up your profile first: click the Apply Hub icon → Profile"); return { filled: 0, attention: 0 }; }
    const ctxPage = pageContext();
    const report = { filled: 0, attention: 0, answers: 0, files: [], unknown: [] };
    const els = [...document.querySelectorAll(FILLABLE)].filter((el) => visible(el) && !el.disabled && !el.readOnly);
    const radiosDone = new Set();

    for (const el of els) {
      const isEmpty = el.tagName === "SELECT" ? (el.selectedIndex <= 0 || !el.value) : el.tagName === "BUTTON" ? /select|choose|^\s*$/i.test(el.innerText) : !el.value;
      if (!isEmpty) continue;
      if (el.type === "radio" || el.type === "file") continue;
      const { rule, ctx, label } = ruleFor(el);
      let value = null;
      if (rule) value = rule.value ? rule.value(profile, ctx) : profile[rule.key];
      if ((value == null || value === "") && (el.tagName === "TEXTAREA" || (label && label.length > 25))) {
        const a = matchAnswer(label, answers);
        if (a) { value = fillTemplate(a.a, ctxPage); report.answers++; }
      }
      if (value != null && value !== "" && await fillOne(el, value)) {
        report.filled++;
        el.style.outline = "2px solid #2f9e44"; el.style.outlineOffset = "1px";
        el.dataset.applyHub = "filled";
      } else if (label) report.unknown.push(label.slice(0, 80));
    }

    // radio groups (yes/no questions, EEO, etc.)
    for (const r of document.querySelectorAll('input[type="radio"]')) {
      if (!r.name || radiosDone.has(r.name) || !visible(r)) continue;
      radiosDone.add(r.name);
      const group = [...document.querySelectorAll(`input[type="radio"][name="${CSS.escape(r.name)}"]`)];
      if (group.some((g) => g.checked)) continue;
      const { rule, ctx } = ruleFor(r);
      const value = rule ? (rule.value ? rule.value(profile, ctx) : profile[rule.key]) : null;
      if (value && await fillRadioGroup(group, value)) {
        report.filled++;
        const box = r.closest("fieldset") || r.parentElement; box.style.outline = "2px solid #2f9e44";
      }
    }

    await attachFiles(docs, report);

    // highlight what still needs a human
    for (const el of document.querySelectorAll(FILLABLE + ', input[type="checkbox"], input[type="radio"]')) {
      if (!visible(el)) continue;
      let starred = false;
      try { const l = (el.id && document.querySelector(`label[for="${CSS.escape(el.id)}"]`)) || el.closest("label"); starred = !!(l && l.innerText.includes("*")); } catch {}
      const required = el.required || el.getAttribute("aria-required") === "true" || starred;
      const empty = el.type === "checkbox" || el.type === "radio" ? false : el.tagName === "SELECT" ? !el.value : el.tagName === "BUTTON" ? false : !el.value;
      if (required && empty) { el.style.outline = "2px solid #f08c00"; el.style.outlineOffset = "1px"; report.attention++; }
    }
    if (report.filled || report.files.length) {
      showToast(`Apply Hub filled ${report.filled} field(s)${report.files.length ? ` + attached ${report.files.join(", ")}` : ""}${report.answers ? ` · ${report.answers} from your answer bank` : ""}${report.attention ? ` · ${report.attention} still need you (orange)` : ""}. Review, then submit yourself.`);
    }
    return report;
  }

  // ---------------------------------------------------------------- UI bits
  function showToast(msg) {
    if (window.top !== window && !document.querySelector("form")) return;
    let t = document.getElementById("__applyhub_toast");
    if (!t) {
      t = document.createElement("div"); t.id = "__applyhub_toast";
      t.style.cssText = "position:fixed;z-index:2147483647;right:16px;bottom:76px;max-width:360px;background:#14171c;color:#fff;font:14px/1.4 system-ui,sans-serif;padding:12px 14px;border-radius:12px;box-shadow:0 6px 24px rgba(0,0,0,.25)";
      document.documentElement.appendChild(t);
    }
    t.textContent = msg; t.style.display = "block";
    clearTimeout(showToast._t); showToast._t = setTimeout(() => (t.style.display = "none"), 9000);
  }

  async function maybeShowButton() {
    const { settings = {} } = await chrome.storage.local.get("settings");
    const onAts = ATS_HOSTS.test(location.hostname + location.pathname);
    if (!onAts && !settings.showEverywhere) return;
    const count = [...document.querySelectorAll(FILLABLE)].filter(visible).length;
    if (count < 3 || document.getElementById("__applyhub_btn")) return;
    const b = document.createElement("button");
    b.id = "__applyhub_btn"; b.type = "button"; b.textContent = "⚡ Autofill";
    b.title = "Apply Hub: fill this application (Alt+Shift+F)";
    b.style.cssText = "position:fixed;z-index:2147483646;right:16px;bottom:16px;background:#3b5bdb;color:#fff;border:0;border-radius:999px;padding:12px 18px;font:600 14px system-ui,sans-serif;box-shadow:0 6px 20px rgba(59,91,219,.45);cursor:pointer";
    b.onclick = async () => { b.textContent = "Filling…"; await fill(); b.textContent = "⚡ Autofill again"; };
    document.documentElement.appendChild(b);
  }

  // remember the last focused editable field for "Save answer" (context menu)
  let lastFocused = null;
  document.addEventListener("focusin", (e) => { if (e.target.matches("input, textarea, [contenteditable]")) lastFocused = e.target; }, true);

  chrome.runtime.onMessage.addListener((msg, _sender, reply) => {
    if (msg.type === "AH_FILL") { fill().then((r) => reply(r)); return true; }
    if (msg.type === "AH_SAVE_ANSWER" && lastFocused) {
      const q = labelText(lastFocused) || attrText(lastFocused);
      const a = lastFocused.value || lastFocused.innerText || "";
      if (!a.trim()) { showToast("Type your answer first, then right-click → Save answer."); return; }
      chrome.storage.local.get("answers").then(({ answers = [] }) => {
        const ctx = pageContext();
        const generic = ctx.company && ctx.company.length > 2 ? a.split(ctx.company).join("{company}") : a;
        answers.unshift({ q: q.slice(0, 300), a: generic, saved: new Date().toISOString(), from: location.hostname });
        chrome.storage.local.set({ answers }).then(() => showToast(`Saved to your answer bank ✓ ("${q.slice(0, 50)}…")`));
      });
    }
    if (msg.type === "AH_CONTEXT") reply(pageContext());
  });

  setTimeout(maybeShowButton, 1200);
  // single-page apps (Workday, Ashby) render forms late
  let tries = 0; const iv = setInterval(() => { maybeShowButton(); if (++tries > 10) clearInterval(iv); }, 2500);
})();
