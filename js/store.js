// Aïlo — couche de données (v0.4 : Supabase)
// L'app lit une copie en mémoire (rapide, synchrone) ; chaque modification
// est appliquée tout de suite à cette copie puis envoyée à Supabase.
// En cas d'échec, on prévient et on recharge tout depuis la base.

import { DURATIONS, COMMISSION_RATE, COMMISSION_TIERS, VEDETTE_MIN, SERVICE_FEE, SHIPPING_FEE, SHIPPING_MIN, BUFFER_DAYS, SHIPPING_DAYS, addDays, tintFor } from "./data.js";
import { distanceKm } from "./geo.js";
import { SUPABASE_URL, SUPABASE_KEY, PAYMENT_STEP, FUNCTIONS_URL } from "./config.js";
export { PAYMENT_STEP };
const ACCEPTED = PAYMENT_STEP ? "acceptee" : "confirmee";

const sb = window.supabase.createClient(SUPABASE_URL, SUPABASE_KEY, {
  auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true, flowType: "pkce" }
});

const empty = () => ({ me: null, users: {}, items: [], reservations: [], messages: {}, favorites: [], busy: [], follows: [], stats: {} });
let db = empty();
let session = null;
let recovering = false;

const toast = (m) => window.dispatchEvent(new CustomEvent("ailo:toast", { detail: m }));
const refresh = () => window.dispatchEvent(new Event("ailo:refresh"));
const round = (n) => Math.round(n * 100) / 100;
const uuid = () => crypto.randomUUID();
const hash = (s) => [...s].reduce((h, c) => (h * 31 + c.charCodeAt(0)) | 0, 7);

// ---------- Conversions base <-> app ----------
const toItem = (r) => ({
  id: r.id, ownerId: r.owner_id, title: r.title, description: r.description || "", defects: r.defects || "", brand: r.brand || "",
  category: r.category, style: r.style, color: r.color, pattern: r.pattern || "", size: r.size, condition: r.condition, occasions: r.occasions || [],
  prices: r.prices || {}, deposit: Number(r.deposit), cleaningFee: Number(r.cleaning_fee), cleaningRequired: r.cleaning_required,
  handover: r.handover, instant: r.instant, unavailable: r.unavailable || [], photos: r.photos || [], status: r.status,
  createdAt: (r.created_at || "").slice(0, 10), tint: tintFor(hash(r.id))
});
const fromItem = (i) => ({
  id: i.id, owner_id: i.ownerId, title: i.title, description: i.description, defects: i.defects, brand: i.brand,
  category: i.category, style: i.style, color: i.color, pattern: i.pattern || "", size: i.size, condition: i.condition, occasions: i.occasions,
  prices: i.prices, deposit: Number(i.deposit) || 0, cleaning_fee: Number(i.cleaningFee) || 0, cleaning_required: !!i.cleaningRequired,
  handover: i.handover, instant: !!i.instant, unavailable: i.unavailable || [], photos: i.photos, status: i.status
});
const toRes = (r) => ({
  id: r.id, thread: r.thread_id, itemId: r.item_id, renterId: r.renter_id, ownerId: r.owner_id, durationId: r.duration_id,
  start: r.start_date, end: r.end_date, cleaning: r.cleaning, handover: r.handover, price: Number(r.price),
  cleaningFee: Number(r.cleaning_fee), shippingFee: Number(r.shipping_fee), serviceFee: Number(r.service_fee),
  creditUsed: Number(r.credit_used), deposit: Number(r.deposit), status: r.status, createdAt: r.created_at,
  commissionRate: r.commission_rate === null || r.commission_rate === undefined ? null : Number(r.commission_rate)
});
const fromRes = (r) => ({
  id: r.id, thread_id: r.thread, item_id: r.itemId, renter_id: r.renterId, owner_id: r.ownerId, duration_id: r.durationId,
  start_date: r.start, end_date: r.end, cleaning: r.cleaning, handover: r.handover, price: r.price, cleaning_fee: r.cleaningFee,
  shipping_fee: r.shippingFee, service_fee: r.serviceFee, credit_used: r.creditUsed, deposit: r.deposit, status: "demandee"
});
const toUser = (p, revs) => {
  const mine = revs.filter((x) => x.target_id === p.id);
  return {
    id: p.id, name: p.name || "", zip: p.zip, city: p.city || "", lat: p.lat, lng: p.lng, photo: p.photo_url || "",
    plan: p.plan, type: p.kind, verified: p.verified, acceptedTerms: p.accepted_terms_at,
    reviews: mine.length, rating: mine.length ? mine.reduce((s, x) => s + x.rating, 0) / mine.length : null
  };
};

// ---------- Session ----------
export async function init() {
  sb.auth.onAuthStateChange((event, s) => {
    session = s;
    if (event === "PASSWORD_RECOVERY") { recovering = true; refresh(); }
    if (s) listen(); else unlisten();
  });
  const { data } = await sb.auth.getSession();
  session = data.session;
  // Session gardée sur le téléphone mais compte supprimé entre-temps : on repart comme visiteuse
  if (session) {
    const { error } = await sb.auth.getUser();
    if (error && [401, 403, 404].includes(error.status)) { await sb.auth.signOut({ scope: "local" }).catch(() => {}); session = null; }
  }
  await sync().catch(() => toast("Connexion à la base impossible. Vérifie ta connexion internet."));
  if (session) listen();
}

// ---------- Temps réel : nouveaux messages et changements de réservation ----------
let channel = null;
function listen() {
  if (channel || !session) return;
  channel = sb.channel("ailo-live")
    .on("postgres_changes", { event: "INSERT", schema: "public", table: "messages" }, (p) => {
      const m = p.new;
      const fromOther = m.sender_id && m.sender_id !== db.me;
      sync().then(() => {
        refresh();
        if (fromOther) window.dispatchEvent(new CustomEvent("ailo:incoming", { detail: { thread: m.thread_id, from: user(m.sender_id).name, text: m.body } }));
        else if (!m.sender_id) window.dispatchEvent(new CustomEvent("ailo:incoming", { detail: { thread: m.thread_id, from: "Aïlo", text: m.body, system: true } }));
      }).catch(() => {});
    })
    .on("postgres_changes", { event: "*", schema: "public", table: "reservations" }, () => { sync().then(refresh).catch(() => {}); })
    .on("postgres_changes", { event: "*", schema: "public", table: "items" }, () => { sync().then(refresh).catch(() => {}); })
    .subscribe();
}
function unlisten() { if (channel) { sb.removeChannel(channel); channel = null; } }

// ---------- Notifications push (app fermée) ----------
const b64uToBytes = (s) => { s = s.replace(/-/g, "+").replace(/_/g, "/"); while (s.length % 4) s += "="; return Uint8Array.from(atob(s), (c) => c.charCodeAt(0)); };
const bytesToB64u = (buf) => btoa(String.fromCharCode(...new Uint8Array(buf))).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
export const pushSupported = () => "serviceWorker" in navigator && "PushManager" in window && "Notification" in window;
// Abonne cet appareil (à appeler après l'autorisation des notifications). Renvoie true si c'est bon.
export async function enablePush() {
  if (!pushSupported() || !session || Notification.permission !== "granted") return false;
  const reg = await navigator.serviceWorker.ready;
  let sub = await reg.pushManager.getSubscription();
  if (!sub) {
    const res = await fetch(FUNCTIONS_URL + "/vapid");
    if (!res.ok) throw new Error("vapid " + res.status);
    const { key } = await res.json();
    sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: b64uToBytes(key) });
  }
  const { error } = await sb.from("push_subscriptions").upsert({
    endpoint: sub.endpoint, user_id: db.me, p256dh: bytesToB64u(sub.getKey("p256dh")), auth: bytesToB64u(sub.getKey("auth"))
  }, { onConflict: "endpoint" });
  if (error) throw error;
  return true;
}
// État réel des notifications d'Aïlo sur cet appareil (la simple autorisation peut venir d'OdeBot, même site)
export async function pushStatus() {
  if (!pushSupported()) return "unsupported";
  if (Notification.permission === "denied") return "denied";
  try {
    const reg = await navigator.serviceWorker.ready;
    return (await reg.pushManager.getSubscription()) && Notification.permission === "granted" ? "on" : "off";
  } catch (e) { return "off"; }
}
export async function testPush() {
  try {
    const res = await fetch(FUNCTIONS_URL + "/test-push", { method: "POST", headers: { "Content-Type": "application/json", Authorization: "Bearer " + (session && session.access_token) }, body: "{}" });
    const d = await res.json(); return d.sent || 0;
  } catch (e) { return 0; }
}
export async function disablePush() {
  if (!pushSupported()) return;
  const reg = await navigator.serviceWorker.ready;
  const sub = await reg.pushManager.getSubscription();
  if (sub) { await sb.from("push_subscriptions").delete().eq("endpoint", sub.endpoint); await sub.unsubscribe(); }
}

// ---------- Abonnement Premium (Stripe, via la fonction serveur) ----------
export async function startSubscription() {
  try {
    const res = await fetch(FUNCTIONS_URL + "/subscribe", { method: "POST", headers: { "Content-Type": "application/json", Authorization: "Bearer " + (session && session.access_token) }, body: "{}" });
    const data = await res.json().catch(() => ({}));
    if (data.url) return { url: data.url };
    if (data.error === "stripe_not_configured") return { notReady: true };
    return { error: data.error || "L'abonnement n'a pas pu démarrer." };
  } catch (e) { return { notReady: true }; }
}

// ---------- Signalements (obligation des hébergeurs : DSA art. 16) ----------
export async function report(kind, targetId, reason, details) {
  const { error } = await sb.from("reports").insert({ reporter_id: db.me || null, target_kind: kind, target_id: targetId, reason, details: details || "" });
  return !error;
}

// ---------- Paiement (Stripe Checkout via la fonction serveur) ----------
// Renvoie { url } (page de paiement) ou { notReady: true } tant que Stripe n'est pas branché, ou { error }.
export async function startPayment(thread) {
  try {
    const res = await fetch(FUNCTIONS_URL + "/pay", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: "Bearer " + (session && session.access_token) },
      body: JSON.stringify({ thread })
    });
    const data = await res.json().catch(() => ({}));
    if (data.url) return { url: data.url };
    if (data.error === "stripe_not_configured") return { notReady: true };
    return { error: data.error || "Le paiement n'a pas pu démarrer." };
  } catch (e) {
    return { notReady: true };
  }
}

// ---------- Messages lus / non lus (mémorisé sur cet appareil) ----------
const readKey = () => "ailo-read-" + db.me;
function readMap() { try { return JSON.parse(localStorage.getItem(readKey()) || "{}"); } catch (e) { return {}; } }
export function markRead(thread) {
  const m = readMap();
  m[thread] = new Date().toISOString();
  try { localStorage.setItem(readKey(), JSON.stringify(m)); } catch (e) { /* rien */ }
}
export function isUnread(thread) {
  const last = readMap()[thread] || "";
  return (db.messages[thread] || []).some((x) => x.from !== db.me && (x.at || "") > last);
}
export const unreadCount = () => db.reservations.filter((r) => r.thread === r.id && isUnread(r.id)).length;
export const hasSession = () => !!session;
export const isRecovering = () => recovering;
export const myEmail = () => session?.user?.email || "";

const authMsg = (e) => {
  const m = (e && e.message) || "";
  if (/invalid login/i.test(m)) return "E-mail ou mot de passe incorrect.";
  if (/already registered|already exists/i.test(m)) return "Un compte existe déjà avec cet e-mail : connecte-toi.";
  if (/password/i.test(m) && /(6|8|short|weak)/i.test(m)) return "Mot de passe trop faible : 8 caractères minimum.";
  if (/email.*not confirmed/i.test(m)) return "Confirme d'abord ton e-mail (lien reçu par e-mail).";
  if (/email rate limit|over_email_send_rate_limit/i.test(m + (e && e.code || ""))) return "Le service d'e-mails d'inscription est saturé pour le moment (version de test). Réessaie dans une heure.";
  if (/rate limit|too many/i.test(m)) return "Trop de tentatives : réessaie dans quelques minutes.";
  return m || "Une erreur est survenue.";
};
const appUrl = () => location.origin + location.pathname;

export async function signUp(email, password) {
  const { data, error } = await sb.auth.signUp({ email, password, options: { emailRedirectTo: appUrl() } });
  if (error) return { error: authMsg(error) };
  session = data.session;
  if (!session) return { needConfirm: true };
  await sync();
  return {};
}
export async function signIn(email, password) {
  const { data, error } = await sb.auth.signInWithPassword({ email, password });
  if (error) return { error: authMsg(error) };
  session = data.session;
  await sync();
  return {};
}
export async function resetPassword(email) {
  const { error } = await sb.auth.resetPasswordForEmail(email, { redirectTo: appUrl() });
  return error ? { error: authMsg(error) } : {};
}
export async function setNewPassword(password) {
  const { error } = await sb.auth.updateUser({ password });
  if (error) return { error: authMsg(error) };
  recovering = false;
  await sync();
  return {};
}
export async function signOut() {
  await disablePush().catch(() => {});
  await sb.auth.signOut();
  session = null;
  db = empty();
  await sync().catch(() => {}); // retour au catalogue public
}

// ---------- Chargement ----------
let syncing = null;
// Colonnes de profil visibles sans compte (jamais l'e-mail, ni les dates d'acceptation)
const PUBLIC_PROFILE = "id,name,zip,city,lat,lng,photo_url,plan,kind,verified";
export function sync() {
  if (syncing) return syncing;
  syncing = (async () => {
    const uid = session ? session.user.id : null; // sans compte : catalogue public seulement
    const none = () => Promise.resolve({ data: [], error: null });
    const [items, resas, favs, busy, follows, stats] = await Promise.all([
      sb.from("items").select("*").neq("status", "removed").order("created_at", { ascending: false }).limit(1000),
      uid ? sb.from("reservations").select("*") : none(),
      uid ? sb.from("favorites").select("item_id") : none(),
      sb.rpc("busy_ranges"),
      uid ? sb.from("follows").select("follower_id,followed_id") : none(),
      sb.from("owner_stats").select("owner_id,rentals_done")
    ]);
    for (const r of [items, resas, favs]) if (r.error) throw r.error;
    const ids = new Set(uid ? [uid] : []);
    items.data.forEach((i) => ids.add(i.owner_id));
    resas.data.forEach((r) => { ids.add(r.owner_id); ids.add(r.renter_id); });
    if (!follows.error) follows.data.forEach((f) => { if (f.follower_id === uid) ids.add(f.followed_id); if (f.followed_id === uid) ids.add(f.follower_id); });
    const threads = [...new Set(resas.data.map((r) => r.thread_id))];
    const [profs, revs, msgs] = await Promise.all([
      sb.from("profiles").select(uid ? "*" : PUBLIC_PROFILE).in("id", [...ids]),
      sb.from("reviews").select("reservation_id,author_id,target_id,rating,body,created_at").in("target_id", [...ids]),
      threads.length ? sb.from("messages").select("*").in("thread_id", threads).order("created_at") : Promise.resolve({ data: [] })
    ]);
    for (const r of [profs, revs, msgs]) if (r.error) throw r.error;
    const next = empty();
    next.me = uid;
    profs.data.forEach((p) => { next.users[p.id] = toUser(p, revs.data); });
    if (uid && !next.users[uid]) next.users[uid] = toUser({ id: uid }, []);
    next.items = items.data.map(toItem);
    next.reservations = resas.data.map(toRes);
    const byRes = Object.fromEntries(revs.data.map((v) => [v.reservation_id, v]));
    next.reservations.forEach((r) => { const v = byRes[r.id]; if (v) r.review = { rating: v.rating, text: v.body || "" }; });
    msgs.data.forEach((m) => (next.messages[m.thread_id] = next.messages[m.thread_id] || []).push({ from: m.sender_id || "system", text: m.body, at: m.created_at }));
    next.favorites = favs.data.map((f) => f.item_id);
    next.follows = follows.error ? [] : follows.data; // tolère une base sans la migration 006
    next.stats = stats.error ? {} : Object.fromEntries(stats.data.map((x) => [x.owner_id, x.rentals_done]));
    next.busy = (busy.error ? [] : busy.data).map((b) => ({ itemId: b.item_id, thread: b.thread_id, start: b.start_date, end: b.end_date, handover: b.handover }));
    db = next;
  })().finally(() => { syncing = null; });
  return syncing;
}

// Envoie une écriture ; en cas d'erreur, prévient et recharge la base
async function write(promiseFn, failMsg) {
  try {
    const res = await promiseFn();
    if (res && res.error) throw res.error;
    return true;
  } catch (e) {
    console.error(e);
    toast(failMsg + " " + ((e && e.message) || ""));
    await sync().catch(() => {});
    refresh();
    return false;
  }
}

// ---------- Lecture ----------
function guestPlace() { try { return JSON.parse(localStorage.getItem("ailo-guest-place") || "null"); } catch (e) { return null; } }
export function setGuestPlace(p) { try { localStorage.setItem("ailo-guest-place", JSON.stringify(p)); } catch (e) { /* ignore */ } }
export const isGuest = () => !session;
// Accès Premium : forfait payant (mis à jour par Stripe côté serveur) ou compte administrateur
export const isPremium = () => ["premium", "pro", "partenaire"].includes(me().plan);
export const me = () => db.users[db.me] || Object.assign({ id: null, name: "", city: "", zip: "", lat: null, lng: null, reviews: 0, rating: null }, (!session && guestPlace()) || {});
export const user = (id) => db.users[id] || { id, name: "Membre", city: "", reviews: 0, rating: null };
export const item = (id) => db.items.find((i) => i.id === id);
export const reservation = (id) => db.reservations.find((r) => r.id === id);
export const isFav = (id) => db.favorites.includes(id);
export const myItems = () => db.items.filter((i) => i.ownerId === db.me);
export const favorites = () => db.items.filter((i) => db.favorites.includes(i.id) && i.status === "online");
export const isOnboarded = () => !!(session && me().name && me().acceptedTerms);

export function distanceTo(userId) {
  const a = me(), b = user(userId);
  return distanceKm(a.lat, a.lng, b.lat, b.lng);
}
export const offeredDurations = (itm) => DURATIONS.filter((d) => Number(itm.prices[d.id]) > 0);
export const minPrice = (i) => Math.min(...offeredDurations(i).map((d) => Number(i.prices[d.id])));

export function brands() {
  return [...new Set(db.items.filter((i) => i.status === "online" && i.ownerId !== db.me && i.brand).map((i) => i.brand))].sort((a, b) => a.localeCompare(b, "fr"));
}

export function catalog(f = {}) {
  const q = (f.q || "").trim().toLowerCase();
  return db.items.filter((i) => {
    if (i.status !== "online" || i.ownerId === db.me || !offeredDurations(i).length) return false;
    if (q && !(i.title + " " + i.category + " " + i.style + " " + i.color + " " + (i.pattern || "") + " " + (i.brand || "") + " " + i.size).toLowerCase().includes(q)) return false;
    if (f.category && i.category !== f.category) return false;
    if (f.style && i.style !== f.style) return false;
    if (f.color && i.color !== f.color) return false;
    if (f.size && i.size !== f.size) return false;
    if (f.brand && i.brand !== f.brand) return false;
    if (f.condition && i.condition !== f.condition) return false;
    if (f.handover && !(i.handover === "both" || i.handover === f.handover)) return false;
    if (f.occasion && !i.occasions.includes(f.occasion)) return false;
    if (f.maxPrice && minPrice(i) > Number(f.maxPrice)) return false;
    if (f.radius) {
      const d = distanceTo(i.ownerId);
      if (d !== null && d > Number(f.radius) && (i.handover === "main" || !f.includeShipping)) return false;
    }
    if (f.date && !isAvailable(i.id, f.date, addDays(f.date, 3), "main")) return false;
    return true;
  }).sort((a, b) => {
    if (f.sort === "price") return minPrice(a) - minPrice(b);
    if (f.sort === "new") return b.createdAt.localeCompare(a.createdAt);
    const boost = (x) => (isVedette(x.ownerId) ? 10 : 0); // pièces des loueuses vedettes mises en avant
    return ((distanceTo(a.ownerId) ?? 9999) - boost(a)) - ((distanceTo(b.ownerId) ?? 9999) - boost(b));
  });
}

const isMain = (r) => r.thread === r.id;
const byStart = (a, b) => b.start.localeCompare(a.start);
export const myRentals = () => db.reservations.filter((r) => r.renterId === db.me && isMain(r)).sort(byStart);
export const myLendings = () => db.reservations.filter((r) => r.ownerId === db.me && isMain(r)).sort(byStart);
export const group = (r) => db.reservations.filter((x) => x.thread === r.thread);

export function conversations() {
  return db.reservations
    .filter((r) => isMain(r) && (db.messages[r.id] || []).length)
    .map((r) => ({ r, last: db.messages[r.id][db.messages[r.id].length - 1] }))
    .sort((a, b) => (b.last.at || "").localeCompare(a.last.at || ""));
}
export const messages = (rid) => db.messages[rid] || [];
export const receivedReviews = () => db.reservations.filter((r) => r.ownerId === db.me && r.review);

// ---------- Argent ----------
// ---------- Bonus gros loueur ----------
export const rentalsDone = (uid) => db.stats[uid] || 0;
export const isVedette = (uid) => rentalsDone(uid) >= VEDETTE_MIN;
export function commissionFor(uid) {
  const n = rentalsDone(uid);
  return COMMISSION_TIERS.filter((t) => n >= t.min).pop().rate;
}
export function nextTier(uid) {
  const n = rentalsDone(uid);
  const t = COMMISSION_TIERS.find((x) => x.min > n);
  return t ? { rate: t.rate, missing: t.min - n } : null;
}
export const rateOf = (r) => (r.commissionRate ?? commissionFor(r.ownerId));
export const payoutFor = (r) => round(r.price * (1 - rateOf(r)) + r.cleaningFee);

// ---------- Suivre un profil ----------
export const isFollowing = (uid) => db.follows.some((f) => f.follower_id === db.me && f.followed_id === uid);
export const followersCount = (uid) => db.follows.filter((f) => f.followed_id === uid).length;
export const followers = (uid) => db.follows.filter((f) => f.followed_id === uid).map((f) => f.follower_id);
export const following = () => db.follows.filter((f) => f.follower_id === db.me).map((f) => f.followed_id);
export function toggleFollow(uid) {
  if (isFollowing(uid)) {
    db.follows = db.follows.filter((f) => !(f.follower_id === db.me && f.followed_id === uid));
    write(() => sb.from("follows").delete().eq("follower_id", db.me).eq("followed_id", uid), "Désabonnement non enregistré.");
    return false;
  }
  db.follows.push({ follower_id: db.me, followed_id: uid });
  write(() => sb.from("follows").insert({ follower_id: db.me, followed_id: uid }), "Abonnement non enregistré.");
  return true;
}
export const groupPayout = (r) => round(group(r).reduce((s, x) => s + payoutFor(x), 0));
export const serviceFeeFor = (priceSum) => round(SERVICE_FEE.fixed + priceSum * SERVICE_FEE.rate);
export function earnings() {
  return round(db.reservations.filter((r) => r.ownerId === db.me && ["confirmee", "remise", "rendue", "terminee"].includes(r.status)).reduce((s, r) => s + payoutFor(r), 0));
}
export function credit() {
  const earned = db.reservations.filter((r) => r.ownerId === db.me && r.status === "terminee").reduce((s, r) => s + payoutFor(r), 0);
  const used = db.reservations.filter((r) => r.renterId === db.me && !["refusee", "annulee"].includes(r.status)).reduce((s, r) => s + (r.creditUsed || 0), 0);
  return Math.max(0, round(earned - used));
}
export function quote({ itemIds, durationId, cleaning, handover, useCredit }) {
  const its = itemIds.map(item);
  const price = round(its.reduce((s, i) => s + Number(i.prices[durationId] || 0), 0));
  const cleaningFee = round(its.reduce((s, i) => s + ((cleaning === "forfait" || i.cleaningRequired) ? Number(i.cleaningFee || 0) : 0), 0));
  const shippingFee = handover === "envoi" ? SHIPPING_FEE : 0;
  const serviceFee = serviceFeeFor(price);
  const deposit = its.reduce((s, i) => s + Number(i.deposit || 0), 0);
  const payable = round(price + cleaningFee + shippingFee + serviceFee);
  const creditUsed = useCredit ? Math.min(credit(), payable) : 0;
  return { price, cleaningFee, shippingFee, serviceFee, deposit, creditUsed, total: round(payable - creditUsed + deposit),
    shippingOk: handover !== "envoi" || price >= SHIPPING_MIN, missingForShipping: Math.max(0, round(SHIPPING_MIN - price)) };
}

// ---------- Disponibilités ----------
function blockedSpan(start, end, handover) {
  const t = handover === "envoi" ? SHIPPING_DAYS : 0;
  return { start: addDays(start, -t), end: addDays(end, t + BUFFER_DAYS) };
}
export function bookedRanges(itemId) {
  const own = ((item(itemId) || {}).unavailable || []).map((u) => ({ start: u.start, end: u.end, own: true }));
  return db.busy.filter((b) => b.itemId === itemId).map((b) => blockedSpan(b.start, b.end, b.handover)).concat(own);
}
export function isAvailable(itemId, start, end, handover, ignoreThread) {
  const want = blockedSpan(start, end, handover);
  const itm = item(itemId);
  if (!itm) return false;
  if ((itm.unavailable || []).some((u) => want.start <= u.end && want.end >= u.start)) return false;
  return !db.busy.some((b) => {
    if (b.itemId !== itemId || b.thread === ignoreThread) return false;
    const s = blockedSpan(b.start, b.end, b.handover);
    return want.start <= s.end && want.end >= s.start;
  });
}

// ---------- Photos ----------
async function uploadPhoto(dataUrl) {
  const blob = await (await fetch(dataUrl)).blob();
  const path = `${db.me}/${uuid()}.jpg`;
  const { error } = await sb.storage.from("photos").upload(path, blob, { contentType: "image/jpeg", upsert: false });
  if (error) throw error;
  return sb.storage.from("photos").getPublicUrl(path).data.publicUrl;
}

// ---------- Écriture ----------
export function toggleFav(id) {
  const on = db.favorites.includes(id);
  if (on) db.favorites = db.favorites.filter((f) => f !== id); else db.favorites.push(id);
  write(() => on ? sb.from("favorites").delete().eq("user_id", db.me).eq("item_id", id) : sb.from("favorites").insert({ user_id: db.me, item_id: id }), "Favori non enregistré.");
}

export function saveItem(data) {
  const isNew = !data.id;
  const itm = Object.assign({}, data, isNew ? { id: uuid(), ownerId: db.me, status: "online", createdAt: new Date().toISOString().slice(0, 10) } : {});
  itm.tint = tintFor(hash(itm.id));
  const k = db.items.findIndex((i) => i.id === itm.id);
  if (k >= 0) db.items[k] = Object.assign(db.items[k], itm); else db.items.unshift(itm);
  write(async () => {
    const photos = [];
    for (const p of itm.photos) photos.push(p.startsWith("data:") ? await uploadPhoto(p) : p);
    itm.photos = photos;
    const res = await sb.from("items").upsert(fromItem(itm));
    if (!res.error) toast(isNew ? "Ta pièce est en ligne !" : "Modifications enregistrées");
    return res;
  }, "La pièce n'a pas pu être enregistrée.");
  return itm.id;
}
export function setItemStatus(id, status) {
  item(id).status = status;
  write(() => sb.from("items").update({ status }).eq("id", id), "Changement non enregistré.");
}
export function deleteItem(id) {
  db.items = db.items.filter((i) => i.id !== id);
  db.favorites = db.favorites.filter((f) => f !== id);
  write(() => sb.from("items").update({ status: "removed" }).eq("id", id), "Suppression non enregistrée.");
}

export function book({ itemIds, durationId, start, cleaning, handover, useCredit }) {
  const dur = DURATIONS.find((d) => d.id === durationId);
  const end = addDays(start, dur.days);
  for (const id of itemIds) if (!isAvailable(id, start, end, handover)) return { error: `« ${item(id).title} » n'est plus disponible à ces dates.` };
  const q = quote({ itemIds, durationId, cleaning, handover, useCredit });
  if (!q.shippingOk) return { error: `L'envoi demande au moins ${SHIPPING_MIN} € de location.` };
  const first = item(itemIds[0]);
  const instant = itemIds.every((id) => item(id).instant);
  const mainId = uuid();
  const now = new Date().toISOString();
  const rows = itemIds.map((id, k) => {
    const i = item(id);
    return {
      id: k === 0 ? mainId : uuid(), thread: mainId, itemId: id, renterId: db.me, ownerId: first.ownerId, durationId, start, end, cleaning, handover,
      price: Number(i.prices[durationId]), cleaningFee: (cleaning === "forfait" || i.cleaningRequired) ? Number(i.cleaningFee || 0) : 0, deposit: Number(i.deposit || 0),
      shippingFee: k === 0 ? q.shippingFee : 0, serviceFee: k === 0 ? q.serviceFee : 0, creditUsed: k === 0 ? q.creditUsed : 0,
      status: instant ? ACCEPTED : "demandee", createdAt: now
    };
  });
  db.reservations.push(...rows);
  rows.forEach((r) => db.busy.push({ itemId: r.itemId, thread: mainId, start, end, handover }));
  const n = itemIds.length;
  const sys = instant ? `Réservation acceptée automatiquement${n > 1 ? ` (${n} pièces, un seul colis)` : ""}.${PAYMENT_STEP ? " Il reste à payer pour la confirmer." : ""}`
    : `Demande envoyée${n > 1 ? ` pour ${n} pièces` : ""}. Tu ne paies qu'une fois la demande acceptée.`;
  db.messages[mainId] = [{ from: "system", text: sys, at: now }];
  write(async () => {
    let res = await sb.from("reservations").insert(rows.map(fromRes));
    if (res.error) return res;
    if (instant) { res = await sb.from("reservations").update({ status: ACCEPTED }).eq("thread_id", mainId); if (res.error) return res; }
    return sb.from("messages").insert({ thread_id: mainId, sender_id: null, body: sys });
  }, "La réservation n'a pas pu être enregistrée.");
  return { reservation: reservation(mainId) };
}

export const TRANSITIONS = {
  demandee: [{ to: ACCEPTED, by: "owner", label: "Accepter" }, { to: "refusee", by: "owner", label: "Refuser", ghost: true }, { to: "annulee", by: "renter", label: "Annuler la demande", ghost: true }],
  acceptee: [{ to: "confirmee", by: "renter", label: "Payer", pay: true }, { to: "annulee", by: "renter", label: "Annuler", ghost: true }],
  confirmee: [{ to: "remise", by: "owner", label: "Vêtement remis (état des lieux fait)" }, { to: "annulee", by: "renter", label: "Annuler", ghost: true }],
  remise: [{ to: "rendue", by: "owner", label: "Vêtement rendu" }],
  rendue: [{ to: "terminee", by: "owner", label: "Tout est conforme : rendre la caution" }, { to: "litige", by: "owner", label: "Signaler un problème", ghost: true }],
  litige: [{ to: "terminee", by: "owner", label: "Litige réglé" }]
};
const SYSTEM_TEXT = {
  acceptee: "Demande acceptée ! Il reste à payer pour confirmer la location.",
  confirmee: PAYMENT_STEP ? "Paiement reçu : la location est confirmée." : "Demande acceptée : la location est confirmée.",
  refusee: "Demande refusée.",
  annulee: "Réservation annulée.",
  remise: "Vêtement remis, confirmé par la loueuse. État des lieux enregistré.",
  rendue: "Vêtement rendu, confirmé par la loueuse. Elle vérifie l'état.",
  terminee: "Location terminée : caution remboursée, loueuse payée.",
  litige: "Un problème a été signalé. Aïlo examine les photos des deux états des lieux."
};
export function transition(rid, to) {
  const r = reservation(rid);
  group(r).forEach((x) => { x.status = to; });
  if (["refusee", "annulee", "terminee"].includes(to)) db.busy = db.busy.filter((b) => b.thread !== r.thread);
  const now = new Date().toISOString();
  (db.messages[r.thread] = db.messages[r.thread] || []).push({ from: "system", text: SYSTEM_TEXT[to], at: now });
  write(async () => {
    const res = await sb.from("reservations").update({ status: to }).eq("thread_id", r.thread);
    if (res.error) return res;
    return sb.from("messages").insert({ thread_id: r.thread, sender_id: null, body: SYSTEM_TEXT[to] });
  }, "Changement non enregistré.");
}

export function sendMessage(rid, text) {
  markRead(rid);
  (db.messages[rid] = db.messages[rid] || []).push({ from: db.me, text, at: new Date().toISOString() });
  write(() => sb.from("messages").insert({ thread_id: rid, sender_id: db.me, body: text }), "Message non envoyé.");
}

export function review(rid, rating, text) {
  const r = reservation(rid);
  r.review = { rating, text };
  write(() => sb.from("reviews").insert({ reservation_id: rid, author_id: db.me, target_id: r.ownerId, rating, body: text }), "Avis non enregistré.");
}

export function updateMe(patch) {
  const u = me();
  Object.assign(u, patch);
  write(async () => {
    const row = {};
    if ("name" in patch) row.name = patch.name;
    for (const k of ["zip", "city", "lat", "lng"]) if (k in patch) row[k] = patch[k];
    if ("acceptedTerms" in patch) row.accepted_terms_at = patch.acceptedTerms;
    if (patch.photo && patch.photo.startsWith("data:")) { row.photo_url = await uploadPhoto(patch.photo); u.photo = row.photo_url; }
    return sb.from("profiles").update(row).eq("id", db.me);
  }, "Profil non enregistré.");
}
