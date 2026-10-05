"""Apply Hub scanner.

Runs every 3 hours on GitHub Actions (or locally):
  1. pulls internship postings from every company in config/companies.yaml
  2. keeps the ones that are internships, relevant to you, and in Europe/Gulf
  3. watches pages in config/watch.yaml for changes
  4. turns data/*.yaml (grad + research programs) into JSON for the app
  5. sends phone notifications (ntfy) for new openings, page changes and deadlines
  6. writes everything to docs/data/*.json, which the app reads

Usage:
  python scanner/scan.py               full run
  python scanner/scan.py --check       test every company source, print counts, write nothing
  python scanner/scan.py --no-notify   full run without sending notifications
  python scanner/scan.py --test-notify send one test notification and exit
"""
import argparse
import hashlib
import html
import json
import os
import re
import sys
import time
import unicodedata
from concurrent.futures import ThreadPoolExecutor
from datetime import date, datetime, timedelta, timezone
from pathlib import Path

try:  # use the OS certificate store when available (fixes SSL errors on some Windows setups)
    import truststore
    truststore.inject_into_ssl()
except ImportError:
    pass

import requests
import yaml

sys.path.insert(0, str(Path(__file__).parent))
from sources import FETCHERS, UA  # noqa: E402

ROOT = Path(__file__).resolve().parent.parent
CONFIG, DATA, OUT = ROOT / "config", ROOT / "data", ROOT / "docs" / "data"
STATE_FILE = DATA / "state.json"
NOW = datetime.now(timezone.utc)
TODAY = NOW.date()


def load_yaml(p):
    with open(p, encoding="utf-8") as f:
        return yaml.safe_load(f)


def load_json(p, default):
    try:
        with open(p, encoding="utf-8") as f:
            return json.load(f)
    except (FileNotFoundError, json.JSONDecodeError):
        return default


def write_json(p, obj):
    p.parent.mkdir(parents=True, exist_ok=True)
    with open(p, "w", encoding="utf-8") as f:
        json.dump(obj, f, ensure_ascii=False, indent=1, default=str)


# ===================================================================== filtering
class Filter:
    def __init__(self, s):
        self.intern = [re.compile(p, re.I) for p in s["internship_patterns"]]
        self.cats = {k: re.compile(v, re.I) for k, v in s["categories"].items()}
        self.exclude = re.compile(s["exclude"], re.I)
        self.stale = [y.lower() for y in s["stale_years"]]
        self.regions = {r: [self._loc_re(t) for t in terms] for r, terms in s["regions"].items()}

    @staticmethod
    def _loc_re(term):
        t = re.escape(term.lower())
        if term[:1].isalnum():
            t = r"\b" + t
        if term[-1:].isalnum():
            t = t + r"\b"
        return re.compile(t)

    def regions_of(self, loc):
        l = loc.lower()
        return {r for r, pats in self.regions.items() if any(p.search(l) for p in pats)}

    def classify(self, raw, company):
        title = unicodedata.normalize("NFKC", raw["title"]).strip()
        t = title.lower()
        hint = (raw.get("hint") or "").lower()
        if not (any(p.search(t) for p in self.intern) or "intern" in hint):
            return None
        if self.exclude.search(t) or any(y in t for y in self.stale):
            return None
        cats = [k for k, p in self.cats.items() if p.search(t)]
        if not cats:
            if company["type"] == "quant":
                cats = ["quant"]
            elif company["type"] == "ai":
                cats = ["ml"]
            else:
                return None
        if company["type"] == "quant" and "quant" not in cats and not ({"swe", "ml"} & set(cats)):
            cats.append("quant")
        locs, regions = [], set()
        for loc in raw["locations"]:
            if not loc:
                continue
            rs = self.regions_of(loc)
            if rs:
                regions |= rs
                locs.append(loc)
        if not regions:
            return None
        tags = []
        if re.search(r"\bph\.?d\b|doctoral", t):
            tags.append("phd")
        if re.search(r"\bmaster'?s\b|\bmsc\b", t):
            tags.append("masters")
        if "2027" in t:
            tags.append("2027")
        if re.search(r"off[- ]cycle", t):
            tags.append("off-cycle")
        return {
            "title": title,
            "location": " · ".join(dict.fromkeys(locs))[:160],
            "regions": sorted(regions),
            "categories": cats,
            "tags": tags,
        }


# ===================================================================== notifications
class Notifier:
    def __init__(self, s, enabled):
        self.server = s["notify"]["server"].rstrip("/")
        self.topic = os.environ.get("NTFY_TOPIC", "").strip()
        self.enabled = enabled and bool(self.topic)
        self.app_url = (os.environ.get("APP_URL") or s.get("app_url") or "").rstrip("/")
        self.sent = 0

    def push(self, title, message, click=None, tags=None, priority=3, actions=None):
        print(f"  [notify] {title} | {message[:120].replace(chr(10), ' / ')}")
        if not self.enabled:
            return
        body = {"topic": self.topic, "title": title[:250], "message": message[:3500],
                "tags": tags or [], "priority": priority}
        if click:
            body["click"] = click
        acts = list(actions or [])
        if self.app_url and len(acts) < 3:
            acts.append({"action": "view", "label": "Open Apply Hub", "url": self.app_url})
        if acts:
            body["actions"] = acts
        try:
            requests.post(self.server, json=body, timeout=20).raise_for_status()
            self.sent += 1
            time.sleep(0.4)
        except Exception as e:
            print(f"  [notify] FAILED: {e}")


# ===================================================================== jobs
def fetch_company(c):
    t0 = time.time()
    try:
        raw = FETCHERS[c["ats"]](c["token"])
        return c, raw, None, time.time() - t0
    except Exception as e:
        return c, [], f"{type(e).__name__}: {str(e)[:160]}", time.time() - t0


def scan_jobs(companies_cfg, flt, prev_jobs, check_only=False):
    companies = companies_cfg["companies"]
    opens = companies_cfg["defaults"]["opens"]
    jobs = {j["id"]: j for j in prev_jobs}
    seen_now, company_status, new_ids = set(), [], []

    with ThreadPoolExecutor(max_workers=10) as ex:
        results = list(ex.map(fetch_company, companies))

    for c, raw, err, secs in results:
        kept = 0
        if not err:
            for r in raw:
                info = flt.classify(r, c)
                if not info:
                    continue
                jid = f"{c['ats']}:{c['token'].split('|')[0]}:{r['ext_id']}"
                kept += 1
                seen_now.add(jid)
                if jid in jobs:
                    j = jobs[jid]
                    j.update(info)
                    j.update({"last_seen": NOW.isoformat(timespec="minutes"), "open": True, "url": r["url"]})
                    j.pop("closed_at", None)
                else:
                    jobs[jid] = {
                        "id": jid, "company": c["name"], "company_type": c["type"],
                        "tier": c.get("tier", 3), **info, "url": r["url"],
                        "posted": r.get("posted"),
                        "first_seen": NOW.isoformat(timespec="minutes"),
                        "last_seen": NOW.isoformat(timespec="minutes"), "open": True,
                    }
                    new_ids.append(jid)
            # postings of this company that vanished -> closed
            prefix = f"{c['ats']}:{c['token'].split('|')[0]}:"
            for jid, j in jobs.items():
                if jid.startswith(prefix) and jid not in seen_now and j.get("open"):
                    j["open"] = False
                    j["closed_at"] = NOW.isoformat(timespec="minutes")
        status = {
            "name": c["name"], "type": c["type"], "tier": c.get("tier", 3), "ats": c["ats"],
            "ok": err is None, "error": err, "raw_count": len(raw), "open_internships": kept,
            "opens": c.get("opens") or opens.get(c["type"], ""),
            "careers": c.get("careers", ""),
        }
        company_status.append(status)
        print(f"  {'OK ' if not err else 'ERR'} {c['name']:<32} {len(raw):>4} postings -> "
              f"{kept:>3} relevant  ({secs:.1f}s){'  ' + err if err else ''}")

    for m in companies_cfg.get("manual", []):
        company_status.append({
            "name": m["name"], "type": m["type"], "tier": m.get("tier", 3), "ats": "manual",
            "ok": None, "error": None, "raw_count": 0, "open_internships": None,
            "opens": m.get("opens") or opens.get(m["type"], ""), "careers": m.get("careers", ""),
        })

    if check_only:
        return None, company_status, new_ids

    # drop postings closed for more than 45 days
    cutoff = (NOW - timedelta(days=45)).isoformat()
    jobs = {k: v for k, v in jobs.items() if v.get("open") or v.get("closed_at", "") > cutoff}
    ordered = sorted(jobs.values(), key=lambda j: (not j["open"], j["first_seen"][:10]), reverse=False)
    ordered.sort(key=lambda j: (not j["open"], j["tier"], j["company"]))
    return ordered, company_status, new_ids


# ===================================================================== page watcher
def page_lines(text, keywords):
    text = re.sub(r"(?is)<(script|style|noscript|svg)[^>]*>.*?</\1>", " ", text)
    text = re.sub(r"(?i)<(br|/p|/div|/li|/h\d|/tr)[^>]*>", "\n", text)
    text = html.unescape(re.sub(r"<[^>]+>", " ", text))
    lines = [re.sub(r"\s+", " ", l).strip() for l in text.split("\n")]
    kws = [k.lower() for k in keywords]
    return [l for l in lines if 3 < len(l) < 400 and any(k in l.lower() for k in kws)]


def watch_pages(cfg, state, notifier, bootstrap):
    results, wstate = [], state.setdefault("watch", {})
    for p in cfg.get("pages", []):
        key = p["url"]
        st = wstate.get(key, {})
        rec = {"name": p["name"], "kind": p.get("kind", "company"), "url": p["url"],
               "last_checked": NOW.isoformat(timespec="minutes"),
               "last_changed": st.get("last_changed")}
        try:
            r = requests.get(p["url"], headers=UA, timeout=30)
            if r.status_code in (401, 403, 429, 503):
                rec.update(status="blocked", detail=f"HTTP {r.status_code}: check manually")
            elif not r.ok:
                rec.update(status="error", detail=f"HTTP {r.status_code}")
            else:
                lines = page_lines(r.text, p.get("keywords") or ["2027"])
                digest = hashlib.sha256("\n".join(lines).encode()).hexdigest()
                rec.update(status="ok", detail=f"{len(lines)} matching lines",
                           snippet=" | ".join(lines[:6])[:500])
                old = st.get("hash")
                if old and old != digest:
                    added = [l for l in lines if l not in set(st.get("lines", []))][:4]
                    rec["last_changed"] = NOW.isoformat(timespec="minutes")
                    rec["changes"] = added
                    if not bootstrap:
                        notifier.push(f"🔔 Page changed: {p['name']}",
                                      ("New text:\n• " + "\n• ".join(added)) if added else "Something changed on the page.",
                                      click=p["url"], tags=["eyes"])
                st.update(hash=digest, lines=lines[:200])
                if not old:
                    rec["last_changed"] = rec["last_changed"] or None
        except Exception as e:
            rec.update(status="error", detail=f"{type(e).__name__}")
        st["status"] = rec["status"]
        wstate[key] = st
        results.append(rec)
        print(f"  watch {rec['status']:<7} {p['name']}")
    return results


# ===================================================================== grad / research
def to_usd(money, fx, years=1):
    if not money or money.get("amount") is None:
        return None
    rate = fx.get(money.get("currency", "USD"), 1.0)
    return round(money["amount"] * rate)


def d(x):
    if not x:
        return None
    return x if isinstance(x, date) else date.fromisoformat(str(x))


def build_grad(fx):
    out = []
    for p in load_yaml(DATA / "grad_programs.yaml")["programs"]:
        dl = [{**x, "date": d(x.get("date"))} for x in p.get("deadlines") or []]
        for s in p.get("scholarships") or []:
            s["deadline"] = d(s.get("deadline"))
        upcoming = sorted([x["date"] for x in dl if x["date"] and x["date"] >= TODAY])
        t = p.get("tuition")
        tuition_year_usd = None
        if t and t.get("amount") is not None:
            mult = {"semester": 2, "year": 1, "total": 1}.get(t.get("per", "year"), 1)
            tuition_year_usd = round(to_usd(t, fx) * mult)
        opens = d(p.get("opens"))
        out.append({
            **p, "deadlines": dl, "opens": opens,
            "app_fee_usd": to_usd(p.get("app_fee"), fx),
            "tuition_year_usd": tuition_year_usd,
            "next_deadline": upcoming[0] if upcoming else None,
            "status": ("closed" if not upcoming else
                       "open" if (not opens or opens <= TODAY) else "not_open_yet"),
        })
    out.sort(key=lambda p: (p["next_deadline"] is None, p["next_deadline"] or date.max))
    return out


def build_research():
    out = []
    for p in load_yaml(DATA / "research_programs.yaml")["programs"]:
        p["deadline"], p["opens"] = d(p.get("deadline")), d(p.get("opens"))
        p["status"] = ("closed" if p["deadline"] and p["deadline"] < TODAY else
                       "not_open_yet" if p["opens"] and p["opens"] > TODAY else "open")
        out.append(p)
    out.sort(key=lambda p: (p["deadline"] is None, p["deadline"] or date.max))
    return out


# ===================================================================== reminders
def tracker_items():
    """Optional: read your tracker (secret gist) so its deadlines are reminded too."""
    gid = os.environ.get("TRACKER_GIST_ID", "").strip()
    if not gid:
        return []
    try:
        g = requests.get(f"https://api.github.com/gists/{gid}", timeout=20).json()
        content = g["files"]["apply-hub-tracker.json"]["content"]
        items = json.loads(content).get("items", {})
        return [i for i in items.values() if i.get("deadline") and i.get("status") not in
                ("Applied", "Submitted", "Rejected", "Withdrawn", "Offer", "Admitted", "Interview")]
    except Exception as e:
        print(f"  tracker gist not readable: {e}")
        return []


def deadline_events(grad, research, tracked):
    ev = []
    for p in grad:
        name = f"{p['university']}: {p['program']}"
        for x in p["deadlines"]:
            if x["date"]:
                ev.append((x["date"], f"{name} ({x['label']})", p.get("url")))
        for s in p.get("scholarships") or []:
            if s.get("deadline"):
                ev.append((s["deadline"], f"{s['name']} scholarship: {p['university']}", p.get("url")))
        if p.get("opens"):
            ev.append((p["opens"], f"OPENS: {name}", p.get("url")))
    for r in research:
        if r.get("deadline"):
            ev.append((r["deadline"], f"{r['name']}", r.get("url")))
        if r.get("opens"):
            ev.append((r["opens"], f"OPENS: {r['name']}", r.get("url")))
    for t in tracked:
        try:
            ev.append((date.fromisoformat(t["deadline"][:10]), f"{t.get('org', '')}: {t.get('title', '')} (tracker)", t.get("url")))
        except Exception:
            pass
    return ev


def daily_digest(settings, grad, research, jobs, state, notifier):
    n = settings["notify"]
    if NOW.hour < n["digest_hour_utc"] or state.get("last_digest") == TODAY.isoformat():
        return
    warn = set(n["deadline_warn_days"])
    lines = []
    for dt, label, _url in sorted(deadline_events(grad, research, tracker_items())):
        days = (dt - TODAY).days
        if label.startswith("OPENS:"):
            if days == 0:
                lines.append(f"🟢 Today: {label[7:]} opens")
        elif days in warn or days == 0:
            when = "TODAY" if days == 0 else f"in {days} day{'s' if days > 1 else ''}"
            lines.append(f"{'🔴' if days <= 3 else '🟠'} {when}: {label} ({dt:%d %b})")
    since = (NOW - timedelta(days=1)).isoformat()
    fresh = [j for j in jobs if j["open"] and j["first_seen"] > since]
    if fresh:
        lines.append(f"🆕 {len(fresh)} new internship(s) in the last 24h")
    if lines:
        notifier.push("☀️ Apply Hub daily brief", "\n".join(lines[:15]),
                      click=notifier.app_url or None, tags=["calendar"], priority=4)
    state["last_digest"] = TODAY.isoformat()


# ===================================================================== main
def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--check", action="store_true")
    ap.add_argument("--no-notify", action="store_true")
    ap.add_argument("--test-notify", action="store_true")
    args = ap.parse_args()

    settings = load_yaml(CONFIG / "settings.yaml")
    notifier = Notifier(settings, enabled=not (args.no_notify or args.check))
    if args.test_notify:
        notifier.enabled = bool(notifier.topic)
        if not notifier.enabled:
            sys.exit("Set the NTFY_TOPIC environment variable first.")
        notifier.push("✅ Apply Hub is connected", "Notifications work. You'll get new internships and deadline reminders here.",
                      click=notifier.app_url or None, tags=["tada"])
        return

    t0 = time.time()
    flt = Filter(settings)
    companies_cfg = load_yaml(CONFIG / "companies.yaml")
    state = load_json(STATE_FILE, {})
    prev = load_json(OUT / "jobs.json", {"jobs": []})["jobs"]
    bootstrap = not prev

    print(f"== Scanning {len(companies_cfg['companies'])} companies")
    jobs, company_status, new_ids = scan_jobs(companies_cfg, flt, prev, check_only=args.check)
    if args.check:
        bad = [c for c in company_status if c["ok"] is False]
        print(f"\n{len(bad)} source(s) failing: {', '.join(c['name'] for c in bad) or 'none'}")
        return

    # ---- notifications for new internships
    by_id = {j["id"]: j for j in jobs}
    new_jobs = sorted((by_id[i] for i in new_ids), key=lambda j: (j["tier"], j["company"]))
    max_ind = settings["notify"]["max_individual"]
    if bootstrap:
        notifier.push("🚀 Apply Hub is live",
                      f"Found {len(new_jobs)} open internships in Europe/Gulf across "
                      f"{len({j['company'] for j in new_jobs})} companies. Open the app to review them.",
                      click=notifier.app_url or None, tags=["rocket"])
    elif len(new_jobs) > max_ind:
        top = "\n".join(f"• {j['company']}: {j['title']} ({j['location'][:40]})" for j in new_jobs[:8])
        notifier.push(f"🆕 {len(new_jobs)} new internships", top + ("\n…" if len(new_jobs) > 8 else ""),
                      click=notifier.app_url or None, tags=["briefcase"], priority=4)
    else:
        for j in new_jobs:
            notifier.push(f"🆕 {j['company']}: new internship",
                          f"{j['title']}\n📍 {j['location']}\n🏷 {', '.join(j['categories'])}",
                          click=j["url"], tags=["briefcase"], priority=4 if j["tier"] == 1 else 3,
                          actions=[{"action": "view", "label": "Apply", "url": j["url"]}])

    print("== Watching pages")
    watch = watch_pages(load_yaml(CONFIG / "watch.yaml"), state, notifier, bootstrap=False)

    fx = settings["fx_to_usd"]
    grad, research = build_grad(fx), build_research()
    daily_digest(settings, grad, research, jobs, state, notifier)

    open_jobs = [j for j in jobs if j["open"]]
    meta = {
        "last_scan": NOW.isoformat(timespec="minutes"),
        "duration_s": round(time.time() - t0),
        "open_internships": len(open_jobs),
        "new_this_scan": len(new_ids),
        "companies_ok": sum(1 for c in company_status if c["ok"]),
        "companies_failed": [c["name"] for c in company_status if c["ok"] is False],
        "notifications_sent": notifier.sent,
        "fx_to_usd": fx,
    }
    write_json(OUT / "jobs.json", {"generated": meta["last_scan"], "jobs": jobs})
    write_json(OUT / "companies.json", company_status)
    write_json(OUT / "watch.json", watch)
    write_json(OUT / "grad.json", grad)
    write_json(OUT / "research.json", research)
    write_json(OUT / "meta.json", meta)
    write_json(STATE_FILE, state)
    print(f"\n== Done in {meta['duration_s']}s: {len(open_jobs)} open internships, "
          f"{len(new_ids)} new, {meta['companies_ok']} sources OK, "
          f"failed: {meta['companies_failed'] or 'none'}")


if __name__ == "__main__":
    main()
