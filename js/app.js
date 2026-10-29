const Store = {
  get(key, fallback) {
    try { const v = localStorage.getItem("tracker_" + key); return v === null ? fallback : JSON.parse(v); }
    catch (e) { return fallback; }
  },
  set(key, value) {
    try { localStorage.setItem("tracker_" + key, JSON.stringify(value)); } catch (e) {}
  }
};
 
const $ = id => document.getElementById(id);
const esc = s => String(s ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
 
/* Potential = saved but not applied to yet */
const STATUSES = ["Potential", "Applied", "Interview", "Offer", "Rejected"];
 
const PAGES = [
  { key: "landing",  href: "landing.html",  label: "Home",          desc: "Your jobs and internships at a glance" },
  { key: "todo",     href: "todo.html",     label: "To-Do List",    desc: "Follow-up emails, deadlines and your own tasks" },
  { key: "resume",   href: "resume.html",   label: "Resume Editor", desc: "Upload, edit and improve your resumes" },
  { key: "schedule", href: "schedule.html", label: "Scheduling",    desc: "Calendar, events and alerts" },
  { key: "account",  href: "account.html",  label: "Account",       desc: "Job types, stats, profile and settings" },
  { key: "profile",  href: "profile.html",  label: "Profile",       desc: "Your name, school and contact details" },
  { key: "settings", href: "settings.html", label: "Settings",      desc: "Reminders, password and your data" }
];
 
/* ---------- Dates ---------- */
function ymd(d) {
  return d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0") + "-" + String(d.getDate()).padStart(2, "0");
}
function parseYmd(s) { const [y, m, d] = s.split("-").map(Number); return new Date(y, m - 1, d); }
function addDays(s, n) { const d = parseYmd(s); d.setDate(d.getDate() + n); return ymd(d); }
function daysUntil(s) {
  const now = new Date();
  return Math.round((parseYmd(s) - new Date(now.getFullYear(), now.getMonth(), now.getDate())) / 86400000);
}
function niceDate(s) { return s ? parseYmd(s).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" }) : "-"; }
function dueText(s) {
  const n = daysUntil(s);
  if (n < 0) return Math.abs(n) + (n === -1 ? " day" : " days") + " overdue";
  if (n === 0) return "today";
  if (n === 1) return "tomorrow";
  return "in " + n + " days";
}
 
/* ---------- Settings (defaults + what the user saved) ---------- */
function getSettings() {
  return { popup: true, followup: true, deadline: true, events: true, remind: false, weekly: false, followDays: 7, deadlineDays: 7, ...Store.get("settings", {}) };
}
 
/* ---------- Jobs helpers ---------- */
/* Applied/Interview jobs get a follow-up date automatically if none was set */
function ensureFollowUp(job) {
  if (job.status === "Applied" || job.status === "Interview") {
    if (!job.date) job.date = ymd(new Date());
    if (!job.followUp && !job.followUpSent) job.followUp = addDays(job.date, Number(getSettings().followDays) || 7);
  }
  return job;
}
 
/* Opens the student's email app with a ready-to-edit follow-up message */
function followUpMailto(job) {
  const me = Store.get("user", {});
  const subject = "Following up on my " + job.position + " application";
  const body = "Dear " + job.company + " hiring team,\n\n" +
    "I applied for the " + job.position + " position" + (job.date ? " on " + niceDate(job.date) : "") +
    " and wanted to follow up on my application. I am still very interested in the role and would welcome the chance to talk about how I can contribute.\n\n" +
    "Thank you for your time.\n\nBest regards,\n" + (me.name || "") + (me.email ? "\n" + me.email : "");
  return "mailto:" + (job.contact || "") + "?subject=" + encodeURIComponent(subject) + "&body=" + encodeURIComponent(body);
}
 
/* ---------- Reminders ---------- */
function getNotifications() {
  const s = getSettings();
  const jobs = Store.get("jobs", []), tasks = Store.get("tasks", []), events = Store.get("events", []);
  const out = [];
 
  if (s.followup) jobs.forEach(j => {
    if ((j.status === "Applied" || j.status === "Interview") && j.followUp && !j.followUpSent) {
      const n = daysUntil(j.followUp);
      if (n <= 0) out.push({ kind: "followup", id: j.id, n, title: "Send a follow-up email to " + j.company, detail: j.position + ", due " + dueText(j.followUp) });
    }
  });
 
  if (s.deadline) jobs.forEach(j => {
    if (j.status === "Potential" && j.deadline) {
      const n = daysUntil(j.deadline);
      if (n <= Number(s.deadlineDays)) out.push({
        kind: "deadline", id: j.id, n,
        title: (n < 0 ? "Deadline passed for " : "Apply to ") + j.company,
        detail: j.position + ", deadline " + niceDate(j.deadline) + " (" + dueText(j.deadline) + ")"
      });
    }
  });
 
  if (s.events) events.forEach(e => {
    const n = daysUntil(e.date);
    if (n === 0 || n === 1) out.push({ kind: "event", id: e.id, n, title: e.title, detail: e.type + " " + dueText(e.date) + (e.time ? " at " + e.time : "") });
  });
 
  tasks.forEach(t => {
    if (!t.done && t.due) {
      const n = daysUntil(t.due);
      if (n <= 1) out.push({ kind: "task", id: t.id, n, title: t.title, detail: "To-do due " + dueText(t.due) });
    }
  });
 
  out.forEach(o => { o.urgency = o.n < 0 ? "overdue" : (o.n === 0 ? "today" : "soon"); });
  return out.sort((a, b) => a.n - b.n);
}
 
function notifActions(it) {
  if (it.kind === "followup") {
    const j = Store.get("jobs", []).find(x => x.id === it.id);
    return `<a class="btn small" href="${esc(followUpMailto(j))}">Draft email</a>
      <button type="button" class="small alt" data-act="sent" data-id="${it.id}">Mark sent</button>
      <button type="button" class="small alt" data-act="snooze" data-id="${it.id}">Snooze 3 days</button>`;
  }
  if (it.kind === "deadline") return `<button type="button" class="small" data-act="applied" data-id="${it.id}">Mark applied</button><a class="btn small alt" href="landing.html">View</a>`;
  if (it.kind === "event") return `<a class="btn small alt" href="schedule.html">Open calendar</a>`;
  if (it.kind === "task") return `<button type="button" class="small" data-act="done" data-id="${it.id}">Mark done</button>`;
  return "";
}
 
function notifHtml(list) {
  if (!list.length) return `<li class="none">You are all caught up. No reminders right now.</li>`;
  return list.map(it => `
    <li class="notif ${it.urgency}">
      <div><b>${esc(it.title)}</b><div class="meta">${esc(it.detail)}</div></div>
      <div class="actions">${notifActions(it)}</div>
    </li>`).join("");
}
 
function notifAction(btn) {
  const act = btn.dataset.act, id = Number(btn.dataset.id);
  let msg = "Updated";
  if (act === "done") {
    const tasks = Store.get("tasks", []);
    const t = tasks.find(x => x.id === id); if (t) t.done = true;
    Store.set("tasks", tasks); msg = "Task done";
  } else {
    const jobs = Store.get("jobs", []);
    const j = jobs.find(x => x.id === id); if (!j) return;
    if (act === "sent")   { j.followUpSent = true; msg = "Follow-up marked as sent"; }
    if (act === "snooze") { j.followUp = addDays(ymd(new Date()), 3); msg = "Reminder snoozed for 3 days"; }
    if (act === "applied") { j.status = "Applied"; j.date = ymd(new Date()); j.followUp = ""; j.followUpSent = false; ensureFollowUp(j); msg = "Marked as applied. Follow-up set for " + niceDate(j.followUp); }
    Store.set("jobs", jobs);
  }
  toast(msg);
  refreshBell();
  if (typeof window.onDataChanged === "function") window.onDataChanged();
}
document.addEventListener("click", e => {
  const b = e.target.closest("[data-act]");
  if (b && b.closest(".notif, .act-scope")) notifAction(b);
});
 
/* ---------- Header: links, Contents menu, reminder bell ---------- */
const BELL_SVG = '<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M18 8a6 6 0 0 0-12 0c0 7-3 9-3 9h18s-3-2-3-9"/><path d="M13.7 21a2 2 0 0 1-3.4 0"/></svg>';
 
function renderHeader(active) {
  const navActive = (active === "profile" || active === "settings") ? "account" : active;
  const main = PAGES.filter(p => ["landing", "todo", "resume", "schedule", "account"].includes(p.key));
  $("header").innerHTML = `
    <h1>Application <span>Tracker</span></h1>
    <nav aria-label="Main">
      ${main.map(p => `<a href="${p.href}" class="${p.key === navActive ? "active" : ""}">${p.label}</a>`).join("")}
      <span class="menu">
        <button type="button" class="navbtn" id="contents-btn" aria-expanded="false" aria-controls="contents-menu">Contents &#9662;</button>
        <div class="dropdown hidden" id="contents-menu">
          <ul class="menu-list">
            ${PAGES.map(p => `<li><a href="${p.href}"${p.key === active ? ' aria-current="page"' : ""}><b>${p.label}</b><span>${p.desc}</span></a></li>`).join("")}
          </ul>
        </div>
      </span>
      <span class="menu">
        <button type="button" class="navbtn bell" id="bell" aria-label="Reminders" aria-expanded="false" aria-controls="notif-panel">${BELL_SVG}<span class="count hidden" id="bell-count">0</span></button>
        <div class="dropdown right hidden" id="notif-panel">
          <h3>Reminders</h3>
          <ul class="list notif-list" id="notif-list"></ul>
          <p style="margin:.75rem 0 0"><a href="todo.html">Open the full to-do list</a></p>
        </div>
      </span>
      <a href="login.html">Log out</a>
    </nav>`;
  initHeaderMenus();
  refreshBell();
  showReminderPopup();
}
 
function initHeaderMenus() {
  const pairs = [["contents-btn", "contents-menu"], ["bell", "notif-panel"]];
  const closeAll = () => pairs.forEach(([b, p]) => { $(b).setAttribute("aria-expanded", "false"); $(p).classList.add("hidden"); });
  pairs.forEach(([b, p]) => $(b).addEventListener("click", ev => {
    ev.stopPropagation();
    const opening = $(p).classList.contains("hidden");
    closeAll();
    if (opening) { $(p).classList.remove("hidden"); $(b).setAttribute("aria-expanded", "true"); if (b === "bell") refreshBell(); }
  }));
  document.addEventListener("click", ev => {
    // composedPath still works if the clicked button was re-rendered
    if (!ev.composedPath().some(el => el.classList && el.classList.contains("menu"))) closeAll();
  });
  document.addEventListener("keydown", ev => { if (ev.key === "Escape") closeAll(); });
}
 
function refreshBell() {
  const list = getNotifications();
  const c = $("bell-count");
  if (c) { c.textContent = list.length > 9 ? "9+" : list.length; c.classList.toggle("hidden", !list.length); }
  const ul = $("notif-list");
  if (ul) ul.innerHTML = notifHtml(list.slice(0, 6));
  const b = $("bell");
  if (b) b.setAttribute("aria-label", list.length ? "Reminders, " + list.length + " waiting" : "Reminders");
}
 
/* Pop-up shown once per login session when reminders are waiting */
function resetPopup() { try { sessionStorage.removeItem("tracker_popup_seen"); } catch (e) {} }
 
function showReminderPopup() {
  if (!getSettings().popup || /todo\.html$/.test(location.pathname)) return;
  try { if (sessionStorage.getItem("tracker_popup_seen") === "1") return; } catch (e) {}
  const list = getNotifications();
  if (!list.length) return;
  try { sessionStorage.setItem("tracker_popup_seen", "1"); } catch (e) {}
 
  const box = document.createElement("div");
  box.className = "popup";
  box.id = "reminder-popup";
  box.setAttribute("role", "alertdialog");
  box.setAttribute("aria-label", "Reminders");
  box.innerHTML = `
    <h3>You have ${list.length} reminder${list.length === 1 ? "" : "s"}</h3>
    <ul>${list.slice(0, 3).map(it => `<li class="${it.urgency}"><b>${esc(it.title)}</b><br><span>${esc(it.detail)}</span></li>`).join("")}</ul>
    ${list.length > 3 ? `<p class="muted" style="margin:0 0 .5rem">and ${list.length - 3} more</p>` : ""}
    <a class="btn small" href="todo.html">Open to-do list</a>
    <button type="button" class="small alt" id="popup-close">Dismiss</button>`;
  document.body.appendChild(box);
  $("popup-close").addEventListener("click", () => box.remove());
  document.addEventListener("keydown", ev => { if (ev.key === "Escape") box.remove(); });
}
 
/* ---------- Small message at the bottom of the screen ---------- */
let toastTimer;
function toast(msg) {
  let t = $("toast");
  if (!t) { t = document.createElement("div"); t.id = "toast"; t.className = "toast"; t.setAttribute("role", "status"); document.body.appendChild(t); }
  t.textContent = msg;
  t.classList.add("show");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.classList.remove("show"), 2600);
}
