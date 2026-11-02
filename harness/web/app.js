const $ = (sel) => document.querySelector(sel);

const state = {
  ticketId: null,
  filePath: ".",
  es: null,
  androidEs: null,
};

function log(msg) {
  const el = $("#dash-log");
  const line = `[${new Date().toLocaleTimeString()}] ${msg}\n`;
  el.textContent = (el.textContent + line).slice(-12000);
  el.scrollTop = el.scrollHeight;
}

async function api(path, opts = {}) {
  const res = await fetch(path, {
    headers: { "content-type": "application/json", ...(opts.headers || {}) },
    ...opts,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || res.statusText);
  return data;
}

function showDashboard() {
  state.ticketId = null;
  if (state.es) {
    state.es.close();
    state.es = null;
  }
  $("#view-dashboard").classList.remove("hidden");
  $("#view-ticket").classList.add("hidden");
  history.replaceState(null, "", "/");
  refreshTickets();
}

async function showTicket(id) {
  state.ticketId = id;
  state.filePath = ".";
  $("#view-dashboard").classList.add("hidden");
  $("#view-ticket").classList.remove("hidden");
  history.replaceState(null, "", `#ticket/${id}`);
  await loadTicket(id);
  browseFiles(".");
  connectEvents(id);
}

async function refreshStatus() {
  const s = await api("/api/status");
  $("#status-line").textContent = `main ${short(s.mainSha)} · prod ${short(s.prodSha)} · ${s.repo}`;
  const link = $("#main-preview-link");
  link.href = s.mainPreview?.url || "#";
  return s;
}

function short(sha) {
  return sha ? sha.slice(0, 7) : "?";
}

async function refreshTickets() {
  const { open, closed } = await api("/api/tickets");
  const openEl = $("#open-list");
  const closedEl = $("#closed-list");
  openEl.innerHTML = open.length
    ? open
        .map(
          (t) => `<li><a href="#ticket/${t.id}">${escapeHtml(t.title || t.id)}</a>
            <span class="when">${escapeHtml(t.id)}</span></li>`,
        )
        .join("")
    : "<li class='when'>No open tickets</li>";
  closedEl.innerHTML = closed.length
    ? closed
        .map(
          (t) => `<li><a href="#ticket/${t.id}">${escapeHtml(t.title || t.id)}</a>
            <span class="when">${escapeHtml(t.closedAt || "")}</span></li>`,
        )
        .join("")
    : "<li class='when'>None yet</li>";
}

function escapeHtml(s) {
  return String(s)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

function formatChatEvent(ev) {
  if (ev.type === "user") {
    return `<div class="msg user"><div class="role">you</div><div>${escapeHtml(ev.text)}</div></div>`;
  }
  if (ev.type === "system") {
    return `<div class="msg system"><div class="role">system</div><div>${escapeHtml(ev.text)}</div></div>`;
  }
  if (ev.type === "agent_stderr") {
    return `<div class="msg err"><div class="role">stderr</div><div>${escapeHtml(ev.text)}</div></div>`;
  }
  if (ev.type === "run_start") {
    return `<div class="msg system"><div class="role">run</div><div>started</div></div>`;
  }
  if (ev.type === "run_end") {
    return `<div class="msg system"><div class="role">run</div><div>ended code=${ev.code ?? "?"} signal=${ev.signal ?? "-"}</div></div>`;
  }
  if (ev.type === "agent") {
    const d = ev.data || {};
    let text = "";
    if (d.type === "assistant" && d.message?.content) {
      text = d.message.content.map((c) => c.text || "").join("");
    } else if (d.type === "result") {
      text = d.result || JSON.stringify(d, null, 2);
    } else if (d.type === "tool_call") {
      text = `tool: ${JSON.stringify(d.tool_call || d).slice(0, 400)}`;
    } else {
      text = JSON.stringify(d).slice(0, 500);
    }
    if (!text) return "";
    return `<div class="msg"><div class="role">agent</div><div>${escapeHtml(text)}</div></div>`;
  }
  return "";
}

async function loadTicket(id) {
  const t = await api(`/api/tickets/${encodeURIComponent(id)}`);
  $("#ticket-title").textContent = `${t.title || t.id} (${t.status})`;
  const chat = $("#chat");
  chat.innerHTML = (t.chat || []).map(formatChatEvent).join("");
  chat.scrollTop = chat.scrollHeight;

  const prev = $("#ticket-preview-link");
  if (t.previewUrl) {
    prev.href = t.previewUrl;
    prev.classList.remove("hidden");
  } else {
    prev.classList.add("hidden");
  }

  const open = t.status === "open";
  $("#prompt-form").classList.toggle("hidden", !open);
  $("#btn-request-preview").disabled = !open;
  $("#btn-merge-main").disabled = !open;
  $("#btn-stop").disabled = !open;
  $("#btn-android-ticket").disabled = !open;
}

function connectEvents(id) {
  if (state.es) state.es.close();
  state.es = new EventSource(`/api/tickets/${encodeURIComponent(id)}/events`);
  state.es.onmessage = (msg) => {
    try {
      const ev = JSON.parse(msg.data);
      if (ev.type === "hello") return;
      const html = formatChatEvent(ev);
      if (html) {
        $("#chat").insertAdjacentHTML("beforeend", html);
        $("#chat").scrollTop = $("#chat").scrollHeight;
      }
      if (ev.type === "run_end") loadTicket(id);
    } catch {
      /* ignore */
    }
  };
}

async function browseFiles(rel) {
  if (!state.ticketId) return;
  state.filePath = rel || ".";
  let data;
  try {
    data = await api(
      `/api/files?scope=ticket&ticket=${encodeURIComponent(state.ticketId)}&path=${encodeURIComponent(state.filePath)}`,
    );
  } catch (err) {
    $("#file-list").innerHTML = "";
    $("#file-view").textContent = err.message;
    $("#file-crumbs").textContent = "(worktree unavailable)";
    return;
  }
  $("#file-crumbs").textContent = data.root;
  const list = $("#file-list");
  const up =
    state.filePath !== "."
      ? `<li><button type="button" class="dir" data-path="${escapeHtml(parentPath(state.filePath))}">..</button></li>`
      : "";
  list.innerHTML =
    up +
    data.items
      .map((it) => {
        const cls = it.type === "dir" ? "dir" : "file";
        return `<li><button type="button" class="${cls}" data-path="${escapeHtml(it.path)}" data-type="${it.type}">${escapeHtml(it.name)}${it.type === "dir" ? "/" : ""}</button></li>`;
      })
      .join("");
}

function parentPath(p) {
  const parts = p.split("/").filter(Boolean);
  parts.pop();
  return parts.join("/") || ".";
}

async function openFile(rel) {
  const data = await api(
    `/api/file?scope=ticket&ticket=${encodeURIComponent(state.ticketId)}&path=${encodeURIComponent(rel)}`,
  );
  $("#file-view").textContent = data.content;
}

function connectAndroidLog() {
  if (state.androidEs) state.androidEs.close();
  state.androidEs = new EventSource("/api/android/events");
  state.androidEs.onmessage = (msg) => {
    try {
      const ev = JSON.parse(msg.data);
      if (ev.type === "android_log") log(ev.text.replace(/\n$/, ""));
      if (ev.type === "android_start") log(`Android test start (${ev.scope}${ev.ticketId ? " " + ev.ticketId : ""})`);
      if (ev.type === "android_end") log(`Android test end code=${ev.code}`);
    } catch {
      /* ignore */
    }
  };
}

function route() {
  const m = location.hash.match(/^#ticket\/([a-z0-9]+(?:-[a-z0-9]+)*)$/);
  if (m) showTicket(m[1]);
  else showDashboard();
}

$("#btn-back").addEventListener("click", () => {
  location.hash = "";
  showDashboard();
});

$("#new-ticket-form").addEventListener("submit", async (e) => {
  e.preventDefault();
  const fd = new FormData(e.target);
  try {
    const meta = await api("/api/tickets", {
      method: "POST",
      body: JSON.stringify({ id: fd.get("id"), title: fd.get("title") }),
    });
    e.target.reset();
    log(`Opened ticket ${meta.id}`);
    location.hash = `#ticket/${meta.id}`;
    showTicket(meta.id);
  } catch (err) {
    log(`Error: ${err.message}`);
    alert(err.message);
  }
});

$("#prompt-form").addEventListener("submit", async (e) => {
  e.preventDefault();
  const text = $("#prompt-input").value.trim();
  if (!text || !state.ticketId) return;
  try {
    await api(`/api/tickets/${encodeURIComponent(state.ticketId)}/prompt`, {
      method: "POST",
      body: JSON.stringify({ prompt: text }),
    });
    $("#prompt-input").value = "";
    await loadTicket(state.ticketId);
  } catch (err) {
    alert(err.message);
  }
});

$("#btn-stop").addEventListener("click", async () => {
  if (!state.ticketId) return;
  await api(`/api/tickets/${encodeURIComponent(state.ticketId)}/stop`, { method: "POST", body: "{}" });
});

$("#btn-request-preview").addEventListener("click", async () => {
  if (!state.ticketId) return;
  try {
    await api(`/api/tickets/${encodeURIComponent(state.ticketId)}/request-preview`, {
      method: "POST",
      body: "{}",
    });
    await loadTicket(state.ticketId);
  } catch (err) {
    alert(err.message);
  }
});

$("#btn-merge-main").addEventListener("click", async () => {
  if (!state.ticketId) return;
  if (!confirm(`Merge '${state.ticketId}' into main and close the ticket?`)) return;
  try {
    const r = await api(`/api/tickets/${encodeURIComponent(state.ticketId)}/merge`, {
      method: "POST",
      body: "{}",
    });
    log(`Merged to main @ ${short(r.mainSha)}`);
    await loadTicket(state.ticketId);
    await refreshStatus();
  } catch (err) {
    log(`Merge failed: ${err.message}`);
    alert(err.message);
    await loadTicket(state.ticketId);
  }
});

$("#btn-promote-prod").addEventListener("click", async () => {
  if (!confirm("Fast-forward prod from main and push origin/main and origin/prod? Workers Builds deploys 66ksiag.pl from prod.")) return;
  try {
    const r = await api("/api/main/promote", { method: "POST", body: "{}" });
    log(`prod @ ${short(r.prodSha)} pushed (main ${short(r.mainSha)})`);
    await refreshStatus();
  } catch (err) {
    log(`Promote failed: ${err.message}`);
    alert(err.message);
  }
});

$("#btn-android-main").addEventListener("click", async () => {
  try {
    connectAndroidLog();
    await api("/api/main/android", { method: "POST", body: "{}" });
    log("Android build+install started (main)");
  } catch (err) {
    alert(err.message);
  }
});

$("#btn-android-ticket").addEventListener("click", async () => {
  if (!state.ticketId) return;
  try {
    connectAndroidLog();
    await api(`/api/tickets/${encodeURIComponent(state.ticketId)}/android`, {
      method: "POST",
      body: "{}",
    });
    log(`Android build+install started (${state.ticketId})`);
  } catch (err) {
    alert(err.message);
  }
});

$("#file-list").addEventListener("click", (e) => {
  const btn = e.target.closest("button[data-path]");
  if (!btn) return;
  const p = btn.dataset.path;
  if (btn.dataset.type === "dir" || btn.textContent === "..") browseFiles(p);
  else openFile(p).catch((err) => {
    $("#file-view").textContent = err.message;
  });
});

window.addEventListener("hashchange", route);

refreshStatus()
  .then(refreshTickets)
  .then(route)
  .catch((err) => {
    $("#status-line").textContent = err.message;
  });
