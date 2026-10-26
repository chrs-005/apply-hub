/* Apply Hub Autofill: background service worker.
 * - keyboard shortcut (Alt+Shift+F) -> fill the active tab
 * - right-click menu: "Save this answer to Apply Hub"
 * - "Mark as applied" -> adds the job to your tracker (secret GitHub gist shared with the app)
 */
const GIST_FILE = "apply-hub-tracker.json";

// Job portals + university portals: the only places auto-learned answers are allowed to come from.
const APPLICATION_HOSTS = /greenhouse\.io|lever\.co|ashbyhq\.com|myworkdayjobs\.com|workday\.com|smartrecruiters\.com|workable\.com|icims\.com|taleo\.net|successfactors|oraclecloud\.com|jobvite\.com|teamtailor\.com|recruitee\.com|personio\.|bamboohr\.com|eightfold\.ai|careers\.microsoft\.com|amazon\.jobs|janestreet\.com|avature\.net|join\.com|applytojob\.com|breezy\.hr|\.ac\.(uk|ae|at|be|il)$|\.edu(\.[a-z]{2})?$|ethz\.ch|epfl\.ch|uzh\.ch|polytechnique|ip-paris|universit|uni-[a-z]+\.de|tum\.de|tudelft\.nl|uva\.nl|kaust\.edu|mbzuai|eacea|technolutions|campusfrance|ens\.(fr|psl)|sorbonne|imperial\.ac|lse\.ac|ucl\.ac|ox\.ac|cam\.ac|ed\.ac/;

async function removeJunkLearned() {
  // Older versions learned from every site (search boxes, chats...). Keep only answers learned on
  // application sites, plus anything you saved yourself (right-click "Save this answer").
  const { answers = [] } = await chrome.storage.local.get("answers");
  const kept = answers.filter((a) => !a.learned || APPLICATION_HOSTS.test(a.from || ""));
  if (kept.length !== answers.length) await chrome.storage.local.set({ answers: kept });
  return answers.length - kept.length;
}

chrome.runtime.onInstalled.addListener((d) => {
  chrome.contextMenus.create({ id: "ah-save-answer", title: "Save this answer to Apply Hub", contexts: ["editable"] });
  chrome.contextMenus.create({ id: "ah-fill", title: "Autofill this application", contexts: ["page", "editable"] });
  if (d.reason === "install") chrome.runtime.openOptionsPage();
  if (d.reason === "update") removeJunkLearned();
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

chrome.runtime.onMessage.addListener((msg, _s, reply) => {
  if (msg.type === "AH_TRACK") { addToTracker(msg.entry).then(reply).catch((e) => reply({ ok: false, error: String(e) })); return true; }
});
