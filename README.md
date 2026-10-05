# Apply Hub

Your system for **Summer 2027 internships (Europe and Gulf)** and **Fall 2027 master's applications**.

```
 ┌──────────────── GitHub (free, runs while your laptop is off) ────────────────┐
 │  every 3h: scanner/scan.py                                                     │
 │   ├─ 59 company job boards (Jane Street, Optiver, IMC, Jump, HRT, Google,      │
 │   │   Microsoft, Amazon, NVIDIA, Stripe, Databricks, Anthropic, OpenAI…)       │
 │   │   → keeps internships in UK/IE, Switzerland, EU, Gulf · SWE/Quant/ML/Research│
 │   ├─ watches 17 pages (Citadel, G-Research, ETH, EPFL, KAUST, MBZUAI, CERN…)    │
 │   ├─ grad + research programs (data/*.yaml) → fees in USD, next deadlines      │
 │   └─ Web Push → the Apply Hub app on your iPhone (new internship · page       │
 │       changed · daily deadlines). No extra app needed.                          │
 │  docs/  → GitHub Pages = the Apply Hub app (add to iPhone home screen)          │
 └────────────────────────────────────────────────────────────────────────────────┘
 Chrome extension (extension/) → ⚡ Autofill on Workday/Greenhouse/Lever/Ashby/… + CV upload
 Tracker → a secret GitHub gist, synced between phone, laptop and extension
```

---

## 1. One-time setup (~20 minutes)

### A. Put it on GitHub
1. Create a **public** repo called `apply-hub` and push this folder (or let Claude do it).
   Public is fine: it only holds job listings and program data. Your tracker and profile are never in the repo.
2. Repo → **Settings → Pages** → Source: *Deploy from a branch* → Branch `main`, folder `/docs` → Save.
   Your app URL will be `https://<your-username>.github.io/apply-hub/`.
3. Repo → **Settings → Secrets and variables → Actions**:
   - Secret `VAPID_PRIVATE_KEY`: the push-signing key (its public half is `VAPID_PUBLIC` in `docs/app.js`).
     (Already set up. If you ever regenerate it, update both halves together.)
   - Secret `TRACKER_GIST_ID`: your tracker's Gist ID (from step B.3). The scanner reads your devices'
     notification addresses and your tracker deadlines from it.
   - Variable `APP_URL`: your app URL from step 2.
4. Repo → **Actions** tab → *Scan internships & deadlines* → **Run workflow**
   (tick “Only send a test notification” to test your phone).

### B. iPhone (iOS 16.4 or newer)
1. Open your app URL in **Safari** → Share → **Add to Home Screen**. You now have the ✓ *Apply Hub* icon,
   and it opens full-screen like a normal app. **From now on, always open it from that icon.**
2. In the app → ⚙︎ **Settings → Sync tracker**:
   - Tap *Get a token* (GitHub, scope **gist** only, no expiration) → paste it → **Create tracker**.
   - Copy the **Gist ID** it shows. You'll need it for your laptop, the extension, and the GitHub secret `TRACKER_GIST_ID`.
3. Same Settings screen → **Turn on notifications** → Allow. A “Notifications are on” banner confirms it.
   Notifications appear from *Apply Hub* itself; tapping one opens the job's Apply page.
   (It also works in Chrome/Edge on your laptop, if you want alerts there too.)

### C. Laptop: Chrome extension
1. Chrome → `chrome://extensions` → turn on **Developer mode** → **Load unpacked** → pick the `extension/` folder.
2. The profile page opens. Fill it in **once**: name, contact, university, GPA, graduation date, visa answers,
   upload your **CV**, **transcript** and a generic **cover letter**. Click **Save**.
3. In the extension settings, paste the same GitHub token + Gist ID (so “Add to tracker” syncs to your phone).
4. Pin the extension (puzzle icon → 📌).

---

## 2. Daily use

| You want to… | Do this |
|---|---|
| See what's new | Apply Hub notifies you the moment a new internship is posted. At **9am Beirut** there's a daily brief with deadlines in 14/7/3/1 days. |
| Browse internships | App → **Internships**. Filter by region (UK, CH, EU, Gulf) and role (SWE, Quant, ML/AI, Research). PhD-only roles are hidden by default. |
| Know when a company opens | App → Internships → **Not posted yet**: each company's usual opening window. You'll be pinged when it posts. |
| Compare grad schools by cost | App → **Grad** → sort by *Application fee: high → low*. Each card shows fee, tuition, scholarships, English/GRE requirements, and deadlines. |
| Plan your application budget | Tap **+ Track** on programs. The Grad tab shows the total of your fees. |
| Fill an application | Open the form → click **⚡ Autofill** (bottom right) or press **Alt+Shift+F**. Green = filled, orange = needs you. **Review, then submit yourself.** |
| Reuse essay answers | Write a good answer once → right-click in the box → **Save this answer to Apply Hub**. Next time a similar question gets it filled, with `{company}` swapped in. |
| Log an application | Extension popup → **Add to tracker** (status *Applied*). It appears in the app. |
| Track statuses | App → **Tracker**: Saved → Preparing → Applied → Test/OA → Interview → Offer/Rejected. Grad items have a document checklist (CV, SOP, 3 references, English test, fee paid). |
| University portals (ETH, Oxford, MBZUAI…) | Extension settings → tick *Show the Autofill button on every site*, or just press Alt+Shift+F. |

---

## 3. Customising

- **Add a company**: `config/companies.yaml` (instructions at the top). Test it with `python scanner/scan.py --check`.
- **Add a grad program or fix a fee/deadline**: edit `data/grad_programs.yaml`. You can do this right on github.com from your phone.
- **Change what counts as relevant** (keywords, regions, excluded roles): `config/settings.yaml`.
- **Watch a new page** (e.g. a professor's lab page): `config/watch.yaml`.

Run locally (Windows):
```bash
pip install -r scanner/requirements.txt
python scanner/scan.py --no-notify
python -m http.server 8765 --directory docs
```

---

## 4. Honest limits

- **Data accuracy.** Grad data was researched on 2026-10-05. Each program has a `source` (official / aggregator / estimate) and a `verify` list. Always confirm fees and deadlines on the program page before paying or planning around them.
- **Sites without an API** (Citadel, G-Research, SIG, Meta, Apple, Bloomberg, DeepMind, Mistral) are either *watched for changes* or listed under *Check manually*. Some sites block robots, and the app shows those as “blocked”.
- **Autofill** handles the standard fields (it fills ~80–90% of a typical Greenhouse/Lever form). Workday's custom dropdowns and multi-page flows are best-effort: click Autofill again on each page. It never ticks consent boxes and never submits.
- **iPhone push** only works from the Home Screen icon (not a Safari tab), on iOS 16.4+. If notifications
  stop, open the app once; it re-registers your device automatically.
- GitHub pauses scheduled workflows after 60 days with no repo activity. The scanner's own commits keep it active.
