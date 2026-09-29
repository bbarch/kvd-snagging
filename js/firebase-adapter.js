// Firebase back end for the KVD snagging app.
// The app talks to a small store/user/files interface (claude.use("db") etc.).
// This module implements that interface on Firebase Auth + Firestore (+ optional Storage)
// and shows the sign-in screen until the person is approved by the project admin.
import { initializeApp } from "https://www.gstatic.com/firebasejs/12.19.0/firebase-app.js";
import {
  getAuth, onAuthStateChanged, GoogleAuthProvider, signInWithPopup, signInWithRedirect, getRedirectResult,
  signInWithEmailAndPassword, createUserWithEmailAndPassword, sendPasswordResetEmail, sendEmailVerification,
  updateProfile, signOut,
} from "https://www.gstatic.com/firebasejs/12.19.0/firebase-auth.js";
import {
  initializeFirestore, persistentLocalCache, persistentMultipleTabManager, memoryLocalCache,
  doc, collection, getDoc, getDocs, setDoc, updateDoc, deleteDoc, onSnapshot, query, where, limit, FieldPath,
} from "https://www.gstatic.com/firebasejs/12.19.0/firebase-firestore.js";
import { FIREBASE_CONFIG, APP } from "./config.js";

const authBox = document.getElementById("auth");
const body = document.getElementById("auth-body");
const esc = s => String(s ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const say = msg => { const t = window.toast; if (typeof t === "function") t(msg); };

if (!FIREBASE_CONFIG || !FIREBASE_CONFIG.apiKey || FIREBASE_CONFIG.apiKey.startsWith("PASTE")) {
  authBox.hidden = false;
  body.innerHTML = `<p><b>Firebase isn't configured yet.</b></p><p class="small muted">Open <span class="mono">js/config.js</span> and paste your Firebase web app config. The README explains where to find it.</p>`;
  throw new Error("Firebase config missing");
}

const app = initializeApp(FIREBASE_CONFIG);
const auth = getAuth(app);
let fs;
try {
  fs = initializeFirestore(app, { localCache: persistentLocalCache({ tabManager: persistentMultipleTabManager() }), ignoreUndefinedProperties: true });
} catch (e) {
  fs = initializeFirestore(app, { localCache: memoryLocalCache(), ignoreUndefinedProperties: true });
}
const ADMINS = (APP.adminEmails || []).map(e => e.toLowerCase());

/* ---------- error mapping (Firestore codes -> app codes) ---------- */
function mapErr(e) {
  const c = (e && e.code) || "";
  const code = c === "permission-denied" || c === "not-found" || c === "invalid-argument" || c === "failed-precondition" ? "invalid_argument"
    : c === "resource-exhausted" ? "resource_exhausted" : "unavailable";
  if (c && code === "unavailable") console.warn("Firestore:", c, e.message);
  return { code, message: (e && e.message) || String(e) };
}
// Resolve writes once the server confirms, or after 4 s if the device is offline (Firestore queues and syncs later).
function settle(p) {
  return new Promise((res, rej) => {
    let done = false;
    const t = setTimeout(() => { if (!done) { done = true; res(); } }, 4000);
    p.then(() => { if (!done) { done = true; clearTimeout(t); res(); } },
      e => { const m = mapErr(e); if (!done) { done = true; clearTimeout(t); rej(m); } else say("A change made offline was refused by the server: " + (m.code === "invalid_argument" ? "no permission." : m.message)); });
  });
}
const isObj = v => v && typeof v === "object" && !Array.isArray(v);
// Nested objects merge field by field (same as the app expects); arrays and values replace.
function flatten(obj, pre = [], out = []) {
  for (const k of Object.keys(obj)) {
    const v = obj[k], p = pre.concat(k);
    if (isObj(v)) { if (Object.keys(v).length) flatten(v, p, out); }
    else out.push(new FieldPath(...p), v === undefined ? null : v);
  }
  return out;
}
const wrapDoc = s => ({ id: s.id, exists: s.exists(), data: () => (s.exists() ? s.data() : undefined), metadata: { fromCache: s.metadata.fromCache, hasPendingWrites: s.metadata.hasPendingWrites } });

/* ---------- db ---------- */
function docRef(path) {
  const r = doc(fs, path);
  return {
    id: r.id, path,
    get: () => getDoc(r).then(wrapDoc, e => { throw mapErr(e); }),
    set: data => settle(setDoc(r, data)),
    update: data => { const args = flatten(data); return args.length ? settle(updateDoc(r, ...args)) : Promise.resolve(); },
    delete: () => settle(deleteDoc(r)),
    onSnapshot: (next, err) => onSnapshot(r, s => next(wrapDoc(s)), e => err && err(mapErr(e))),
    collection: sub => collRef(path + "/" + sub),
    acquire: async () => ({ acquired: true }),
  };
}
const OPS = {
  "==": (a, b) => a === b, "!=": (a, b) => a !== b, "<": (a, b) => a < b, "<=": (a, b) => a <= b, ">": (a, b) => a > b, ">=": (a, b) => a >= b,
  "in": (a, b) => b.includes(a), "not-in": (a, b) => !b.includes(a), "array-contains": (a, b) => Array.isArray(a) && a.includes(b),
};
// Only the first filter goes to the server (single-field indexes are automatic); the rest run here,
// so no composite indexes need to be created.
function collRef(path, filters = [], lim = null) {
  const build = () => {
    const [first, ...rest] = filters, parts = [];
    if (first) parts.push(where(first[0], first[1], first[2]));
    if (lim && !rest.length) parts.push(limit(lim));
    return { q: query(collection(fs, path), ...parts), rest };
  };
  const wrapQ = (s, rest) => {
    let docs = s.docs.map(wrapDoc);
    if (rest.length) docs = docs.filter(d => rest.every(([f, op, v]) => OPS[op] && OPS[op]((d.data() || {})[f], v)));
    if (lim) docs = docs.slice(0, lim);
    return { docs, size: docs.length, empty: !docs.length, docChanges: () => [], metadata: { fromCache: s.metadata.fromCache, hasPendingWrites: s.metadata.hasPendingWrites } };
  };
  return {
    path,
    where: (f, op, v) => collRef(path, filters.concat([[f, op, v]]), lim),
    orderBy() { return this; },
    limit: n => collRef(path, filters, n),
    get: () => { const { q, rest } = build(); return getDocs(q).then(s => wrapQ(s, rest), e => { throw mapErr(e); }); },
    onSnapshot: (next, err) => { const { q, rest } = build(); return onSnapshot(q, s => next(wrapQ(s, rest)), e => err && err(mapErr(e))); },
    doc: id => docRef(path + "/" + (id || doc(collection(fs, path)).id)),
    add: async data => { const id = doc(collection(fs, path)).id, r = docRef(path + "/" + id); await r.set(data); return r; },
  };
}
const db = { doc: docRef, collection: p => collRef(p) };

/* ---------- people ---------- */
let me = null, members = {};
const PALETTE = ["#1F6F64", "#2B4A6F", "#8A4B2A", "#6B4E8A", "#3C6E2E", "#8A2F4A", "#2E6A8A", "#7A6420"];
const colorFor = id => PALETTE[[...String(id)].reduce((a, c) => a + c.charCodeAt(0), 0) % PALETTE.length];
function initials(name, color) {
  const i = String(name || "?").split(/\s+/).filter(Boolean).slice(0, 2).map(w => w[0].toUpperCase()).join("") || "?";
  return "data:image/svg+xml," + encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 40 40"><rect width="40" height="40" rx="20" fill="${color}"/><text x="20" y="25" font-family="Arial" font-size="15" font-weight="700" fill="#fff" text-anchor="middle">${i.replace(/[<&>"]/g, "")}</text></svg>`);
}
const isAdminEmail = u => !!u && !!u.email && u.emailVerified && ADMINS.includes(u.email.toLowerCase());
const roleOf = uid => (members[uid] || {}).role || "";
const PCACHE = {};
async function profile(id) {
  if (!PCACHE[id]) {
    PCACHE[id] = getDoc(doc(fs, "people/" + id)).then(s => s.exists() ? s.data() : {}, () => ({}));
  }
  const p = await PCACHE[id], name = p.name || p.email || "", color = colorFor(id);
  return { id, name, avatarUrl: p.photo || initials(name, color), color, email: p.email || null, isMe: !!me && id === me.uid, guest: false };
}
const user = {
  me: async () => {
    const name = me.displayName || me.email || "", color = colorFor(me.uid), admin = isAdminEmail(me) || roleOf(me.uid) === "admin";
    return { id: me.uid, name, avatarUrl: me.photoURL || initials(name, color), color, email: me.email, isOwner: isAdminEmail(me), canEdit: admin };
  },
  id: async () => me.uid,
  name: async () => me.displayName || me.email || "",
  isOwner: async () => isAdminEmail(me),
  canEdit: async () => isAdminEmail(me) || roleOf(me.uid) === "admin",
  can: async () => null,
  profiles: async ids => { const out = {}; for (const id of [].concat(ids)) out[id] = await profile(id); return out; },
  search: async q => {
    if (!(isAdminEmail(me) || roleOf(me.uid) === "admin")) return [];
    try {
      const s = await getDocs(collection(fs, "people")), ql = String(q || "").toLowerCase();
      return s.docs.map(d => ({ id: d.id, ...d.data() }))
        .filter(p => !ql || (p.name || "").toLowerCase().includes(ql) || (p.email || "").toLowerCase().includes(ql))
        .slice(0, 8).map(p => ({ id: p.id, name: p.name || p.email || "Unnamed", avatarUrl: p.photo || initials(p.name, colorFor(p.id)), color: colorFor(p.id), email: p.email || null, isMe: p.id === me.uid, guest: false }));
    } catch (e) { return []; }
  },
};

/* ---------- files ---------- */
const downloads = {
  save: async ({ filename, data }) => {
    const blob = data instanceof Blob ? data : new Blob([data], { type: filename.endsWith(".csv") ? "text/csv" : filename.endsWith(".html") ? "text/html" : "application/octet-stream" });
    const url = URL.createObjectURL(blob), a = document.createElement("a");
    a.href = url; a.download = filename; document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 5000);
    return { status: "saved" };
  },
};
let assets = null;
async function setupStorage() {
  if (!APP.useStorage) return;
  const { getStorage, ref, uploadBytes, getDownloadURL } = await import("https://www.gstatic.com/firebasejs/12.19.0/firebase-storage.js");
  const st = getStorage(app), urls = {};
  const timeout = (p, ms) => Promise.race([p, new Promise((_, rej) => setTimeout(() => rej({ code: "store_unavailable" }), ms))]);
  assets = {
    upload: async (blob, opts = {}) => {
      const path = `photos/${me.uid}/${Date.now()}-${Math.random().toString(36).slice(2, 8)}.jpg`;
      await timeout(uploadBytes(ref(st, path), blob, { contentType: opts.type || blob.type || "image/jpeg" }), 25000);
      const url = await getDownloadURL(ref(st, path)); urls[path] = url;
      return { id: path, url, sizeBytes: blob.size, contentType: opts.type || blob.type };
    },
    urlFor: async path => urls[path] || (urls[path] = await getDownloadURL(ref(st, path)).catch(() => "")),
    list: async () => ({ assets: [], usage: {} }),
    delete: async () => ({ deleted: false }),
  };
}

/* ---------- sign-in screen ---------- */
let resolved = false;
function enterApp() {
  if (resolved) { authBox.hidden = true; return; }
  resolved = true; authBox.hidden = true;
  window.__fbResolve({ db, user, assets, downloads });
}
function showLogin(msg) {
  authBox.hidden = false;
  body.innerHTML = `
    <button class="btn primary" id="a-google" style="width:100%">Sign in with Google</button>
    <div class="auth-or"><span>or with email</span></div>
    <form id="a-form" class="auth-form">
      <label class="field" id="a-name-f" hidden><span>Your name</span><input type="text" id="a-name" autocomplete="name"></label>
      <label class="field"><span>Email</span><input type="text" id="a-email" inputmode="email" autocomplete="email" required></label>
      <label class="field"><span>Password</span><input type="password" id="a-pass" autocomplete="current-password" required minlength="6"></label>
      <div class="row"><button class="btn" type="submit" id="a-go">Sign in</button><button class="btn ghost" type="button" id="a-toggle">Create an account</button></div>
      <button class="linkbtn" type="button" id="a-reset">Forgot password?</button>
    </form>
    <p class="small" id="a-msg">${esc(msg || "")}</p>`;
  let creating = false;
  const m = document.getElementById("a-msg");
  const fail = e => { const c = (e && e.code) || ""; m.textContent = c.includes("wrong-password") || c.includes("invalid-credential") ? "Email or password is wrong." : c.includes("email-already") ? "That email already has an account. Sign in instead." : c.includes("weak-password") ? "Use at least 6 characters for the password." : c.includes("unauthorized-domain") ? "This web address isn't authorised in Firebase yet (Authentication > Settings > Authorised domains)." : "Couldn't sign in: " + (e.message || c); };
  document.getElementById("a-google").onclick = async () => {
    try { await signInWithPopup(auth, new GoogleAuthProvider()); }
    catch (e) { if (["auth/popup-blocked", "auth/operation-not-supported-in-this-environment", "auth/cancelled-popup-request"].includes(e.code)) signInWithRedirect(auth, new GoogleAuthProvider()); else if (e.code !== "auth/popup-closed-by-user") fail(e); }
  };
  document.getElementById("a-toggle").onclick = () => {
    creating = !creating;
    document.getElementById("a-name-f").hidden = !creating;
    document.getElementById("a-go").textContent = creating ? "Create account" : "Sign in";
    document.getElementById("a-toggle").textContent = creating ? "I already have an account" : "Create an account";
  };
  document.getElementById("a-reset").onclick = async () => {
    const email = document.getElementById("a-email").value.trim();
    if (!email) { m.textContent = "Enter your email first."; return; }
    try { await sendPasswordResetEmail(auth, email); m.textContent = "Password reset email sent."; } catch (e) { fail(e); }
  };
  document.getElementById("a-form").onsubmit = async ev => {
    ev.preventDefault();
    const email = document.getElementById("a-email").value.trim(), pass = document.getElementById("a-pass").value;
    m.textContent = "Please wait…";
    try {
      if (creating) {
        const cred = await createUserWithEmailAndPassword(auth, email, pass);
        const name = document.getElementById("a-name").value.trim();
        if (name) await updateProfile(cred.user, { displayName: name });
        sendEmailVerification(cred.user).catch(() => {});
        await registerPerson(cred.user);
      } else await signInWithEmailAndPassword(auth, email, pass);
    } catch (e) { fail(e); }
  };
}
function showPending(u) {
  authBox.hidden = false;
  body.innerHTML = `<p><b>You're signed in as ${esc(u.email || u.displayName)}.</b></p>
    <p>The project admin needs to give you a role before you can use the app. Ask them to open Setup › People and roles. This screen opens the app as soon as they do.</p>
    <button class="btn" id="a-out">Sign out</button>`;
  document.getElementById("a-out").onclick = () => signOut(auth).then(() => location.reload());
}
async function registerPerson(u) {
  try { await setDoc(doc(fs, "people/" + u.uid), { name: u.displayName || "", email: u.email || "", photo: u.photoURL || "", seen: Date.now() }, { merge: true }); } catch (e) {}
}
window.fbSignOut = () => signOut(auth).then(() => location.reload());

let unsubMembers = null;
getRedirectResult(auth).catch(() => {});
onAuthStateChanged(auth, async u => {
  if (!u) { me = null; if (resolved) location.reload(); else showLogin(); return; }
  me = u;
  body.innerHTML = `<p class="muted">Signing in…</p>`;
  await registerPerson(u);
  await setupStorage().catch(() => { assets = null; });
  if (unsubMembers) unsubMembers();
  unsubMembers = onSnapshot(doc(fs, "config/members"), s => {
    members = s.exists() ? (s.data().m || {}) : {};
    const ok = isAdminEmail(u) || ["admin", "qc", "team", "crm"].includes(roleOf(u.uid));
    if (ok) enterApp(); else if (resolved) location.reload(); else showPending(u);
  }, () => { if (isAdminEmail(u)) enterApp(); else showPending(u); });
});
