const $ = (s) => document.querySelector(s);

(async function init() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  const { profile = {} } = await chrome.storage.local.get("profile");

  // prefill company/role from the page
  try {
    const ctx = await chrome.tabs.sendMessage(tab.id, { type: "AH_CONTEXT" });
    if (ctx) {
      $("#company").value = ctx.company || ""; $("#role").value = ctx.role || "";
      $("#mode").options[0].textContent = `Auto-detect (looks like: ${ctx.detected === "grad" ? "grad school" : "internship"})`;
    }
  } catch { $("#role").value = (tab.title || "").slice(0, 100); }

  $("#fill").onclick = async () => {
    $("#result").textContent = "Filling…";
    try {
      const r = await chrome.tabs.sendMessage(tab.id, { type: "AH_FILL", mode: $("#mode").value });
      $("#result").textContent = r ? `✓ ${r.mode === "grad" ? "Grad-school" : "Internship"} mode: filled ${r.filled} field(s)${r.files?.length ? ", attached " + r.files.join(", ") : ""}${r.attention ? `. ${r.attention} still need you (orange)` : ""}.` : "Done.";
    } catch { $("#result").textContent = "Can't fill this page (reload the page once after installing the extension)."; }
  };

  $("#track").onclick = async () => {
    $("#track-result").textContent = "Saving…";
    const r = await chrome.runtime.sendMessage({ type: "AH_TRACK", entry: { company: $("#company").value, role: $("#role").value, url: tab.url, status: $("#status").value, kind: $("#mode").value === "grad" ? "grad" : "job" } });
    $("#track-result").textContent = r?.synced ? "✓ Added to your tracker (synced to the app)" : r?.ok ? "✓ Saved locally (set up sync in Settings to see it in the app)" : `Error: ${r?.error || r?.status}`;
  };

  const copyKeys = [["Email", profile.email], ["Phone", `${profile.phone_code || ""} ${profile.phone || ""}`.trim()], ["LinkedIn", profile.linkedin], ["GitHub", profile.github], ["GPA", profile.gpa && `${profile.gpa}/${profile.gpa_scale || "4.0"}`], ["Full name", `${profile.first_name || ""} ${profile.last_name || ""}`.trim()], ["University", profile.university]];
  for (const [label, val] of copyKeys) {
    if (!val) continue;
    const b = document.createElement("button");
    b.className = "chip"; b.textContent = label; b.title = val;
    b.onclick = async () => { await navigator.clipboard.writeText(val); b.textContent = "Copied ✓"; setTimeout(() => (b.textContent = label), 1200); };
    $("#copy").appendChild(b);
  }
})();
