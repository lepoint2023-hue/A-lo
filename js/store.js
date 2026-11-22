// Aïlo — couche de données.
// Version 0.1 : tout est enregistré dans le navigateur (localStorage).
// Toutes les lectures/écritures passent par ce fichier : c'est lui qu'on
// remplacera par Supabase (base de données) et Stripe (paiements) à l'étape suivante.

import { demoData, DURATIONS, COMMISSION_RATE, BUFFER_DAYS, addDays } from "./data.js";

const KEY = "ailo-v1";
let db = load();

function load() {
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) return JSON.parse(raw);
  } catch (e) { /* stockage indisponible : on repart des données de démo */ }
  return demoData();
}

export function save() {
  try {
    localStorage.setItem(KEY, JSON.stringify(db));
    return true;
  } catch (e) {
    alertQuota();
    return false;
  }
}

let quotaWarned = false;
function alertQuota() {
  if (quotaWarned) return;
  quotaWarned = true;
  window.dispatchEvent(new CustomEvent("ailo:toast", { detail: "Mémoire du navigateur pleine : supprime quelques photos. (Avec la vraie base de données, cette limite disparaît.)" }));
}

export function resetDemo() {
  db = demoData();
  save();
}

const nextId = (p) => { db.seq = (db.seq || 100) + 1; return p + db.seq; };

// ---------- Lecture ----------
export const me = () => db.users[db.me];
export const user = (id) => db.users[id];
export const item = (id) => db.items.find((i) => i.id === id);
export const reservation = (id) => db.reservations.find((r) => r.id === id);
export const isFav = (id) => db.favorites.includes(id);
export const myItems = () => db.items.filter((i) => i.ownerId === db.me);
export const favorites = () => db.items.filter((i) => db.favorites.includes(i.id));

export function catalog(f = {}) {
  const q = (f.q || "").trim().toLowerCase();
  return db.items.filter((i) => {
    if (i.status !== "online" || i.ownerId === db.me) return false;
    if (q && !(i.title + " " + i.category + " " + i.style + " " + i.color + " " + (i.brand || "") + " " + i.size).toLowerCase().includes(q)) return false;
    if (f.category && i.category !== f.category) return false;
    if (f.style && i.style !== f.style) return false;
    if (f.color && i.color !== f.color) return false;
    if (f.size && i.size !== f.size) return false;
    if (f.occasion && !i.occasions.includes(f.occasion)) return false;
    if (f.maxPrice && i.prices.we > Number(f.maxPrice)) return false;
    if (f.maxKm && user(i.ownerId).km > Number(f.maxKm)) return false;
    if (f.date && !isAvailable(i.id, f.date, addDays(f.date, 3))) return false;
    return true;
  }).sort((a, b) => {
    if (f.sort === "price") return a.prices.we - b.prices.we;
    if (f.sort === "new") return b.createdAt.localeCompare(a.createdAt) || b.id.localeCompare(a.id);
    return user(a.ownerId).km - user(b.ownerId).km;
  });
}

export function myRentals() { return db.reservations.filter((r) => r.renterId === db.me).sort(byStart); }
export function myLendings() { return db.reservations.filter((r) => r.ownerId === db.me).sort(byStart); }
const byStart = (a, b) => b.start.localeCompare(a.start);

export function conversations() {
  return db.reservations
    .filter((r) => (r.renterId === db.me || r.ownerId === db.me) && db.messages[r.id] && db.messages[r.id].length)
    .map((r) => ({ r, last: db.messages[r.id][db.messages[r.id].length - 1] }))
    .sort((a, b) => (b.last.at || "").localeCompare(a.last.at || ""));
}
export const messages = (rid) => db.messages[rid] || [];

export function earnings() {
  return myLendings()
    .filter((r) => ["confirmee", "remise", "rendue", "terminee"].includes(r.status))
    .reduce((s, r) => s + payoutFor(r), 0);
}

// ---------- Prix ----------
export function quote(itm, durationId, cleaning) {
  const price = itm.prices[durationId];
  const cleaningFee = cleaning === "forfait" ? itm.cleaningFee : 0;
  return { price, cleaningFee, deposit: itm.deposit, total: price + cleaningFee + itm.deposit, commission: round(price * COMMISSION_RATE) };
}
export const payoutFor = (r) => round(r.price * (1 - COMMISSION_RATE) + r.cleaningFee);
const round = (n) => Math.round(n * 100) / 100;

// ---------- Disponibilités ----------
const BLOCKING = ["demandee", "confirmee", "remise", "rendue"];
export function bookedRanges(itemId) {
  return db.reservations
    .filter((r) => r.itemId === itemId && BLOCKING.includes(r.status))
    .map((r) => ({ start: r.start, end: addDays(r.end, BUFFER_DAYS) }));
}
export function isAvailable(itemId, start, end, ignoreId) {
  return !db.reservations.some((r) =>
    r.itemId === itemId && r.id !== ignoreId && BLOCKING.includes(r.status) &&
    start <= addDays(r.end, BUFFER_DAYS) && end >= r.start);
}

// ---------- Écriture ----------
export function toggleFav(id) {
  const k = db.favorites.indexOf(id);
  if (k >= 0) db.favorites.splice(k, 1); else db.favorites.push(id);
  save();
}

export function saveItem(data) {
  if (data.id) {
    const i = item(data.id);
    Object.assign(i, data);
  } else {
    data.id = nextId("i");
    data.ownerId = db.me;
    data.status = "online";
    data.createdAt = new Date().toISOString().slice(0, 10);
    data.tint = "#E5D9D0";
    db.items.push(data);
  }
  save();
  return data.id;
}

export function setItemStatus(id, status) { item(id).status = status; save(); }
export function deleteItem(id) {
  db.items = db.items.filter((i) => i.id !== id);
  db.favorites = db.favorites.filter((f) => f !== id);
  save();
}

export function book(itemId, durationId, start, cleaning) {
  const itm = item(itemId);
  const dur = DURATIONS.find((d) => d.id === durationId);
  const end = addDays(start, dur.days);
  if (!isAvailable(itemId, start, end)) return { error: "Ces dates ne sont plus disponibles." };
  const q = quote(itm, durationId, cleaning);
  const r = {
    id: nextId("r"), itemId, renterId: db.me, ownerId: itm.ownerId, durationId, start, end, cleaning,
    price: q.price, cleaningFee: q.cleaningFee, deposit: q.deposit,
    status: itm.instant ? "confirmee" : "demandee", createdAt: new Date().toISOString()
  };
  db.reservations.push(r);
  db.messages[r.id] = [{ from: "system", text: itm.instant ? `Réservation confirmée · ${q.total} € payés (dont ${q.deposit} € de caution)` : "Demande envoyée. La loueuse a 24 h pour répondre ; tu ne paies qu'une fois acceptée.", at: r.createdAt }];
  save();
  return { reservation: r };
}

// Transitions autorisées : qui peut faire quoi, à quelle étape
export const TRANSITIONS = {
  demandee: [{ to: "confirmee", by: "owner", label: "Accepter" }, { to: "refusee", by: "owner", label: "Refuser", ghost: true }, { to: "annulee", by: "renter", label: "Annuler la demande", ghost: true }],
  confirmee: [{ to: "remise", by: "both", label: "Vêtement remis (état des lieux fait)" }, { to: "annulee", by: "renter", label: "Annuler", ghost: true }],
  remise: [{ to: "rendue", by: "both", label: "Vêtement rendu" }],
  rendue: [{ to: "terminee", by: "owner", label: "Tout est conforme : rendre la caution" }, { to: "litige", by: "owner", label: "Signaler un problème", ghost: true }],
  litige: [{ to: "terminee", by: "owner", label: "Litige réglé" }]
};

const SYSTEM_TEXT = {
  confirmee: "Réservation acceptée. Paiement effectué, caution prélevée.",
  refusee: "Demande refusée. Aucun montant n'a été prélevé.",
  annulee: "Réservation annulée.",
  remise: "Vêtement remis. État des lieux enregistré.",
  rendue: "Vêtement rendu. La loueuse vérifie l'état.",
  terminee: "Location terminée : caution remboursée, loueuse payée.",
  litige: "Un problème a été signalé. Aïlo examine les photos des deux états des lieux."
};

export function transition(rid, to) {
  const r = reservation(rid);
  r.status = to;
  (db.messages[rid] = db.messages[rid] || []).push({ from: "system", text: SYSTEM_TEXT[to], at: new Date().toISOString() });
  save();
}

export function sendMessage(rid, text) {
  (db.messages[rid] = db.messages[rid] || []).push({ from: db.me, text, at: new Date().toISOString() });
  save();
}

export function review(rid, rating, text) {
  reservation(rid).review = { rating, text };
  save();
}

export function updateMe(patch) { Object.assign(me(), patch); save(); }
