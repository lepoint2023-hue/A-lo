// Aïlo — couche de données.
// Version de démonstration : tout est enregistré dans le navigateur (localStorage).
// Toutes les lectures/écritures passent par ce fichier : c'est lui qu'on
// remplacera par Supabase (base de données) et Stripe (paiements).

import { demoData, DURATIONS, COMMISSION_RATE, SERVICE_FEE, SHIPPING_FEE, SHIPPING_MIN, BUFFER_DAYS, SHIPPING_DAYS, addDays } from "./data.js";
import { distanceKm } from "./geo.js";

const KEY = "ailo-v3"; // changé en v0.3 (localisation, envoi groupé, crédit)
let db = load();

function load() {
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) return JSON.parse(raw);
  } catch (e) { /* stockage indisponible : on repart des données de démo */ }
  return demoData();
}

export function save() {
  try { localStorage.setItem(KEY, JSON.stringify(db)); return true; }
  catch (e) {
    window.dispatchEvent(new CustomEvent("ailo:toast", { detail: "Mémoire du navigateur pleine : supprime quelques photos. (Avec la vraie base de données, cette limite disparaît.)" }));
    return false;
  }
}

export function resetDemo() { db = demoData(); save(); }
const nextId = (p) => { db.seq = (db.seq || 100) + 1; return p + db.seq; };
const round = (n) => Math.round(n * 100) / 100;

// ---------- Lecture ----------
export const me = () => db.users[db.me];
export const user = (id) => db.users[id];
export const item = (id) => db.items.find((i) => i.id === id);
export const reservation = (id) => db.reservations.find((r) => r.id === id);
export const isFav = (id) => db.favorites.includes(id);
export const myItems = () => db.items.filter((i) => i.ownerId === db.me);
export const favorites = () => db.items.filter((i) => db.favorites.includes(i.id));
export const isOnboarded = () => !!(me().acceptedTerms && me().name);

export function distanceTo(userId) {
  const a = me(), b = user(userId);
  return distanceKm(a.lat, a.lng, b.lat, b.lng);
}

export const offeredDurations = (itm) => DURATIONS.filter((d) => Number(itm.prices[d.id]) > 0);

export function brands() {
  return [...new Set(db.items.filter((i) => i.status === "online" && i.ownerId !== db.me && i.brand).map((i) => i.brand))].sort((a, b) => a.localeCompare(b, "fr"));
}

export function catalog(f = {}) {
  const q = (f.q || "").trim().toLowerCase();
  return db.items.filter((i) => {
    if (i.status !== "online" || i.ownerId === db.me) return false;
    if (q && !(i.title + " " + i.category + " " + i.style + " " + i.color + " " + (i.brand || "") + " " + i.size).toLowerCase().includes(q)) return false;
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
      // hors rayon : visible seulement si l'envoi est possible
      if (d !== null && d > Number(f.radius) && i.handover === "main") return false;
      if (d !== null && d > Number(f.radius) && !f.includeShipping) return false;
    }
    if (f.date && !isAvailable(i.id, f.date, addDays(f.date, 3), "main")) return false;
    return true;
  }).sort((a, b) => {
    if (f.sort === "price") return minPrice(a) - minPrice(b);
    if (f.sort === "new") return b.createdAt.localeCompare(a.createdAt) || b.id.localeCompare(a.id);
    return (distanceTo(a.ownerId) ?? 9999) - (distanceTo(b.ownerId) ?? 9999);
  });
}
export const minPrice = (i) => Math.min(...offeredDurations(i).map((d) => Number(i.prices[d.id])));

// Seules les réservations « principales » (une par colis) sont listées
const isMain = (r) => r.thread === r.id;
export function myRentals() { return db.reservations.filter((r) => r.renterId === db.me && isMain(r)).sort(byStart); }
export function myLendings() { return db.reservations.filter((r) => r.ownerId === db.me && isMain(r)).sort(byStart); }
const byStart = (a, b) => b.start.localeCompare(a.start);
export const group = (r) => db.reservations.filter((x) => x.thread === r.thread);

export function conversations() {
  return db.reservations
    .filter((r) => isMain(r) && (r.renterId === db.me || r.ownerId === db.me) && (db.messages[r.id] || []).length)
    .map((r) => ({ r, last: db.messages[r.id][db.messages[r.id].length - 1] }))
    .sort((a, b) => (b.last.at || "").localeCompare(a.last.at || ""));
}
export const messages = (rid) => db.messages[rid] || [];

// ---------- Argent ----------
export const payoutFor = (r) => round(r.price * (1 - COMMISSION_RATE) + r.cleaningFee);
export const groupPayout = (r) => round(group(r).reduce((s, x) => s + payoutFor(x), 0));
export const serviceFeeFor = (priceSum) => round(SERVICE_FEE.fixed + priceSum * SERVICE_FEE.rate);

const ACTIVE = ["confirmee", "remise", "rendue"];
export function earnings() { // gains prévus (locations confirmées, en cours ou terminées)
  return round(db.reservations.filter((r) => r.ownerId === db.me && [...ACTIVE, "terminee"].includes(r.status)).reduce((s, r) => s + payoutFor(r), 0));
}
export function credit() { // crédit disponible : gains des locations terminées, moins ce qui a déjà servi
  const earned = db.reservations.filter((r) => r.ownerId === db.me && r.status === "terminee").reduce((s, r) => s + payoutFor(r), 0);
  return Math.max(0, round(earned - (db.creditUsed || 0)));
}

// Devis d'un colis : la pièce choisie + d'autres pièces de la même loueuse
export function quote({ itemIds, durationId, cleaning, handover, useCredit }) {
  const its = itemIds.map(item);
  const price = round(its.reduce((s, i) => s + Number(i.prices[durationId] || 0), 0));
  const cleaningFee = round(its.reduce((s, i) => s + ((cleaning === "forfait" || i.cleaningRequired) ? Number(i.cleaningFee || 0) : 0), 0));
  const shippingFee = handover === "envoi" ? SHIPPING_FEE : 0;
  const serviceFee = serviceFeeFor(price);
  const deposit = its.reduce((s, i) => s + Number(i.deposit || 0), 0);
  const payable = round(price + cleaningFee + shippingFee + serviceFee);
  const creditUsed = useCredit ? Math.min(credit(), payable) : 0;
  return {
    price, cleaningFee, shippingFee, serviceFee, deposit, creditUsed,
    total: round(payable - creditUsed + deposit),
    shippingOk: handover !== "envoi" || price >= SHIPPING_MIN,
    missingForShipping: Math.max(0, round(SHIPPING_MIN - price))
  };
}

// ---------- Disponibilités ----------
const BLOCKING = ["demandee", "confirmee", "remise", "rendue"];
function blockedSpan(start, end, handover) {
  const t = handover === "envoi" ? SHIPPING_DAYS : 0;
  return { start: addDays(start, -t), end: addDays(end, t + BUFFER_DAYS) };
}
export function bookedRanges(itemId) {
  const own = (item(itemId).unavailable || []).map((u) => ({ start: u.start, end: u.end, own: true }));
  return db.reservations
    .filter((r) => r.itemId === itemId && BLOCKING.includes(r.status))
    .map((r) => blockedSpan(r.start, r.end, r.handover)).concat(own);
}
export function isAvailable(itemId, start, end, handover, ignoreThread) {
  const want = blockedSpan(start, end, handover);
  const itm = item(itemId);
  if ((itm.unavailable || []).some((u) => want.start <= u.end && want.end >= u.start)) return false;
  return !db.reservations.some((r) => {
    if (r.itemId !== itemId || r.thread === ignoreThread || !BLOCKING.includes(r.status)) return false;
    const b = blockedSpan(r.start, r.end, r.handover);
    return want.start <= b.end && want.end >= b.start;
  });
}

// ---------- Écriture ----------
export function toggleFav(id) {
  const k = db.favorites.indexOf(id);
  if (k >= 0) db.favorites.splice(k, 1); else db.favorites.push(id);
  save();
}

export function saveItem(data) {
  if (data.id) Object.assign(item(data.id), data);
  else {
    Object.assign(data, { id: nextId("i"), ownerId: db.me, status: "online", createdAt: new Date().toISOString().slice(0, 10), tint: "#E5D9D0" });
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

export function book({ itemIds, durationId, start, cleaning, handover, useCredit }) {
  const dur = DURATIONS.find((d) => d.id === durationId);
  const end = addDays(start, dur.days);
  for (const id of itemIds) if (!isAvailable(id, start, end, handover)) return { error: `« ${item(id).title} » n'est plus disponible à ces dates.` };
  const q = quote({ itemIds, durationId, cleaning, handover, useCredit });
  if (!q.shippingOk) return { error: `L'envoi demande au moins ${SHIPPING_MIN} € de location.` };
  const first = item(itemIds[0]);
  const instant = itemIds.every((id) => item(id).instant);
  const mainId = nextId("r");
  const now = new Date().toISOString();
  itemIds.forEach((id, k) => {
    const i = item(id);
    db.reservations.push({
      id: k === 0 ? mainId : nextId("r"), thread: mainId, itemId: id, renterId: db.me, ownerId: first.ownerId, durationId, start, end,
      cleaning, handover, price: Number(i.prices[durationId]), cleaningFee: (cleaning === "forfait" || i.cleaningRequired) ? Number(i.cleaningFee || 0) : 0,
      deposit: Number(i.deposit || 0),
      shippingFee: k === 0 ? q.shippingFee : 0, serviceFee: k === 0 ? q.serviceFee : 0, creditUsed: k === 0 ? q.creditUsed : 0,
      status: instant ? "confirmee" : "demandee", createdAt: now
    });
  });
  db.creditUsed = round((db.creditUsed || 0) + q.creditUsed);
  const n = itemIds.length;
  db.messages[mainId] = [{ from: "system", text: instant
    ? `Réservation confirmée${n > 1 ? ` (${n} pièces, un seul colis)` : ""}.`
    : `Demande envoyée${n > 1 ? ` pour ${n} pièces` : ""}. La loueuse a 24 h pour répondre ; tu ne paies qu'une fois acceptée.`, at: now }];
  save();
  return { reservation: reservation(mainId) };
}

// Transitions autorisées : qui peut faire quoi, à quelle étape (appliquées à tout le colis)
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
  group(r).forEach((x) => { x.status = to; });
  if (["refusee", "annulee"].includes(to) && r.creditUsed) db.creditUsed = Math.max(0, round(db.creditUsed - r.creditUsed));
  (db.messages[r.thread] = db.messages[r.thread] || []).push({ from: "system", text: SYSTEM_TEXT[to], at: new Date().toISOString() });
  save();
}

export function sendMessage(rid, text) {
  (db.messages[rid] = db.messages[rid] || []).push({ from: db.me, text, at: new Date().toISOString() });
  save();
}
export function review(rid, rating, text) { reservation(rid).review = { rating, text }; save(); }
export function updateMe(patch) { Object.assign(me(), patch); save(); }
