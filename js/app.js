// KVD Windpark snagging app (UI). Back end: js/firebase-adapter.js
"use strict";
/* ---------- helpers ---------- */
const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];
const esc = s => String(s ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const clone = o => o == null ? o : JSON.parse(JSON.stringify(o));
const isObj = v => v && typeof v === "object" && !Array.isArray(v);
function merge(a, b) { // mirrors db.update: objects merge recursively, everything else replaces
  for (const k of Object.keys(b)) {
    if (isObj(b[k]) && isObj(a[k])) merge(a[k], b[k]); else a[k] = b[k];
  }
  return a;
}
const DAY = 86400000;
const FB = window.APP_MODE === "firebase";
const fmtD = t => t ? new Date(t).toLocaleDateString("en-IN", { day: "2-digit", month: "short" }) : "–";
const fmtDT = t => t ? new Date(t).toLocaleString("en-IN", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" }) : "–";
const isoDay = t => { const d = new Date(t); d.setMinutes(d.getMinutes() - d.getTimezoneOffset()); return d.toISOString().slice(0, 10); };
const rid = () => Math.random().toString(36).slice(2, 8) + Date.now().toString(36).slice(-4);
let toastT;
function toast(msg) { const t = $("#toast"); t.textContent = msg; t.hidden = false; clearTimeout(toastT); toastT = setTimeout(() => t.hidden = true, 3200); }
const chains = {};
function serial(key, fn) { const p = (chains[key] || Promise.resolve()).then(fn, fn); chains[key] = p.catch(() => {}); return p; }
function errMsg(e) {
  const c = e && e.code;
  if (c === "invalid_argument") return "You don't have permission to change this. Ask the project admin to share the page with you as an editor.";
  if (c === "quota_exceeded") return "The project database is full. Ask the admin to clear old photos.";
  if (c === "resource_exhausted") return "Too many changes at once. Wait a few seconds and try again.";
  return "Couldn't save. Check your connection and try again.";
}

/* ---------- checklist ---------- */
const ITEMS = Object.fromEntries(CL.items.map(i => [i.id, i]));
const BYGROUP = {};
CL.items.forEach(i => (BYGROUP[i.g] = BYGROUP[i.g] || []).push(i));
const SEVDAYS = { critical: 2, major: 7, minor: 14 };
const SEVORDER = { critical: 0, major: 1, minor: 2 };
const STATUS = {
  ni: "Not inspected", ip: "Inspection in progress", op: "Snags open", vf: "Awaiting verification", rd: "Ready for handover", ho: "Handed over"
};
const SNAGST = { open: "Open", fixed: "Fixed – verify", closed: "Closed", void: "Void" };
const ROLES = { admin: "Admin", qc: "QC inspector", team: "Contractor team", crm: "CRM / handover" };

/* ---------- state ---------- */
const S = {
  db: null, user: null, assets: null, downloads: null,
  me: { id: null, name: "", avatarUrl: "" }, canEdit: false, isOwner: false,
  config: null, configLoaded: false, members: {}, sums: {}, people: [],
  unit: null,           // {id, data, exists, unsub}
  queue: { docs: [], unsub: null, key: "" },
  route: { v: "overview", tower: null, uid: null, utab: "inspect" },
  openRooms: new Set(),
  qf: { scope: "open", team: "", tower: "", sev: "" },
  names: {},
};

function defaultConfig() {
  return {
    name: "KVD Windpark",
    towers: [1, 2, 3, 6, 7].map(n => ({ id: "T" + n, name: "Tower " + n, floors: 24, start: 1, flats: 4, types: ["3BHK", "2BHK", "2BHK", "3BHK"] })),
    list: null,
    teams: CL.teams,
    flatTypes: CL.flatTypes,
  };
}
const cfg = () => S.config || defaultConfig();
const teamName = id => (cfg().teams.find(t => t.id === id) || {}).name || id || "Unassigned";
const towerName = id => (cfg().towers.find(t => t.id === id) || {}).name || id;

/* units derived from config */
let UNITS = [], UIDX = {};
function rebuildUnits() {
  const c = cfg(), out = [];
  if (c.list && c.list.length) {
    for (const u of c.list) out.push({ id: `${u.t}-${u.n}`, t: u.t, f: +u.f, n: String(u.n), ty: u.ty, a: u.a || "" });
  } else {
    for (const T of c.towers) for (let f = T.start; f < T.start + T.floors; f++) for (let p = 1; p <= T.flats; p++) {
      const n = f === 0 ? "G" + String(p).padStart(2, "0") : String(f * 100 + p);
      out.push({ id: `${T.id}-${n}`, t: T.id, f, n, ty: T.types[p - 1] || T.types[0] || "2BHK", a: "" });
    }
  }
  UNITS = out; UIDX = Object.fromEntries(out.map(u => [u.id, u]));
}
function towersInUse() {
  const c = cfg();
  if (c.list && c.list.length) { const ids = [...new Set(c.list.map(u => u.t))]; return ids.map(id => c.towers.find(t => t.id === id) || { id, name: id }); }
  return c.towers;
}
function roomsFor(ty) { const ft = cfg().flatTypes; return ft[ty] || ft[Object.keys(ft)[0]] || []; }
const CHECKCACHE = {};
function checksFor(ty) {
  const key = ty + JSON.stringify(roomsFor(ty));
  if (CHECKCACHE[key]) return CHECKCACHE[key];
  const out = [];
  for (const r of roomsFor(ty)) { const k = CL.kinds[r.kind]; if (!k) continue; for (const g of k.groups) for (const it of (BYGROUP[g] || [])) out.push({ k: r.key + "|" + it.id, room: r, item: it }); }
  return (CHECKCACHE[key] = out);
}

/* ---------- role ---------- */
function myRole() {
  const m = S.members[S.me.id];
  if (m && m.role) return m;
  if (S.isOwner || S.canEdit) return { role: "admin" };
  return { role: "qc" };
}
const can = {
  raise: () => ["admin", "qc", "crm"].includes(myRole().role),
  inspect: () => ["admin", "qc"].includes(myRole().role),
  fix: s => { const r = myRole(); return r.role === "admin" || r.role === "qc" || (r.role === "team" && (!r.team || r.team === s.team)); },
  verify: () => ["admin", "qc"].includes(myRole().role),
  handover: () => ["admin", "crm"].includes(myRole().role),
  setup: () => myRole().role === "admin" && (S.canEdit || S.isOwner),
};

/* ---------- unit summary ---------- */
function newUnit(uid) {
  const u = UIDX[uid] || {};
  return { tower: u.t, floor: u.f, flat: u.n, type: u.ty, snags: {}, checks: {}, handover: {}, openTeams: [], openCount: 0, fixedCount: 0, closedCount: 0 };
}
function computeMeta(uid, d) {
  const u = UIDX[uid] || { t: d.tower, ty: d.type };
  let o = 0, fx = 0, c = 0, cr = 0, om = 0, od = null;
  const tm = {}, teams = new Set();
  for (const s of Object.values(d.snags || {})) {
    if (s.st === "open") { o++; tm[s.team] = (tm[s.team] || 0) + 1; teams.add(s.team); if (s.sev !== "minor") cr++; else om++; od = od ? Math.min(od, s.at) : s.at; }
    else if (s.st === "fixed") { fx++; if (s.sev !== "minor") cr++; else om++; }
    else if (s.st === "closed") c++;
  }
  const list = checksFor(u.ty), ch = d.checks || {};
  const done = list.filter(x => ch[x.k]).length;
  const p = list.length ? (done === list.length ? 100 : Math.floor(done * 100 / list.length)) : 0;
  const h = !!(d.handover && d.handover.done);
  let s = "ni";
  if (h) s = "ho"; else if (o) s = "op"; else if (fx) s = "vf"; else if (p === 100) s = "rd"; else if (done || c) s = "ip";
  return { tower: u.t, o, fx, c, cr, om, p, done, total: list.length, openTeams: [...teams], sum: { s, o, fx, c, cr, p, h, od, tm: Object.entries(tm).map(([t, n]) => ({ t, n })) } };
}
const sumOf = uid => { const u = UIDX[uid]; return (u && S.sums[u.t] && S.sums[u.t].units && S.sums[u.t].units[uid]) || { s: "ni", o: 0, fx: 0, c: 0, cr: 0, p: 0, h: false, od: null, tm: [] }; };

/* ---------- writes ---------- */
async function writeUnit(uid, patch) {
  if (!S.db) throw { code: "not_granted" };
  return serial("u/" + uid, async () => {
    const ref = S.db.doc("units/" + uid);
    let cur = null, exists = false;
    if (S.unit && S.unit.id === uid && S.unit.loaded) { exists = S.unit.exists; cur = S.unit.data; }
    else { const snap = await ref.get(); exists = snap.exists; cur = snap.exists ? snap.data() : null; }
    const merged = merge(clone(cur) || newUnit(uid), clone(patch));
    const meta = computeMeta(uid, merged);
    const top = { openTeams: meta.openTeams, openCount: meta.o, fixedCount: meta.fx, closedCount: meta.c, upd: Date.now() };
    if (exists) await ref.update({ ...patch, ...top }); else await ref.set({ ...merged, ...top });
    if (S.unit && S.unit.id === uid) { S.unit.data = { ...merged, ...top }; S.unit.exists = true; }
    const qd = S.queue.docs.find(x => x.id === uid); if (qd) qd.data = { ...merged, ...top };
    await writeSum(meta.tower, uid, meta.sum);
    return merged;
  });
}
async function writeSum(t, uid, sum) {
  return serial("s/" + t, async () => {
    const ref = S.db.doc("sum/" + t);
    let exists = !!S.sums[t];
    if (!exists) exists = (await ref.get()).exists;
    if (exists) await ref.update({ units: { [uid]: sum } }); else await ref.set({ units: { [uid]: sum } });
    S.sums[t] = S.sums[t] || { units: {} }; S.sums[t].units = { ...S.sums[t].units, [uid]: sum };
  });
}

/* pending check writes, coalesced */
let pendChecks = {}, pendUid = null, pendTimer = null;
function queueCheck(uid, patch) {
  if (pendUid && pendUid !== uid) flushChecks();
  pendUid = uid; Object.assign(pendChecks, patch);
  if (S.unit && S.unit.id === uid) { S.unit.data = S.unit.data || newUnit(uid); S.unit.data.checks = { ...(S.unit.data.checks || {}), ...patch }; }
  clearTimeout(pendTimer); pendTimer = setTimeout(flushChecks, 900);
}
function flushChecks() {
  clearTimeout(pendTimer);
  if (!pendUid) return;
  const uid = pendUid, checks = pendChecks; pendUid = null; pendChecks = {};
  writeUnit(uid, { checks }).catch(e => toast(errMsg(e)));
}

/* ---------- photos ---------- */
function loadImg(file) { return new Promise((res, rej) => { const i = new Image(); i.onload = () => res(i); i.onerror = rej; i.src = URL.createObjectURL(file); }); }
async function compress(file, max, q) {
  const img = await loadImg(file);
  const s = Math.min(1, max / Math.max(img.naturalWidth, img.naturalHeight));
  const c = document.createElement("canvas"); c.width = Math.round(img.naturalWidth * s); c.height = Math.round(img.naturalHeight * s);
  c.getContext("2d").drawImage(img, 0, 0, c.width, c.height);
  URL.revokeObjectURL(img.src);
  return c;
}
async function savePhoto(file) {
  if (S.assets) {
    try {
      const c = await compress(file, 1600, 0.72);
      const blob = await new Promise(r => c.toBlob(r, "image/jpeg", 0.72));
      const r = await S.assets.upload(blob, { type: "image/jpeg" });
      return "a:" + r.id;
    } catch (e) { /* fall through to db */ }
  }
  let c = await compress(file, 900, 0.55), d = c.toDataURL("image/jpeg", 0.55);
  if (d.length > 180000) { c = await compress(file, 640, 0.5); d = c.toDataURL("image/jpeg", 0.5); }
  const ref = await S.db.collection("photos").add({ d, at: Date.now(), by: S.me.id });
  return "d:" + ref.id;
}
const PHOTOCACHE = {};
async function photoSrc(ref) {
  if (ref.startsWith("a:")) return (S.assets && S.assets.urlFor) ? S.assets.urlFor(ref.slice(2)) : "/_blob/" + ref.slice(2);
  if (PHOTOCACHE[ref]) return PHOTOCACHE[ref];
  try { const s = await S.db.doc("photos/" + ref.slice(2)).get(); return (PHOTOCACHE[ref] = s.exists ? s.data().d : ""); } catch (e) { return ""; }
}
function thumbs(refs) { return (refs || []).map(r => `<img data-ref="${esc(r)}" alt="Snag photo" loading="lazy">`).join(""); }
function hydrate(root) {
  $$("img[data-ref]", root).forEach(async img => { if (img.src) return; const s = await photoSrc(img.dataset.ref); if (s) img.src = s; });
  fillNames(root);
}

/* ---------- people ---------- */
function nameSpan(id) { return `<span data-uid="${esc(id || "")}">${esc(S.names[id] || (id && id === S.me.id ? "You" : "Someone"))}</span>`; }
async function fillNames(root) {
  const els = $$("[data-uid]", root), ids = [...new Set(els.map(e => e.dataset.uid).filter(Boolean))];
  if (!S.user || !ids.length) return;
  try {
    const ps = await S.user.profiles(ids);
    for (const id of ids) if (ps[id] && ps[id].name) S.names[id] = ps[id].name;
    els.forEach(e => { const id = e.dataset.uid; e.textContent = S.names[id] || (id === S.me.id ? "You" : "Someone"); });
  } catch (e) {}
}

/* ---------- downloads ---------- */
async function offerFile(filename, data) {
  if (!S.downloads) { toast("Downloads aren't available in this view."); return; }
  try { await S.downloads.save({ filename, data }); }
  catch (e) { if (e && e.code !== "declined") toast("Couldn't prepare the file."); }
}
const csvCell = v => { const s = String(v ?? ""); return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s; };

/* ---------- routing ---------- */
function go(v, extra = {}) {
  if (S.route.v === "unit" && (v !== "unit" || extra.uid !== S.route.uid)) { flushChecks(); closeUnit(); }
  Object.assign(S.route, { v }, extra);
  if (v === "setup" && !S.setupDirty) S.sd = null;
  if (v === "unit" && S.route.uid) openUnit(S.route.uid);
  if (v === "snags") subscribeQueue();
  render(); window.scrollTo(0, 0);
}
$("#tabs").addEventListener("click", e => { const b = e.target.closest("button[data-v]"); if (b) go(b.dataset.v); });

function render() {
  $("#pname").textContent = cfg().name || "KVD Windpark";
  $$("#tabs button").forEach(b => {
    const cur = S.route.v === b.dataset.v || (S.route.v === "unit" && b.dataset.v === "towers");
    b.toggleAttribute("aria-current", false); if (cur) b.setAttribute("aria-current", "page");
    if (b.dataset.v === "setup") b.hidden = !can.setup();
  });
  renderWho();
  const v = $("#view");
  const banner = bannerHTML();
  let html = "";
  if (!S.configLoaded && S.db) html = `<div class="empty">Loading project…</div>`;
  else if (S.route.v === "overview") html = viewOverview();
  else if (S.route.v === "towers") html = viewTowers();
  else if (S.route.v === "unit") html = viewUnit();
  else if (S.route.v === "snags") html = viewSnags();
  else if (S.route.v === "setup") html = can.setup() ? viewSetup() : `<div class="empty">Only the project admin can change setup.</div>`;
  v.innerHTML = banner + html;
  hydrate(v);
  if (S.route.v === "setup" && can.setup()) wireSetup();
  if (S.route.v === "unit" && S.route.utab === "handover") wireHandover();
}
function bannerHTML() {
  if (S.booting) return "";
  if (!S.db) return `<div class="banner warn">Shared project data isn't available in this view. Open the page on claude.ai while signed in; entries can't be saved until then.</div>`;
  if (S.configLoaded && !S.config) return can.setup()
    ? `<div class="banner">The project isn't set up yet. The towers below are a draft (Phase 1: towers 1, 2, 3, 6 and 7, 24 floors × 4 flats). <button class="btn sm primary" onclick="go('setup')">Open setup</button></div>`
    : `<div class="banner">The project admin hasn't finished setup yet. You can look around, but flats may change.</div>`;
  return "";
}
function renderWho() {
  const r = myRole();
  $("#who").innerHTML = S.me.id
    ? `<img src="${esc(S.me.avatarUrl)}" alt=""><span>${esc(S.me.name || "You")}</span><span class="role">${esc(ROLES[r.role])}${r.team ? " · " + esc(teamName(r.team)) : ""}</span>${FB ? `<button class="btn sm ghost" onclick="window.fbSignOut()">Sign out</button>` : ""}`
    : `<span class="muted small">Not signed in</span>`;
}

/* ---------- overview ---------- */
function viewOverview() {
  let tot = UNITS.length, insp = 0, open = 0, fixed = 0, closed = 0, ho = 0, rd = 0, age7 = 0, crit = 0;
  const teamOpen = {}, now = Date.now();
  for (const u of UNITS) {
    const s = sumOf(u.id);
    if (s.p === 100) insp++;
    open += s.o; fixed += s.fx; closed += s.c; crit += s.cr; if (s.h) ho++; if (s.s === "rd") rd++;
    if (s.od && now - s.od > 7 * DAY) age7++;
    for (const x of s.tm || []) teamOpen[x.t] = (teamOpen[x.t] || 0) + x.n;
  }
  const towers = towersInUse().map(T => {
    const us = UNITS.filter(u => u.t === T.id), c = { ni: 0, ip: 0, op: 0, vf: 0, rd: 0, ho: 0 }; let o = 0;
    us.forEach(u => { const s = sumOf(u.id); c[s.s]++; o += s.o; });
    const bars = Object.keys(c).map(k => c[k] ? `<i class="bar-${k}" style="width:${(c[k] * 100 / us.length).toFixed(2)}%" title="${STATUS[k]}: ${c[k]}"></i>` : "").join("");
    return `<button class="tower-row" onclick="go('towers',{tower:'${esc(T.id)}'})"><div><h3>${esc(T.name)}</h3><div class="small muted mono">${us.length} flats</div></div>
      <div class="stack" role="img" aria-label="${esc(T.name)} status">${bars}</div>
      <div class="n small mono">${c.ho} handed · <span class="${o ? "st-op" : ""}">${o} open</span></div></button>`;
  }).join("");
  const tmax = Math.max(1, ...Object.values(teamOpen));
  const teamBars = Object.entries(teamOpen).sort((a, b) => b[1] - a[1]).map(([t, n]) =>
    `<div class="hbar"><span>${esc(teamName(t))}</span><div class="track"><i style="width:${(n * 100 / tmax).toFixed(1)}%"></i></div><b class="mono">${n}</b></div>`).join("");
  return `
  <div class="spread"><h2>Project status</h2><span class="small muted">${tot} flats across ${towersInUse().length} towers</span></div>
  <div class="kpis">
    <div class="kpi"><span class="label">Inspected</span><b>${insp}</b><span class="small">of ${tot} flats fully checked</span></div>
    <div class="kpi"><span class="label">Open snags</span><b class="st-op">${open}</b><span class="small">${crit} critical or major</span></div>
    <div class="kpi"><span class="label">Awaiting QC</span><b class="st-vf">${fixed}</b><span class="small">marked fixed by teams</span></div>
    <div class="kpi"><span class="label">Closed</span><b class="st-rd">${closed}</b><span class="small">verified by QC</span></div>
    <div class="kpi"><span class="label">Ready</span><b>${rd}</b><span class="small">flats ready for handover</span></div>
    <div class="kpi"><span class="label">Handed over</span><b class="st-ho">${ho}</b><span class="small">${age7} flats have snags older than 7 days</span></div>
  </div>
  <div class="grid2">
    <section class="panel"><div class="spread"><h3>Towers</h3>${legend()}</div><div class="tower-rows">${towers || `<div class="empty">No towers configured.</div>`}</div></section>
    <section class="panel"><h3>Open snags by team</h3>${teamBars ? `<div class="hbars">${teamBars}</div>` : `<div class="empty">No open snags. Start by opening a flat under Towers and working through the checklist.</div>`}</section>
  </div>`;
}
function legend() { return `<div class="legend">${Object.keys(STATUS).map(k => `<span><i class="bar-${k}"></i>${STATUS[k]}</span>`).join("")}</div>`; }

/* ---------- towers ---------- */
function viewTowers() {
  const ts = towersInUse();
  const tid = S.route.tower && ts.find(t => t.id === S.route.tower) ? S.route.tower : (ts[0] && ts[0].id);
  S.route.tower = tid;
  const us = UNITS.filter(u => u.t === tid);
  const floors = [...new Set(us.map(u => u.f))].sort((a, b) => b - a);
  const byFloor = {}; us.forEach(u => (byFloor[u.f] = byFloor[u.f] || []).push(u));
  const cols = Math.max(1, ...Object.values(byFloor).map(a => a.length));
  const rows = floors.map(f => {
    const cells = byFloor[f].sort((a, b) => a.n.localeCompare(b.n, undefined, { numeric: true })).map(u => {
      const s = sumOf(u.id);
      return `<button class="cell c-${s.s}" onclick="go('unit',{uid:'${esc(u.id)}',utab:'inspect'})" title="${esc(u.n)} · ${esc(u.ty)} · ${STATUS[s.s]}${s.o ? " · " + s.o + " open" : ""}">${esc(u.n)}${s.o ? `<sup>${s.o}</sup>` : ""}</button>`;
    }).join("");
    return `<div class="fl">${f === 0 ? "G" : f}</div>${cells}${"<span></span>".repeat(cols - byFloor[f].length)}`;
  }).join("");
  return `
  <div class="spread"><h2>${esc(towerName(tid) || "Towers")}</h2><div class="chips">${ts.map(t => `<button class="chip" aria-pressed="${t.id === tid}" onclick="go('towers',{tower:'${esc(t.id)}'})">${esc(t.name)}</button>`).join("")}</div></div>
  ${legend()}
  ${us.length ? `<div class="tgrid-wrap"><div class="tgrid" style="grid-template-columns:34px repeat(${cols},minmax(58px,1fr))">${rows}</div></div>
  <p class="small muted">Tap a flat to inspect it. The small red number is open snags.</p>` : `<div class="empty">No flats in this tower yet.</div>`}`;
}

/* ---------- unit ---------- */
function openUnit(uid) {
  if (S.unit && S.unit.id === uid) return;
  closeUnit();
  S.unit = { id: uid, data: null, exists: false, loaded: false, unsub: null };
  if (!S.db) return;
  S.unit.unsub = S.db.doc("units/" + uid).onSnapshot(snap => {
    if (!S.unit || S.unit.id !== uid) return;
    S.unit.exists = snap.exists; S.unit.loaded = true;
    S.unit.data = snap.exists ? clone(snap.data()) : null;
    if (pendUid === uid && Object.keys(pendChecks).length) { S.unit.data = S.unit.data || newUnit(uid); S.unit.data.checks = { ...(S.unit.data.checks || {}), ...pendChecks }; }
    if (S.route.v === "unit" && !sheetOpen() && !S.hoDirty) { const y = window.scrollY; render(); window.scrollTo(0, y); }
  }, () => {});
}
function closeUnit() { if (S.unit && S.unit.unsub) S.unit.unsub(); S.unit = null; S.hoDirty = false; }
const U = () => (S.unit && S.unit.data) || newUnit(S.route.uid);

function viewUnit() {
  const uid = S.route.uid, u = UIDX[uid];
  if (!u) return `<div class="empty">This flat isn't in the project list. <button class="btn sm" onclick="go('towers')">Back to towers</button></div>`;
  const d = U(), m = computeMeta(uid, d);
  const snags = Object.values(d.snags || {}).filter(s => s.st !== "void");
  const tab = S.route.utab || "inspect";
  const tabs = [["inspect", `Inspection · ${m.p}%`], ["snags", `Snags · ${m.o + m.fx}`], ["handover", "Handover"]];
  let body = "";
  if (S.unit && !S.unit.loaded && S.db) body = `<div class="empty">Loading flat…</div>`;
  else if (tab === "inspect") body = viewInspect(uid, u, d);
  else if (tab === "snags") body = viewUnitSnags(uid, d);
  else body = viewHandover(uid, u, d, m);
  return `
  <div class="unit-head">
    <div class="t">
      <div class="crumbs"><button onclick="go('towers',{tower:'${esc(u.t)}'})">${esc(towerName(u.t))}</button><span>›</span><span>Floor ${u.f === 0 ? "G" : u.f}</span></div>
      <h2><span class="mono">${esc(u.n)}</span> · ${esc(u.ty)}${u.a ? ` <span class="small muted">${esc(u.a)} sq ft</span>` : ""}</h2>
      <div class="row small"><span class="pill st-${m.sum.s}">${STATUS[m.sum.s]}</span><span class="muted">${m.done} of ${m.total} checks · ${snags.length} snags logged</span></div>
    </div>
    <div class="row">${can.raise() ? `<button class="btn primary" onclick="newSnag('${esc(uid)}')">+ Snag</button>` : ""}</div>
  </div>
  <div class="subtabs">${tabs.map(([k, l]) => `<button class="chip" aria-pressed="${k === tab}" onclick="S.route.utab='${k}';render()">${l}</button>`).join("")}</div>
  ${body}`;
}

function viewInspect(uid, u, d) {
  const ch = d.checks || {}, snags = d.snags || {}, edit = can.inspect();
  return roomsFor(u.ty).map(r => {
    const kind = CL.kinds[r.kind]; if (!kind) return "";
    const list = checksFor(u.ty).filter(x => x.room.key === r.key);
    const done = list.filter(x => ch[x.k]).length, ns = list.filter(x => String(ch[x.k] || "").startsWith("s:")).length;
    const open = S.openRooms.has(uid + r.key);
    const groups = open ? kind.groups.map(g => {
      const items = BYGROUP[g] || [];
      const rows = items.map(it => {
        const k = r.key + "|" + it.id, v = ch[k] || "";
        const sg = v.startsWith("s:") ? snags[v.slice(2)] : null;
        return `<div class="item" data-k="${esc(k)}">
          <div class="txt"><div>${esc(it.t)}</div><div class="small muted">${esc(it.c)} · <span class="mono">${it.id}</span> · <span class="sev sev-${it.sev}">${it.sev}</span></div></div>
          <div class="tri" role="group" aria-label="Result">
            <button class="ok" aria-pressed="${v === "ok"}" ${edit ? "" : "disabled"} onclick="setCheck('${esc(uid)}','${esc(k)}','ok')">OK</button>
            <button class="na" aria-pressed="${v === "na"}" ${edit ? "" : "disabled"} onclick="setCheck('${esc(uid)}','${esc(k)}','na')">N/A</button>
            <button class="sg" aria-pressed="${!!sg}" ${edit ? "" : "disabled"} onclick="${sg ? `openSnag('${esc(uid)}','${esc(sg.id)}')` : `newSnag('${esc(uid)}','${esc(r.key)}','${it.id}')`}">Snag</button>
          </div>
          ${sg ? `<button class="snaglink" onclick="openSnag('${esc(uid)}','${esc(sg.id)}')"><span class="mono">#${sg.no}</span><span class="pill s-${sg.st}">${SNAGST[sg.st]}</span><span>${esc(teamName(sg.team))}</span>${sg.d ? `<span class="muted">${esc(sg.d.slice(0, 60))}</span>` : ""}</button>` : ""}
        </div>`;
      }).join("");
      const left = items.filter(it => !ch[r.key + "|" + it.id]).length;
      return `<div class="grp"><div class="grp-h"><span class="label">${esc(CL.groups[g])}</span>${edit && left ? `<button class="btn sm ghost" onclick="markRest('${esc(uid)}','${esc(r.key)}','${g}')">Mark ${left} remaining OK</button>` : ""}</div>${rows}</div>`;
    }).join("") : "";
    return `<details class="room" ${open ? "open" : ""} data-room="${esc(r.key)}" ontoggle="roomToggle(this,'${esc(uid)}')">
      <summary><div><h3>${esc(r.label)}</h3><span class="small muted">${esc(kind.label)}</span></div><span class="small mono">${done}/${list.length}${ns ? ` · <span class="st-op">${ns} snag${ns > 1 ? "s" : ""}</span>` : ""}</span>
      <div class="progress"><i style="width:${list.length ? done * 100 / list.length : 0}%"></i></div></summary>${groups}</details>`;
  }).join("") + (edit ? "" : `<p class="small muted">Your role can view the checklist. QC inspectors and admins record results.</p>`);
}
function roomToggle(el, uid) {
  const k = uid + el.dataset.room, was = S.openRooms.has(k);
  if (el.open === was) return;
  if (el.open) S.openRooms.add(k); else S.openRooms.delete(k);
  if (el.open) { const y = window.scrollY; render(); window.scrollTo(0, y); }
}
function setCheck(uid, k, v) {
  const cur = (U().checks || {})[k];
  if (String(cur || "").startsWith("s:")) { toast("This item has a snag. Close or void the snag instead."); return; }
  queueCheck(uid, { [k]: cur === v ? null : v });
  const y = window.scrollY; render(); window.scrollTo(0, y);
}
function markRest(uid, rkey, g) {
  const ch = U().checks || {}, patch = {};
  for (const it of BYGROUP[g] || []) { const k = rkey + "|" + it.id; if (!ch[k]) patch[k] = "ok"; }
  queueCheck(uid, patch); const y = window.scrollY; render(); window.scrollTo(0, y);
}

function viewUnitSnags(uid, d) {
  const all = Object.values(d.snags || {}).sort((a, b) => a.no - b.no);
  if (!all.length) return `<div class="empty">No snags on this flat yet. Tap “Snag” on any checklist item, or “+ Snag” above for something not on the list.</div>`;
  return snagList(all.map(s => ({ uid, s })), false);
}
function snagList(rows, showUnit) {
  const now = Date.now();
  return `<div class="slist">${rows.map(({ uid, s }) => {
    const u = UIDX[uid] || {}, room = (roomsFor(u.ty).find(r => r.key === s.room) || {}).label || s.room || "";
    const late = s.due && (s.st === "open") && now > s.due;
    return `<button class="srow sv-${s.sev}" onclick="openSnag('${esc(uid)}','${esc(s.id)}')">
      <span class="stripe"></span>
      <span class="main"><span class="t">${esc(s.title)}</span>
        <span class="meta">${showUnit ? `<span class="mono">${esc(towerName(u.t))} · ${esc(u.n)}</span>` : ""}<span class="mono">#${s.no}</span><span>${esc(room)}</span><span>${esc(teamName(s.team))}</span>${s.src === "customer" ? "<span>Customer</span>" : ""}<span class="${late ? "overdue" : ""}">${s.st === "closed" ? "Closed " + fmtD(s.cl) : s.due ? "Due " + fmtD(s.due) : "Raised " + fmtD(s.at)}</span>${(s.ph || []).length ? `<span>${s.ph.length} photo${s.ph.length > 1 ? "s" : ""}</span>` : ""}</span></span>
      <span class="side"><span class="pill s-${s.st}">${SNAGST[s.st]}</span><span class="sev sev-${s.sev}">${s.sev}</span></span>
    </button>`;
  }).join("")}</div>`;
}

/* ---------- snag queue ---------- */
function queueKey() { const f = S.qf; return [f.scope, f.team, f.tower].join("|"); }
function subscribeQueue() {
  if (!S.db) return;
  const r = myRole();
  if (!S.qf.init) { S.qf.init = true; if (r.role === "team" && r.team) { S.qf.team = r.team; } if (r.role === "qc") S.qf.scope = "fixed"; }
  const key = queueKey(); if (S.queue.key === key && S.queue.unsub) return;
  if (S.queue.unsub) S.queue.unsub();
  S.queue = { docs: [], unsub: null, key, loading: true };
  let q = S.db.collection("units");
  const f = S.qf;
  if (f.scope === "open" && f.team) q = q.where("openTeams", "array-contains", f.team);
  else if (f.scope === "open") q = q.where("openCount", ">", 0);
  else if (f.scope === "fixed") q = q.where("fixedCount", ">", 0);
  else if (f.scope === "closed") q = q.where("closedCount", ">", 0);
  if (f.tower) q = q.where("tower", "==", f.tower);
  q = q.limit(1000);
  S.queue.unsub = q.onSnapshot(snap => {
    S.queue.docs = snap.docs.map(d => ({ id: d.id, data: d.data() })); S.queue.loading = false;
    if (S.route.v === "snags" && !sheetOpen()) { const y = window.scrollY; render(); window.scrollTo(0, y); }
  }, e => { S.queue.loading = false; S.queue.err = e; if (S.route.v === "snags") render(); });
}
function queueRows() {
  const f = S.qf, rows = [];
  const want = { open: ["open"], fixed: ["fixed"], closed: ["closed"], all: ["open", "fixed", "closed"] }[f.scope] || ["open"];
  for (const d of S.queue.docs) for (const s of Object.values(d.data.snags || {})) {
    if (!want.includes(s.st)) continue;
    if (f.team && s.team !== f.team) continue;
    if (f.sev && s.sev !== f.sev) continue;
    rows.push({ uid: d.id, s });
  }
  rows.sort((a, b) => (SEVORDER[a.s.sev] - SEVORDER[b.s.sev]) || (a.s.at - b.s.at));
  return rows;
}
function setQF(k, v) { S.qf[k] = v; subscribeQueue(); render(); }
function viewSnags() {
  const f = S.qf, rows = queueRows();
  const opt = (v, l, cur) => `<option value="${esc(v)}" ${v === cur ? "selected" : ""}>${esc(l)}</option>`;
  const scopes = [["open", "Open"], ["fixed", "Fixed – awaiting QC"], ["closed", "Closed"], ["all", "All"]];
  return `
  <div class="spread"><h2>Snags</h2><button class="btn" ${rows.length ? "" : "disabled"} onclick="exportCSV()">Export CSV</button></div>
  <div class="chips">${scopes.map(([k, l]) => `<button class="chip" aria-pressed="${f.scope === k}" onclick="setQF('scope','${k}')">${l}</button>`).join("")}</div>
  <div class="filters">
    <label class="field"><span>Team</span><select id="qf-team" onchange="setQF('team',this.value)">${opt("", "All teams", f.team)}${cfg().teams.map(t => opt(t.id, t.name, f.team)).join("")}</select></label>
    <label class="field"><span>Tower</span><select id="qf-tower" onchange="setQF('tower',this.value)">${opt("", "All towers", f.tower)}${towersInUse().map(t => opt(t.id, t.name, f.tower)).join("")}</select></label>
    <label class="field"><span>Severity</span><select id="qf-sev" onchange="setQF('sev',this.value)">${opt("", "All", f.sev)}${CL.severity.map(s => opt(s.id, s.name, f.sev)).join("")}</select></label>
  </div>
  ${S.queue.loading ? `<div class="empty">Loading snags…</div>` : rows.length ? `<p class="small muted">${rows.length} snag${rows.length > 1 ? "s" : ""}, most severe and oldest first.</p>` + snagList(rows, true)
      : `<div class="empty">Nothing here for these filters.</div>`}`;
}
function exportCSV() {
  const rows = queueRows();
  const head = ["Tower", "Floor", "Flat", "Type", "Snag no", "Room", "Item ID", "Title", "Details", "Team", "Severity", "Status", "Source", "Raised", "Target", "Closed"];
  const lines = [head.join(",")].concat(rows.map(({ uid, s }) => {
    const u = UIDX[uid] || {}, room = (roomsFor(u.ty).find(r => r.key === s.room) || {}).label || s.room;
    return [towerName(u.t), u.f, u.n, u.ty, s.no, room, s.item || "", s.title, s.d || "", teamName(s.team), s.sev, SNAGST[s.st], s.src || "qc",
      s.at ? isoDay(s.at) : "", s.due ? isoDay(s.due) : "", s.cl ? isoDay(s.cl) : ""].map(csvCell).join(",");
  }));
  offerFile(`KVD-snags-${isoDay(Date.now())}.csv`, lines.join("\n"));
}

/* ---------- sheet (modal) ---------- */
const sheetOpen = () => !$("#sheet").hidden;
function showSheet(html) { $("#sheetIn").innerHTML = html; $("#sheet").hidden = false; hydrate($("#sheetIn")); const f = $("#sheetIn input,#sheetIn select,#sheetIn textarea,#sheetIn button"); if (f) f.focus({ preventScroll: true }); }
function closeSheet() { $("#sheet").hidden = true; $("#sheetIn").innerHTML = ""; S.pendingPhotos = []; const y = window.scrollY; render(); window.scrollTo(0, y); }
$("#sheet").addEventListener("click", e => { if (e.target.id === "sheet") closeSheet(); });
document.addEventListener("keydown", e => { if (e.key === "Escape") { if (!$("#lightbox").hidden) $("#lightbox").hidden = true; else if (sheetOpen()) closeSheet(); } });
document.addEventListener("click", e => {
  const img = e.target.closest("img[data-ref]"); if (!img || !img.src) return;
  $("#lbimg").src = img.src; $("#lightbox").hidden = false;
});
$("#lightbox").addEventListener("click", () => $("#lightbox").hidden = true);

function unitData(uid) {
  if (S.unit && S.unit.id === uid) return U();
  const q = S.queue.docs.find(x => x.id === uid); return q ? q.data : newUnit(uid);
}
const opt = (v, l, cur) => `<option value="${esc(v)}" ${v === cur ? "selected" : ""}>${esc(l)}</option>`;
function sevSeg(name, cur) {
  return `<div class="seg" role="radiogroup">${CL.severity.map(s => `<label><input type="radio" name="${name}" value="${s.id}" ${s.id === cur ? "checked" : ""}>${s.name}</label>`).join("")}</div>`;
}

/* new snag */
function newSnag(uid, roomKey, itemId, src) {
  if (!can.raise()) { toast("Your role can't raise snags."); return; }
  const u = UIDX[uid], rooms = roomsFor(u.ty);
  const room = rooms.find(r => r.key === roomKey) || rooms[0];
  const it = itemId ? ITEMS[itemId] : null;
  S.pendingPhotos = [];
  S.newCtx = { uid, itemId: itemId || "" };
  const kindItems = r => (CL.kinds[r.kind] || { groups: [] }).groups.flatMap(g => BYGROUP[g] || []);
  S.kindItems = kindItems;
  showSheet(`
    <div class="spread"><h2>New snag · <span class="mono">${esc(u.n)}</span></h2><button class="btn ghost" onclick="closeSheet()">Cancel</button></div>
    <form id="nsf" class="panel" style="border:0;padding:0" onsubmit="event.preventDefault();saveNewSnag()">
      <div class="grid2">
        <label class="field"><span>Room</span><select id="ns-room" onchange="nsRoomChange()">${rooms.map(r => opt(r.key, r.label, room.key)).join("")}</select></label>
        <label class="field"><span>Checklist item</span><select id="ns-item" onchange="nsItemChange()">${opt("", "Not on checklist", it ? "-" : "")}${kindItems(room).map(i => opt(i.id, i.id + " · " + i.t.slice(0, 70), it ? it.id : "")).join("")}</select></label>
      </div>
      <label class="field"><span>What's wrong</span><input type="text" id="ns-title" required maxlength="140" value="${esc(it ? it.t : "")}" placeholder="e.g. Hollow tile near door, 3 nos"></label>
      <label class="field"><span>Details, location, quantity</span><textarea id="ns-d" placeholder="e.g. 2nd and 3rd tile from balcony door, left side"></textarea></label>
      <div class="grid2">
        <label class="field"><span>Assign to team</span><select id="ns-team">${cfg().teams.map(t => opt(t.id, t.name, it ? it.team : "civil")).join("")}</select></label>
        <label class="field"><span>Target date</span><input type="date" id="ns-due" value="${isoDay(Date.now() + SEVDAYS[it ? it.sev : "minor"] * DAY)}"></label>
      </div>
      <div class="field"><span>Severity</span>${sevSeg("ns-sev", it ? it.sev : "minor")}</div>
      <div class="field"><span>Raised by</span><div class="seg"><label><input type="radio" name="ns-src" value="qc" ${src === "customer" ? "" : "checked"}>QC inspection</label><label><input type="radio" name="ns-src" value="customer" ${src === "customer" ? "checked" : ""}>Customer walk-through</label></div></div>
      <div class="field"><span>Photos</span><input type="file" id="ns-ph" accept="image/*" capture="environment" multiple onchange="pickPhotos(this,'ns-thumbs')"><div class="thumbs" id="ns-thumbs"></div></div>
      <div class="row"><button class="btn primary" type="submit" id="ns-save">Save snag</button><span class="small muted" id="ns-msg"></span></div>
    </form>`);
  $$("input[name=ns-sev]").forEach(r => r.addEventListener("change", () => { $("#ns-due").value = isoDay(Date.now() + SEVDAYS[r.value] * DAY); }));
}
function nsRoomChange() {
  const u = UIDX[S.newCtx.uid], r = roomsFor(u.ty).find(x => x.key === $("#ns-room").value);
  $("#ns-item").innerHTML = opt("", "Not on checklist", "") + S.kindItems(r).map(i => opt(i.id, i.id + " · " + i.t.slice(0, 70), "")).join("");
}
function nsItemChange() {
  const it = ITEMS[$("#ns-item").value]; if (!it) return;
  $("#ns-title").value = it.t; $("#ns-team").value = it.team;
  const r = $(`input[name=ns-sev][value=${it.sev}]`); if (r) r.checked = true;
  $("#ns-due").value = isoDay(Date.now() + SEVDAYS[it.sev] * DAY);
}
function pickPhotos(input, thumbsId) {
  const files = [...input.files]; S.pendingPhotos = (S.pendingPhotos || []).concat(files); input.value = "";
  const box = $("#" + thumbsId);
  box.innerHTML = S.pendingPhotos.map((f, i) => `<img src="${URL.createObjectURL(f)}" alt="Photo ${i + 1} to upload">`).join("");
}
async function uploadPending(msgEl) {
  const refs = [], files = S.pendingPhotos || [];
  for (let i = 0; i < files.length; i++) { if (msgEl) msgEl.textContent = `Uploading photo ${i + 1} of ${files.length}…`; refs.push(await savePhoto(files[i])); }
  S.pendingPhotos = []; return refs;
}
async function saveNewSnag() {
  const uid = S.newCtx.uid, btn = $("#ns-save"), msg = $("#ns-msg");
  btn.disabled = true;
  try {
    const ph = await uploadPending(msg);
    msg.textContent = "Saving…";
    const d = unitData(uid), no = Math.max(0, ...Object.values(d.snags || {}).map(s => s.no || 0)) + 1;
    const id = rid(), room = $("#ns-room").value, item = $("#ns-item").value || null, now = Date.now();
    const sev = ($("input[name=ns-sev]:checked") || {}).value || "minor";
    const dueV = $("#ns-due").value;
    const s = { id, no, room, item, title: $("#ns-title").value.trim(), d: $("#ns-d").value.trim(), team: $("#ns-team").value, sev, st: "open",
      src: ($("input[name=ns-src]:checked") || {}).value || "qc", by: S.me.id, at: now, due: dueV ? new Date(dueV + "T18:00:00").getTime() : null,
      ph, fph: [], h: [{ t: now, by: S.me.id, a: "Raised", n: "" }] };
    const patch = { snags: { [id]: s } };
    if (item) patch.checks = { [room + "|" + item]: "s:" + id };
    if (pendUid === uid) flushChecks();
    await writeUnit(uid, patch);
    toast(`Snag #${no} saved and assigned to ${teamName(s.team)}`);
    closeSheet();
  } catch (e) { btn.disabled = false; msg.textContent = errMsg(e); }
}

/* snag detail */
function openSnag(uid, sid) {
  const d = unitData(uid), s = (d.snags || {})[sid];
  if (!s) { toast("That snag couldn't be found."); return; }
  const u = UIDX[uid] || {}, room = (roomsFor(u.ty).find(r => r.key === s.room) || {}).label || s.room;
  S.pendingPhotos = []; S.detailCtx = { uid, sid };
  const it = s.item ? ITEMS[s.item] : null, late = s.due && s.st === "open" && Date.now() > s.due;
  const acts = [];
  if (s.st === "open" && can.fix(s)) acts.push(`<button class="btn primary" onclick="snagAct('fixed')">Mark fixed</button>`);
  if (s.st === "fixed" && can.verify()) acts.push(`<button class="btn primary" onclick="snagAct('closed')">Verify &amp; close</button>`, `<button class="btn danger" onclick="snagAct('open')">Reopen</button>`);
  if (s.st === "closed" && can.verify()) acts.push(`<button class="btn danger" onclick="snagAct('open')">Reopen</button>`);
  if (s.st === "open" && can.verify()) acts.push(`<button class="btn" onclick="snagAct('closed')">Close without fix report</button>`, `<button class="btn ghost" onclick="snagAct('void')">Void (not a snag)</button>`);
  if (s.st === "void" && can.verify()) acts.push(`<button class="btn" onclick="snagAct('open')">Restore</button>`);
  const editable = can.verify() && s.st !== "closed" && s.st !== "void";
  showSheet(`
    <div class="spread"><div class="row"><span class="mono">${esc(towerName(u.t))} · ${esc(u.n)} · #${s.no}</span><span class="pill s-${s.st}">${SNAGST[s.st]}</span></div><button class="btn ghost" onclick="closeSheet()">Close</button></div>
    <div><h2>${esc(s.title)}</h2><div class="meta" style="margin-top:6px"><span>${esc(room)}</span>${it ? `<span class="mono">${it.id}</span>` : ""}<span>${s.src === "customer" ? "Raised by customer" : "QC inspection"}</span><span>Raised ${fmtDT(s.at)} by ${nameSpan(s.by)}</span></div></div>
    ${s.d ? `<p style="margin:0">${esc(s.d)}</p>` : ""}
    ${it ? `<p class="small muted" style="margin:0">Acceptance: ${esc(it.c)}</p>` : ""}
    ${editable ? `<div class="grid2">
        <label class="field"><span>Team</span><select id="sd-team">${cfg().teams.map(t => opt(t.id, t.name, s.team)).join("")}</select></label>
        <label class="field"><span>Target date</span><input type="date" id="sd-due" value="${s.due ? isoDay(s.due) : ""}"></label></div>
        <div class="field"><span>Severity</span>${sevSeg("sd-sev", s.sev)}</div>
        <div><button class="btn sm" onclick="snagEdit()">Save changes</button></div>`
      : `<div class="meta"><span>Team: <b>${esc(teamName(s.team))}</b></span><span class="sev sev-${s.sev}">${s.sev}</span><span class="${late ? "overdue" : ""}">${s.due ? "Target " + fmtD(s.due) : "No target date"}</span></div>`}
    ${(s.ph || []).length ? `<div class="field"><span>Photos when raised</span><div class="thumbs">${thumbs(s.ph)}</div></div>` : ""}
    ${(s.fph || []).length ? `<div class="field"><span>Photos after fix</span><div class="thumbs">${thumbs(s.fph)}</div></div>` : ""}
    ${acts.length ? `<div class="panel" style="background:var(--surface-2)">
      <label class="field"><span>Note (optional)</span><textarea id="sd-note" placeholder="${s.st === "open" ? "What was done" : "Reason"}"></textarea></label>
      <div class="field"><span>${s.st === "open" ? "Photo after fix" : "Add photo"}</span><input type="file" id="sd-ph" accept="image/*" capture="environment" multiple onchange="pickPhotos(this,'sd-thumbs')"><div class="thumbs" id="sd-thumbs"></div></div>
      <div class="row">${acts.join("")}<span class="small muted" id="sd-msg"></span></div></div>` : ""}
    <div class="field"><span>History</span><div class="hist">${(s.h || []).slice().reverse().map(h => `<div><b>${esc(h.a)}</b> · ${nameSpan(h.by)} · <span class="muted">${fmtDT(h.t)}</span>${h.n ? `<div>${esc(h.n)}</div>` : ""}</div>`).join("")}</div></div>
    ${S.route.v !== "unit" ? `<div><button class="btn sm" onclick="closeSheet();go('unit',{uid:'${esc(uid)}',utab:'snags'})">Open flat ${esc(u.n)}</button></div>` : ""}`);
}
async function snagAct(to) {
  const { uid, sid } = S.detailCtx, msg = $("#sd-msg");
  $$("#sheetIn .panel .btn").forEach(b => b.disabled = true);
  try {
    const d = unitData(uid), s = clone(d.snags[sid]), now = Date.now();
    const refs = await uploadPending(msg);
    const label = { fixed: "Marked fixed", closed: s.st === "fixed" ? "Verified and closed" : "Closed", open: s.st === "void" ? "Restored" : "Reopened", void: "Voided" }[to];
    if (to === "fixed" || s.st === "fixed" && to === "open") s.fph = (s.fph || []).concat(refs); else s.ph = (s.ph || []).concat(refs);
    if (to === "fixed" && !refs.length && !(s.fph || []).length && !$("#sd-note").value.trim()) { msg.textContent = "Add a photo or a note so QC can verify."; $$("#sheetIn .panel .btn").forEach(b => b.disabled = false); return; }
    s.st = to; if (to === "closed") s.cl = now; if (to === "open") s.cl = null;
    s.h = (s.h || []).concat([{ t: now, by: S.me.id, a: label, n: $("#sd-note").value.trim() }]);
    const patch = { snags: { [sid]: s } };
    if (s.item) { const k = s.room + "|" + s.item; if (to === "void") patch.checks = { [k]: null }; else if ((d.checks || {})[k] !== "s:" + sid) patch.checks = { [k]: "s:" + sid }; }
    await writeUnit(uid, patch);
    toast(`#${s.no}: ${label.toLowerCase()}`); closeSheet();
  } catch (e) { msg.textContent = errMsg(e); $$("#sheetIn .panel .btn").forEach(b => b.disabled = false); }
}
async function snagEdit() {
  const { uid, sid } = S.detailCtx, d = unitData(uid), s = clone(d.snags[sid]);
  const team = $("#sd-team").value, sev = ($("input[name=sd-sev]:checked") || {}).value || s.sev, dv = $("#sd-due").value;
  const due = dv ? new Date(dv + "T18:00:00").getTime() : null, notes = [];
  if (team !== s.team) notes.push(`Team: ${teamName(s.team)} → ${teamName(team)}`);
  if (sev !== s.sev) notes.push(`Severity: ${s.sev} → ${sev}`);
  if ((due || null) !== (s.due || null)) notes.push(`Target: ${fmtD(due)}`);
  if (!notes.length) { toast("Nothing changed."); return; }
  Object.assign(s, { team, sev, due }); s.h = (s.h || []).concat([{ t: Date.now(), by: S.me.id, a: "Edited", n: notes.join("; ") }]);
  try { await writeUnit(uid, { snags: { [sid]: s } }); toast("Snag updated"); openSnag(uid, sid); } catch (e) { toast(errMsg(e)); }
}

/* ---------- handover ---------- */
function hoDraft(uid, d) {
  if (!S.ho || S.ho.uid !== uid) S.ho = { uid, v: clone(d.handover || {}) };
  const v = S.ho.v; ["gate", "cust", "meters", "keys", "docs", "demo", "sig"].forEach(k => v[k] = v[k] || {});
  return v;
}
function hoGate(uid, d, m, v) {
  const minors = Object.values(d.snags || {}).filter(s => (s.st === "open" || s.st === "fixed") && s.sev === "minor");
  const rows = [
    [m.done === m.total && m.total > 0, `Inspection complete (${m.done}/${m.total} checks)`],
    [m.cr === 0, m.cr ? `${m.cr} critical or major snag${m.cr > 1 ? "s" : ""} still open or awaiting QC` : "No critical or major snags open"],
    [!minors.length || !!v.acceptMinor, minors.length ? `${minors.length} minor snag${minors.length > 1 ? "s" : ""} open: customer must accept them below` : "No minor snags open"],
    ...CL.handover.gate.map(g => [!!v.gate[g.id], g.label]),
    [!!(v.cust.name || "").trim(), "Customer name entered"],
    [!!v.sig.c && !!v.sig.r, "Customer and company signatures"],
  ];
  return { rows, ok: rows.every(r => r[0]), minors };
}
function viewHandover(uid, u, d, m) {
  const v = hoDraft(uid, d), g = hoGate(uid, d, m, v), edit = can.handover() && !v.done;
  const dis = edit ? "" : "disabled";
  const cb = (sec, it) => `<label><input type="checkbox" data-ho="${sec}.${it.id}" ${v[sec][it.id] ? "checked" : ""} ${dis}><span>${esc(it.label)}</span></label>`;
  const gateHTML = `<div class="gate">${g.rows.map(([ok, l]) => `<div><span class="${ok ? "ok" : "no"}" aria-hidden="true">${ok ? "✓" : "✕"}</span><span>${esc(l)}</span></div>`).join("")}</div>`;
  if (v.done) {
    return `<div class="done-stamp">Handed over on ${fmtDT(v.done)} to ${esc(v.cust.name || "customer")} · recorded by ${nameSpan(v.doneBy)}</div>
    <div class="grid2">
      <section class="panel"><h3>Meter readings</h3>${CL.handover.meters.map(x => `<div class="spread small"><span>${esc(x.label)}</span><b class="mono">${esc(v.meters[x.id] || "–")}</b></div>`).join("")}</section>
      <section class="panel"><h3>Keys handed</h3>${CL.handover.keys.map(x => `<div class="spread small"><span>${esc(x.label)}</span><b class="mono">${esc(v.keys[x.id] || "0")}</b></div>`).join("")}</section>
    </div>
    <section class="panel"><h3>Signatures</h3><div class="grid2"><div class="field"><span>Customer</span>${v.sig.c ? `<img class="sigimg" src="${esc(v.sig.c)}" alt="Customer signature">` : ""}</div><div class="field"><span>For the company</span>${v.sig.r ? `<img class="sigimg" src="${esc(v.sig.r)}" alt="Company signature">` : ""}</div></div></section>
    <div class="row"><button class="btn" onclick="hoDownload('${esc(uid)}')">Download handover record</button>${myRole().role === "admin" ? `<button class="btn danger" onclick="hoReopen('${esc(uid)}')">Reopen handover</button>` : ""}</div>`;
  }
  return `
  ${edit ? "" : `<div class="banner">Handover is recorded by CRM or admin. You can see progress here.</div>`}
  <section class="panel"><div class="spread"><h3>Before handover</h3><span class="pill ${g.ok ? "st-rd" : "st-op"}">${g.ok ? "Ready to hand over" : "Not ready"}</span></div>${gateHTML}
    <div class="checks">${CL.handover.gate.map(x => cb("gate", x)).join("")}</div></section>
  <section class="panel"><h3>Customer</h3><div class="grid2">
    <label class="field"><span>Customer name</span><input type="text" id="ho-cname" data-ho="cust.name" value="${esc(v.cust.name || "")}" ${dis}></label>
    <label class="field"><span>Phone</span><input type="tel" id="ho-cphone" data-ho="cust.phone" value="${esc(v.cust.phone || "")}" ${dis}></label>
    <label class="field"><span>Allotment / booking no.</span><input type="text" id="ho-calloc" data-ho="cust.alloc" value="${esc(v.cust.alloc || "")}" ${dis}></label>
    <label class="field"><span>Attended by (if not the allottee)</span><input type="text" id="ho-crep" data-ho="cust.rep" value="${esc(v.cust.rep || "")}" ${dis}></label></div>
    ${edit ? `<div><button class="btn sm" onclick="newSnag('${esc(uid)}',null,null,'customer')">+ Log a snag the customer points out</button></div>` : ""}</section>
  ${g.minors.length ? `<section class="panel"><h3>Minor snags still open</h3>${snagList(g.minors.map(s => ({ uid, s })), false)}
    <div class="checks"><label><input type="checkbox" data-ho="acceptMinor" ${v.acceptMinor ? "checked" : ""} ${dis}><span>Customer accepts handover with these ${g.minors.length} minor snags, to be fixed by their target dates</span></label></div></section>` : ""}
  <div class="grid2">
    <section class="panel"><h3>Meter readings</h3>${CL.handover.meters.map(x => `<label class="field"><span>${esc(x.label)}</span><input type="text" inputmode="decimal" id="ho-m-${x.id}" data-ho="meters.${x.id}" value="${esc(v.meters[x.id] || "")}" ${dis}></label>`).join("")}</section>
    <section class="panel"><h3>Keys handed (count)</h3>${CL.handover.keys.map(x => `<label class="field"><span>${esc(x.label)}</span><input type="number" min="0" id="ho-k-${x.id}" data-ho="keys.${x.id}" value="${esc(v.keys[x.id] || "")}" ${dis}></label>`).join("")}</section>
  </div>
  <section class="panel"><h3>Documents handed</h3><div class="checks">${CL.handover.docs.map(x => cb("docs", x)).join("")}</div></section>
  <section class="panel"><h3>Shown to customer</h3><div class="checks">${CL.handover.demo.map(x => cb("demo", x)).join("")}</div></section>
  <section class="panel"><h3>Remarks</h3><textarea id="ho-rem" data-ho="remarks" ${dis}>${esc(v.remarks || "")}</textarea></section>
  <section class="panel"><h3>Signatures</h3><div class="grid2">
    ${["c", "r"].map(k => `<div class="field"><span>${k === "c" ? "Customer" : "For the company"}</span>
      ${v.sig[k] && !edit ? `<img class="sigimg" src="${esc(v.sig[k])}" alt="Signature">` : `<canvas class="pad" id="pad-${k}" aria-label="Sign here"></canvas>`}
      ${edit ? `<div class="row"><button class="btn sm ghost" onclick="padClear('${k}')">Clear</button><span class="small muted">Sign with a finger or mouse</span></div>` : ""}</div>`).join("")}
  </div></section>
  ${edit ? `<div class="row"><button class="btn" onclick="hoSave('${esc(uid)}')">Save draft</button><button class="btn primary" ${g.ok ? "" : "disabled"} onclick="hoComplete('${esc(uid)}')">Complete handover</button><span class="small muted" id="ho-msg">${g.ok ? "" : "Complete every item above to enable handover."}</span></div>` : ""}`;
}
function setPath(o, path, val) { const ps = path.split("."); let c = o; ps.slice(0, -1).forEach(p => c = c[p] = c[p] || {}); c[ps[ps.length - 1]] = val; }
function wireHandover() {
  const v = S.ho && S.ho.v; if (!v || v.done) return;
  $$("[data-ho]").forEach(el => {
    const ev = el.type === "checkbox" ? "change" : "input";
    el.addEventListener(ev, () => {
      setPath(v, el.dataset.ho, el.type === "checkbox" ? el.checked : el.value); S.hoDirty = true;
      if (el.type === "checkbox") { const y = window.scrollY; render(); window.scrollTo(0, y); }
    });
    if (el.type !== "checkbox") el.addEventListener("change", () => { const y = window.scrollY; const a = document.activeElement && document.activeElement.id; render(); window.scrollTo(0, y); if (a && $("#" + a)) $("#" + a).focus({ preventScroll: true }); });
  });
  ["c", "r"].forEach(k => { const c = $("#pad-" + k); if (c) wirePad(c, k, v); });
}
function wirePad(c, k, v) {
  const dpr = Math.min(2, window.devicePixelRatio || 1), w = c.clientWidth, h = c.clientHeight;
  c.width = w * dpr; c.height = h * dpr;
  const ctx = c.getContext("2d"); ctx.scale(dpr, dpr); ctx.lineWidth = 2.2; ctx.lineCap = "round"; ctx.lineJoin = "round"; ctx.strokeStyle = "#111";
  if (v.sig[k]) { const i = new Image(); i.onload = () => ctx.drawImage(i, 0, 0, w, h); i.src = v.sig[k]; }
  let drawing = false;
  const pos = e => { const r = c.getBoundingClientRect(); return [e.clientX - r.left, e.clientY - r.top]; };
  c.addEventListener("pointerdown", e => { drawing = true; c.setPointerCapture(e.pointerId); const [x, y] = pos(e); ctx.beginPath(); ctx.moveTo(x, y); });
  c.addEventListener("pointermove", e => { if (!drawing) return; const [x, y] = pos(e); ctx.lineTo(x, y); ctx.stroke(); });
  const end = () => {
    if (!drawing) return; drawing = false;
    const out = document.createElement("canvas"); out.width = w; out.height = h; const o = out.getContext("2d");
    o.fillStyle = "#fff"; o.fillRect(0, 0, w, h); o.drawImage(c, 0, 0, w, h);
    v.sig[k] = out.toDataURL("image/png"); S.hoDirty = true;
    const y = window.scrollY; render(); window.scrollTo(0, y);
  };
  c.addEventListener("pointerup", end); c.addEventListener("pointercancel", end);
}
function padClear(k) { if (!S.ho) return; S.ho.v.sig[k] = null; S.hoDirty = true; const y = window.scrollY; render(); window.scrollTo(0, y); }
async function hoSave(uid, extra) {
  const v = clone(S.ho.v); Object.assign(v, extra || {});
  const m = $("#ho-msg"); if (m) m.textContent = "Saving…";
  try { await writeUnit(uid, { handover: v }); S.hoDirty = false; S.ho = null; toast(extra && extra.done ? "Handover complete" : "Handover draft saved"); render(); }
  catch (e) { if (m) m.textContent = errMsg(e); }
}
function hoComplete(uid) {
  const d = U(), m = computeMeta(uid, d), g = hoGate(uid, d, m, S.ho.v);
  if (!g.ok) { toast("Some handover items are still incomplete."); return; }
  hoSave(uid, { done: Date.now(), doneBy: S.me.id });
}
async function hoReopen(uid) {
  try { await writeUnit(uid, { handover: { done: null, doneBy: null } }); S.ho = null; toast("Handover reopened"); render(); } catch (e) { toast(errMsg(e)); }
}
function hoDownload(uid) {
  const d = U(), v = d.handover || {}, u = UIDX[uid] || {};
  const snags = Object.values(d.snags || {}).filter(s => s.st !== "void").sort((a, b) => a.no - b.no);
  const tr = (a, b) => `<tr><td>${esc(a)}</td><td>${esc(b)}</td></tr>`;
  const html = `<!doctype html><html><head><meta charset="utf-8"><title>Handover ${esc(u.id)}</title>
<style>body{font:13px/1.45 Arial,sans-serif;color:#111;max-width:800px;margin:24px auto;padding:0 16px}h1{font-size:20px;margin:0 0 4px}h2{font-size:14px;margin:22px 0 6px;border-bottom:1px solid #999;padding-bottom:3px}table{border-collapse:collapse;width:100%}td,th{border:1px solid #ccc;padding:4px 6px;text-align:left;vertical-align:top}th{background:#eee}img{max-height:90px;border:1px solid #ccc}</style></head><body>
<h1>${esc(cfg().name)}: flat handover record</h1><div>${esc(towerName(u.t))} · Flat ${esc(u.n)} · Floor ${esc(u.f)} · ${esc(u.ty)}</div>
<div>Handed over: ${fmtDT(v.done)}</div>
<h2>Customer</h2><table>${tr("Name", (v.cust || {}).name)}${tr("Phone", (v.cust || {}).phone)}${tr("Allotment no.", (v.cust || {}).alloc)}${tr("Attended by", (v.cust || {}).rep)}</table>
<h2>Meter readings</h2><table>${CL.handover.meters.map(x => tr(x.label, (v.meters || {})[x.id] || "")).join("")}</table>
<h2>Keys handed</h2><table>${CL.handover.keys.map(x => tr(x.label, (v.keys || {})[x.id] || "0")).join("")}</table>
<h2>Documents handed</h2><table>${CL.handover.docs.map(x => tr(x.label, (v.docs || {})[x.id] ? "Yes" : "No")).join("")}</table>
<h2>Shown to customer</h2><table>${CL.handover.demo.map(x => tr(x.label, (v.demo || {})[x.id] ? "Yes" : "No")).join("")}</table>
<h2>Snag register</h2><table><tr><th>#</th><th>Room</th><th>Snag</th><th>Team</th><th>Severity</th><th>Status</th></tr>${snags.map(s => `<tr><td>${s.no}</td><td>${esc((roomsFor(u.ty).find(r => r.key === s.room) || {}).label || s.room)}</td><td>${esc(s.title)}${s.d ? "<br>" + esc(s.d) : ""}</td><td>${esc(teamName(s.team))}</td><td>${esc(s.sev)}</td><td>${esc(SNAGST[s.st])}${s.st === "open" || s.st === "fixed" ? " (target " + fmtD(s.due) + ")" : ""}</td></tr>`).join("")}</table>
${v.acceptMinor ? "<p>The customer accepted handover with the open minor snags listed above, to be fixed by their target dates.</p>" : ""}
<h2>Remarks</h2><p>${esc(v.remarks || "None")}</p>
<h2>Signatures</h2><table><tr><th>Customer</th><th>For the company</th></tr><tr><td>${v.sig && v.sig.c ? `<img src="${v.sig.c}">` : ""}</td><td>${v.sig && v.sig.r ? `<img src="${v.sig.r}">` : ""}</td></tr></table>
</body></html>`;
  offerFile(`KVD-${uid}-handover.html`, html);
}

/* ---------- setup ---------- */
function setupDraft() { if (!S.sd) S.sd = clone(cfg()); return S.sd; }
function viewSetup() {
  const c = setupDraft(), n = previewCount(c);
  const towerRows = c.towers.map((t, i) => `<tr>
    <td><input type="text" id="tw-id-${i}" value="${esc(t.id)}" style="width:70px" onchange="twSet(${i},'id',this.value)"></td>
    <td><input type="text" id="tw-nm-${i}" value="${esc(t.name)}" onchange="twSet(${i},'name',this.value)"></td>
    <td><input type="number" id="tw-fl-${i}" min="1" max="80" value="${t.floors}" style="width:76px" onchange="twSet(${i},'floors',+this.value)"></td>
    <td><input type="number" id="tw-st-${i}" min="0" max="5" value="${t.start}" style="width:66px" onchange="twSet(${i},'start',+this.value)"></td>
    <td><input type="number" id="tw-fx-${i}" min="1" max="20" value="${t.flats}" style="width:66px" onchange="twSet(${i},'flats',+this.value)"></td>
    <td><input type="text" id="tw-ty-${i}" value="${esc(t.types.join(", "))}" onchange="twSet(${i},'types',this.value.split(',').map(s=>s.trim()).filter(Boolean))"></td>
    <td><button class="btn sm ghost" onclick="twDel(${i})" aria-label="Remove tower">Remove</button></td></tr>`).join("");
  const roomsTxt = ty => c.flatTypes[ty].map(r => `${r.key} | ${r.label} | ${r.kind}`).join("\n");
  return `
  <div class="spread"><h2>Project setup</h2><div class="row"><span class="small muted" id="set-msg">${S.setupDirty ? "Unsaved changes" : S.config ? "Saved" : "Not saved yet"}</span><button class="btn primary" onclick="saveSetup()">Save setup</button></div></div>
  <section class="panel"><h3>Project</h3><label class="field"><span>Project name</span><input type="text" id="set-name" value="${esc(c.name)}" onchange="S.sd.name=this.value;dirty()"></label>
    <p class="small muted" style="margin:0">${n} flats will be tracked${c.list && c.list.length ? " from the pasted apartment list" : " from the tower pattern below"}.</p></section>
  <section class="panel"><div class="spread"><h3>Towers</h3><button class="btn sm" onclick="twAdd()">Add tower</button></div>
    <p class="small muted" style="margin:0">Flat numbers are generated as floor × 100 + position (floor 12, position 3 → 1203). “Flat types by position” lists the type of flat 01, 02, 03… on a typical floor.${c.list && c.list.length ? " <b>An apartment list is loaded, so flats come from the list; tower names still come from here.</b>" : ""}</p>
    <div class="tbl-wrap"><table class="tbl"><tr><th>ID</th><th>Name</th><th>Floors</th><th>First floor</th><th>Flats / floor</th><th>Flat types by position</th><th></th></tr>${towerRows}</table></div></section>
  <section class="panel"><h3>Apartment list</h3>
    <p class="small muted" style="margin:0">Paste from the “Apartment list” sheet of the checklist workbook: Tower, Floor, Flat no., Type, Carpet area. Comma or tab separated, header row optional. This replaces the tower pattern.</p>
    <textarea id="set-list" rows="6" placeholder="T1,12,1203,3BHK,1450"></textarea>
    <div class="row"><button class="btn sm" onclick="parseList()">Load list</button>${c.list && c.list.length ? `<span class="small">${c.list.length} flats loaded.</span><button class="btn sm ghost" onclick="S.sd.list=null;dirty(true)">Clear list, use pattern</button>` : ""}<span class="small muted" id="list-msg"></span></div></section>
  <div class="grid2">
    <section class="panel"><h3>Teams</h3><p class="small muted" style="margin:0">One per line: <span class="mono">id | name</span>. Keep ids stable once snags exist.</p>
      <textarea id="set-teams" rows="12" onchange="parseTeams(this.value)">${esc(c.teams.map(t => t.id + " | " + t.name).join("\n"))}</textarea></section>
    <section class="panel"><h3>Rooms by flat type</h3><p class="small muted" style="margin:0">One room per line: <span class="mono">key | label | kind</span>. Kinds: ${Object.keys(CL.kinds).join(", ")}.</p>
      ${Object.keys(c.flatTypes).map(ty => `<label class="field"><span>${esc(ty)} · ${checksFor(ty).length} checks</span><textarea id="set-ft-${esc(ty)}" rows="7" onchange="parseRooms('${esc(ty)}',this.value)">${esc(roomsTxt(ty))}</textarea></label>`).join("")}
      <div class="row"><input type="text" id="set-newft" placeholder="New type, e.g. 3BHK+S" style="max-width:200px"><button class="btn sm" onclick="addFlatType()">Add type</button></div></section>
  </div>
  <section class="panel"><h3>People and roles</h3>
    <p class="small muted" style="margin:0">${FB ? "Everyone who has signed in appears here. New people have no access until you give them a role." : "Everyone who has opened this page appears here."} Contractor team members see their team's snags first and can mark them fixed. QC inspectors record inspections and verify fixes. CRM records handovers.</p>
    <div class="row"><input type="text" id="set-find" placeholder="Find a colleague by name" style="max-width:280px" oninput="findPeople(this.value)" onfocus="findPeople(this.value)"><div id="find-res" class="chips"></div></div>
    <div class="tbl-wrap" id="people-tbl"><div class="empty">Loading people…</div></div></section>`;
}
function previewCount(c) { if (c.list && c.list.length) return c.list.length; return c.towers.reduce((a, t) => a + t.floors * t.flats, 0); }
function dirty(rerender) { S.setupDirty = true; const m = $("#set-msg"); if (m) m.textContent = "Unsaved changes"; if (rerender) { const y = window.scrollY; render(); window.scrollTo(0, y); } }
function twSet(i, k, v) { S.sd.towers[i][k] = v; dirty(true); }
function twAdd() { const n = Math.max(0, ...S.sd.towers.map(t => parseInt(String(t.id).replace(/\D/g, ""), 10) || 0)) + 1; S.sd.towers.push({ id: "T" + n, name: "Tower " + n, floors: 24, start: 1, flats: 4, types: ["3BHK", "2BHK", "2BHK", "3BHK"] }); dirty(true); }
function twDel(i) { S.sd.towers.splice(i, 1); dirty(true); }
function parseTeams(txt) {
  const t = txt.split("\n").map(l => l.split("|").map(s => s.trim())).filter(a => a[0]).map(a => ({ id: a[0].toLowerCase().replace(/[^a-z0-9_-]/g, ""), name: a[1] || a[0] }));
  if (t.length) { S.sd.teams = t; dirty(); }
}
function parseRooms(ty, txt) {
  const rs = txt.split("\n").map(l => l.split("|").map(s => s.trim())).filter(a => a[0]).map(a => ({ key: a[0].replace(/[^A-Za-z0-9_-]/g, ""), label: a[1] || a[0], kind: CL.kinds[a[2]] ? a[2] : "bedroom" }));
  if (rs.length) { S.sd.flatTypes[ty] = rs; dirty(true); }
}
function addFlatType() { const v = $("#set-newft").value.trim(); if (!v || S.sd.flatTypes[v]) return; S.sd.flatTypes[v] = clone(S.sd.flatTypes["3BHK"] || Object.values(S.sd.flatTypes)[0]); dirty(true); }
function parseList() {
  const txt = $("#set-list").value, out = [], bad = [], seen = new Set(), types = Object.keys(S.sd.flatTypes);
  txt.split(/\r?\n/).forEach((l, i) => {
    if (!l.trim()) return;
    const a = l.split(/\t|,/).map(s => s.trim());
    if (i === 0 && /tower/i.test(a[0])) return;
    const [t, f, n, ty, ar] = a;
    const tyN = types.find(x => x.toLowerCase() === String(ty || "").toLowerCase().replace(/\s/g, ""));
    if (!t || f === "" || isNaN(+f) || !n || !tyN || !/^[A-Za-z0-9_-]+$/.test(t + n)) { bad.push(i + 1); return; }
    const id = t + "-" + n; if (seen.has(id)) { bad.push(i + 1); return; } seen.add(id);
    out.push({ t, f: +f, n: String(n), ty: tyN, a: ar || "" });
  });
  const m = $("#list-msg");
  if (!out.length) { m.textContent = "No valid rows found. Expected: Tower, Floor, Flat no., Type."; return; }
  S.sd.list = out;
  const tids = [...new Set(out.map(u => u.t))];
  tids.forEach(id => { if (!S.sd.towers.find(t => t.id === id)) S.sd.towers.push({ id, name: id, floors: 24, start: 1, flats: 4, types: ["3BHK"] }); });
  dirty(true);
  toast(`${out.length} flats loaded${bad.length ? `; skipped lines ${bad.slice(0, 8).join(", ")}${bad.length > 8 ? "…" : ""}` : ""}. Save setup to apply.`);
}
async function saveSetup() {
  const c = clone(S.sd), m = $("#set-msg");
  const ids = c.towers.map(t => t.id);
  if (ids.some(id => !/^[A-Za-z0-9_-]+$/.test(id)) || new Set(ids).size !== ids.length) { toast("Tower IDs must be unique and use only letters, numbers, - or _."); return; }
  if (previewCount(c) > 3000) { toast("That's more than 3000 flats. Check floors and flats per floor."); return; }
  m.textContent = "Saving…";
  try {
    await S.db.doc("config/project").set(c);
    const tids = c.list && c.list.length ? [...new Set(c.list.map(u => u.t))] : ids;
    for (const t of tids) { const r = S.db.doc("sum/" + t); if (!(await r.get()).exists) await r.set({ units: {} }); }
    const mem = S.db.doc("config/members"); if (!(await mem.get()).exists) await mem.set({ m: {} });
    S.setupDirty = false; S.config = c; rebuildUnits(); toast("Setup saved"); render();
  } catch (e) { m.textContent = errMsg(e); }
}
async function loadPeople() {
  const box = $("#people-tbl"); if (!box) return;
  let ids = [];
  try { const snap = await S.db.collection("people").limit(500).get(); ids = snap.docs.map(d => d.id); } catch (e) {}
  ids = [...new Set(ids.concat(Object.keys(S.members)))];
  if (!ids.length) { box.innerHTML = `<div class="empty">Nobody has opened the page yet. Share it, then assign roles here.</div>`; return; }
  const ps = S.user ? await S.user.profiles(ids) : {};
  const topt = (v, l, cur) => `<option value="${esc(v)}" ${v === cur ? "selected" : ""}>${esc(l)}</option>`;
  box.innerHTML = `<table class="tbl"><tr><th>Person</th><th>Role</th><th>Team</th></tr>${ids.map(id => {
    const p = ps[id] || {}, m = S.members[id] || {};
    return `<tr><td><div class="pp">${p.avatarUrl ? `<img src="${esc(p.avatarUrl)}" alt="">` : ""}<span>${esc(p.name || (id === S.me.id ? "You" : "Unnamed person"))}</span></div></td>
      <td><select id="pr-${esc(id)}" onchange="setMember('${esc(id)}',{role:this.value})">${topt("", FB ? "No access (pending)" : "Default (QC inspector)", m.role || "")}${Object.entries(ROLES).map(([k, l]) => topt(k, l, m.role)).join("")}</select></td>
      <td><select id="pt-${esc(id)}" onchange="setMember('${esc(id)}',{team:this.value})">${topt("", "—", m.team || "")}${cfg().teams.map(t => topt(t.id, t.name, m.team)).join("")}</select></td></tr>`;
  }).join("")}</table>`;
}
async function setMember(id, patch) {
  const next = { ...(S.members[id] || {}), ...patch };
  try {
    const ref = S.db.doc("config/members");
    if ((await ref.get()).exists) await ref.update({ m: { [id]: next } }); else await ref.set({ m: { [id]: next } });
    S.members[id] = next; toast("Role saved");
  } catch (e) { toast(errMsg(e)); }
}
async function findPeople(q) {
  if (!S.user) return;
  const hits = await S.user.search(q || "");
  const box = $("#find-res"); if (!box) return;
  box.innerHTML = hits.filter(h => !S.members[h.id]).map(h => `<button class="chip" data-id="${esc(h.id)}">Add ${esc(h.name)}</button>`).join("");
  $$("button", box).forEach(b => b.onclick = async () => { await setMember(b.dataset.id, { role: "qc" }); loadPeople(); findPeople($("#set-find").value); });
}
function wireSetup() { loadPeople(); }

/* ---------- boot ---------- */
function softRender() {
  if (sheetOpen() || S.hoDirty) return;
  if (S.route.v === "setup") return;
  const y = window.scrollY; render(); window.scrollTo(0, y);
}
function normalize(c) {
  const d = defaultConfig();
  c = { ...d, ...c };
  if (!Array.isArray(c.towers)) c.towers = d.towers;
  if (!Array.isArray(c.teams) || !c.teams.length) c.teams = d.teams;
  if (!c.flatTypes || !Object.keys(c.flatTypes).length) c.flatTypes = d.flatTypes;
  return c;
}
async function boot() {
  S.booting = true; rebuildUnits(); render();
  const use = n => (window.claude && typeof window.claude.use === "function") ? window.claude.use(n).catch(() => null) : Promise.resolve(null);
  const [db, user, assets, downloads] = await Promise.all(["db", "user", "assets", "downloads"].map(use));
  Object.assign(S, { db, user, assets, downloads }); S.booting = false;
  if (user) { try { const me = await user.me(); S.me = me; S.isOwner = me.isOwner; S.canEdit = me.canEdit; } catch (e) {} }
  if (!db) { S.configLoaded = true; render(); return; }
  db.doc("config/project").onSnapshot(snap => {
    S.config = snap.exists ? normalize(snap.data()) : null; S.configLoaded = true; rebuildUnits();
    if (S.route.v === "setup" && !S.setupDirty) S.sd = null;
    if (S.route.v !== "setup" || !S.setupDirty) { if (!sheetOpen() && !S.hoDirty) { const y = window.scrollY; render(); window.scrollTo(0, y); } }
  }, () => { S.configLoaded = true; render(); });
  db.doc("config/members").onSnapshot(snap => { S.members = snap.exists ? (snap.data().m || {}) : {}; softRender(); }, () => {});
  db.collection("sum").onSnapshot(snap => { const n = {}; snap.docs.forEach(d => n[d.id] = d.data()); S.sums = n; softRender(); }, () => {});
  if (S.me.id && !FB) {
    try { const r = db.doc("people/" + S.me.id), s = await r.get(); if (!s.exists || Date.now() - (s.data().seen || 0) > 12 * 3600000) await r.set({ seen: Date.now() }); } catch (e) {}
  }
}
window.addEventListener("pagehide", flushChecks);
document.addEventListener("visibilitychange", () => { if (document.hidden) flushChecks(); });
boot();
