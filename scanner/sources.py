"""Fetchers for each job-board type. Each returns a list of raw jobs:

    {"ext_id": str, "title": str, "locations": [str], "url": str,
     "posted": iso-date | None, "hint": str}

`hint` is extra text (e.g. employment type "Intern") used only to decide
whether a posting is an internship.
"""
import html
import re
import time
from datetime import datetime, timezone

import requests

UA = {
    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
                  "(KHTML, like Gecko) Chrome/130.0 Safari/537.36",
    "Accept": "application/json, text/html;q=0.9, */*;q=0.8",
    "Accept-Language": "en-GB,en;q=0.9",
}
TIMEOUT = 30

# Countries queried on sites where we search country by country.
COUNTRIES = {
    # iso3: (name used in the search, display name)
    "GBR": "United Kingdom", "IRL": "Ireland", "CHE": "Switzerland", "DEU": "Germany",
    "FRA": "France", "NLD": "Netherlands", "POL": "Poland", "ESP": "Spain",
    "ITA": "Italy", "LUX": "Luxembourg", "SWE": "Sweden", "DNK": "Denmark",
    "AUT": "Austria", "CZE": "Czech Republic", "ARE": "United Arab Emirates",
    "SAU": "Saudi Arabia", "QAT": "Qatar",
}


def _get(url, **kw):
    for wait in (5, 20, 60, None):  # back off when rate-limited
        r = requests.get(url, headers=UA, timeout=TIMEOUT, **kw)
        if r.status_code != 429 or wait is None:
            break
        time.sleep(wait)
    r.raise_for_status()
    return r


def _post(url, payload, **kw):
    r = requests.post(url, json=payload, headers={**UA, "Content-Type": "application/json"},
                      timeout=TIMEOUT, **kw)
    r.raise_for_status()
    return r


def _ms_to_iso(ms):
    try:
        return datetime.fromtimestamp(int(ms) / 1000, tz=timezone.utc).date().isoformat()
    except Exception:
        return None


# ---------------------------------------------------------------- greenhouse
def greenhouse(token):
    data = _get(f"https://boards-api.greenhouse.io/v1/boards/{token}/jobs").json()
    out = []
    for j in data.get("jobs", []):
        locs = [j.get("location", {}).get("name") or ""]
        for o in j.get("offices", []) or []:
            if o.get("name"):
                locs.append(o["name"])
        out.append({
            "ext_id": str(j["id"]), "title": j.get("title", ""), "locations": locs,
            "url": j.get("absolute_url", ""),
            "posted": (j.get("first_published") or j.get("updated_at") or "")[:10] or None,
            "hint": "",
        })
    return out


# ---------------------------------------------------------------- lever
def lever(token):
    data = _get(f"https://api.lever.co/v0/postings/{token}?mode=json").json()
    out = []
    for j in data:
        c = j.get("categories", {}) or {}
        locs = [c.get("location") or ""] + list(c.get("allLocations") or [])
        out.append({
            "ext_id": j["id"], "title": j.get("text", ""), "locations": locs,
            "url": j.get("hostedUrl", ""), "posted": _ms_to_iso(j.get("createdAt")),
            "hint": c.get("commitment") or "",
        })
    return out


# ---------------------------------------------------------------- ashby
def ashby(token):
    data = _get(f"https://api.ashbyhq.com/posting-api/job-board/{token}").json()
    out = []
    for j in data.get("jobs", []):
        if j.get("isListed") is False:
            continue
        locs = [j.get("location") or ""]
        for s in j.get("secondaryLocations") or []:
            locs.append(s.get("location") or "")
        addr = ((j.get("address") or {}).get("postalAddress") or {})
        if addr.get("addressCountry"):
            locs.append(addr["addressCountry"])
        out.append({
            "ext_id": j.get("id") or j.get("jobUrl"), "title": j.get("title", ""),
            "locations": locs, "url": j.get("jobUrl", ""),
            "posted": (j.get("publishedAt") or "")[:10] or None,
            "hint": j.get("employmentType") or "",
        })
    return out


# ---------------------------------------------------------------- workable
def workable(token):
    out, page = [], None
    for _ in range(10):
        body = {"query": "", "location": [], "department": [], "worktype": [], "remote": []}
        if page:
            body["token"] = page
        data = _post(f"https://apply.workable.com/api/v3/accounts/{token}/jobs", body).json()
        for j in data.get("results", []):
            locs = []
            for l in [j.get("location") or {}] + list(j.get("locations") or []):
                locs.append(", ".join(x for x in [l.get("city"), l.get("country")] if x))
            out.append({
                "ext_id": j.get("shortcode"), "title": j.get("title", ""), "locations": locs,
                "url": f"https://apply.workable.com/{token}/j/{j.get('shortcode')}/",
                "posted": (j.get("published") or "")[:10] or None,
                "hint": j.get("type") or "",
            })
        page = data.get("nextPage")
        if not page:
            break
    return out


# ---------------------------------------------------------------- workday
def workday(token):
    tenant, wd, site = token.split("|")
    base = f"https://{tenant}.{wd}.myworkdayjobs.com"
    out, offset, total = [], 0, None
    while offset < 400:
        data = _post(f"{base}/wday/cxs/{tenant}/{site}/jobs",
                     {"appliedFacets": {}, "limit": 20, "offset": offset, "searchText": "intern"}).json()
        if total is None:
            total = data.get("total", 0)
        posts = data.get("jobPostings", [])
        for j in posts:
            out.append({
                "ext_id": j.get("externalPath"), "title": j.get("title", ""),
                "locations": [j.get("locationsText") or ""],
                "url": f"{base}/en-US/{site}{j.get('externalPath', '')}",
                "posted": None, "hint": "",
            })
        offset += 20
        if not posts or offset >= total:
            break
        time.sleep(0.3)
    return out


# ---------------------------------------------------------------- jane street
# Jane Street replaces some Latin letters in titles with look-alike Lisu
# characters (U+A4D0..U+A4FF). Map them back so keyword matching works.
_LISU = {
    0xA4D0: "B", 0xA4D1: "P", 0xA4D3: "D", 0xA4D4: "T", 0xA4D6: "G", 0xA4D7: "K",
    0xA4D9: "J", 0xA4DA: "C", 0xA4DC: "Z", 0xA4DD: "F", 0xA4DF: "M", 0xA4E0: "N",
    0xA4E1: "L", 0xA4E2: "S", 0xA4E3: "R", 0xA4E6: "V", 0xA4E7: "H", 0xA4EA: "W",
    0xA4EB: "X", 0xA4EC: "Y", 0xA4EE: "A", 0xA4F0: "E", 0xA4F2: "I", 0xA4F3: "O",
    0xA4F4: "U",
}
JS_CITIES = {"LDN": "London, United Kingdom", "AMS": "Amsterdam, Netherlands",
             "NYC": "New York, US", "HKG": "Hong Kong", "SGP": "Singapore",
             "CHI": "Chicago, US", "ATX": "Austin, US"}


def janestreet(_token):
    data = _get("https://www.janestreet.com/jobs/main.json").json()
    out = []
    for j in data:
        avail = j.get("availability", "")
        title = (j.get("position") or "").translate(_LISU)
        out.append({
            "ext_id": str(j["id"]),
            "title": f"{title} ({avail})" if avail else title,
            "locations": [JS_CITIES.get(j.get("city"), j.get("city") or "")],
            "url": f"https://www.janestreet.com/join-jane-street/position/{j['id']}/",
            "posted": None, "hint": avail,
        })
    return out


# ---------------------------------------------------------------- google
def google(_token):
    out, seen = [], set()
    for name in ["United Kingdom", "Switzerland", "Germany", "France", "Ireland",
                 "Netherlands", "Poland", "Denmark", "Sweden", "United Arab Emirates"]:
        for page in (1, 2, 3):
            r = _get("https://www.google.com/about/careers/applications/jobs/results",
                     params={"location": name, "target_level": "INTERN_AND_APPRENTICE",
                             "page": page})
            blocks = r.text.split('<li class="lLd3Je"')[1:]
            for b in blocks:
                m_id = re.search(r"ssk='\d+:(\d+)'", b)
                m_t = re.search(r"<h3[^>]*>(.*?)</h3>", b, re.S)
                if not (m_id and m_t) or m_id.group(1) in seen:
                    continue
                seen.add(m_id.group(1))
                locs = [html.unescape(x).strip(" ;·") for x in re.findall(r'class="r0wTof[^"]*">([^<]+)<', b)]
                out.append({
                    "ext_id": m_id.group(1), "title": html.unescape(m_t.group(1)).strip(),
                    "locations": list(dict.fromkeys(locs)) or [name],
                    "url": f"https://www.google.com/about/careers/applications/jobs/results/{m_id.group(1)}",
                    "posted": None, "hint": "intern",
                })
            if len(blocks) < 20:
                break
            time.sleep(0.5)
    return out


# ---------------------------------------------------------------- microsoft
def microsoft(_token):
    out, seen = [], set()
    for name in ["United Kingdom", "Ireland", "Switzerland", "Germany", "France",
                 "Netherlands", "Poland", "United Arab Emirates", "Saudi Arabia", "Qatar"]:
        start = 0
        while start < 200:
            data = _get("https://apply.careers.microsoft.com/api/pcsx/search",
                        params={"domain": "microsoft.com", "query": "intern",
                                "location": name, "start": start}).json()
            pos = (data.get("data") or {}).get("positions") or []
            for p in pos:
                if p["id"] in seen:
                    continue
                seen.add(p["id"])
                out.append({
                    "ext_id": str(p["id"]), "title": p.get("name", ""),
                    "locations": (p.get("locations") or []) + (p.get("standardizedLocations") or []),
                    "url": "https://apply.careers.microsoft.com" + (p.get("positionUrl") or ""),
                    "posted": datetime.fromtimestamp(p["postedTs"], tz=timezone.utc).date().isoformat()
                              if p.get("postedTs") else None,
                    "hint": "",
                })
            if len(pos) < 10:
                break
            start += len(pos)
            time.sleep(1.5)
        time.sleep(1.5)
    return out


# ---------------------------------------------------------------- amazon
ISO2 = {"GB": "United Kingdom", "IE": "Ireland", "CH": "Switzerland", "DE": "Germany",
        "FR": "France", "NL": "Netherlands", "PL": "Poland", "ES": "Spain", "IT": "Italy",
        "LU": "Luxembourg", "SE": "Sweden", "DK": "Denmark", "AT": "Austria",
        "CZ": "Czech Republic", "AE": "United Arab Emirates", "SA": "Saudi Arabia", "QA": "Qatar"}


def amazon(_token):
    # Amazon locations look like "GB, London" or "DE, BE, Berlin": first part is the country.
    out, seen = [], set()
    for code3 in COUNTRIES:
        data = _get("https://www.amazon.jobs/en/search.json",
                    params={"base_query": "intern", "normalized_country_code[]": code3,
                            "result_limit": 100}).json()
        for j in data.get("jobs", []):
            jid = j.get("id_icims") or j.get("id")
            if jid in seen:
                continue
            seen.add(jid)
            parts = [x.strip() for x in (j.get("location") or "").split(",")]
            country = ISO2.get(parts[0], parts[0]) if parts else ""
            out.append({
                "ext_id": str(jid), "title": j.get("title", ""),
                "locations": [f"{parts[-1]}, {country}" if len(parts) > 1 else country],
                "url": "https://www.amazon.jobs" + (j.get("job_path") or ""),
                "posted": None, "hint": "",
            })
        time.sleep(0.3)
    return out


FETCHERS = {
    "greenhouse": greenhouse, "lever": lever, "ashby": ashby, "workable": workable,
    "workday": workday, "janestreet": janestreet, "google": google,
    "microsoft": microsoft, "amazon": amazon,
}
