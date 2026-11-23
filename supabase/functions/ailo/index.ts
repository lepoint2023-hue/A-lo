// =====================================================================
// Aïlo — fonction serveur (Supabase Edge Function « ailo »)
//   GET  /ailo/vapid   → clé publique pour s'abonner aux notifications
//   POST /ailo/push    → appelée par la base à chaque nouveau message
//   POST /ailo/pay     → crée la page de paiement Stripe d'une location
//   POST /ailo/stripe  → Stripe confirme le paiement (webhook)
// Aucune dépendance. Secrets facultatifs : STRIPE_SECRET_KEY, STRIPE_WEBHOOK_SECRET.
// =====================================================================

const APP_URL = "https://lepoint2023-hue.github.io/A-lo/";
const APP_ORIGIN = "https://lepoint2023-hue.github.io";
const VAPID_SUBJECT = "mailto:lepoint2023@gmail.com";

declare const Deno: any;
const env = (k: string) => (typeof Deno !== "undefined" ? Deno.env.get(k) : (globalThis as any).process?.env?.[k]) || "";

// ---------- Outils ----------
const enc = new TextEncoder();
export function b64u(buf: ArrayBuffer | Uint8Array): string {
  const b = buf instanceof Uint8Array ? buf : new Uint8Array(buf);
  let s = "";
  for (const x of b) s += String.fromCharCode(x);
  return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}
export function unb64u(s: string): Uint8Array {
  s = s.replace(/-/g, "+").replace(/_/g, "/");
  while (s.length % 4) s += "=";
  return Uint8Array.from(atob(s), (c) => c.charCodeAt(0));
}
function concat(...parts: Uint8Array[]): Uint8Array {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let o = 0;
  for (const p of parts) { out.set(p, o); o += p.length; }
  return out;
}
const cors = (origin: string | null) => ({
  "Access-Control-Allow-Origin": origin === APP_ORIGIN || (origin || "").startsWith("http://localhost") ? origin! : APP_ORIGIN,
  "Access-Control-Allow-Headers": "authorization, content-type, apikey, x-client-info",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Vary": "Origin"
});
const json = (data: unknown, status = 200, extra: Record<string, string> = {}) =>
  new Response(JSON.stringify(data), { status, headers: { "Content-Type": "application/json", ...extra } });

// ---------- Accès à la base avec la clé serveur ----------
function serviceKey(): string {
  try {
    const keys = JSON.parse(env("SUPABASE_SECRET_KEYS") || "{}");
    const first = Object.values(keys)[0];
    if (typeof first === "string" && first) return first;
  } catch (_) { /* ignore */ }
  return env("SUPABASE_SERVICE_ROLE_KEY");
}
function dbHeaders(extra: Record<string, string> = {}) {
  const k = serviceKey();
  const h: Record<string, string> = { apikey: k, "Content-Type": "application/json", ...extra };
  if (k.startsWith("eyJ")) h.Authorization = `Bearer ${k}`;
  return h;
}
async function rest(path: string, init: RequestInit = {}) {
  const res = await fetch(`${env("SUPABASE_URL")}/rest/v1/${path}`, { ...init, headers: dbHeaders((init.headers as Record<string, string>) || {}) });
  if (!res.ok) throw new Error(`db ${res.status}: ${await res.text()}`);
  const t = await res.text();
  return t ? JSON.parse(t) : null;
}
async function getSecret(key: string): Promise<string | null> {
  const rows = await rest(`app_secrets?key=eq.${key}&select=value`);
  return rows && rows[0] ? rows[0].value : null;
}
async function setSecret(key: string, value: string) {
  await rest("app_secrets?on_conflict=key", { method: "POST", headers: { Prefer: "resolution=ignore-duplicates" }, body: JSON.stringify({ key, value }) });
}
async function currentUser(req: Request): Promise<{ id: string; email?: string } | null> {
  const auth = req.headers.get("authorization") || "";
  if (!auth.startsWith("Bearer ")) return null;
  const res = await fetch(`${env("SUPABASE_URL")}/auth/v1/user`, { headers: { apikey: serviceKey(), Authorization: auth } });
  if (!res.ok) return null;
  return await res.json();
}

// ---------- Clés VAPID (créées une seule fois, gardées dans la base) ----------
export async function newVapidKeys() {
  const kp = await crypto.subtle.generateKey({ name: "ECDSA", namedCurve: "P-256" }, true, ["sign", "verify"]);
  const pub = b64u(await crypto.subtle.exportKey("raw", kp.publicKey));
  const priv = JSON.stringify(await crypto.subtle.exportKey("jwk", kp.privateKey));
  return { pub, priv };
}
let vapidCache: { pub: string; priv: string } | null = null;
async function vapid() {
  if (vapidCache) return vapidCache;
  let pub = await getSecret("vapid_public");
  let priv = await getSecret("vapid_private");
  if (!pub || !priv) {
    const k = await newVapidKeys();
    await setSecret("vapid_public", k.pub);
    await setSecret("vapid_private", k.priv);
    pub = await getSecret("vapid_public");   // relit : si deux appels se croisent, on garde la première paire
    priv = await getSecret("vapid_private");
  }
  vapidCache = { pub: pub!, priv: priv! };
  return vapidCache;
}

// ---------- Web Push (RFC 8291 aes128gcm + RFC 8292 VAPID) ----------
async function hkdf(salt: Uint8Array, ikm: Uint8Array, info: Uint8Array, bytes: number) {
  const key = await crypto.subtle.importKey("raw", ikm, "HKDF", false, ["deriveBits"]);
  return new Uint8Array(await crypto.subtle.deriveBits({ name: "HKDF", hash: "SHA-256", salt, info }, key, bytes * 8));
}
export async function encryptPayload(payload: string, p256dh: string, authSecret: string) {
  const uaPublic = unb64u(p256dh);
  const auth = unb64u(authSecret);
  const local = await crypto.subtle.generateKey({ name: "ECDH", namedCurve: "P-256" }, true, ["deriveBits"]);
  const asPublic = new Uint8Array(await crypto.subtle.exportKey("raw", local.publicKey));
  const uaKey = await crypto.subtle.importKey("raw", uaPublic, { name: "ECDH", namedCurve: "P-256" }, false, []);
  const shared = new Uint8Array(await crypto.subtle.deriveBits({ name: "ECDH", public: uaKey }, local.privateKey, 256));
  const ikm = await hkdf(auth, shared, concat(enc.encode("WebPush: info\0"), uaPublic, asPublic), 32);
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const cek = await hkdf(salt, ikm, enc.encode("Content-Encoding: aes128gcm\0"), 16);
  const nonce = await hkdf(salt, ikm, enc.encode("Content-Encoding: nonce\0"), 12);
  const key = await crypto.subtle.importKey("raw", cek, "AES-GCM", false, ["encrypt"]);
  const plain = concat(enc.encode(payload), new Uint8Array([2]));
  const cipher = new Uint8Array(await crypto.subtle.encrypt({ name: "AES-GCM", iv: nonce }, key, plain));
  const rs = new Uint8Array([0, 0, 16, 0]); // 4096
  return concat(salt, rs, new Uint8Array([asPublic.length]), asPublic, cipher);
}
export async function vapidHeader(endpoint: string, pub: string, privJwk: string) {
  const aud = new URL(endpoint).origin;
  const header = b64u(enc.encode(JSON.stringify({ typ: "JWT", alg: "ES256" })));
  const claims = b64u(enc.encode(JSON.stringify({ aud, exp: Math.floor(Date.now() / 1000) + 12 * 3600, sub: VAPID_SUBJECT })));
  const key = await crypto.subtle.importKey("jwk", JSON.parse(privJwk), { name: "ECDSA", namedCurve: "P-256" }, false, ["sign"]);
  const sig = await crypto.subtle.sign({ name: "ECDSA", hash: "SHA-256" }, key, enc.encode(`${header}.${claims}`));
  return `vapid t=${header}.${claims}.${b64u(sig)}, k=${pub}`;
}
async function sendPush(sub: { endpoint: string; p256dh: string; auth: string }, data: unknown) {
  const v = await vapid();
  const body = await encryptPayload(JSON.stringify(data), sub.p256dh, sub.auth);
  const res = await fetch(sub.endpoint, {
    method: "POST",
    headers: { Authorization: await vapidHeader(sub.endpoint, v.pub, v.priv), "Content-Encoding": "aes128gcm", "Content-Type": "application/octet-stream", TTL: "86400", Urgency: "high" },
    body
  });
  if (res.status === 404 || res.status === 410) {
    await rest(`push_subscriptions?endpoint=eq.${encodeURIComponent(sub.endpoint)}`, { method: "DELETE" });
  }
  return res.status;
}

async function handlePush(req: Request) {
  const secret = await getSecret("hook_secret");
  if (!secret || req.headers.get("x-ailo-hook") !== secret) return json({ error: "forbidden" }, 403);
  const m = await req.json();
  const resa = await rest(`reservations?thread_id=eq.${m.thread_id}&select=renter_id,owner_id,item_id&limit=1`);
  if (!resa || !resa[0]) return json({ sent: 0 });
  const r = resa[0];
  const author = m.sender_id || m.actor;
  const targets = [r.renter_id, r.owner_id].filter((u: string) => u && u !== author);
  if (!targets.length) return json({ sent: 0 });
  let title = "Aïlo";
  if (m.sender_id) {
    const p = await rest(`profiles?id=eq.${m.sender_id}&select=name`);
    title = p && p[0] && p[0].name ? `Message de ${p[0].name}` : "Nouveau message";
  } else {
    const it = await rest(`items?id=eq.${r.item_id}&select=title`);
    if (it && it[0]) title = `Aïlo · ${it[0].title}`;
  }
  const subs = await rest(`push_subscriptions?user_id=in.(${targets.join(",")})&select=endpoint,p256dh,auth`);
  const body = String(m.body || "").slice(0, 140);
  const data = { title, body, url: `${APP_URL}#/messages/${m.thread_id}`, tag: `ailo-${m.thread_id}` };
  const results = await Promise.allSettled((subs || []).map((s: any) => sendPush(s, data)));
  return json({ sent: results.filter((x) => x.status === "fulfilled").length });
}

// ---------- Stripe ----------
const cents = (n: number) => Math.round(Number(n || 0) * 100);
async function handlePay(req: Request) {
  const user = await currentUser(req);
  if (!user) return json({ error: "Connecte-toi pour payer." }, 401);
  const { thread } = await req.json();
  if (!/^[0-9a-f-]{36}$/.test(String(thread))) return json({ error: "Location inconnue." }, 400);
  const rows = await rest(`reservations?thread_id=eq.${thread}&select=*,items(title)`);
  if (!rows || !rows.length) return json({ error: "Location inconnue." }, 404);
  if (rows[0].renter_id !== user.id) return json({ error: "Seule la locataire peut payer." }, 403);
  if (rows.some((r: any) => r.status !== "acceptee")) return json({ error: "Cette location n'est pas (ou plus) à payer." }, 409);
  const stripeKey = env("STRIPE_SECRET_KEY");
  if (!stripeKey) return json({ error: "stripe_not_configured" }, 503);

  // Montants recalculés ici à partir de la base : l'app ne décide jamais du prix
  const rental = rows.reduce((s: number, r: any) => s + cents(r.price) + cents(r.cleaning_fee) + cents(r.shipping_fee) + cents(r.service_fee) - cents(r.credit_used), 0);
  const deposit = rows.reduce((s: number, r: any) => s + cents(r.deposit), 0);
  const titles = rows.map((r: any) => (r.items && r.items.title) || "Pièce").join(", ").slice(0, 200);
  const p = new URLSearchParams();
  p.set("mode", "payment");
  p.set("locale", "fr");
  p.append("payment_method_types[]", "card");
  p.append("payment_method_types[]", "bancontact");
  let i = 0;
  if (rental > 0) {
    p.set(`line_items[${i}][quantity]`, "1");
    p.set(`line_items[${i}][price_data][currency]`, "eur");
    p.set(`line_items[${i}][price_data][unit_amount]`, String(rental));
    p.set(`line_items[${i}][price_data][product_data][name]`, `Location Aïlo : ${titles}`);
    i++;
  }
  if (deposit > 0) {
    p.set(`line_items[${i}][quantity]`, "1");
    p.set(`line_items[${i}][price_data][currency]`, "eur");
    p.set(`line_items[${i}][price_data][unit_amount]`, String(deposit));
    p.set(`line_items[${i}][price_data][product_data][name]`, "Caution (rendue au retour du vêtement)");
    i++;
  }
  if (!i) return json({ error: "Rien à payer." }, 400);
  p.set("client_reference_id", thread);
  p.set("metadata[thread]", thread);
  p.set("payment_intent_data[metadata][thread]", thread);
  if (user.email) p.set("customer_email", user.email);
  p.set("success_url", `${APP_URL}#/location/${thread}`);
  p.set("cancel_url", `${APP_URL}#/location/${thread}`);
  const res = await fetch("https://api.stripe.com/v1/checkout/sessions", {
    method: "POST",
    headers: { Authorization: `Bearer ${stripeKey}`, "Content-Type": "application/x-www-form-urlencoded" },
    body: p.toString()
  });
  const s = await res.json();
  if (!res.ok) return json({ error: (s.error && s.error.message) || "Stripe a refusé la demande." }, 502);
  return json({ url: s.url });
}

export async function verifyStripe(raw: string, header: string, secret: string, now = Date.now()) {
  const parts = Object.fromEntries(header.split(",").map((x) => x.split("=")).filter((x) => x.length === 2).map(([k, v]) => [k.trim(), v]));
  const sigs = header.split(",").filter((x) => x.trim().startsWith("v1=")).map((x) => x.trim().slice(3));
  const t = Number(parts.t);
  if (!t || !sigs.length || Math.abs(now / 1000 - t) > 300) return false;
  const key = await crypto.subtle.importKey("raw", enc.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const mac = new Uint8Array(await crypto.subtle.sign("HMAC", key, enc.encode(`${t}.${raw}`)));
  const hex = Array.from(mac, (b) => b.toString(16).padStart(2, "0")).join("");
  return sigs.some((s) => s.length === hex.length && [...s].reduce((d, c, k) => d | (c.charCodeAt(0) ^ hex.charCodeAt(k)), 0) === 0);
}
async function handleStripe(req: Request) {
  const secret = env("STRIPE_WEBHOOK_SECRET");
  if (!secret) return json({ error: "stripe_not_configured" }, 503);
  const raw = await req.text();
  if (!(await verifyStripe(raw, req.headers.get("stripe-signature") || "", secret))) return json({ error: "bad signature" }, 400);
  const ev = JSON.parse(raw);
  const s = ev.data && ev.data.object;
  const paid = (ev.type === "checkout.session.completed" && s.payment_status === "paid") || ev.type === "checkout.session.async_payment_succeeded";
  if (paid && s.metadata && s.metadata.thread) {
    const thread = s.metadata.thread;
    const updated = await rest(`reservations?thread_id=eq.${thread}&status=eq.acceptee`, {
      method: "PATCH", headers: { Prefer: "return=representation" },
      body: JSON.stringify({ status: "confirmee", payment_ref: s.payment_intent || s.id })
    });
    if (updated && updated.length) {
      await rest("messages", { method: "POST", body: JSON.stringify({ thread_id: thread, sender_id: null, body: "Paiement reçu : la location est confirmée." }) });
    }
  }
  return json({ received: true });
}

// ---------- Aiguillage ----------
export async function handler(req: Request): Promise<Response> {
  const origin = req.headers.get("origin");
  const h = cors(origin);
  if (req.method === "OPTIONS") return new Response("ok", { headers: h });
  const path = new URL(req.url).pathname.replace(/\/+$/, "");
  try {
    let res: Response;
    if (req.method === "GET" && path.endsWith("/vapid")) res = json({ key: (await vapid()).pub });
    else if (req.method === "POST" && path.endsWith("/push")) res = await handlePush(req);
    else if (req.method === "POST" && path.endsWith("/pay")) res = await handlePay(req);
    else if (req.method === "POST" && path.endsWith("/stripe")) res = await handleStripe(req);
    else if (req.method === "GET") res = json({ ok: true, stripe: !!env("STRIPE_SECRET_KEY"), webhook: !!env("STRIPE_WEBHOOK_SECRET") });
    else res = json({ error: "not found" }, 404);
    for (const [k, v] of Object.entries(h)) res.headers.set(k, v);
    return res;
  } catch (e) {
    console.error(e);
    return json({ error: "Erreur serveur." }, 500, h);
  }
}

if (typeof Deno !== "undefined") Deno.serve(handler);
