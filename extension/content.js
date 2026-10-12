/* Apply Hub Autofill: content script.
 * 1. Fills fields it recognises from your profile (rules in fields.js)
 * 2. Reuses answers you gave before (answer bank, which learns from what you type)
 * 3. Anything still unknown is asked to YOU in a side panel, and remembered
 *
 *   green  = filled from your profile / saved answers
 *   orange = required and still empty
 * It never submits anything and never ticks consent boxes.
 */
(() => {
  if (window.__applyHubLoaded) return;
  window.__applyHubLoaded = true;

  const ATS_HOSTS = /greenhouse\.io|lever\.co|ashbyhq\.com|myworkdayjobs\.com|workday\.com|smartrecruiters\.com|workable\.com|icims\.com|taleo\.net|successfactors|oraclecloud\.com|jobvite\.com|teamtailor\.com|recruitee\.com|personio\.|bamboohr\.com|eightfold\.ai|careers\.microsoft\.com|amazon\.jobs|janestreet\.com|avature\.net|join\.com|applytojob\.com|breezy\.hr/;
  // Inputs + native selects + custom dropdown triggers (Workday buttons, div/span comboboxes)
  const FILLABLE = 'input:not([type=hidden]):not([type=submit]):not([type=button]):not([type=reset]):not([type=image]):not([type=password]):not([type=checkbox]), textarea, select, button[aria-haspopup="listbox"], [role="combobox"]:not(input)';
  const GRAD_HOSTS = /\.ac\.(uk|ae|at|be|il)$|\.edu(\.[a-z]{2})?$|ethz\.ch|epfl\.ch|uzh\.ch|polytechnique|ip-paris|universit|uni-[a-z]+\.de|tum\.de|tudelft\.nl|uva\.nl|kaust\.edu|mbzuai|eacea|technolutions|campusfrance|ens\.(fr|psl)|sorbonne|imperial\.ac|lse\.ac|ucl\.ac|ox\.ac|cam\.ac|ed\.ac/;
  const SENSITIVE = /password|passport (no|number)|card number|credit card|cvv|cvc|iban|account number|routing|\bssn\b|social security|national (id|insurance)|id number|tax (id|number)|security code/i;
  const GREEN = "2px solid #2f9e44", ORANGE = "2px solid #f08c00";

  let currentMode = "auto";
  function isGradSchoolPage() {
    if (currentMode === "grad") return true;
    if (currentMode === "internship") return false;
    if (ATS_HOSTS.test(location.hostname + location.pathname)) return false;
    if (GRAD_HOSTS.test(location.hostname)) return true;
    const text = (document.body?.innerText || "").slice(0, 6000);
    return /graduate admission|application for admission|master'?s (programme|program|degree)|programme of study|statement of purpose|letters? of recommendation|referee/i.test(text);
  }
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const norm = (s) => String(s || "").replace(/([a-z])([A-Z])/g, "$1 $2").replace(/[_\-\[\]\.]+/g, " ").replace(/\s+/g, " ").trim().toLowerCase();
  const visible = (el) => { const r = el.getBoundingClientRect(); const s = getComputedStyle(el); return r.width > 0 && r.height > 0 && s.visibility !== "hidden" && s.display !== "none"; };
  const mark = (el, outline) => {
    let t = el;
    if (el.type === "file" || el.type === "radio") t = el.closest("fieldset") || el.parentElement;
    else if (el.tagName === "INPUT" && el.getAttribute("role") === "combobox") t = el.closest('[class*="control" i]') || el.parentElement; // react-select etc.
    else if (el.tagName === "SELECT" && (!visible(el) || el.classList.contains("select2-hidden-accessible"))) t = el.nextElementSibling?.matches?.(".select2, .select2-container, .chosen-container") ? el.nextElementSibling : (el.closest(".choices") || el);
    t.style.outline = outline; t.style.outlineOffset = "1px";
  };

  // ---------------------------------------------------------------- describe a field
  function labelParts(el) {
    const parts = [];
    if (el.id) {
      try { document.querySelectorAll(`label[for="${CSS.escape(el.id)}"]`).forEach((l) => parts.push(l.innerText)); } catch {}
    }
    const wrap = el.closest("label"); if (wrap) parts.push(wrap.innerText);
    for (const attr of ["aria-labelledby"]) {
      const lb = el.getAttribute(attr);
      if (lb) lb.split(/\s+/).forEach((id) => { const n = document.getElementById(id); if (n && n !== el) parts.push(n.innerText); });
    }
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
      const fs = el.closest("fieldset, [role=radiogroup]");
      const lg = fs && (fs.querySelector("legend") || (fs.getAttribute("aria-labelledby") && document.getElementById(fs.getAttribute("aria-labelledby"))));
      if (lg) parts.unshift(lg.innerText);
    }
    return parts;
  }
  const labelText = (el) => norm(labelParts(el).join(" ").replace(/\*/g, " "));
  const rawLabel = (el) => labelParts(el).join(" ").replace(/\s+/g, " ").replace(/\s*\*\s*$/, "").trim().slice(0, 300) || el.placeholder || el.name || "";
  function attrText(el) {
    return norm([el.name, el.id, el.getAttribute("data-automation-id"), el.getAttribute("data-qa"), el.placeholder, el.getAttribute("autocomplete"), el.title].filter(Boolean).join(" "));
  }
  const isRequired = (el) => {
    let starred = false;
    try { const l = (el.id && document.querySelector(`label[for="${CSS.escape(el.id)}"]`)) || el.closest("label"); starred = !!(l && l.innerText.includes("*")); } catch {}
    return el.required || el.getAttribute("aria-required") === "true" || starred;
  };

  const AUTOCOMPLETE = { "given-name": "first_name", "family-name": "last_name", "email": "email", "tel": "phone", "tel-national": "phone", "postal-code": "postal_code", "address-line1": "address", "street-address": "address", "address-level2": "city", "country-name": "country", "country": "country", "bday": "dob", "name": "full_name", "url": "website" };

  function ruleFor(el) {
    const label = labelText(el), attrs = attrText(el);
    const ac = (el.getAttribute("autocomplete") || "").toLowerCase();
    const ctx = { text: label || attrs, placeholder: norm(el.placeholder), inputType: (el.type || "").toLowerCase(),
                  isSelect: isDropdown(el), wantsFullPhone: false, wantsScale: /scale|out of/.test(label), gradSchool: isGradSchoolPage() };
    if (AUTOCOMPLETE[ac]) return { rule: AH_RULES.find((r) => r.key === AUTOCOMPLETE[ac]) || { key: AUTOCOMPLETE[ac] }, ctx, label };
    for (const text of [label, attrs]) {
      if (!text) continue;
      ctx.text = text;
      for (const r of AH_RULES) if (r.re.test(text) && !(r.not && r.not.test(text))) return { rule: r, ctx, label };
    }
    return { rule: null, ctx, label: label || attrs };
  }

  // ---------------------------------------------------------------- low-level events (React/Vue/Angular friendly)
  function nativeSet(el, value) {
    const proto = el.tagName === "TEXTAREA" ? HTMLTextAreaElement.prototype : el.tagName === "SELECT" ? HTMLSelectElement.prototype : HTMLInputElement.prototype;
    Object.getOwnPropertyDescriptor(proto, "value").set.call(el, value);
  }
  function setNative(el, value) {
    // plain text fields: set, notify, blur (so validation runs)
    el.focus({ preventScroll: true });
    nativeSet(el, value);
    el.dispatchEvent(new Event("input", { bubbles: true }));
    el.dispatchEvent(new Event("change", { bubbles: true }));
    el.dispatchEvent(new Event("blur", { bubbles: true }));
  }
  function typeText(el, text) {
    // search boxes inside dropdowns: NO blur/change, or the menu closes and clears the text
    el.focus({ preventScroll: true });
    nativeSet(el, text);
    el.dispatchEvent(new InputEvent("input", { bubbles: true, inputType: "insertText", data: text }));
    const k = text.slice(-1) || "a";
    el.dispatchEvent(new KeyboardEvent("keyup", { key: k, bubbles: true }));
  }
  function key(el, k) {
    const code = { Enter: 13, ArrowDown: 40, Escape: 27, Tab: 9 }[k] || 0;
    for (const t of ["keydown", "keyup"]) el.dispatchEvent(new KeyboardEvent(t, { key: k, code: k, keyCode: code, which: code, bubbles: true, cancelable: true }));
  }
  function realClick(el) {
    const r = el.getBoundingClientRect();
    const o = { bubbles: true, cancelable: true, view: window, clientX: r.left + r.width / 2, clientY: r.top + Math.min(r.height / 2, 12), button: 0 };
    el.dispatchEvent(new PointerEvent("pointerdown", { ...o, pointerType: "mouse" }));
    el.dispatchEvent(new MouseEvent("mousedown", o));
    el.dispatchEvent(new PointerEvent("pointerup", { ...o, pointerType: "mouse" }));
    el.dispatchEvent(new MouseEvent("mouseup", o));
    el.dispatchEvent(new MouseEvent("click", o));
  }

  // ---------------------------------------------------------------- matching an answer to dropdown options
  const YES = /^(yes|oui|ja|si|sí|true|y)\b/i, NO = /^(no|non|nein|false|n)\b/i;
  const DECLINE = /decline|prefer not|don.?t wish|do not wish|not to (say|answer|disclose)|rather not|choose not|not specified/i;
  const SYN = [
    ["bachelor", "bachelors", "bachelor's", "bsc", "bs", "ba", "be", "beng", "undergraduate", "licence", "license"],
    ["master", "masters", "master's", "msc", "ms", "ma", "meng", "graduate", "postgraduate"],
    ["lebanon", "lebanese republic", "lb", "lbn", "lebanese"],
    ["united kingdom", "uk", "great britain", "gb", "england"],
    ["united arab emirates", "uae", "emirates"],
    ["company website", "careers page", "career site", "website", "company careers site"],
  ];
  const clean = (s) => String(s || "").normalize("NFKD").replace(/[̀-ͯ]/g, "").replace(/[’‘`]/g, "'").replace(/\s+/g, " ").trim().toLowerCase();
  const toks = (s) => new Set(clean(s).replace(/[^a-z0-9' ]/g, " ").split(" ").filter((w) => w.length > 1));
  function bestOption(options, value) {
    // options: [{text, el}] -> best match for value
    const v = clean(value);
    if (!v) return null;
    const list = options.filter((o) => o.text && !/^(select|choose|please select|please choose|--|—|-|no options|no results|loading)/i.test(clean(o.text)));
    const t = (o) => clean(o.text);
    const syn = SYN.find((g) => g.some((x) => v === x || v.startsWith(x + " ")));
    const vt = toks(v);
    const overlap = (o) => { const ot = toks(o.text); const inter = [...vt].filter((w) => ot.has(w)).length; return inter / Math.max(1, Math.min(vt.size, ot.size)); };
    const byOverlap = [...list].sort((a, b) => overlap(b) - overlap(a))[0];
    return list.find((o) => t(o) === v)
      || (YES.test(v) && list.find((o) => YES.test(t(o))))
      || (NO.test(v) && list.find((o) => NO.test(t(o))))
      || (DECLINE.test(v) && list.find((o) => DECLINE.test(t(o))))
      || list.find((o) => t(o).startsWith(v))
      || list.find((o) => t(o).includes(v))
      || list.find((o) => v.includes(t(o)) && t(o).length > 2)
      || (syn && list.find((o) => syn.some((x) => t(o) === x || t(o).startsWith(x + " ") || t(o).startsWith(x + "'") || toks(o.text).has(x))))
      || (byOverlap && overlap(byOverlap) >= 0.5 ? byOverlap : null)
      || null;
  }

  // ---------------------------------------------------------------- custom dropdowns
  const isDropdown = (el) => el.tagName === "SELECT" || el.getAttribute("role") === "combobox" || /^(listbox|true)$/.test(el.getAttribute("aria-haspopup") || "") || el.getAttribute("aria-autocomplete") === "list";
  const OPTION_SEL = '[role="option"], .select2-results__option, .choices__item--choice, .chosen-results li, li[class*="option" i], div[class*="option" i], [data-automation-id="promptOption"], [data-automation-id="menuItem"]';
  function menuOptions(trigger, input) {
    // Prefer the listbox the control points at; fall back to any visible option on the page.
    const ids = [trigger, input].filter(Boolean).flatMap((e) => [e.getAttribute("aria-controls"), e.getAttribute("aria-owns")]).filter(Boolean).join(" ").split(/\s+/).filter(Boolean);
    let scopes = ids.map((id) => document.getElementById(id)).filter(Boolean);
    if (!scopes.length) scopes = [document];
    const out = [];
    for (const scope of scopes) out.push(...scope.querySelectorAll(OPTION_SEL));
    const cands = [...new Set(out)].filter((o) => visible(o) && o.innerText.trim() && o.innerText.trim().length < 160 && o.getAttribute("aria-disabled") !== "true" && !o.classList.contains("select2-results__option--disabled"));
    // keep the innermost elements only (an option, not the list that contains it)
    return cands.filter((o) => !cands.some((c) => c !== o && o.contains(c))).map((o) => ({ text: o.innerText.trim().split("\n")[0], el: o }));
  }
  async function waitPick(trigger, input, value, ms, allowSingle) {
    const t0 = Date.now();
    while (Date.now() - t0 < ms) {
      const opts = menuOptions(trigger, input);
      const best = bestOption(opts, value) || (allowSingle && opts.length === 1 ? opts[0] : null);
      if (best) return best;
      await sleep(120);
    }
    return null;
  }
  async function pickCustom(trigger, value) {
    // 1) open the menu
    const isInput = trigger.tagName === "INPUT";
    trigger.scrollIntoView({ block: "center" });
    realClick(trigger);
    if (isInput) { trigger.focus(); key(trigger, "ArrowDown"); }
    await sleep(150);
    // 2) find the search box (the trigger itself, one inside it, or the one that just got focus)
    let input = isInput ? trigger : trigger.querySelector("input");
    const ae = document.activeElement;
    if (!input && ae && ae.tagName === "INPUT" && ae !== trigger) input = ae;
    if (!input) input = document.querySelector(".select2-container--open .select2-search__field, .choices.is-open input, .chosen-with-drop input");
    // 3) options may already be listed
    let best = await waitPick(trigger, input, value, input ? 500 : 1400, false);
    // 4) otherwise type to filter (full value, then the first word)
    if (!best && input) {
      for (const term of [String(value), String(value).split(/[\s,(]/)[0]]) {
        if (!term) continue;
        typeText(input, term);
        best = await waitPick(trigger, input, value, 2200, true);
        if (best) break;
      }
    }
    if (best) {
      best.el.scrollIntoView({ block: "nearest" });
      realClick(best.el);
      await sleep(250);
      // some widgets only commit on Enter
      if (input && document.activeElement === input && input.value && menuOptions(trigger, input).length) key(input, "Enter");
      return true;
    }
    // give up cleanly: clear our typing and close the menu
    if (input) { typeText(input, ""); key(input, "Escape"); } else key(trigger, "Escape");
    document.body.dispatchEvent(new MouseEvent("mousedown", { bubbles: true }));
    return false;
  }

  async function fillOne(el, value) {
    if (value == null || value === "") return false;
    if (el.tagName === "SELECT") {
      const best = bestOption([...el.options].map((o) => ({ text: o.text, el: o })), value) ||
                   bestOption([...el.options].map((o) => ({ text: o.value, el: o })), value);
      if (!best) return false;
      el.focus({ preventScroll: true });
      nativeSet(el, best.el.value);
      best.el.selected = true;
      el.dispatchEvent(new Event("input", { bubbles: true }));
      el.dispatchEvent(new Event("change", { bubbles: true }));
      // jQuery-based widgets (select2, chosen) listen through jQuery
      try { if (window.jQuery) window.jQuery(el).trigger("change").trigger("chosen:updated"); } catch {}
      return true;
    }
    if (isDropdown(el)) return pickCustom(el, value);
    setNative(el, String(value));
    return true;
  }
  function radioOptions(radios) {
    return radios.map((r) => {
      const l = (r.id && document.querySelector(`label[for="${CSS.escape(r.id)}"]`)) || r.closest("label");
      return { text: ((l ? l.innerText : r.getAttribute("aria-label") || r.value) || r.value).trim(), el: r };
    });
  }
  async function fillRadioGroup(radios, value) {
    const best = bestOption(radioOptions(radios), value);
    if (!best) return false;
    realClick(best.el); if (!best.el.checked) best.el.click();
    return true;
  }
  // a hidden native <select> behind a custom widget (select2 / chosen / choices) is the real field
  const hiddenSelects = () => [...document.querySelectorAll("select")].filter((s) => !visible(s) && !s.disabled &&
    (s.classList.contains("select2-hidden-accessible") || (s.nextElementSibling && /select2|chosen|choices/.test(s.nextElementSibling.className || "")) || s.closest(".choices")));

  // ---------------------------------------------------------------- answer bank (incl. answers learned from you)
  const STOP = new Set("a an the to of for in on at and or you your are is do does did with this that what why how which would please describe tell us about".split(" "));
  const words = (s) => new Set(norm(s).replace(/[^a-z0-9à-ÿ ]/g, " ").split(" ").filter((w) => w.length > 2 && !STOP.has(w)));
  function matchAnswer(label, bank, strict) {
    const L = words(label); if (!L.size) return null;
    let best = null, score = 0;
    for (const a of bank) {
      if (!a.a || !String(a.a).trim()) continue;
      if (norm(a.q) === norm(label)) return a;
      const Q = words(a.q); if (!Q.size || L.size < 2) continue;
      const inter = [...Q].filter((w) => L.has(w)).length;
      const s = inter / Math.min(Q.size, L.size);
      if (s > score) { score = s; best = a; }
    }
    return score >= (strict ? 0.8 : 0.6) ? best : null;
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
  async function saveAnswer(q, a, extra = {}) {
    if (!q || !String(a).trim() || SENSITIVE.test(q)) return;
    const { answers = [] } = await chrome.storage.local.get("answers");
    const ctx = pageContext();
    const generic = ctx.company && ctx.company.length > 2 ? String(a).split(ctx.company).join("{company}") : String(a);
    const i = answers.findIndex((x) => norm(x.q) === norm(q));
    const entry = { q: q.slice(0, 300), a: generic, saved: new Date().toISOString(), from: location.hostname, ...extra };
    if (i >= 0) answers.splice(i, 1);
    answers.unshift(entry);
    await chrome.storage.local.set({ answers: answers.slice(0, 1000) });
  }

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
        mark(input.closest("div") || input, GREEN);
      } catch (e) { console.warn("Apply Hub: could not attach", e); }
    }
  }

  // ---------------------------------------------------------------- main fill
  const isEmptyField = (el) => el.tagName === "SELECT" ? (el.selectedIndex <= 0 || !el.value || /^(select|choose|--)/i.test(el.options[el.selectedIndex]?.text || ""))
    : el.tagName === "INPUT" || el.tagName === "TEXTAREA" ? !el.value
    : /^(\s*|select.*|choose.*|please select.*|--.*)$/i.test((el.innerText || "").trim());
  const isEssay = (el) => el.tagName === "TEXTAREA" && (el.rows >= 3 || el.maxLength > 400 || el.getBoundingClientRect().height > 70 || /why|describe|tell us|explain|motivation|statement|essay|cover letter/i.test(labelText(el)));

  async function fill(opts = {}) {
    const store = await chrome.storage.local.get(["profile", "answers", "docs", "settings"]);
    const { profile = {}, answers = [], docs = {} } = store;
    if (!profile.first_name && !profile.email) { showToast("Set up your profile first: click the Apply Hub icon → Profile"); return { filled: 0, attention: 0 }; }
    const ctxPage = pageContext();
    const report = { filled: 0, attention: 0, answers: 0, files: [], unknown: [] };
    const pending = []; // fields nobody knew yet -> you
    let qid = 0;
    const tag = (el) => (el.dataset.ahQid = el.dataset.ahQid || "q" + (++qid) + "_" + Date.now().toString(36));

    const els = [...document.querySelectorAll(FILLABLE)].filter((el) => visible(el) && !el.disabled && !el.readOnly && !el.closest("#__applyhub_panel"))
      .concat(hiddenSelects());
    const seen = new Set();
    const ONCE = new Set(["university", "degree", "major", "gpa", "gpa_scale", "grad_date", "edu_start"]);
    const usedKeys = new Set();

    for (const el of els) {
      if (seen.has(el) || el.type === "radio" || el.type === "file") continue;
      seen.add(el);
      // a search input inside a combobox widget is handled through the widget
      if (el.tagName === "INPUT" && el.closest('[role="combobox"]:not(input)') && el.closest('[role="combobox"]:not(input)') !== el) continue;
      if (!isEmptyField(el)) continue;
      const { rule, ctx, label } = ruleFor(el);
      if (rule && ONCE.has(rule.key) && usedKeys.has(rule.key + "|" + label)) { report.unknown.push(label.slice(0, 80)); continue; }
      let value = rule ? (rule.value ? rule.value(profile, ctx) : profile[rule.key]) : null;
      let fromBank = false;
      if (value == null || value === "") {
        const a = matchAnswer(rawLabel(el) || label, answers, !(el.tagName === "TEXTAREA" || label.length > 25));
        if (a) { value = fillTemplate(a.a, ctxPage); fromBank = true; }
      }
      if (value != null && value !== "" && await fillOne(el, value)) {
        report.filled++; if (fromBank) report.answers++;
        mark(el, GREEN); el.dataset.applyHub = "filled"; el.dataset.ahValue = String(value);
        if (rule) usedKeys.add(rule.key + "|" + label);
      } else {
        report.unknown.push(label.slice(0, 80));
        const options = el.tagName === "SELECT" ? [...el.options].map((o) => o.text.trim()).filter((t) => t && !/^(select|choose|--)/i.test(t)).slice(0, 80) : null;
        pending.push({ id: tag(el), el, label: rawLabel(el), type: el.tagName === "SELECT" ? "select" : isDropdown(el) ? "dropdown" : el.tagName === "TEXTAREA" ? "textarea" : (el.type || "text"),
                       options, required: isRequired(el), essay: isEssay(el), maxLength: el.maxLength > 0 ? el.maxLength : null });
      }
    }

    // radio groups (yes/no questions, EEO, etc.)
    const radiosDone = new Set();
    for (const r of document.querySelectorAll('input[type="radio"]')) {
      if (!r.name || radiosDone.has(r.name) || !visible(r)) continue;
      radiosDone.add(r.name);
      const group = [...document.querySelectorAll(`input[type="radio"][name="${CSS.escape(r.name)}"]`)];
      if (group.some((g) => g.checked)) continue;
      const { rule, ctx } = ruleFor(r);
      let value = rule ? (rule.value ? rule.value(profile, ctx) : profile[rule.key]) : null;
      if (!value) { const a = matchAnswer(rawLabel(r), answers, true); if (a) value = a.a; }
      if (value && await fillRadioGroup(group, value)) { report.filled++; mark(r, GREEN); }
      else pending.push({ id: tag(r), el: r, group, label: rawLabel(r), type: "radio", options: radioOptions(group).map((o) => o.text), required: group.some(isRequired), essay: false });
    }

    await attachFiles(docs, report);

    // ---- unknown fields: ask you (answers are remembered)
    const forUser = pending.filter((p) => !p.essay && p.label && !SENSITIVE.test(p.label));

    // highlight what still needs a human
    for (const el of document.querySelectorAll(FILLABLE + ', input[type="checkbox"], input[type="radio"]')) {
      if (!visible(el) || el.closest("#__applyhub_panel")) continue;
      const empty = el.type === "checkbox" || el.type === "radio" ? false : isEmptyField(el);
      if (isRequired(el) && empty) { mark(el, ORANGE); report.attention++; }
    }
    const required = forUser.filter((p) => p.required), optional = forUser.filter((p) => !p.required);
    if (forUser.length && opts.panel !== false) openAskPanel([...required, ...optional]);
    showToast(`Apply Hub filled ${report.filled} field(s)${report.files.length ? ` + attached ${report.files.join(", ")}` : ""}` +
      `${report.answers ? ` · ${report.answers} from your saved answers` : ""}` +
      `${forUser.length ? ` · ${forUser.length} question(s) for you →` : ""}. Review, then submit yourself.`);
    return report;
  }
  // ---------------------------------------------------------------- "needs you" side panel
  function openAskPanel(items) {
    document.getElementById("__applyhub_panel")?.remove();
    const host = document.createElement("div");
    host.id = "__applyhub_panel";
    host.style.cssText = "position:fixed;z-index:2147483647;top:12px;right:12px;width:360px;max-height:calc(100vh - 24px)";
    const root = host.attachShadow({ mode: "open" });
    root.innerHTML = `<style>
      *{box-sizing:border-box;font:13.5px/1.4 system-ui,-apple-system,"Segoe UI",sans-serif}
      .p{background:#fff;color:#14171c;border-radius:14px;box-shadow:0 10px 40px rgba(0,0,0,.25);max-height:calc(100vh - 24px);display:flex;flex-direction:column;overflow:hidden;border:1px solid #e3e6eb}
      .h{padding:12px 14px;background:#3b5bdb;color:#fff;display:flex;justify-content:space-between;align-items:center}
      .h b{font-size:14.5px}.x{background:none;border:0;color:#fff;font-size:18px;cursor:pointer}
      .b{overflow:auto;padding:6px 14px 14px}
      .q{border-bottom:1px solid #eef0f3;padding:10px 0}.q:last-child{border-bottom:0}
      .l{font-weight:650;margin-bottom:4px}.req{color:#c92a2a}.hint{color:#646b76;font-size:12px;margin-bottom:6px}
      input,select,textarea{width:100%;padding:7px 9px;border:1px solid #d0d4da;border-radius:9px;background:#f9fafb;color:#14171c}
      textarea{min-height:60px}
      .row{display:flex;gap:6px;margin-top:6px;align-items:center}
      button.f{background:#3b5bdb;color:#fff;border:0;border-radius:9px;padding:7px 12px;font-weight:600;cursor:pointer}
      button.s{background:#eef0f3;color:#14171c;border:0;border-radius:9px;padding:7px 10px;cursor:pointer}
      .opts{display:flex;flex-wrap:wrap;gap:5px}.opts button{background:#eef0f3;border:1px solid #d0d4da;border-radius:999px;padding:4px 10px;cursor:pointer;color:#14171c}
      .opts button:hover{background:#e8edff;border-color:#3b5bdb}
      label.r{font-size:12px;color:#646b76;display:flex;gap:5px;align-items:center;margin-top:6px}label.r input{width:auto}
      .done{color:#2f9e44;font-weight:600}
      @media (prefers-color-scheme: dark){.p{background:#171a1f;color:#e9ecf1;border-color:#2a2f37}.q{border-color:#2a2f37}
        input,select,textarea{background:#0e1013;color:#e9ecf1;border-color:#2a2f37}.opts button,button.s{background:#23272e;color:#e9ecf1;border-color:#2a2f37}.hint,label.r{color:#9aa3ae}}
    </style>
    <div class="p"><div class="h"><b>🙋 Apply Hub needs you (${items.length})</b><button class="x" title="Close">✕</button></div>
    <div class="b">${items.map((p, i) => `
      <div class="q" data-i="${i}">
        <div class="l">${esc(p.label)}${p.required ? ' <span class="req">*</span>' : ""}</div>
        ${p.hint ? `<div class="hint">${esc(p.hint)}</div>` : ""}
        ${p.options?.length ? `<div class="opts">${p.options.slice(0, 40).map((o) => `<button data-v="${esc(o)}">${esc(o)}</button>`).join("")}</div>`
          : `<${p.type === "textarea" ? "textarea" : "input"} placeholder="Your answer"${p.suggestion ? ` value="${esc(p.suggestion)}"` : ""}>${p.type === "textarea" ? esc(p.suggestion || "") + "</textarea>" : ""}
             <div class="row"><button class="f">Fill</button><button class="s skip">Skip</button></div>`}
        <label class="r"><input type="checkbox" class="rem" checked> Remember for next applications</label>
      </div>`).join("")}</div></div>`;
    const close = () => host.remove();
    root.querySelector(".x").onclick = close;
    const done = async (i, value) => {
      const p = items[i], q = root.querySelector(`.q[data-i="${i}"]`);
      const ok = p.type === "radio" ? await fillRadioGroup(p.group, value) : await fillOne(p.el, value);
      if (!ok) { q.querySelector(".l").insertAdjacentHTML("afterend", `<div class="hint" style="color:#c92a2a">Couldn't select that here. Please pick it on the page.</div>`); return; }
      mark(p.el, GREEN); p.el.dataset.applyHub = "you";
      if (q.querySelector(".rem").checked) await saveAnswer(p.label, value, { learned: true, type: p.type });
      q.innerHTML = `<div class="l">${esc(p.label)}</div><div class="done">✓ ${esc(String(value).slice(0, 120))}</div>`;
      if (![...root.querySelectorAll(".q")].some((x) => !x.querySelector(".done"))) setTimeout(close, 900);
    };
    root.querySelectorAll(".q").forEach((q) => {
      const i = +q.dataset.i;
      q.querySelectorAll(".opts button").forEach((b) => (b.onclick = () => done(i, b.dataset.v)));
      const f = q.querySelector("button.f"), inp = q.querySelector("input:not(.rem), textarea");
      if (f) f.onclick = () => inp.value.trim() && done(i, inp.value.trim());
      if (inp && inp.tagName === "INPUT") inp.onkeydown = (e) => { if (e.key === "Enter") f.click(); };
      const sk = q.querySelector(".skip"); if (sk) sk.onclick = () => q.remove();
    });
    document.documentElement.appendChild(host);
  }
  const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

  // ---------------------------------------------------------------- learn from what you type
  const PROFILE_LEARN = new Set(["address", "postal_code", "languages", "pronouns", "website", "scholar", "salary", "duration", "nationality", "city"]);
  let learnTimer = null, learnedCount = 0;
  document.addEventListener("change", async (e) => {
    const el = e.target;
    if (!el || !el.matches || !el.matches("input, select, textarea") || el.closest("#__applyhub_panel")) return;
    if (["password", "file", "hidden", "submit", "button"].includes(el.type) || /^cc-/.test(el.autocomplete || "")) return;
    if (el.type === "checkbox") return; // consents etc.
    if (el.dataset.applyHub === "filled" && el.value === el.dataset.ahValue) return; // our own fill
    const label = rawLabel(el);
    if (!label || label.length < 3 || SENSITIVE.test(label)) return;
    let value = el.tagName === "SELECT" ? el.options[el.selectedIndex]?.text?.trim() : el.type === "radio" ? (radioOptions([el])[0]?.text) : el.value.trim();
    if (!value || (el.tagName === "SELECT" && /^(select|choose|--)/i.test(value))) return;
    const { rule } = ruleFor(el);
    const { profile = {} } = await chrome.storage.local.get("profile");
    if (rule && profile[rule.key]) return; // already known
    clearTimeout(learnTimer);
    if (rule && PROFILE_LEARN.has(rule.key)) { profile[rule.key] = value; await chrome.storage.local.set({ profile }); }
    else if (!rule) await saveAnswer(label, value, { learned: true, type: el.type || el.tagName.toLowerCase() });
    else return;
    learnedCount++;
    learnTimer = setTimeout(() => { showToast(`📚 Learned ${learnedCount} new answer(s) for next time`); learnedCount = 0; }, 1500);
  }, true);

  // ---------------------------------------------------------------- UI bits
  function showToast(msg, ms = 9000) {
    if (window.top !== window && !document.querySelector("form")) return;
    let t = document.getElementById("__applyhub_toast");
    if (!t) {
      t = document.createElement("div"); t.id = "__applyhub_toast";
      t.style.cssText = "position:fixed;z-index:2147483646;right:16px;bottom:76px;max-width:380px;background:#14171c;color:#fff;font:14px/1.4 system-ui,sans-serif;padding:12px 14px;border-radius:12px;box-shadow:0 6px 24px rgba(0,0,0,.25)";
      document.documentElement.appendChild(t);
    }
    t.textContent = msg; t.style.display = "block";
    clearTimeout(showToast._t); showToast._t = setTimeout(() => (t.style.display = "none"), ms);
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
    if (msg.type === "AH_FILL") { currentMode = msg.mode || "auto"; fill().then((r) => reply({ ...r, mode: isGradSchoolPage() ? "grad" : "internship" })); return true; }
    if (msg.type === "AH_SAVE_ANSWER" && lastFocused) {
      const q = rawLabel(lastFocused) || attrText(lastFocused);
      const a = lastFocused.value || lastFocused.innerText || "";
      if (!a.trim()) { showToast("Type your answer first, then right-click → Save answer."); return; }
      saveAnswer(q, a).then(() => showToast(`Saved to your answer bank ✓ ("${q.slice(0, 50)}…")`));
    }
    if (msg.type === "AH_CONTEXT") { currentMode = "auto"; reply({ ...pageContext(), detected: isGradSchoolPage() ? "grad" : "internship" }); }
  });

  // test hook (used only by the local test pages)
  if (window.__AH_TEST__) window.__AH_TEST__ = { fill, fillOne, bestOption, openAskPanel };

  setTimeout(maybeShowButton, 1200);
  // single-page apps (Workday, Ashby) render forms late
  let tries = 0; const iv = setInterval(() => { maybeShowButton(); if (++tries > 10) clearInterval(iv); }, 2500);
})();
