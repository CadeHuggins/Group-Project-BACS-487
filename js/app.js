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
const STATUSES = ["Applied", "Interview", "Offer", "Rejected"];
 
function renderHeader(active) {
  const links = [
    ["landing", "landing.html", "Home"],
    ["account", "account.html", "Account"],
    ["resume", "resume.html", "Resume Editor"],
    ["schedule", "schedule.html", "Scheduling"]
  ];
  $("header").innerHTML = `
    <h1>Application <span>Tracker</span></h1>
    <nav aria-label="Main">
      ${links.map(l => `<a href="${l[1]}" class="${l[0] === active ? "active" : ""}">${l[2]}</a>`).join("")}
      <a href="login.html">Log out</a>
    </nav>`;
}
 
let toastTimer;
function toast(msg) {
  let t = $("toast");
  if (!t) { t = document.createElement("div"); t.id = "toast"; t.className = "toast"; t.setAttribute("role", "status"); document.body.appendChild(t); }
  t.textContent = msg;
  t.classList.add("show");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.classList.remove("show"), 2200);
}
 
/* Local-date helper (avoids timezone shifts): returns YYYY-MM-DD */
function ymd(d) {
  return d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0") + "-" + String(d.getDate()).padStart(2, "0");
}
