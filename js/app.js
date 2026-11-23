// Aïlo — application (v0.4 : comptes et données Supabase)
import * as S from "./store.js";
import {
  CATEGORIES, STYLES, COLORS, SIZES, OCCASIONS, CONDITIONS, CONDITION_HINTS, DURATIONS, STATUS,
  COMMISSION_RATE, COMMISSION_TIERS, VEDETTE_MIN, BETA_FREE_PREMIUM, SERVICE_FEE, SHIPPING_FEE, SHIPPING_MIN, SHIPPING_DAYS, DEFAULT_RADIUS, addDays
} from "./data.js";
import { esc, euro, fmtDate, fmtShort, today, initials, avatar, icon, photo, toast, resizeImage, calendar } from "./ui.js";
import { searchPlaces, nearestPlace, currentPosition, kmLabel } from "./geo.js";
import { aiEndpoint } from "./config.js";

const view = document.getElementById("view");
const tabbar = document.getElementById("tabbar");

const freshFilters = () => ({ q: "", category: "", style: "", color: "", size: "", brand: "", condition: "", handover: "", occasion: "", maxPrice: "", radius: DEFAULT_RADIUS, includeShipping: true, date: "", sort: "km" });
const ui = {
  filters: freshFilters(),
  groupBy: "tout",
  locTab: "prends",
  dressFilter: "",
  booking: {},   // itemId -> { durationId, start, cleaning, handover, extras: [], useCredit }
  draft: null,   // pièce en cours d'édition
  place: null,   // commune choisie dans un sélecteur
  authReason: "", // pourquoi on demande de se connecter
  view: (() => { try { return localStorage.getItem("ailo-view") || "grid"; } catch (e) { return "grid"; } })()
};

// ---------------------------------------------------------------- Routeur
const routes = [
  [/^#?\/?$/, decouvrir],
  [/^#\/favoris$/, favoris],
  [/^#\/item\/([\w-]+)$/, fiche],
  [/^#\/dressing$/, dressing],
  [/^#\/dressing\/nouveau$/, () => itemForm()],
  [/^#\/dressing\/([\w-]+)$/, (id) => itemForm(id)],
  [/^#\/locations$/, locations],
  [/^#\/location\/([\w-]+)$/, locationDetail],
  [/^#\/messages$/, messagesList],
  [/^#\/messages\/([\w-]+)$/, thread],
  [/^#\/profil$/, profil],
  [/^#\/profil\/modifier$/, editProfile],
  [/^#\/membre\/([\w-]+)$/, membre],
  [/^#\/cgu$/, cgu],
  [/^#\/connexion$/, () => authView()],
  [/^#\/bienvenue$/, () => decouvrir()]
];
// Pages visibles sans compte ; les autres demandent de se connecter
const PUBLIC = /^(#?\/?|#\/item\/[\w-]+|#\/membre\/[\w-]+|#\/cgu|#\/connexion)$/;
const GATE_REASON = { dressing: "Crée ton compte pour proposer tes vêtements à la location.", favoris: "Crée ton compte pour garder tes coups de cœur.", locations: "Crée ton compte pour suivre tes locations.", location: "Crée ton compte pour suivre tes locations.", messages: "Crée ton compte pour échanger avec les loueuses.", profil: "Crée ton compte pour avoir ton profil Aïlo." };
// Demande un compte, puis revient où on était
function needAccount(reason) {
  ui.authReason = reason;
  try { sessionStorage.setItem("ailo-after-auth", location.hash || "#/"); } catch (e) { /* ignore */ }
  if (location.hash === "#/connexion") route(); else go("#/connexion");
}
function afterAuthTarget() {
  let t = null;
  try { t = sessionStorage.getItem("ailo-after-auth"); sessionStorage.removeItem("ailo-after-auth"); } catch (e) { /* ignore */ }
  return t && t !== "#/connexion" ? t : "#/";
}

function route(keep) {
  const h = location.hash || "#/";
  let out = null;
  if (!S.hasSession() && !PUBLIC.test(h)) {
    ui.authReason = GATE_REASON[h.split("/")[1]] || "";
    try { sessionStorage.setItem("ailo-after-auth", h); } catch (e) { /* ignore */ }
    out = authView();
  }
  else if (S.isRecovering()) out = recoveryView();
  else if (S.hasSession() && !S.isOnboarded() && h !== "#/cgu") out = onboarding();
  else if (S.hasSession() && h === "#/connexion") { location.hash = "#/"; return; }
  else for (const [re, fn] of routes) {
    const m = h.match(re);
    if (m) { out = fn(...m.slice(1)); break; }
  }
  if (!out) { location.hash = "#/"; return; }
  const cta = S.isGuest() && !out.noTabbar && !out.bottomBar;
  view.innerHTML = alertBanner() + out.html + (cta ? `<div class="guest-cta" role="region" aria-label="Inscription">
      <span class="grow"><strong>Inscription gratuite</strong><span class="small block">Pour louer une tenue ou proposer tes vêtements.</span></span>
      <a class="btn sm" href="#/connexion" data-action="signup">S'inscrire</a></div>` : "");
  document.body.classList.toggle("has-guest-cta", cta);
  tabbar.hidden = !!out.noTabbar;
  document.body.classList.toggle("has-bottombar", !!out.bottomBar);
  setTab(out.tab);
  if (out.mount) out.mount();
  if (!keep) window.scrollTo(0, 0);
  document.title = out.title ? `${out.title} · Aïlo` : "Aïlo";
}
window.addEventListener("hashchange", () => route());
window.addEventListener("ailo:toast", (e) => toast(e.detail));
window.addEventListener("ailo:incoming", (e) => {
  const { thread, from, text, system } = e.detail;
  if (location.hash === "#/messages/" + thread && document.visibilityState === "visible") { S.markRead(thread); return; }
  if (document.visibilityState === "visible") toast(system ? text : `Nouveau message de ${from}`);
  else if ("Notification" in window && Notification.permission === "granted" && navigator.serviceWorker) {
    navigator.serviceWorker.ready.then((reg) => reg.showNotification(system ? "Aïlo" : `Message de ${from}`, { body: text, icon: "icons/icon-192.png", tag: "ailo-" + thread, data: { url: location.pathname + "#/messages/" + thread } })).catch(() => {});
  }
  setTab(currentTab());
});
window.addEventListener("ailo:refresh", () => {
  // Ne jamais redessiner un formulaire en cours ni un champ en train d'être rempli
  if (/^#\/(dressing\/|profil\/modifier)/.test(location.hash) || document.querySelector("input:focus, textarea:focus, dialog[open]")) { setTab(currentTab()); return; }
  route(true);
});
const currentTab = () => ({ "": "decouvrir", item: "", favoris: "decouvrir", membre: "decouvrir", dressing: "dressing", locations: "locations", location: "locations", messages: "messages", profil: "profil" })[location.hash.split("/")[1] || ""] ?? "";

function setTab(tab) {
  tabbar.querySelectorAll("a").forEach((a) => {
    const on = a.dataset.tab === tab;
    a.classList.toggle("on", on);
    if (on) a.setAttribute("aria-current", "page"); else a.removeAttribute("aria-current");
  });
  tabbar.querySelector("[data-tab=locations] .dot").hidden = !(S.myLendings().some((r) => r.status === "demandee") || S.myRentals().some((r) => r.status === "acceptee"));
  tabbar.querySelector("[data-tab=messages] .dot").hidden = !S.unreadCount();
}

const go = (h) => { location.hash = h; };
const back = (fallback) => (history.length > 1 ? history.back() : go(fallback));

// ---------------------------------------------------------------- Composants
const dist = (userId) => S.distanceTo(userId);
const far = (i) => (dist(i.ownerId) ?? 0) > Number(ui.filters.radius || 9999);

function card(i) {
  const owner = S.user(i.ownerId);
  const fav = S.isFav(i.id);
  return `<article class="card">
    <a href="#/item/${i.id}" class="card-link">
      <div class="card-ph">${photo(i)}${i.instant ? `<span class="tag-instant">${icon("bolt", 12)} Instantané</span>` : ""}${far(i) ? `<span class="tag-ship">${icon("box", 12)} Envoi</span>` : ""}</div>
      <h3>${esc(i.title)}</h3>
      <p class="muted small">T. ${esc(i.size)} · ${esc(owner.city)} · ${kmLabel(dist(i.ownerId))}</p>
      <p class="price"><span class="muted">dès </span><strong>${euro(S.minPrice(i))}</strong></p>
    </a>
    <button class="fav ${fav ? "on" : ""}" data-action="fav" data-id="${i.id}" aria-label="${fav ? "Retirer des" : "Ajouter aux"} favoris" aria-pressed="${fav}">${icon(fav ? "heart-fill" : "heart", 16)}</button>
  </article>`;
}

// Présentation des résultats, choisie par chacune et gardée sur l'appareil
const VIEWS = [["large", "Grandes photos", "Grand"], ["grid", "Grille de deux", "Grille"], ["small", "Petites photos", "Petit"], ["list", "Liste", "Liste"]];
const grid = (items) => `<div class="grid2 grid-${ui.view}">${items.map(card).join("")}</div>`;
const empty = (title, text, cta = "") => `<div class="empty"><p class="empty-title">${title}</p><p class="muted">${text}</p>${cta}</div>`;
const statusPill = (s) => `<span class="pill tone-${STATUS[s].tone}">${STATUS[s].label}</span>`;
const ownerBadge = (u) => (u.type === "boutique" ? `<span class="badge">${icon("shop", 12)} Boutique partenaire</span>` : u.type === "pro" ? `<span class="badge">Pro</span>` : "")
  + (S.isVedette(u.id) ? `<span class="badge vedette">${icon("star", 12)} Loueuse vedette</span>` : "");
// Marque des options payantes au lancement
// Avec une clé : étiquette cliquable (ⓘ) qui explique concrètement l'avantage
const premiumTag = (k) => k
  ? `<button type="button" class="premium" data-action="premium-info" data-k="${k}" aria-label="Option Premium : en savoir plus">${icon("crown", 12)} Premium ${icon("info", 13)}</button>`
  : `<span class="premium">${icon("crown", 12)} Premium</span>`;
const PREMIUM_INFO = {
  follow: { title: "Suivre un profil", points: [
    "Tu suis tes loueuses préférées, celles qui ont ta taille et ton style.",
    "Tu reçois une notification dès qu'elles mettent une nouvelle pièce en ligne.",
    "Tu réserves avant tout le monde les pièces les plus demandées (robes de cocktail, tenues de mariage…).",
    "Tu retrouves toutes les loueuses suivies dans Profil → Profils suivis."] },
  premium: { title: "L'abonnement Premium", points: [
    "Suivre des profils et être prévenue de leurs nouvelles pièces.",
    "Voir les statistiques de ce qui se loue le mieux autour de toi.",
    "Mettre tes annonces en haut des résultats."] }
};
const betaFreeNote = () => BETA_FREE_PREMIUM ? `<p class="premium-note small">${icon("crown", 14)} <span><strong>Offert pendant la bêta.</strong> Au lancement d'Aïlo, cette option fera partie de l'abonnement Premium.</span></p>` : "";
const pct = (r) => `${Math.round(r * 100)} %`;
const tiersText = () => COMMISSION_TIERS.map((t, k) => k === 0 ? `${pct(t.rate)} de base` : `${pct(t.rate)} dès ${t.min} locations terminées`).join(", ");
const opts = (list, sel, placeholder) => `<option value="">${placeholder}</option>` + list.map((v) => `<option ${v === sel ? "selected" : ""}>${esc(v)}</option>`).join("");
const fmtRating = (n) => (n === null || n === undefined ? "—" : n.toFixed(1).replace(".", ","));
const ratingLine = (u) => (u.reviews ? `★ ${fmtRating(u.rating)} · ${u.reviews} avis` : "Nouveau membre");

// Sélecteur de commune (code postal ou nom, ou position du téléphone)
function placePicker(current) {
  return `<div class="place-picker">
    <label class="field"><span>Ta commune *</span>
      <input id="place-q" type="text" inputmode="search" autocomplete="off" placeholder="Code postal ou commune, ex. 6680" value="${current ? esc(current.zip + " " + current.city) : ""}"></label>
    <div id="place-results" class="place-results" role="listbox" aria-label="Communes"></div>
    <button type="button" class="btn ghost sm" data-action="geo-me">${icon("locate", 18)} Utiliser ma position</button>
    <p class="muted small">Seule ta commune est visible, jamais ton adresse. Les distances sont approximatives.</p>
  </div>`;
}
function mountPlacePicker() {
  const q = document.getElementById("place-q"), box = document.getElementById("place-results");
  let t;
  q.addEventListener("input", () => {
    ui.place = null;
    clearTimeout(t);
    t = setTimeout(async () => {
      const list = await searchPlaces(q.value);
      box.innerHTML = list.map((p) => `<button type="button" role="option" data-action="pick-place" data-zip="${p.zip}" data-city="${esc(p.city)}" data-lat="${p.lat}" data-lng="${p.lng}">${p.zip} ${esc(p.city)}</button>`).join("");
    }, 150);
  });
}
function setPlace(p) {
  ui.place = { zip: p.zip, city: p.city, lat: Number(p.lat), lng: Number(p.lng) };
  const q = document.getElementById("place-q");
  if (q) q.value = `${p.zip} ${p.city}`;
  const box = document.getElementById("place-results");
  if (box) box.innerHTML = "";
}

// ---------------------------------------------------------------- Bienvenue
function ageFrom(iso) {
  const b = new Date(iso + "T00:00:00"), n = new Date();
  let a = n.getFullYear() - b.getFullYear();
  if (n.getMonth() < b.getMonth() || (n.getMonth() === b.getMonth() && n.getDate() < b.getDate())) a--;
  return a;
}
function onboarding() {
  const u = S.me();
  if (!ui.place && u.zip && u.name) ui.place = { zip: u.zip, city: u.city, lat: u.lat, lng: u.lng };
  return {
    noTabbar: true, title: "Bienvenue",
    html: `<form id="onb" class="page onb" novalidate>
      <div class="logo big-logo">Aïlo</div>
      <h1 class="h1">Loue la tenue de ton prochain événement, ou loue ton dressing.</h1>
      <p class="muted">Deux informations pour commencer : elles servent à te montrer les pièces près de chez toi.</p>
      <label class="field"><span>Ton prénom *</span><input name="name" maxlength="30" autocomplete="given-name" value="${esc(u.name)}" required></label>
      ${placePicker(ui.place)}
      <label class="field"><span>Date de naissance * <span class="muted small">(vérifie que tu as 18 ans ; elle n'est pas conservée)</span></span><input type="date" name="birth" required max="${today()}" min="1900-01-01"></label>
      <label class="toggle"><input type="checkbox" name="terms" required><span>J'accepte les <a href="#/cgu">conditions générales</a> et la politique de confidentialité.</span></label>
      <p id="onb-err" class="err small" role="alert"></p>
      <button class="btn">Commencer</button>
      <p class="muted small center">Connectée avec ${esc(S.myEmail())} · <button type="button" class="linkbtn" data-action="logout">changer de compte</button></p>
    </form>`,
    mount() {
      mountPlacePicker();
      document.getElementById("onb").addEventListener("submit", (e) => {
        e.preventDefault();
        const f = e.target, err = document.getElementById("onb-err");
        const name = f.name.value.trim();
        if (!name) return (err.textContent = "Indique ton prénom.");
        if (!ui.place) return (err.textContent = "Choisis ta commune dans la liste, ou utilise ta position.");
        if (!f.birth.value) return (err.textContent = "Indique ta date de naissance.");
        if (ageFrom(f.birth.value) < 18) {
          f.querySelector(".btn").disabled = true;
          return (err.textContent = "Désolée : Aïlo est réservée aux personnes majeures (18 ans et plus). Tu ne peux pas créer de compte.");
        }
        if (!f.terms.checked) return (err.textContent = "Accepte les conditions générales pour continuer.");
        S.updateMe(Object.assign({ name: name.charAt(0).toUpperCase() + name.slice(1), acceptedTerms: new Date().toISOString() }, ui.place));
        ui.place = null;
        toast(`Bienvenue ${S.me().name} !`);
        const target = afterAuthTarget(); // revient sur la pièce ou la page d'où on venait
        go(target); route();
        setTimeout(maybeWelcome, 1200);
      });
    }
  };
}

function cgu() {
  return {
    noTabbar: !S.isOnboarded(), title: "Conditions générales",
    html: `<div class="page prose">
      <header class="topbar"><button class="icon-btn" data-action="back" aria-label="Retour">${icon("back", 20)}</button><h1 class="h1 inline">Conditions générales</h1><span></span></header>
      <p class="box note small">Brouillon de travail : ces conditions doivent être rédigées et validées par un juriste avant l'ouverture au public.</p>
      <h2 class="h3">Âge minimum</h2><p>Aïlo est réservée aux personnes de 18 ans et plus. La date de naissance demandée à l'inscription sert uniquement à ce contrôle et n'est pas conservée. En indiquant ta date de naissance, tu certifies être majeure ; une fausse déclaration engage ta responsabilité. Tout compte ou contenu concernant une personne mineure est supprimé dès qu'il est signalé.</p>
      <h2 class="h3">Signaler un contenu</h2><p>Chaque pièce et chaque profil a un bouton « Signaler ». Aïlo examine chaque signalement en priorité et retire rapidement les contenus illicites ou contraires à ces conditions ; le compte concerné peut être suspendu.</p>
      <h2 class="h3">Le rôle d'Aïlo</h2><p>Aïlo met en relation des particuliers et des professionnelles qui louent des vêtements avec des personnes qui en ont besoin. Aïlo n'est ni propriétaire ni vendeur des pièces.</p>
      <h2 class="h3">Options Premium</h2><p>Certaines options (signalées par une couronne) seront payantes au lancement, comme suivre un profil. Elles sont offertes pendant la bêta.</p>
      <h2 class="h3">Paiement, caution, frais</h2><p>La locataire paie la location, les frais de service (${euro(SERVICE_FEE.fixed)} + ${SERVICE_FEE.rate * 100} % de la location), l'éventuel forfait nettoyage et, en cas d'envoi, un forfait aller-retour de ${euro(SHIPPING_FEE)}. Une caution est bloquée puis remboursée après le retour contrôlé. Aïlo prélève une commission sur la part de la loueuse : ${tiersText()}. Le taux est fixé au moment de la réservation.</p>
      <h2 class="h3">Remise et retour</h2><p>Un état des lieux photo est fait à la remise et au retour. En cas de dommage, Aïlo compare les photos ; la retenue ne dépasse jamais la caution.</p>
      <h2 class="h3">Données personnelles</h2><p>Aïlo conserve ton prénom, ta commune, tes annonces, tes réservations et tes messages. Ton adresse exacte n'est jamais affichée. Tu peux supprimer ton compte à tout moment.</p>
    </div>`
  };
}

// ---------------------------------------------------------------- Découvrir
function activeFilterCount() {
  const f = ui.filters;
  return ["category", "style", "color", "size", "brand", "condition", "handover", "maxPrice", "date"].filter((k) => f[k]).length + (Number(f.radius) !== DEFAULT_RADIUS ? 1 : 0);
}

function resultsHTML() {
  const items = S.catalog(ui.filters);
  if (!items.length) {
    const mine = S.myItems().filter((i) => i.status === "online").length;
    return empty("Aucune pièce trouvée", mine
      ? `Tes propres pièces n'apparaissent pas ici : retrouve-les dans <a href="#/dressing">Mon dressing</a>. Les autres membres les voient dans leur fil.`
      : "Élargis le rayon ou les filtres.", `<button class="btn ghost" data-action="clear-filters">Effacer les filtres</button>`);
  }
  const near = items.filter((i) => !far(i)).length;
  const count = `<p class="muted small count">${items.length} pièce${items.length > 1 ? "s" : ""}${items.length - near ? ` · dont ${items.length - near} plus loin, avec envoi` : ""}</p>`;
  if (ui.groupBy === "tout") return count + grid(items);
  const groups = new Map();
  for (const i of items) {
    const keys = ui.groupBy === "categorie" ? [i.category] : ui.groupBy === "theme" ? i.occasions : [i.ownerId];
    for (const k of keys) { if (!groups.has(k)) groups.set(k, []); groups.get(k).push(i); }
  }
  let keys = [...groups.keys()];
  if (ui.groupBy === "theme") keys = OCCASIONS.filter((o) => groups.has(o));
  if (ui.groupBy === "profil") keys.sort((a, b) => (S.user(b).type === "boutique") - (S.user(a).type === "boutique"));
  return count + keys.map((k) => {
    const title = ui.groupBy === "profil"
      ? `<div class="group-owner">${avatar(S.user(k), "sm")}<span>${esc(S.user(k).name)}</span>${ownerBadge(S.user(k))}<span class="muted small">${ratingLine(S.user(k))} · ${esc(S.user(k).city)}${kmLabel(dist(k)) ? ", " + kmLabel(dist(k)) : ""}</span></div>`
      : `<h2 class="h2">${esc(k)} <span class="muted small">${groups.get(k).length}</span></h2>`;
    return `<section class="group">${title}<div class="hscroll">${groups.get(k).map(card).join("")}</div></section>`;
  }).join("");
}

// Encart d'occasion : « Spécial mariage » par défaut, puis celui de l'occasion choisie
const OCCASION_BANNERS = {
  "Mariage": { kicker: "Spécial mariage", title: "Invitée, témoin ou mariée", text: "Toutes les tenues pour le grand jour", bg: "#F3EBDA, #E9DCCF" },
  "Soirée": { kicker: "Soirée", title: "Briller jusqu'au bout de la nuit", text: "Robes, combinaisons et vestes habillées", bg: "#E4E1F0, #D6D2E8" },
  "Cocktail": { kicker: "Cocktail", title: "Élégante, du cocktail au grand soir", text: "Robes courtes ou longues, costumes et accessoires", bg: "#F6E1DC, #EDD0C9" },
  "Business": { kicker: "Business", title: "Impeccable pour le travail", text: "Tailleurs, costumes, chemisiers et vestes", bg: "#E6E8EB, #D8DCE1" },
  "Vacances & plage": { kicker: "Vacances & plage", title: "Légère et décontractée", text: "Robes d'été, lin, chapeaux et sacs de plage", bg: "#FBEFD8, #F5E1BC" },
  "Communion": { kicker: "Communion", title: "Une tenue pour la fête de famille", text: "Des tenues claires et élégantes", bg: "#EEF2E6, #E0E8D5" },
  "Baptême": { kicker: "Baptême", title: "Pour accueillir le petit dernier", text: "Des tenues douces et chics pour la cérémonie", bg: "#E5EEF2, #D6E5EC" },
  "Tous les jours": { kicker: "Tous les jours", title: "Le dressing du quotidien", text: "Des pièces faciles à porter, pour changer de style", bg: "#EFEBE4, #E4DED4" }
};
function occasionBanner(current) {
  // Bandeau fin, non cliquable : rappelle la sélection en cours
  const o = OCCASION_BANNERS[current] || { kicker: "Toutes les occasions", title: "Une tenue pour chaque événement", bg: "#F3EBDA, #E9DCCF" };
  return `<p class="occ-strip" style="background:linear-gradient(135deg, ${o.bg})"><strong>${esc(o.kicker)}</strong> · ${esc(o.title)}</p>`;
}
function decouvrir() {
  const f = ui.filters, n = activeFilterCount(), u = S.me();
  const seg = [["tout", "Aucun"], ["categorie", "Par catégorie"], ["theme", "Par occasion"], ["profil", "Par loueuse"]];
  return {
    tab: "decouvrir",
    html: `<div class="page">
      <header class="topbar"><div class="logo">Aïlo</div>
        ${S.isGuest() ? `<a class="btn sm" href="#/connexion" data-action="signup">Créer un compte</a>` : `<a class="icon-btn" href="#/favoris" aria-label="Mes favoris">${icon("heart", 20)}</a>`}</header>
      ${installBanner()}
      <p class="muted">${S.isGuest() ? `Bienvenue sur Aïlo · <a href="#/connexion" data-action="to-login">Se connecter</a>` : `Bonjour ${esc(u.name)}`}</p>
      <h1 class="h1">Quelle tenue pour ton prochain événement ?</h1>
      <div class="searchrow">
        <label class="search">${icon("search", 18)}<span class="sr">Rechercher</span>
          <input id="q" type="search" placeholder="Robe, marque, taille 38…" value="${esc(f.q)}" autocomplete="off"></label>
        <button class="icon-btn solid ghost-solid" data-action="photo-search" aria-label="Rechercher avec une photo">${icon("camera", 20)}</button>
        <button class="icon-btn solid" data-action="open-filters" aria-label="Filtres">${icon("filter", 20)}${n ? `<span class="count-badge">${n}</span>` : ""}</button>
      </div>
      ${S.isGuest() && !u.city
        ? `<button class="where" data-action="guest-place">${icon("pin", 16)} <span><strong>Choisis ta commune</strong> pour voir les pièces près de chez toi</span></button>`
        : `<button class="where" data-action="${S.isGuest() ? "guest-place" : "open-filters"}">${icon("pin", 16)} Autour de <strong>${esc(u.city)}</strong> · ${Number(f.radius) >= 100 ? "partout" : f.radius + " km"} <span class="muted">Modifier</span></button>`}
      <div class="chips">${["", ...OCCASIONS].map((o) => `<button class="chip ${f.occasion === o ? "on" : ""}" data-action="occasion" data-o="${o}" aria-pressed="${f.occasion === o}">${o || "Toutes"}</button>`).join("")}</div>
      ${occasionBanner(f.occasion)}
      <input type="file" accept="image/*" id="search-photo" class="sr" aria-label="Choisir une photo d'inspiration">
      ${lookalikeHTML()}
      ${forYouHTML()}
      <div class="toolbar">
        <label class="tool"><span class="tool-cap">Regrouper</span><select id="group-by">${seg.map(([k, l]) => `<option value="${k}" ${ui.groupBy === k ? "selected" : ""}>${l}</option>`).join("")}</select></label>
        <div class="tool"><span class="tool-cap" id="views-cap">Affichage</span>
          <div class="views" role="group" aria-labelledby="views-cap">${VIEWS.map(([k, l, short]) => `<button data-action="view" data-v="${k}" aria-pressed="${ui.view === k}" aria-label="${l}">${icon("view-" + k, 16)}<span>${short}</span></button>`).join("")}</div></div>
      </div>
      <div id="results" class="view-${ui.view}">${resultsHTML()}</div>
    </div>
    ${filtersSheet()}`,
    mount() {
      notifNudge();
      const q = document.getElementById("q");
      q.addEventListener("input", () => { ui.filters.q = q.value; document.getElementById("results").innerHTML = resultsHTML(); });
    }
  };
}

function filtersSheet() {
  const f = ui.filters, u = S.me();
  const r = Number(f.radius) || 100;
  return `<dialog id="filters" class="sheet" aria-labelledby="filters-title">
    <form method="dialog" id="filters-form">
      <div class="sheet-head"><h2 id="filters-title" class="h2">Filtres</h2><button class="icon-btn" value="cancel" aria-label="Fermer">${icon("close", 20)}</button></div>
      <div class="fields">
        <div class="box mini-row"><span>${icon("pin", 16)} Autour de <strong>${esc(u.city)}</strong></span><a href="#/profil/modifier">Changer</a></div>
        <label class="field"><span>Rayon : <output id="rv">${r >= 100 ? "partout" : r + " km"}</output></span><input type="range" name="radius" min="5" max="100" step="5" value="${r}"></label>
        <label class="toggle"><input type="checkbox" name="includeShipping" ${f.includeShipping ? "checked" : ""}><span>Montrer aussi les pièces plus loin qui peuvent être envoyées</span></label>
        <label class="field"><span>Catégorie</span><select name="category">${opts(CATEGORIES, f.category, "Toutes")}</select></label>
        <label class="field"><span>Style</span><select name="style">${opts(STYLES, f.style, "Tous")}</select></label>
        <fieldset class="field"><legend>Couleur</legend><div class="swatches">
          <label class="sw"><input type="radio" name="color" value="" ${!f.color ? "checked" : ""}><span class="sw-any">Toutes</span></label>
          ${COLORS.map((c) => `<label class="sw" title="${c.name}"><input type="radio" name="color" value="${c.name}" ${f.color === c.name ? "checked" : ""}><span style="background:${c.hex}"></span><span class="sr">${c.name}</span></label>`).join("")}
        </div></fieldset>
        <label class="field"><span>Taille</span><select name="size">${opts(SIZES, f.size, "Toutes")}</select></label>
        <label class="field"><span>Marque</span><select name="brand">${opts(S.brands(), f.brand, "Toutes")}</select></label>
        <label class="field"><span>État</span><select name="condition">${opts(CONDITIONS, f.condition, "Tous")}</select></label>
        <label class="field"><span>Remise</span><select name="handover"><option value="">Main propre ou envoi</option><option value="main" ${f.handover === "main" ? "selected" : ""}>Main propre possible</option><option value="envoi" ${f.handover === "envoi" ? "selected" : ""}>Envoi possible</option></select></label>
        <label class="field"><span>Disponible à partir du</span><input type="date" name="date" min="${today()}" value="${f.date}"></label>
        <label class="field"><span>Prix de départ max : <output id="pv">${f.maxPrice ? euro(f.maxPrice) : "sans limite"}</output></span><input type="range" name="maxPrice" min="5" max="50" step="5" value="${f.maxPrice || 50}"></label>
        <label class="field"><span>Trier par</span><select name="sort"><option value="km" ${f.sort === "km" ? "selected" : ""}>Proximité</option><option value="price" ${f.sort === "price" ? "selected" : ""}>Prix</option><option value="new" ${f.sort === "new" ? "selected" : ""}>Nouveautés</option></select></label>
      </div>
      <div class="sheet-actions"><button type="button" class="btn ghost" data-action="clear-filters">Réinitialiser</button><button class="btn" value="apply">Voir les résultats</button></div>
    </form>
  </dialog>`;
}

// ---------------------------------------------------------------- Favoris
function favoris() {
  const items = S.favorites();
  return {
    tab: "decouvrir", title: "Favoris",
    html: `<div class="page"><header class="topbar"><a class="icon-btn" href="#/" aria-label="Retour">${icon("back", 20)}</a><h1 class="h1 inline">Mes favoris</h1><span></span></header>
      ${items.length ? grid(items) : empty("Pas encore de favoris", "Touche le cœur d'une pièce pour la retrouver ici.")}</div>`
  };
}

// ---------------------------------------------------------------- Fiche vêtement
function fiche(id) {
  const i = S.item(id);
  if (!i) return { html: empty("Pièce introuvable", "Elle a peut-être été retirée.", `<a class="btn" href="#/">Retour</a>`) };
  const o = S.user(i.ownerId), mine = i.ownerId === S.me().id;
  const durs = S.offeredDurations(i);
  const b = ui.booking[id] || (ui.booking[id] = {
    durationId: (durs.find((d) => d.id === "sem") || durs[0]).id, start: "", extras: [], useCredit: false,
    cleaning: i.cleaningRequired ? "forfait" : "propre",
    handover: i.handover === "envoi" || (i.handover === "both" && far(i)) ? "envoi" : "main"
  });
  const fav = S.isFav(id);
  const ranges = S.bookedRanges(id);
  const credit = S.credit();
  const photos = i.photos.length ? i.photos.map((p, k) => `<button class="zoom" data-action="zoom" data-k="${k}" aria-label="Agrandir la photo ${k + 1}"><img src="${p}" alt="${esc(i.title)}, photo ${k + 1}"></button>`).join("") : photo(i, "big");
  return {
    noTabbar: true, bottomBar: !mine, title: i.title,
    html: `<div class="hero">
        <div class="gallery">${photos}</div>
        <button class="icon-btn float left" data-action="back" aria-label="Retour">${icon("back", 20)}</button>
        ${mine ? "" : `<button class="icon-btn float right fav-big ${fav ? "on" : ""}" data-action="fav" data-id="${id}" aria-label="${fav ? "Retirer des" : "Ajouter aux"} favoris" aria-pressed="${fav}">${icon(fav ? "heart-fill" : "heart", 20)}</button>`}
        ${i.photos.length > 1 ? `<div class="dots">${i.photos.map(() => "<span></span>").join("")}</div>` : ""}
      </div>
      <div class="page">
        <div><h1 class="h1">${esc(i.title)}</h1>
          <p class="muted">Taille ${esc(i.size)} · ${esc(i.color)}${i.pattern ? " (" + esc(i.pattern) + ")" : ""}${i.brand ? " · " + esc(i.brand) : ""}</p></div>
        <div class="box mini-row"><span><strong>${esc(i.condition)}</strong><span class="muted small block">${esc(CONDITION_HINTS[i.condition] || "")}</span></span></div>
        ${i.defects ? `<p class="box warnbox small"><strong>Défauts signalés :</strong> ${esc(i.defects)}</p>` : ""}
        <div class="tags">${i.instant ? `<span class="badge accent">${icon("bolt", 12)} Réservation instantanée</span>` : ""}<span class="badge">${esc(i.category)}</span><span class="badge">${esc(i.style)}</span>${i.occasions.map((x) => `<span class="badge">${esc(x)}</span>`).join("")}</div>
        <a class="box row gap plain" href="#/membre/${o.id}">${avatar(o)}
          <div class="grow"><strong>${esc(o.name)}</strong> ${ownerBadge(o)}<div class="muted small">${ratingLine(o)} · ${esc(o.city)}${kmLabel(dist(o.id)) ? ", " + kmLabel(dist(o.id)) : ""}</div></div>${icon("chevron", 16)}
        </a>
        ${i.description ? `<p class="desc">${esc(i.description)}</p>` : ""}
        <div class="row gap wrap"><button class="linkbtn share-link" data-action="share" data-kind="item" data-id="${id}">${icon("share", 16)} Partager cette pièce</button>
          ${mine ? "" : `<button class="linkbtn report-link" data-action="report" data-kind="item" data-id="${id}">Signaler</button>`}</div>
        ${mine ? `<div class="box note">C'est une pièce de ton dressing. <a href="#/dressing/${id}">La modifier</a></div>` : `
        <section class="stack">
          <h2 class="h3">Durée de location</h2>
          <div class="dur" style="grid-template-columns:repeat(${durs.length},1fr)">${durs.map((d) => `<button data-action="dur" data-id="${id}" data-d="${d.id}" aria-pressed="${b.durationId === d.id}"><span class="small">${d.label}</span><strong>${euro(i.prices[d.id])}</strong><span class="tiny">${euro(Math.round(i.prices[d.id] / d.days * 100) / 100)}/jour</span></button>`).join("")}</div>
          <label class="field"><span>Date de remise</span><input type="date" id="start" min="${addDays(today(), 1)}" value="${b.start}"></label>
          <p id="avail" class="small"></p>
          ${ranges.length ? `<p class="muted small">Indisponible : ${ranges.map((r) => `${fmtShort(r.start)} → ${fmtShort(r.end)}`).join(", ")}</p>` : ""}
        </section>
        <section class="stack">
          <h2 class="h3">Remise</h2>
          <div class="radios">
            ${i.handover !== "envoi" ? `<label class="radio"><input type="radio" name="handover" value="main" ${b.handover === "main" ? "checked" : ""}><span><strong>En main propre · gratuit</strong><span class="muted small">À ${esc(o.city)} (${kmLabel(dist(o.id))}), lieu et heure à convenir par message</span></span></label>` : ""}
            ${i.handover !== "main" ? `<label class="radio"><input type="radio" name="handover" value="envoi" ${b.handover === "envoi" ? "checked" : ""}><span><strong>Envoi en point relais · ${euro(SHIPPING_FEE)} aller-retour</strong><span class="muted small">Un seul colis, étiquette retour incluse. À partir de ${euro(SHIPPING_MIN)} de location.</span></span></label>` : ""}
          </div>
          <div id="extras"></div>
        </section>
        <section class="stack">
          <h2 class="h3">Nettoyage</h2>
          ${i.cleaningRequired ? `<p class="box note small">Pièce délicate : le forfait nettoyage (${euro(i.cleaningFee)}) est obligatoire.</p>` : `
          <div class="radios">
            <label class="radio"><input type="radio" name="clean" value="propre" ${b.cleaning === "propre" ? "checked" : ""}><span><strong>Je la rends propre</strong><span class="muted small">Lavage selon l'étiquette, contrôlé au retour</span></span></label>
            <label class="radio"><input type="radio" name="clean" value="forfait" ${b.cleaning === "forfait" ? "checked" : ""}><span><strong>Forfait nettoyage · ${euro(i.cleaningFee)}</strong><span class="muted small">La loueuse s'en occupe</span></span></label>
          </div>`}
        </section>
        ${credit > 0 ? `<label class="toggle box"><input type="checkbox" id="use-credit" ${b.useCredit ? "checked" : ""}><span>Utiliser mon crédit Aïlo (${euro(credit)})<span class="muted small block">Tes gains de location servent à louer à ton tour.</span></span></label>` : ""}
        <section class="box list" id="recap"></section>
        <p class="muted small">La caution est bloquée puis remboursée après le retour contrôlé.</p>
        `}
      </div>
      ${mine ? "" : `<div class="bottombar"><div><strong id="bb-total" class="big accent"></strong><div id="bb-sub" class="muted small"></div></div>
        <button class="btn" data-action="book" data-id="${id}" id="book-btn">${i.instant ? "Réserver" : "Demander"}</button></div>`}`,
    mount() { if (!mine) { updateBooking(id); taste.add(i, 1); } }
  };
}

// Autres pièces de la même loueuse qu'on peut ajouter au colis
function groupCandidates(i, b) {
  return S.catalog({}).filter((x) => x.ownerId === i.ownerId && x.id !== i.id && x.handover !== "main" && Number(x.prices[b.durationId]) > 0);
}

function updateBooking(id) {
  const i = S.item(id), b = ui.booking[id];
  if (b.handover !== "envoi") b.extras = [];
  const itemIds = [id, ...b.extras];
  const q = S.quote({ itemIds, durationId: b.durationId, cleaning: b.cleaning, handover: b.handover, useCredit: b.useCredit });
  const dur = DURATIONS.find((d) => d.id === b.durationId);
  const avail = document.getElementById("avail");
  let ok = true;
  if (b.start) {
    const end = addDays(b.start, dur.days);
    const tooSoon = b.handover === "envoi" && b.start < addDays(today(), SHIPPING_DAYS + 1);
    const busy = itemIds.filter((x) => !S.isAvailable(x, b.start, end, b.handover));
    ok = !tooSoon && !busy.length;
    avail.innerHTML = tooSoon ? `<span class="err">Pour un envoi, choisis une date au moins ${SHIPPING_DAYS + 1} jours après aujourd'hui.</span>`
      : busy.length ? `<span class="err">Pas disponible à ces dates${busy.length && busy[0] !== id ? ` : ${esc(S.item(busy[0]).title)}` : ""}.</span>`
        : `<span class="ok">${icon("check", 14)} Disponible</span> · retour le ${fmtDate(end)}`;
  } else avail.textContent = "Choisis la date à laquelle tu récupères le vêtement.";

  // Envoi groupé
  const ex = document.getElementById("extras");
  if (b.handover === "envoi") {
    const cands = groupCandidates(i, b);
    ex.innerHTML = `${q.shippingOk ? `<p class="small ok">${icon("check", 14)} Envoi possible : ${euro(q.price)} de location dans le colis.</p>`
      : `<p class="box warnbox small">L'envoi demande au moins ${euro(SHIPPING_MIN)} de location. Il manque ${euro(q.missingForShipping)} : ajoute une autre pièce de ${esc(S.user(i.ownerId).name)} au même colis${i.handover !== "envoi" ? ", ou choisis la remise en main propre" : ""}.</p>`}
      ${cands.length ? `<div class="stack"><p class="small"><strong>Dans le même colis</strong> <span class="muted">(${esc(S.user(i.ownerId).name)})</span></p>${cands.map((c) => `
        <label class="extra"><input type="checkbox" data-extra="${c.id}" ${b.extras.includes(c.id) ? "checked" : ""}><span class="extra-ph">${photo(c)}</span><span class="grow"><strong class="small">${esc(c.title)}</strong><span class="muted small block">T. ${esc(c.size)} · ${esc(c.condition)}</span></span><span class="small">+ ${euro(c.prices[b.durationId])}</span></label>`).join("")}</div>` : ""}`;
  } else ex.innerHTML = "";

  const n = itemIds.length;
  document.getElementById("recap").innerHTML = `
    <div class="li"><span>Location · ${dur.label.toLowerCase()}${n > 1 ? ` · ${n} pièces` : ""}</span><span>${euro(q.price)}</span></div>
    ${q.cleaningFee ? `<div class="li"><span>Nettoyage</span><span>${euro(q.cleaningFee)}</span></div>` : ""}
    <div class="li"><span>${b.handover === "envoi" ? "Envoi aller-retour" : "Remise en main propre"}</span><span>${q.shippingFee ? euro(q.shippingFee) : "gratuit"}</span></div>
    <div class="li"><span>Frais de service <span class="muted small">(protection, paiement sécurisé)</span></span><span>${euro(q.serviceFee)}</span></div>
    ${q.creditUsed ? `<div class="li"><span>Crédit Aïlo</span><span class="accent">− ${euro(q.creditUsed)}</span></div>` : ""}
    <div class="li"><span>Caution <span class="muted small">(remboursée)</span></span><span>${euro(q.deposit)}</span></div>
    <div class="li total"><span>À payer</span><span>${euro(q.total)}</span></div>`;
  document.getElementById("bb-total").textContent = euro(q.total - q.deposit);
  document.getElementById("bb-sub").textContent = `${dur.label}${b.start ? " · " + fmtShort(b.start) + " → " + fmtShort(addDays(b.start, dur.days)) : ""} + caution ${euro(q.deposit)}`;
  const btn = document.getElementById("book-btn");
  btn.disabled = !b.start || !ok || !q.shippingOk;
  btn.textContent = itemIds.every((x) => S.item(x).instant) ? "Réserver" : "Demander";
}

// ---------------------------------------------------------------- Profil d'une loueuse
function membre(id) {
  const u = S.user(id);
  const self = id === S.me().id;
  // Sa propre page : on voit ce que les autres voient (les pièces en ligne), y compris les siennes
  const items = self ? S.myItems().filter((i) => i.status === "online" && S.offeredDurations(i).length) : S.catalog({}).filter((i) => i.ownerId === id);
  const plans = { pro: "Pro", partenaire: "Boutique partenaire" };
  return {
    tab: "decouvrir", title: u.name,
    html: `<div class="page">
      <header class="topbar"><button class="icon-btn" data-action="back" aria-label="Retour">${icon("back", 20)}</button><span class="grow"></span>
        <button class="icon-btn" data-action="share" data-kind="membre" data-id="${id}" aria-label="Partager ce dressing">${icon("share", 20)}</button></header>
      <div class="row gap">${avatar(u, "xl")}
        <div class="grow"><h1 class="h1 inline">${esc(u.name)}</h1>
          <div class="muted small">${icon("pin", 13)} ${esc(u.city)}${kmLabel(dist(id)) ? " · " + kmLabel(dist(id)) : ""}${u.verified ? " · identité vérifiée" : ""}</div>
          <div class="small">${ratingLine(u)}</div></div>
        </div>
      <div class="tags">${ownerBadge(u)}</div>
      ${id !== S.me().id ? `<div class="follow-box box">
        <div class="row gap"><div class="grow"><strong>${S.isFollowing(id) ? `Tu suis ${esc(u.name)}` : `Suivre ${esc(u.name)}`}</strong> ${premiumTag("follow")}
          <span class="small block muted">${S.isFollowing(id) ? "Tu reçois une notification à chaque nouvelle pièce." : "Reçois une notification dès qu'une nouvelle pièce est en ligne."}</span></div>
          <button class="btn sm ${S.isFollowing(id) ? "ghost" : ""}" data-action="follow" data-id="${id}" aria-pressed="${S.isFollowing(id)}">${S.isFollowing(id) ? `${icon("check", 16)} Suivie` : "Suivre"}</button></div>
        ${betaFreeNote()}
        ${S.followersCount(id) ? `<p class="muted small">${S.followersCount(id)} abonnée${S.followersCount(id) > 1 ? "s" : ""}</p>` : ""}
      </div>` : ""}
      ${id !== S.me().id ? `<button class="linkbtn report-link" data-action="report" data-kind="membre" data-id="${id}">Signaler ce profil</button>` : ""}
      ${self ? `<p class="box note small">C'est ta page publique : voici ce que voient les personnes à qui tu partages ton dressing.</p>` : ""}
      <h2 class="h2">${self ? "Ton dressing" : "Son dressing"} <span class="muted small">${items.length} pièce${items.length > 1 ? "s" : ""}</span></h2>
      ${items.length ? grid(items) : self ? empty("Aucune pièce en ligne", "Les pièces en pause ou sans prix n'apparaissent pas ici.", `<a class="btn" href="#/dressing">Mon dressing</a>`) : empty("Rien à louer pour l'instant", "Repasse plus tard.")}
    </div>`
  };
}

// ---------------------------------------------------------------- Dressing
function tierBox() {
  const me = S.me().id, n = S.rentalsDone(me), rate = S.commissionFor(me), next = S.nextTier(me);
  const bar = next ? Math.min(100, Math.round(n / (n + next.missing) * 100)) : 100;
  return `<button class="box tier" data-action="tiers">
    <span class="row gap"><span class="grow"><strong>Ta commission : ${pct(rate)}</strong>${S.isVedette(me) ? ` <span class="badge vedette">${icon("star", 12)} Loueuse vedette</span>` : ""}
      <span class="small block muted">${next ? `Encore ${next.missing} location${next.missing > 1 ? "s" : ""} terminée${next.missing > 1 ? "s" : ""} pour passer à ${pct(next.rate)}${n < VEDETTE_MIN ? " et devenir Loueuse vedette" : ""}.` : "Tu as atteint le meilleur palier. Merci !"}</span></span>${icon("chevron", 16)}</span>
    <span class="bar"><span style="width:${bar}%"></span></span>
  </button>`;
}
function dressing() {
  const items = S.myItems();
  const cats = [...new Set(items.map((i) => i.category))];
  const shown = ui.dressFilter ? items.filter((i) => i.category === ui.dressFilter) : items;
  const lend = S.myLendings();
  const active = lend.filter((r) => ["confirmee", "remise", "rendue"].includes(r.status)).length;
  const pending = lend.filter((r) => r.status === "demandee").length;
  const badge = (i) => {
    if (i.status === "paused") return `<span class="st paused">En pause</span>`;
    const out = lend.some((r) => S.group(r).some((x) => x.itemId === i.id) && ["remise", "rendue"].includes(r.status));
    return out ? `<span class="st out">Louée</span>` : `<span class="st on">En ligne</span>`;
  };
  return {
    tab: "dressing", title: "Mon dressing",
    html: `<div class="page">
      <h1 class="h1">Mon dressing</h1>
      <div class="stats"><div><strong>${items.length}</strong><span>pièces</span></div><div><strong>${active}</strong><span>en location</span></div><div class="accent-bg"><strong>${euro(S.earnings())}</strong><span>gains prévus</span></div></div>
      ${tierBox()}
      ${S.followersCount(S.me().id) ? `<button class="box row gap followers-line" data-action="followers">${icon("heart", 18)}<span class="grow"><strong>${S.followersCount(S.me().id)} personne${S.followersCount(S.me().id) > 1 ? "s suivent" : " suit"} ton dressing</strong><span class="small block muted">${S.followersCount(S.me().id) > 1 ? "Elles sont prévenues" : "Elle est prévenue"} de chaque nouvelle pièce.</span></span>${icon("chevron", 16)}</button>` : ""}
      ${pending ? `<a class="box alert" href="#/locations" data-action="tab-loue">${pending} demande${pending > 1 ? "s" : ""} de location en attente ${icon("chevron", 16)}</a>` : ""}
      <div class="chips">${["", ...cats].map((c) => `<button class="chip ${ui.dressFilter === c ? "on" : ""}" data-action="dress-filter" data-c="${esc(c)}" aria-pressed="${ui.dressFilter === c}">${c || "Tout"}</button>`).join("")}</div>
      <div class="grid3">
        <a class="add-tile" href="#/dressing/nouveau">${icon("plus", 26)}<span>Ajouter</span></a>
        ${shown.map((i) => `<a class="tile" href="#/dressing/${i.id}" aria-label="${esc(i.title)}">${photo(i)}${badge(i)}</a>`).join("")}
      </div>
      ${items.length ? "" : `<p class="muted center">Ajoute ta première pièce : une photo, l'IA remplit le reste.</p>`}
    </div>`
  };
}

// ---------------------------------------------------------------- Formulaire pièce
function itemForm(id) {
  const existing = id ? S.item(id) : null;
  if (id && (!existing || existing.ownerId !== S.me().id)) return { html: empty("Pièce introuvable", "", `<a class="btn" href="#/dressing">Retour</a>`) };
  if (!ui.draft || ui.draft._for !== (id || "new")) {
    ui.draft = existing ? JSON.parse(JSON.stringify(existing)) : {
      photos: [], title: "", description: "", defects: "", brand: "", category: "", style: "", color: "", pattern: "", size: "", condition: "",
      occasions: [], prices: { we: "", sem: "", deux: "", mois: "" }, deposit: "", cleaningFee: 8, cleaningRequired: false,
      handover: "both", instant: false, unavailable: []
    };
    ui.draft._for = id || "new";
    ui.draft.unavailable = ui.draft.unavailable || [];
  }
  const d = ui.draft;
  return {
    noTabbar: true, bottomBar: true, title: existing ? "Modifier" : "Nouvelle pièce",
    html: `<form id="item-form" class="page" novalidate>
      <header class="topbar"><button type="button" class="icon-btn" data-action="cancel-form" aria-label="Retour">${icon("back", 20)}</button><h1 class="h1 inline">${existing ? "Modifier la pièce" : "Nouvelle pièce"}</h1><span></span></header>

      <section class="stack"><h2 class="h3">1. Photos <span class="muted small">(3 à 8, format portrait)</span></h2>
        <div class="photo-strip" id="photo-strip">${photoStrip(d)}</div>
        <details class="tips"><summary>${icon("camera", 16)} Conseils pour des photos qui donnent envie</summary>
          <ul>
            <li><strong>Lumière du jour</strong>, près d'une fenêtre, sans flash.</li>
            <li><strong>Fond neutre et rangé</strong> : mur clair, porte, drap uni.</li>
            <li><strong>Portée ou sur cintre</strong>, bien repassée : la pièce entière en première photo.</li>
            <li><strong>Format portrait</strong>, la pièce centrée, net (essuie l'objectif).</li>
            <li>Puis <strong>les détails</strong> : matière, dos, fermeture, et un éventuel défaut.</li>
            <li>Une photo de <strong>l'étiquette</strong> : l'IA y lit la marque et la taille.</li>
          </ul></details>
        <button type="button" class="btn ghost ai-btn" data-action="ai-fill" ${d.photos.length ? "" : "disabled"}>${icon("sparkle", 18)} Remplir avec l'IA</button>
      </section>

      <section class="stack"><h2 class="h3">2. Description</h2>
        <label class="field"><span>Titre *</span><input name="title" required maxlength="60" placeholder="Ex. Robe longue satinée" value="${esc(d.title)}"></label>
        <label class="field"><span>Description</span><textarea name="description" rows="3" maxlength="500" placeholder="Coupe, matière, nombre de fois portée…">${esc(d.description)}</textarea></label>
        <div class="two">
          <label class="field"><span>Catégorie *</span><select name="category" required>${opts(CATEGORIES, d.category, "Choisir")}</select></label>
          <label class="field"><span>Style *</span><select name="style" required>${opts(STYLES, d.style, "Choisir")}</select></label>
          <label class="field"><span>Taille *</span><select name="size" required>${opts(SIZES, d.size, "Choisir")}</select></label>
          <label class="field"><span>État *</span><select name="condition" required>${opts(CONDITIONS, d.condition, "Choisir")}</select></label>
        </div>
        <p class="muted small" id="cond-hint">${esc(CONDITION_HINTS[d.condition] || "")}</p>
        <label class="field"><span>Défauts éventuels</span><textarea name="defects" rows="2" maxlength="300" placeholder="Ex. petit fil tiré au bas de la jupe. Laisse vide s'il n'y en a pas.">${esc(d.defects || "")}</textarea></label>
        <label class="field"><span>Marque</span><input name="brand" maxlength="40" value="${esc(d.brand)}"></label>
        <fieldset class="field"><legend>Couleur *</legend><div class="swatches">
          ${COLORS.map((c) => `<label class="sw" title="${c.name}"><input type="radio" name="color" value="${c.name}" ${d.color === c.name ? "checked" : ""}><span style="background:${c.hex}"></span><span class="sr">${c.name}</span></label>`).join("")}
        </div><span class="muted small" id="color-name">${esc(d.color)}</span></fieldset>
        <label class="field"><span>Motif ou précision de couleur <span class="muted">(facultatif)</span></span><input name="pattern" maxlength="60" placeholder="Ex. imprimé léopard, rayures, fleurs, pied-de-poule" value="${esc(d.pattern || "")}"></label>
        <fieldset class="field"><legend>Occasions</legend><div class="chips wrap">
          ${OCCASIONS.map((o) => `<label class="chip check"><input type="checkbox" name="occasions" value="${o}" ${d.occasions.includes(o) ? "checked" : ""}><span>${o}</span></label>`).join("")}
        </div></fieldset>
      </section>

      <section class="stack"><h2 class="h3">3. Durées, prix et caution</h2>
        <div class="box suggest"><label class="field"><span>Prix d'achat (pour suggérer les prix)</span><span class="money"><input type="number" id="buy" min="0" step="1" inputmode="numeric" placeholder="Ex. 150"><span aria-hidden="true">€</span></span></label><button type="button" class="btn ghost sm" data-action="suggest">Suggérer</button></div>
        ${d.aiPriceFrom ? `<p class="box warnbox small">${icon("sparkle", 14)} Prix proposés par l'IA à partir d'un prix neuf estimé à ${euro(d.aiPriceFrom)}. <strong>Vérifie-les</strong> et corrige-les si besoin.</p>` : ""}
        <div class="stack tight">
          <strong>Prix de location, en euros</strong>
          <p class="muted small">Indique un prix pour chaque durée que tu proposes. Laisse vide une durée que tu ne veux pas proposer (par exemple pas de location d'un mois).</p>
        </div>
        <div class="price-list">
          ${DURATIONS.map((x) => `<label class="price-row"><span><strong>${x.label}</strong><span class="muted small block">${x.days} jours</span></span>
            <span class="money"><input type="number" name="p-${x.id}" min="1" step="1" inputmode="numeric" value="${d.prices[x.id] ?? ""}" placeholder="—" aria-label="Prix pour ${x.label.toLowerCase()}, en euros"><span aria-hidden="true">€</span></span></label>`).join("")}
        </div>
        <label class="price-row"><span><strong>Caution *</strong><span class="muted small block">Bloquée puis rendue au retour</span></span>
          <span class="money"><input type="number" name="deposit" min="0" step="5" inputmode="numeric" value="${d.deposit}" required aria-label="Caution, en euros"><span aria-hidden="true">€</span></span></label>
        <p class="muted small">Aïlo prélève ${pct(S.commissionFor(S.me().id))} sur le prix de location (moins quand tu loues beaucoup : ${tiersText()}). Le forfait nettoyage, l'envoi et la caution ne sont pas commissionnés.</p>
      </section>

      <section class="stack"><h2 class="h3">4. Remise, nettoyage, réservation</h2>
        <fieldset class="field"><legend>Modes de remise acceptés *</legend>
          <label class="toggle"><input type="checkbox" name="hv" value="main" ${d.handover === "main" || d.handover === "both" ? "checked" : ""}><span>En main propre<span class="muted small block">Gratuit pour la locataire. Lieu et heure à convenir par message.</span></span></label>
          <label class="toggle"><input type="checkbox" name="hv" value="envoi" ${d.handover === "envoi" || d.handover === "both" ? "checked" : ""}><span>Envoi en point relais<span class="muted small block">La locataire paie ${euro(SHIPPING_FEE)} aller-retour, à partir de ${euro(SHIPPING_MIN)} de location (plusieurs de tes pièces peuvent partir dans le même colis). Aïlo te fournit l'étiquette.</span></span></label>
        </fieldset>
        <label class="field"><span>Forfait nettoyage</span><input type="number" name="cleaningFee" min="0" step="1" value="${d.cleaningFee}"></label>
        <label class="toggle"><input type="checkbox" name="cleaningRequired" ${d.cleaningRequired ? "checked" : ""}><span>Forfait obligatoire (pièce délicate, pressing)</span></label>
        <label class="toggle"><input type="checkbox" name="instant" ${d.instant ? "checked" : ""}><span>Réservation instantanée<span class="muted small block">Si le calendrier est libre, la location est confirmée sans attendre ton accord.</span></span></label>
      </section>

      <section class="stack"><h2 class="h3">5. Indisponibilités</h2>
        <p class="muted small">Bloque les périodes où la pièce n'est pas disponible (vacances, tu la portes toi-même…).</p>
        <div id="unav">${unavList(d)}</div>
        <div class="two"><label class="field"><span>Du</span><input type="date" id="un-start" min="${today()}"></label><label class="field"><span>Au</span><input type="date" id="un-end" min="${today()}"></label></div>
        <button type="button" class="btn ghost sm" data-action="add-unav">Bloquer cette période</button>
      </section>

      ${existing ? `<section class="stack danger-zone">
        <button type="button" class="btn ghost" data-action="pause" data-id="${id}">${existing.status === "paused" ? "Remettre en ligne" : "Mettre en pause"}</button>
        <button type="button" class="btn ghost danger" data-action="delete" data-id="${id}">Supprimer la pièce</button>
        <a class="btn ghost" href="#/item/${id}">Voir l'annonce</a></section>` : ""}
      <p id="form-err" class="err small" role="alert"></p>
      <div class="bottombar"><span class="muted small">* obligatoire</span><button class="btn">${existing ? "Enregistrer" : "Publier"}</button></div>
    </form>`,
    mount() {
      const form = document.getElementById("item-form");
      form.addEventListener("input", () => syncDraft(form));
      form.addEventListener("change", (e) => {
        syncDraft(form);
        if (e.target.name === "color") document.getElementById("color-name").textContent = e.target.value;
        if (e.target.name === "condition") document.getElementById("cond-hint").textContent = CONDITION_HINTS[e.target.value] || "";
      });
      form.addEventListener("submit", (e) => { e.preventDefault(); submitItem(form, id); });
    }
  };
}

const unavList = (d) => d.unavailable.length ? `<div class="box list">${d.unavailable.map((u, k) => `<div class="li"><span>${fmtShort(u.start)} → ${fmtShort(u.end)}</span><button type="button" class="linkbtn" data-action="rm-unav" data-k="${k}">Retirer</button></div>`).join("")}</div>` : "";

function photoStrip(d) {
  return d.photos.map((p, k) => `<div class="thumb"><img src="${p}" alt="Photo ${k + 1}"><button type="button" class="thumb-x" data-action="rm-photo" data-k="${k}" aria-label="Retirer la photo ${k + 1}">${icon("close", 14)}</button>${k === 0 ? '<span class="thumb-main">Principale</span>' : ""}</div>`).join("") +
    (d.photos.length < 8 ? `<label class="thumb add">${icon("camera", 24)}<span>Ajouter</span><input type="file" accept="image/*" multiple id="photo-input" class="sr"></label>` : "");
}

function syncDraft(form) {
  const d = ui.draft, fd = new FormData(form);
  for (const k of ["title", "description", "defects", "brand", "category", "style", "size", "condition", "pattern"]) d[k] = fd.get(k) ?? d[k];
  d.color = fd.get("color") || d.color;
  d.occasions = fd.getAll("occasions");
  d.prices = Object.fromEntries(DURATIONS.map((x) => [x.id, num(fd.get("p-" + x.id))]));
  d.deposit = num(fd.get("deposit"));
  d.cleaningFee = num(fd.get("cleaningFee")) || 0;
  d.cleaningRequired = fd.get("cleaningRequired") === "on";
  d.instant = fd.get("instant") === "on";
  const hv = fd.getAll("hv");
  d.handover = hv.length === 2 ? "both" : hv[0] || "";
}
const num = (v) => (v === null || v === "" ? "" : Number(v));

// Vérification automatique avant publication : seulement des vêtements et accessoires, rien de choquant.
// Renvoie null si c'est bon (ou si le service ne répond pas), sinon le message à afficher.
async function moderate(d, existing) {
  const fresh = d.photos.filter((p) => p.startsWith("data:")).slice(0, 4);
  const textChanged = !existing || existing.title !== d.title || existing.description !== d.description;
  if (!fresh.length && !textChanged) return null;
  try {
    const res = await fetch(aiEndpoint().replace(/\/analyse$/, "/moderer"), {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ images: fresh, text: `${d.title}. ${d.category}. ${d.description}` })
    });
    if (!res.ok) return null; // service indisponible : on n'empêche pas de publier (les signalements prennent le relais)
    const m = await res.json();
    if (m.ok !== false) return null;
    if (m.explicit) return "Cette annonce ne peut pas être publiée : une photo ou le texte ne respecte pas les règles d'Aïlo." + (m.reason ? " " + m.reason : "");
    return "Aïlo est réservée aux vêtements, chaussures, sacs et accessoires de mode." + (m.reason ? " " + m.reason : "") + " Si c'est une erreur, change la photo principale pour montrer la pièce entière.";
  } catch (e) { return null; }
}

async function submitItem(form, id) {
  syncDraft(form);
  const d = ui.draft, err = document.getElementById("form-err");
  const missing = [];
  if (!d.title.trim()) missing.push("titre");
  for (const k of ["category", "style", "size", "condition", "color"]) if (!d[k]) missing.push({ category: "catégorie", style: "style", size: "taille", condition: "état", color: "couleur" }[k]);
  const filled = DURATIONS.filter((x) => Number(d.prices[x.id]) > 0);
  if (!filled.length) missing.push("au moins un prix");
  if (d.deposit === "") missing.push("caution");
  if (!d.handover) missing.push("un mode de remise");
  const fail = (m) => { err.textContent = m; err.scrollIntoView({ block: "center" }); };
  if (missing.length) return fail("Il manque : " + missing.join(", ") + ".");
  for (let k = 1; k < filled.length; k++) if (Number(d.prices[filled[k].id]) < Number(d.prices[filled[k - 1].id])) return fail("Le prix total doit augmenter avec la durée.");
  if (d.condition === "Bon état" && !d.defects.trim()) return fail("Pour une pièce en « bon état », décris les signes d'usure dans « Défauts ».");
  if (!d.photos.length) return fail("Ajoute au moins une photo de la pièce.");
  const btn = document.querySelector("[form=item-form], #item-form .bottombar .btn, .bottombar .btn");
  const label = btn ? btn.textContent : "";
  if (btn) { btn.disabled = true; btn.textContent = "Vérification…"; }
  const refused = await moderate(d, id ? S.item(id) : null);
  if (btn) { btn.disabled = false; btn.textContent = label; }
  if (refused) return fail(refused);
  if (ui.draft !== d) return; // formulaire quitté pendant la vérification
  const data = Object.assign({}, d);
  delete data._for;
  delete data.aiPriceFrom;
  const newId = S.saveItem(data);
  ui.draft = null;
  toast(id ? "Enregistrement…" : "Publication en cours…");
  go(`#/item/${newId}`);
}

// ---------------------------------------------------------------- Locations
function locations() {
  const list = ui.locTab === "prends" ? S.myRentals() : S.myLendings();
  const pend = S.myLendings().filter((r) => r.status === "demandee").length;
  return {
    tab: "locations", title: "Mes locations",
    html: `<div class="page">
      <h1 class="h1">Mes locations</h1>
      <div class="seg" role="group" aria-label="Type de locations">
        <button data-action="loc-tab" data-k="prends" aria-pressed="${ui.locTab === "prends"}">Je prends</button>
        <button data-action="loc-tab" data-k="loue" aria-pressed="${ui.locTab === "loue"}">Je loue${pend ? ` <span class="count-badge inline">${pend}</span>` : ""}</button>
      </div>
      ${list.length ? `<div class="stack">${list.map(locCard).join("")}</div>` :
        ui.locTab === "prends" ? empty("Aucune location pour l'instant", "Trouve la tenue de ton prochain événement.", `<a class="btn" href="#/">Découvrir</a>`) :
          empty("Personne n'a encore loué tes pièces", "Plus tu publies de pièces avec de belles photos, plus tu loues.", `<a class="btn" href="#/dressing/nouveau">Ajouter une pièce</a>`)}
    </div>`
  };
}

const gone = { title: "Pièce supprimée", tint: "#EEE", photos: [] };
function locCard(r) {
  const g = S.group(r);
  const i = S.item(r.itemId) || gone;
  const other = S.user(ui.locTab === "prends" ? r.ownerId : r.renterId);
  return `<a class="box loc" href="#/location/${r.id}">
    <div class="loc-ph">${photo(i)}</div>
    <div class="grow"><strong>${esc(i.title)}</strong>${g.length > 1 ? ` <span class="badge">+${g.length - 1}</span>` : ""}
      <div class="muted small">${ui.locTab === "prends" ? "Chez" : "Louée par"} ${esc(other.name)}${r.handover === "envoi" ? " · envoi" : ""}</div>
      <div class="small">${fmtShort(r.start)} → ${fmtShort(r.end)}</div></div>
    ${statusPill(r.status)}</a>`;
}

function locationDetail(id) {
  const r = S.reservation(id);
  if (!r) return { html: empty("Location introuvable", "", `<a class="btn" href="#/locations">Retour</a>`) };
  markSeen(r);
  const g = S.group(r);
  const amRenter = r.renterId === S.me().id;
  const other = S.user(amRenter ? r.ownerId : r.renterId);
  const steps = S.PAYMENT_STEP ? ["demandee", "acceptee", "confirmee", "remise", "rendue", "terminee"] : ["demandee", "confirmee", "remise", "rendue", "terminee"];
  const cur = steps.indexOf(r.status === "litige" ? "rendue" : r.status);
  const myRole = amRenter ? "renter" : "owner";
  const acts = S.TRANSITIONS[r.status] || [];
  const mine = acts.filter((a) => a.by === "both" || a.by === myRole);
  const theirs = acts.filter((a) => a.by !== "both" && a.by !== myRole);
  const sum = (k) => g.reduce((s, x) => s + Number(x[k] || 0), 0);
  const price = sum("price"), cleaning = sum("cleaningFee"), deposit = sum("deposit");
  const ship = r.shippingFee || 0, service = r.serviceFee || 0, creditUsed = r.creditUsed || 0;
  const paid = price + cleaning + ship + service - creditUsed + deposit;
  return {
    tab: "locations", title: "Location",
    html: `<div class="page">
      <header class="topbar"><a class="icon-btn" href="#/locations" aria-label="Retour">${icon("back", 20)}</a><h1 class="h1 inline">${amRenter ? "Ma location" : "Location de mes pièces"}</h1><span></span></header>
      <div class="stack">${g.map((x) => { const i = S.item(x.itemId) || gone; return `<a class="box loc" href="#/item/${x.itemId}"><div class="loc-ph">${photo(i)}</div>
        <div class="grow"><strong>${esc(i.title)}</strong><div class="muted small">${amRenter ? "Chez" : "Louée par"} ${esc(other.name)} · ${esc(other.city)}</div></div>${x === r ? statusPill(r.status) : ""}</a>`; }).join("")}</div>
      ${g.length > 1 ? `<p class="muted small">${g.length} pièces dans le même colis.</p>` : ""}
      ${["refusee", "annulee"].includes(r.status) ? "" : `<ol class="steps ${steps.length === 6 ? "six" : ""}">${steps.map((s, k) => `<li class="${k < cur ? "done" : k === cur ? "cur" : ""}">${STATUS[s].label}</li>`).join("")}</ol>`}
      <div class="two"><div class="box mini"><span class="muted small">Remise</span><strong>${fmtDate(r.start)}</strong></div><div class="box mini"><span class="muted small">Retour</span><strong>${fmtDate(r.end)}</strong></div></div>
      <div class="box stack">${calendar(r.start, [{ start: r.start, end: r.end }])}${r.end.slice(0, 7) !== r.start.slice(0, 7) ? calendar(r.end, [{ start: r.start, end: r.end }]) : ""}</div>
      <section class="box list">
        <div class="li"><span>Location${g.length > 1 ? ` · ${g.length} pièces` : ""}</span><span>${euro(price)}</span></div>
        <div class="li"><span>Nettoyage</span><span>${cleaning ? euro(cleaning) : "Rendue propre"}</span></div>
        <div class="li"><span>${r.handover === "envoi" ? "Envoi aller-retour" : "Remise en main propre"}</span><span>${ship ? euro(ship) : "gratuit"}</span></div>
        ${amRenter ? `<div class="li"><span>Frais de service</span><span>${euro(service)}</span></div>
          ${creditUsed ? `<div class="li"><span>Crédit Aïlo</span><span class="accent">− ${euro(creditUsed)}</span></div>` : ""}
          <div class="li"><span>Caution</span><span>${euro(deposit)}</span></div>
          <div class="li total"><span>Total payé</span><span>${euro(paid)}</span></div>` :
          `<div class="li"><span class="muted">Commission Aïlo (${pct(S.rateOf(r))})</span><span class="muted">− ${euro(price * S.rateOf(r))}</span></div>
          <div class="li total"><span>Tu recevras</span><span>${euro(S.groupPayout(r))}</span></div>`}
      </section>
      ${r.status === "acceptee" && amRenter ? `<div class="box paybox"><p class="h3">Demande acceptée !</p><p class="small">Règle la location pour la confirmer. La caution est bloquée puis remboursée après le retour.</p></div>` : ""}
      ${!S.PAYMENT_STEP && r.status === "confirmee" ? `<div class="box paybox"><p class="h3">${amRenter ? "Demande acceptée !" : "Location confirmée"}</p><p class="small">${amRenter ? `Montant à régler : <strong>${euro(paid)}</strong>, dont ${euro(deposit)} de caution rendue au retour.` : `Tu recevras ${euro(S.groupPayout(r))}.`} Le paiement en ligne arrive très bientôt ; pendant la bêta, réglez directement entre vous (virement, Payconiq ou espèces à la remise). Fixez le lieu et l'heure de remise par message.</p></div>` : ""}
      ${mine.length ? `<div class="stack">${mine.map((a) => a.pay
        ? `<button class="btn" data-action="pay" data-id="${r.id}">Payer ${euro(paid)}</button>`
        : `<button class="btn ${a.ghost ? "ghost" : ""}" data-action="transition" data-id="${r.id}" data-to="${a.to}">${a.label}</button>`).join("")}</div>` : ""}
      ${theirs.length ? `<p class="muted small center">En attente de ${esc(other.name)} : ${theirs.map((a) => a.label.toLowerCase()).join(" ou ")}.</p>` : ""}
      ${r.handover === "envoi" ? `<p class="box note small">${amRenter ? `Envoi en point relais : le colis part ${SHIPPING_DAYS} jours avant la remise. Pour le retour, l'étiquette est incluse.` : `Envoi en point relais : dépose le colis ${SHIPPING_DAYS} jours avant le ${fmtShort(r.start)}. L'étiquette est fournie par Aïlo.`}</p>` : ""}
      <a class="btn ghost" href="#/messages/${r.thread}">${icon("chat", 18)} Écrire à ${esc(other.name.split(" ")[0])}</a>
      ${r.status === "terminee" && amRenter && !r.review ? reviewForm() : ""}
      ${r.review ? `<div class="box"><p class="small muted">Avis</p><p>${"★".repeat(r.review.rating)}${"☆".repeat(5 - r.review.rating)}</p><p>${esc(r.review.text)}</p></div>` : ""}
    </div>
    <dialog id="sheet" class="sheet"></dialog>`,
    mount() {
      const f = document.getElementById("review-form");
      if (f) f.addEventListener("submit", (e) => {
        e.preventDefault();
        const fd = new FormData(f);
        if (!fd.get("rating")) { toast("Choisis une note"); return; }
        S.review(r.id, Number(fd.get("rating")), fd.get("text") || "");
        toast("Merci pour ton avis !");
        route(true);
      });
    }
  };
}

function reviewForm() {
  return `<form id="review-form" class="box stack"><h2 class="h3">Ton avis</h2>
    <fieldset class="stars"><legend class="sr">Note</legend>${[5, 4, 3, 2, 1].map((n) => `<input type="radio" id="st${n}" name="rating" value="${n}"><label for="st${n}" aria-label="${n} sur 5">★</label>`).join("")}</fieldset>
    <label class="field"><span>Commentaire</span><textarea name="text" rows="2" maxlength="300" placeholder="Propreté, conformité, remise…"></textarea></label>
    <button class="btn">Publier l'avis</button></form>`;
}

// ---------------------------------------------------------------- Messages
function messagesList() {
  const convs = S.conversations();
  return {
    tab: "messages", title: "Messages",
    html: `<div class="page"><h1 class="h1">Messages</h1>
      ${convs.length ? `<div class="box list">${convs.map(({ r, last }) => {
        const other = S.user(r.renterId === S.me().id ? r.ownerId : r.renterId);
        const i = S.item(r.itemId) || gone;
        const unread = S.isUnread(r.id);
        return `<a class="conv ${unread ? "unread" : ""}" href="#/messages/${r.id}">${avatar(other)}
          <span class="grow"><strong>${esc(other.name)}</strong>${unread ? ' <span class="new-dot" aria-label="non lu"></span>' : ""} <span class="muted small">· ${esc(i.title)}</span>
          <span class="muted small ellipsis block">${last.from === "system" ? "" : last.from === S.me().id ? "Toi : " : ""}${esc(last.text)}</span></span>${icon("chevron", 16)}</a>`;
      }).join("")}</div>` : empty("Pas encore de messages", "Une conversation s'ouvre avec chaque réservation.")}
    </div>`
  };
}

function thread(rid) {
  const r = S.reservation(rid);
  if (!r) return { html: empty("Conversation introuvable", "", `<a class="btn" href="#/messages">Retour</a>`) };
  const other = S.user(r.renterId === S.me().id ? r.ownerId : r.renterId);
  const i = S.item(r.itemId) || gone;
  const msgs = S.messages(rid);
  markSeen(r);
  const amOwner = r.ownerId === S.me().id;
  const next = { demandee: amOwner ? "Accepte ou refuse la demande" : "En attente de la réponse de la loueuse", acceptee: amOwner ? "En attente du paiement" : "Il reste à payer", confirmee: "Fixez ensemble le lieu et l'heure de remise", remise: "Location en cours", rendue: amOwner ? "Vérifie l'état et rends la caution" : "La loueuse vérifie l'état", terminee: "Location terminée", refusee: "Demande refusée", annulee: "Réservation annulée", litige: "Problème signalé" }[r.status] || "";
  return {
    tab: "messages", title: other.name,
    html: `<div class="thread">
      <header class="thread-head"><a class="icon-btn" href="#/messages" aria-label="Retour">${icon("back", 20)}</a>${avatar(other)}
        <a class="grow plain" href="#/location/${r.id}"><strong>${esc(other.name)}</strong><span class="muted small block">${esc(i.title)} · ${fmtShort(r.start)} → ${fmtShort(r.end)}</span></a></header>
      <a class="thread-resa" href="#/location/${r.id}">${photo(i)}<span class="grow">${statusPill(r.status)}<span class="small block">${esc(next)}</span></span><strong class="small">Voir la réservation ${icon("chevron", 14)}</strong></a>
      <div class="bubbles" id="bubbles">${msgs.map((m) => m.from === "system" ? `<p class="sys">${esc(m.text)}</p>` : `<p class="bubble ${m.from === S.me().id ? "me" : ""}">${esc(m.text)}</p>`).join("")}
        ${r.status === "confirmee" ? `<p class="tip">${icon("camera", 16)} À la remise, faites ensemble l'état des lieux photo : il protège la caution.</p>` : ""}</div>
      <form class="composer" id="composer"><label class="grow"><span class="sr">Écrire un message</span><input name="t" placeholder="Écrire un message…" autocomplete="off" maxlength="1000"></label>
        <button class="icon-btn solid" aria-label="Envoyer">${icon("send", 20)}</button></form>
    </div>`,
    mount() {
      S.markRead(rid);
      setTab("messages");
      window.scrollTo(0, document.body.scrollHeight);
      document.getElementById("composer").addEventListener("submit", (e) => {
        e.preventDefault();
        const t = e.target.t.value.trim();
        if (!t) return;
        S.sendMessage(rid, t);
        route(true);
        window.scrollTo(0, document.body.scrollHeight);
      });
    }
  };
}

// ---------------------------------------------------------------- Profil
// Rappel tant que les notifications d'Aïlo ne sont pas branchées sur ce téléphone
async function notifNudge() {
  if (S.isGuest() || document.getElementById("notif-nudge")) return;
  const st = await S.pushStatus();
  if (st !== "off" || !location.hash.match(/^#?\/?$/)) return;
  const page = view.querySelector(".page");
  if (!page) return;
  page.insertAdjacentHTML("afterbegin", `<div class="notif-nudge" id="notif-nudge">${icon("bell", 18)}<span class="grow small"><strong>Active les notifications</strong> pour être prévenue des demandes, réservations et messages.</span><button class="btn sm" data-action="notif-on">Activer</button></div>`);
}
async function refreshNotifState() {
  const el = document.getElementById("notif-state");
  if (!el) return;
  const st = await S.pushStatus();
  el.textContent = { on: "Activées sur ce téléphone", off: "À activer", denied: "Bloquées", unsupported: isIOS() ? "Installer l'app d'abord" : "Non disponibles" }[st] || "";
  el.classList.toggle("warn-text", st !== "on");
}
function profil() {
  const u = S.me();
  const received = S.receivedReviews();
  const plans = { base: "Base", premium: "Premium", pro: "Pro", partenaire: "Partenaire" };
  return {
    tab: "profil", title: "Mon profil",
    html: `<div class="page">
      <div class="row gap">${avatar(u, "xl")}
        <div class="grow"><h1 class="h1 inline">${esc(u.name)}</h1><div class="muted small">${icon("pin", 13)} ${esc(u.city)}${u.verified ? " · identité vérifiée" : ""}</div></div>
        <span class="pill tone-ok solid">${plans[u.plan]}</span></div>
      <div class="two"><div class="box mini"><span class="muted small">Crédit Aïlo</span><strong class="accent">${euro(S.credit())}</strong></div><div class="box mini"><span class="muted small">Gains prévus</span><strong>${euro(S.earnings())}</strong></div></div>
      <div class="box center rating">
        ${u.reviews ? `<div class="score">${fmtRating(u.rating)}</div><div class="accent" aria-label="Note de ${fmtRating(u.rating)} sur 5">${"★".repeat(Math.round(u.rating))}${"☆".repeat(5 - Math.round(u.rating))}</div>
        <div class="muted small">${u.reviews} avis</div>` : `<div class="muted">Pas encore d'avis</div><div class="muted small">Ils apparaîtront après tes premières locations.</div>`}
      </div>
      ${received.map((r) => `<div class="box"><div class="row between small"><strong>${esc(S.user(r.renterId).name)}</strong><span class="muted">${"★".repeat(r.review.rating)}</span></div><p>${esc(r.review.text)}</p></div>`).join("")}
      <nav class="box list menu" aria-label="Mon compte">
        <a href="#/profil/modifier"><span>Modifier mon profil</span><span class="muted">${icon("chevron", 16)}</span></a>
        ${isStandalone() ? "" : `<button data-action="install"><span>Installer l'application</span><span class="muted">${icon("chevron", 16)}</span></button>`}
        <button data-action="followers"><span>Mes abonnées</span><span class="muted">${S.followersCount(S.me().id)} ${icon("chevron", 16)}</span></button>
        <button data-action="followed"><span>Profils suivis ${premiumTag()}</span><span class="muted">${S.following().length} ${icon("chevron", 16)}</span></button>
        <button data-action="share" data-kind="membre" data-id="${S.me().id}"><span>Partager mon dressing</span><span class="muted">${icon("chevron", 16)}</span></button>
        <button data-action="notif-on"><span>Notifications</span><span class="muted"><span id="notif-state">…</span> ${icon("chevron", 16)}</span></button>
        <a href="#/favoris"><span>Mes favoris</span><span class="muted">${S.favorites().length} ${icon("chevron", 16)}</span></a>
        <button data-action="earnings"><span>Mes gains et mon crédit</span><span class="muted">${icon("chevron", 16)}</span></button>
        <button data-action="plans"><span>Mon abonnement</span><span class="muted">${plans[u.plan]} ${icon("chevron", 16)}</span></button>
        <a href="#/cgu"><span>Conditions générales</span><span class="muted">${icon("chevron", 16)}</span></a>
        <button data-action="logout"><span>Se déconnecter</span><span class="muted">${icon("chevron", 16)}</span></button>
      </nav>
      <p class="muted small center">Aïlo v0.10 · ${esc(S.myEmail())} · version bêta. Localisation : bpost, © contributeurs OpenStreetMap.</p>
    </div>
    <dialog id="sheet" class="sheet"></dialog>`,
    mount() { refreshNotifState(); }
  };
}

function editProfile() {
  const u = S.me();
  ui.place = { zip: u.zip, city: u.city, lat: u.lat, lng: u.lng };
  return {
    tab: "profil", title: "Modifier mon profil",
    html: `<form id="pf" class="page" novalidate>
      <header class="topbar"><a class="icon-btn" href="#/profil" aria-label="Retour">${icon("back", 20)}</a><h1 class="h1 inline">Mon profil</h1><span></span></header>
      <div class="row gap"><span id="pf-av">${avatar(u, "xl")}</span>
        <label class="btn ghost sm">${icon("camera", 18)} Changer la photo<input type="file" accept="image/*" id="pf-photo" class="sr"></label></div>
      <label class="field"><span>Prénom et initiale</span><input name="name" value="${esc(u.name)}" maxlength="30" required></label>
      ${placePicker(ui.place)}
      <p id="pf-err" class="err small" role="alert"></p>
      <button class="btn">Enregistrer</button>
    </form>`,
    mount() {
      mountPlacePicker();
      let newPhoto = null;
      document.getElementById("pf-photo").addEventListener("change", async (e) => {
        const f = e.target.files[0]; if (!f) return;
        newPhoto = await resizeImage(f, 400);
        document.getElementById("pf-av").innerHTML = `<img class="avatar xl" src="${newPhoto}" alt="">`;
      });
      document.getElementById("pf").addEventListener("submit", (e) => {
        e.preventDefault();
        const name = e.target.name.value.trim();
        if (!name) return (document.getElementById("pf-err").textContent = "Indique ton prénom.");
        if (!ui.place) return (document.getElementById("pf-err").textContent = "Choisis ta commune dans la liste.");
        S.updateMe(Object.assign({ name }, ui.place, newPhoto ? { photo: newPhoto } : {}));
        ui.place = null;
        toast("Profil enregistré");
        go("#/profil");
      });
    }
  };
}

function openSheet(html) {
  let s = document.getElementById("sheet");
  if (!s) { s = document.createElement("dialog"); s.id = "sheet"; s.className = "sheet"; document.body.appendChild(s); }
  s.innerHTML = `<form method="dialog">${html}<div class="sheet-actions"><button class="btn">Fermer</button></div></form>`;
  if (!s.open) s.showModal();
}

// ---------------------------------------------------------------- Actions (délégation)
const actions = {
  back: () => back("#/"),
  fav(el) { if (S.isGuest()) return needAccount("Crée ton compte pour garder tes coups de cœur."); S.toggleFav(el.dataset.id); if (S.isFav(el.dataset.id)) taste.add(S.item(el.dataset.id), 2); route(true); },
  group(el) { ui.groupBy = el.dataset.k; route(true); },
  view(el) { ui.view = el.dataset.v; try { localStorage.setItem("ailo-view", ui.view); } catch (e) { /* ignore */ } route(true); },
  occasion(el) { const o = el.dataset.o; ui.filters.occasion = o && ui.filters.occasion !== o ? o : ""; route(true); },
  "open-filters"() {
    const dlg = document.getElementById("filters");
    const form = document.getElementById("filters-form");
    form.maxPrice.addEventListener("input", () => { document.getElementById("pv").textContent = form.maxPrice.value >= 50 ? "sans limite" : euro(form.maxPrice.value); });
    form.radius.addEventListener("input", () => { document.getElementById("rv").textContent = form.radius.value >= 100 ? "partout" : form.radius.value + " km"; });
    dlg.addEventListener("close", () => {
      if (dlg.returnValue !== "apply") return;
      const fd = new FormData(form);
      for (const k of ["category", "style", "color", "size", "brand", "condition", "handover", "date", "sort"]) ui.filters[k] = fd.get(k) || "";
      ui.filters.maxPrice = Number(fd.get("maxPrice")) >= 50 ? "" : fd.get("maxPrice");
      ui.filters.radius = Number(fd.get("radius")) >= 100 ? 100 : Number(fd.get("radius"));
      ui.filters.includeShipping = fd.get("includeShipping") === "on";
      route(true);
    }, { once: true });
    dlg.showModal();
  },
  "clear-filters"() {
    ui.filters = freshFilters();
    const dlg = document.getElementById("filters");
    if (dlg && dlg.open) dlg.close("cancel");
    route(true);
  },
  dur(el) {
    const b = ui.booking[el.dataset.id];
    b.durationId = el.dataset.d;
    b.extras = b.extras.filter((x) => Number(S.item(x).prices[b.durationId]) > 0);
    view.querySelectorAll("[data-action=dur]").forEach((x) => x.setAttribute("aria-pressed", x === el));
    updateBooking(el.dataset.id);
  },
  book(el) {
    if (S.isGuest()) return needAccount("Crée ton compte (gratuit) pour réserver cette pièce. Tu reviendras ensuite directement ici.");
    const id = el.dataset.id, b = ui.booking[id];
    const res = S.book({ itemIds: [id, ...b.extras], durationId: b.durationId, start: b.start, cleaning: b.cleaning, handover: b.handover, useCredit: b.useCredit });
    if (res.error) { toast(res.error); return; }
    delete ui.booking[id];
    ui.locTab = "prends";
    toast(res.reservation.status === "confirmee" ? "Réservation confirmée !" : "Demande envoyée à la loueuse");
    go(`#/location/${res.reservation.id}`);
  },
  "dress-filter"(el) { ui.dressFilter = el.dataset.c; route(true); },
  "tab-loue"() { ui.locTab = "loue"; },
  "loc-tab"(el) { ui.locTab = el.dataset.k; route(true); },
  "rm-photo"(el) { ui.draft.photos.splice(Number(el.dataset.k), 1); refreshPhotos(); },
  "add-unav"() {
    const s = document.getElementById("un-start").value, e = document.getElementById("un-end").value;
    if (!s || !e || e < s) { toast("Choisis une date de début et une date de fin."); return; }
    ui.draft.unavailable.push({ start: s, end: e });
    ui.draft.unavailable.sort((a, b) => a.start.localeCompare(b.start));
    document.getElementById("unav").innerHTML = unavList(ui.draft);
  },
  "rm-unav"(el) { ui.draft.unavailable.splice(Number(el.dataset.k), 1); document.getElementById("unav").innerHTML = unavList(ui.draft); },
  async "ai-fill"(el) {
    const url = aiEndpoint();
    if (!url) { toast("L'assistant IA sera disponible dès que son serveur sera en ligne."); return; }
    syncDraft(document.getElementById("item-form"));
    const label = el.innerHTML;
    el.disabled = true; el.textContent = "Analyse des photos…";
    try {
      const res = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ images: ui.draft.photos.slice(0, 3) }) });
      if (!res.ok) throw new Error("HTTP " + res.status);
      const a = await res.json();
      const n = applyAI(a);
      route(true);
      if (a.estimatedValue && !DURATIONS.some((x) => Number(ui.draft.prices[x.id]) > 0)) {
        document.getElementById("buy").value = Math.round(a.estimatedValue);
        actions.suggest(null, true);
        ui.draft.aiPriceFrom = Math.round(a.estimatedValue);
        route(true);
      }
      toast(n ? "Fiche pré-remplie : vérifie et corrige avant de publier." : "L'IA n'a rien trouvé de sûr : remplis à la main.");
    } catch (e) {
      toast("L'analyse n'a pas fonctionné. Remplis les champs à la main.");
      el.disabled = false; el.innerHTML = label;
    }
  },
  suggest(el, quiet) {
    const buy = Number(document.getElementById("buy").value);
    if (!buy) { toast("Indique le prix d'achat"); return; }
    const f = document.getElementById("item-form");
    const r = (n) => Math.max(5, Math.round(n));
    f["p-we"].value = r(buy * 0.13); f["p-sem"].value = r(buy * 0.2); f["p-deux"].value = r(buy * 0.3); f["p-mois"].value = r(buy * 0.45);
    f.deposit.value = Math.round(buy * 0.5 / 5) * 5;
    syncDraft(f);
    if (!quiet) toast("Prix suggérés : ajuste-les, et vide les durées que tu ne veux pas proposer.");
  },
  "cancel-form"() { ui.draft = null; back("#/dressing"); },
  pause(el) { const i = S.item(el.dataset.id); S.setItemStatus(i.id, i.status === "paused" ? "online" : "paused"); ui.draft = null; toast(i.status === "paused" ? "Pièce en pause : elle n'apparaît plus" : "Pièce remise en ligne"); go("#/dressing"); },
  delete(el) {
    const active = S.myLendings().some((r) => S.group(r).some((x) => x.itemId === el.dataset.id) && ["demandee", "confirmee", "remise", "rendue"].includes(r.status));
    if (active) { toast("Impossible : une location est en cours sur cette pièce."); return; }
    if (!confirm("Supprimer définitivement cette pièce ?")) return;
    S.deleteItem(el.dataset.id); ui.draft = null; toast("Pièce supprimée"); go("#/dressing");
  },
  transition(el) { S.transition(el.dataset.id, el.dataset.to); toast(STATUS[el.dataset.to].label); route(true); },
  "pick-place"(el) { setPlace(el.dataset); },
  async "geo-me"(el) {
    const label = el.innerHTML;
    el.disabled = true; el.textContent = "Localisation…";
    try {
      const pos = await currentPosition();
      setPlace(await nearestPlace(pos.lat, pos.lng));
      toast(`Commune trouvée : ${ui.place.city}`);
    } catch (e) {
      toast("Position indisponible : tape ton code postal.");
    }
    el.disabled = false; el.innerHTML = label;
  },
  earnings() {
    const list = S.myLendings().filter((r) => ["confirmee", "remise", "rendue", "terminee"].includes(r.status));
    openSheet(`<h2 class="h2">Mes gains et mon crédit</h2><p class="muted small">Montants nets, après la commission (${pct(S.commissionFor(S.me().id))} actuellement). Une location terminée devient du crédit : tu peux l'utiliser pour louer à ton tour, ou le virer sur ton compte.</p>
      <div class="box list">${list.map((r) => `<div class="li"><span>${esc((S.item(r.itemId) || gone).title)} <span class="muted small">${fmtShort(r.start)} · ${STATUS[r.status].label.toLowerCase()}</span></span><span>${euro(S.groupPayout(r))}</span></div>`).join("") || '<p class="muted">Aucune location pour l\'instant.</p>'}
      <div class="li total"><span>Crédit disponible</span><span>${euro(S.credit())}</span></div></div>`);
  },
  plans() {
    openSheet(`<h2 class="h2">Abonnements</h2><p class="muted small">Contenu à définir — proposition.</p>
      <div class="plans">
        <div class="box"><strong>Base · gratuit</strong><p class="small">Publier et louer. Commission dégressive : ${tiersText()}.</p></div>
        <div class="box accent-border"><strong>Premium</strong> ${premiumTag("premium")}<p class="small">Suivre des profils et être prévenue de leurs nouvelles pièces, statistiques de ce qui se loue, annonces en haut de page.</p>${betaFreeNote()}</div>
        <div class="box"><strong>Pro</strong><p class="small">Pour les professionnelles : badge Pro, annonces illimitées, page vitrine.</p></div>
      </div>`);
  },
  async logout() { await S.signOut(); ui.draft = null; ui.booking = {}; ui.filters = freshFilters(); ui.place = null; go("#/"); route(); },
  "auth-mode"(el) { ui.authMode = el.dataset.m; route(true); },
  async pay(el) {
    const id = el.dataset.id;
    openSheet(`<h2 class="h2">Paiement</h2><p class="small">Ouverture de la page de paiement sécurisée…</p>`);
    const res = await S.startPayment(id);
    if (res.url) { location.href = res.url; return; }
    const sheet = document.getElementById("sheet");
    if (!sheet.open) return;
    openSheet(res.notReady ? `<h2 class="h2">Paiement</h2>
      <p class="small">Le paiement en ligne sécurisé (carte, Bancontact) arrive très bientôt.</p>
      <p class="box note small"><strong>Pendant la bêta</strong> : réglez la location directement entre vous (virement, Payconiq ou espèces à la remise), puis confirme ici.</p>
      <button type="button" class="btn" data-action="beta-paid" data-id="${id}">J'ai réglé la location</button>`
      : `<h2 class="h2">Paiement</h2><p class="small">${esc(res.error)}</p>`);
  },
  "beta-paid"(el) {
    document.getElementById("sheet").close();
    S.transition(el.dataset.id, "confirmee");
    toast("Location confirmée");
    route(true);
  },
  async install() {
    if (deferredInstall) {
      const e = deferredInstall; deferredInstall = null;
      e.prompt();
      try { await e.userChoice; } catch (err) { /* ignore */ }
      route(true);
      return;
    }
    openSheet(installHelp());
  },
  "install-later"() { try { localStorage.setItem("ailo-install-dismissed", "1"); } catch (e) { /* ignore */ } route(true); },
  "welcome-notif"() { document.getElementById("sheet").close(); actions["notif-on"](); },
  "welcome-install"() { document.getElementById("sheet").close(); actions.install(); },
  async share(el) {
    const id = el.dataset.id, base = location.origin + location.pathname;
    const isItem = el.dataset.kind === "item";
    const it = isItem ? S.item(id) : null, u = isItem ? null : S.user(id);
    const url = base + (isItem ? "#/item/" : "#/membre/") + id;
    const title = isItem ? `${it.title} à louer sur Aïlo` : (id === S.me().id ? "Mon dressing sur Aïlo" : `Le dressing de ${u.name} sur Aïlo`);
    const text = isItem ? `${it.title}, taille ${it.size}, à louer dès ${euro(S.minPrice(it))} sur Aïlo.` : "Des tenues à louer pour tes événements, entre particuliers.";
    if (navigator.share) { try { await navigator.share({ title, text, url }); } catch (e) { /* partage annulé */ } return; }
    try { await navigator.clipboard.writeText(url); toast("Lien copié : colle-le dans un message ou une story."); }
    catch (e) { openSheet(`<h2 class="h2">Partager</h2><p class="small">Copie ce lien :</p><input class="field-input" readonly value="${esc(url)}" onclick="this.select()">`); }
  },
  follow(el) {
    if (S.isGuest()) return needAccount("Crée ton compte pour suivre cette loueuse.");
    const id = el.dataset.id;
    if (!BETA_FREE_PREMIUM && !S.isPremium() && !S.isFollowing(id)) return actions["premium-info"]({ dataset: { k: "follow" } });
    const on = S.toggleFollow(id);
    toast(on ? `Tu suis ${S.user(id).name} : tu seras prévenue de ses nouvelles pièces.` : `Tu ne suis plus ${S.user(id).name}.`);
    if (on && "Notification" in window && Notification.permission === "default") setTimeout(() => actions["notif-on"](), 600);
    route(true);
  },
  followed() {
    const ids = S.following();
    openSheet(`<h2 class="h2">Profils suivis ${premiumTag("follow")}</h2>${betaFreeNote()}
      ${ids.length ? `<div class="box list">${ids.map((id) => { const u = S.user(id); return `<a class="li plain" href="#/membre/${id}" onclick="document.getElementById('sheet').close()"><span class="row gap">${avatar(u, "sm")} ${esc(u.name)}</span><span class="muted small">${esc(u.city)}</span></a>`; }).join("")}</div>`
        : `<p class="muted small">Tu ne suis encore personne. Sur la page d'une loueuse, touche « Suivre » pour être prévenue de ses nouvelles pièces.</p>`}`);
  },
  followers() {
    const ids = S.followers(S.me().id);
    openSheet(`<h2 class="h2">Mes abonnées</h2>
      ${ids.length ? `<p class="small">Ces personnes suivent ton dressing : elles reçoivent une notification à chaque nouvelle pièce que tu publies.</p>
        <div class="box list">${ids.map((id) => { const u = S.user(id); return `<a class="li plain" href="#/membre/${id}" onclick="document.getElementById('sheet').close()"><span class="row gap">${avatar(u, "sm")} ${esc(u.name)}</span><span class="muted small">${esc(u.city)}</span></a>`; }).join("")}</div>`
        : `<p class="muted small">Personne ne suit encore ton dressing. Partage-le (Profil → Partager mon dressing) et publie régulièrement : chaque nouvelle pièce prévient tes abonnées.</p>`}`);
  },
  "premium-info"(el) {
    const p = PREMIUM_INFO[el.dataset.k] || PREMIUM_INFO.premium;
    openSheet(`<h2 class="h2">${icon("crown", 20)} ${esc(p.title)}</h2>
      <ul class="premium-points">${p.points.map((x) => `<li>${icon("check", 16)} <span>${esc(x)}</span></li>`).join("")}</ul>
      ${S.isPremium() ? `<p class="box note small">${icon("check", 14)} Tu as déjà accès à cette option.</p>` : BETA_FREE_PREMIUM ? betaFreeNote() : `<button type="button" class="btn" data-action="subscribe">${icon("crown", 16)} Passer à Premium</button>`}`);
  },
  async subscribe(el) {
    if (S.isGuest()) return needAccount("Crée ton compte pour passer à Premium.");
    if (el) el.disabled = true;
    const r = await S.startSubscription();
    if (r.url) { location.href = r.url; return; }
    if (el) el.disabled = false;
    toast(r.notReady ? "L'abonnement en ligne arrive au lancement d'Aïlo." : r.error);
  },
  tiers() {
    const me = S.me().id;
    openSheet(`<h2 class="h2">Bonus gros loueur</h2>
      <p class="small">Plus tu loues, moins Aïlo prend. Le palier est calculé sur tes locations terminées.</p>
      <div class="box list">${COMMISSION_TIERS.map((t, k) => `<div class="li ${S.commissionFor(me) === t.rate ? "total" : ""}"><span>${k === 0 ? "Au départ" : `Dès ${t.min} locations`}${t.min === VEDETTE_MIN ? ` <span class="badge vedette">${icon("star", 12)} Vedette</span>` : ""}</span><span>${pct(t.rate)}</span></div>`).join("")}</div>
      <p class="muted small">Locations terminées : <strong>${S.rentalsDone(me)}</strong>. Le badge « Loueuse vedette » met aussi tes pièces en avant dans les résultats.</p>`);
  },
  "photo-search"() { document.getElementById("search-photo").click(); },
  "clear-lookalike"() { ui.lookalike = null; route(true); },
  guest() { ui.authReason = ""; go("#/"); },
  signup() { ui.authMode = "signup"; ui.authReason = ""; try { sessionStorage.setItem("ailo-after-auth", location.hash || "#/"); } catch (e) { /* ignore */ } go("#/connexion"); route(); },
  "to-login"() { ui.authMode = "login"; ui.authReason = ""; try { sessionStorage.setItem("ailo-after-auth", location.hash || "#/"); } catch (e) { /* ignore */ } go("#/connexion"); route(); },
  "guest-place"() {
    ui.place = null;
    openSheet(`<h2 class="h2">Ta commune</h2><p class="small muted">Pour afficher les pièces près de chez toi. Rien n'est enregistré ailleurs que sur ton téléphone.</p>${placePicker(null)}
      <button type="button" class="btn" data-action="guest-place-ok">Valider</button>`);
    mountPlacePicker();
  },
  "guest-place-ok"() {
    if (!ui.place) { toast("Choisis ta commune dans la liste, ou utilise ta position."); return; }
    S.setGuestPlace(ui.place); ui.place = null;
    document.getElementById("sheet").close();
    route(true);
  },
  report(el) {
    const { kind, id } = el.dataset;
    const reasons = ["Personne mineure (sur les photos ou derrière le compte)", "Photo choquante, sexuelle ou inappropriée", "Vêtement contrefait", "Annonce trompeuse (état, taille, photos)", "Arnaque ou paiement demandé hors d'Aïlo", "Vêtement volé", "Harcèlement ou propos insultants", "Faux profil ou usurpation d'identité", "Autre problème"];
    openSheet(`<h2 class="h2">Signaler ${kind === "item" ? "cette pièce" : "ce profil"}</h2>
      <p class="small muted">Ton signalement est confidentiel. Aïlo l'examine en priorité et retire ce qui ne respecte pas les règles.</p>
      <div class="radios compact">${reasons.map((r) => `<label class="radio"><input type="radio" name="rep-reason" value="${esc(r)}"><span>${esc(r)}</span></label>`).join("")}</div>
      <label class="field"><span>Décris le problème <span class="muted small">(obligatoire pour « Autre problème »)</span></span><textarea id="rep-details" rows="4" maxlength="500" placeholder="Ce que tu as vu, quand, et tout détail utile."></textarea></label>
      <button type="button" class="btn" data-action="report-send" data-kind="${kind}" data-id="${id}">Envoyer le signalement</button>`);
  },
  async "report-send"(el) {
    const r = document.querySelector("input[name=rep-reason]:checked");
    const details = document.getElementById("rep-details").value.trim();
    if (!r && !details) { toast("Choisis un motif ou décris le problème."); return; }
    if (r && r.value === "Autre problème" && !details) { toast("Décris le problème en quelques mots."); return; }
    el.disabled = true;
    const ok = await S.report(el.dataset.kind, el.dataset.id, r ? r.value : "Autre problème", details);
    document.getElementById("sheet").close();
    toast(ok ? "Merci, ton signalement a été envoyé." : "Le signalement n'a pas pu être envoyé. Réessaie plus tard.");
  },
  async "notif-on"() {
    if (S.isGuest()) return needAccount("Crée ton compte pour recevoir les notifications.");
    if (!S.pushSupported()) { toast(isIOS() ? "Sur iPhone : ajoute d'abord Aïlo à l'écran d'accueil (Partager → Sur l'écran d'accueil), puis ouvre-la depuis l'icône." : "Ce navigateur ne gère pas les notifications."); return; }
    const p = await Notification.requestPermission();
    if (p !== "granted") { toast("Notifications bloquées : autorise-les dans les réglages du téléphone (Applications → Chrome → Notifications)."); route(true); return; }
    try {
      await S.enablePush();
      openSheet(`<h2 class="h2">${icon("bell", 20)} Notifications activées</h2>
        <p class="small">Ce téléphone recevra une alerte pour chaque message, demande ou réservation, même app fermée.</p>
        <button type="button" class="btn ghost" data-action="test-push">Envoyer une notification de test</button>`);
    } catch (e) {
      toast("Les notifications n'ont pas pu être branchées : " + ((e && e.message) || e));
    }
    route(true);
  },
  async "test-push"(el) {
    el.disabled = true;
    const n = await S.testPush();
    el.disabled = false;
    toast(n > 0 ? "Notification envoyée : regarde en haut de ton écran." : "Aucun appareil abonné : touche à nouveau « Notifications ».");
  },

  zoom(el) {
    const i = S.item(location.hash.split("/")[2]);
    if (!i || !i.photos.length) return;
    let k = Number(el.dataset.k) || 0;
    const box = document.createElement("div");
    box.className = "lightbox";
    box.setAttribute("role", "dialog");
    box.setAttribute("aria-label", "Photos en grand");
    const show = () => {
      box.innerHTML = `<img src="${i.photos[k]}" alt="${esc(i.title)}, photo ${k + 1}">
        <button class="lb-btn lb-close" aria-label="Fermer">${icon("close", 22)}</button>
        ${i.photos.length > 1 ? `<button class="lb-btn lb-prev" aria-label="Photo précédente">${icon("back", 22)}</button><button class="lb-btn lb-next" aria-label="Photo suivante">${icon("chevron", 22)}</button><span class="lb-count">${k + 1} / ${i.photos.length}</span>` : ""}`;
    };
    show();
    box.addEventListener("click", (e) => {
      if (e.target.closest(".lb-prev")) { k = (k - 1 + i.photos.length) % i.photos.length; show(); }
      else if (e.target.closest(".lb-next")) { k = (k + 1) % i.photos.length; show(); }
      else if (e.target.closest(".lb-close") || e.target === box) box.remove();
    });
    let x0 = null;
    box.addEventListener("touchstart", (e) => { x0 = e.touches[0].clientX; }, { passive: true });
    box.addEventListener("touchend", (e) => {
      if (x0 === null || i.photos.length < 2) return;
      const dx = e.changedTouches[0].clientX - x0;
      if (Math.abs(dx) > 40) { k = (k + (dx < 0 ? 1 : -1) + i.photos.length) % i.photos.length; show(); }
      x0 = null;
    });
    document.body.appendChild(box);
    box.querySelector(".lb-close").focus();
  },
  "toggle-pw"(el) {
    const input = el.parentElement.querySelector("input");
    const show = input.type === "password";
    input.type = show ? "text" : "password";
    el.setAttribute("aria-pressed", show);
    el.setAttribute("aria-label", show ? "Masquer le mot de passe" : "Afficher le mot de passe");
    el.innerHTML = eyeSvg(show);
    input.focus();
  },
  async "forgot"() {
    const email = (document.getElementById("auth-email") || {}).value || "";
    if (!/.+@.+\..+/.test(email)) { toast("Tape d'abord ton adresse e-mail."); return; }
    const r = await S.resetPassword(email.trim());
    toast(r.error || "E-mail envoyé : suis le lien pour choisir un nouveau mot de passe.");
  }
};

document.addEventListener("click", (e) => {
  const el = e.target.closest("[data-action]");
  if (!el || !actions[el.dataset.action]) return;
  if (el.tagName === "A" && el.dataset.action !== "tab-loue") e.preventDefault();
  actions[el.dataset.action](el, e);
});

// Champs de la fiche (date, remise, nettoyage, colis, crédit) et ajout de photos
document.addEventListener("change", async (e) => {
  const t = e.target;
  const onItem = location.hash.startsWith("#/item/");
  const id = onItem ? location.hash.split("/")[2] : null;
  if (onItem && ui.booking[id]) {
    const b = ui.booking[id];
    if (t.id === "start") b.start = t.value;
    else if (t.name === "clean") b.cleaning = t.value;
    else if (t.name === "handover" && t.type === "radio") b.handover = t.value;
    else if (t.dataset.extra) b.extras = t.checked ? [...b.extras, t.dataset.extra] : b.extras.filter((x) => x !== t.dataset.extra);
    else if (t.id === "use-credit") b.useCredit = t.checked;
    else return;
    updateBooking(id);
    return;
  }
  if (t.id === "group-by") { ui.groupBy = t.value; route(true); return; }
  if (t.id === "search-photo") {
    const f = t.files[0]; t.value = "";
    if (f) await photoSearch(f);
    return;
  }
  if (t.id === "photo-input") {
    const files = [...t.files].slice(0, 8 - ui.draft.photos.length);
    for (const f of files) {
      try { ui.draft.photos.push(await resizeImage(f)); } catch (err) { toast("Photo illisible : " + f.name); }
    }
    refreshPhotos();
  }
});

function refreshPhotos() {
  document.getElementById("photo-strip").innerHTML = photoStrip(ui.draft);
  const b = view.querySelector("[data-action=ai-fill]");
  if (b) b.disabled = !ui.draft.photos.length;
}

// Remplit uniquement les champs encore vides, avec des valeurs de nos listes
function applyAI(a) {
  const d = ui.draft;
  let n = 0;
  const set = (k, v, list) => {
    if (!v || d[k]) return;
    if (list && !list.includes(v)) return;
    d[k] = v; n++;
  };
  set("title", typeof a.title === "string" ? a.title.slice(0, 60) : "");
  set("description", typeof a.description === "string" ? a.description.slice(0, 500) : "");
  set("category", a.category, CATEGORIES);
  set("style", a.style, STYLES);
  set("color", a.color, COLORS.map((c) => c.name));
  set("size", a.size, SIZES);
  set("brand", typeof a.brand === "string" ? a.brand.slice(0, 40) : "");
  set("pattern", typeof a.pattern === "string" ? a.pattern.slice(0, 60) : "");
  if (!d.occasions.length && Array.isArray(a.occasions)) {
    d.occasions = a.occasions.filter((o) => OCCASIONS.includes(o));
    if (d.occasions.length) n++;
  }
  return n;
}


// ---------------------------------------------------------------- Alertes de réservation (bandeau rouge)
const seenKey = () => "ailo-seen-" + S.me().id;
function seenMap() { try { return JSON.parse(localStorage.getItem(seenKey()) || "{}"); } catch (e) { return {}; } }
function markSeen(r) { if (!r) return; const m = seenMap(); m[r.thread] = r.status; try { localStorage.setItem(seenKey(), JSON.stringify(m)); } catch (e) { /* ignore */ } }
function reservationAlerts() {
  if (S.isGuest()) return [];
  const seen = seenMap(), out = [];
  const title = (r) => (S.item(r.itemId) || gone).title;
  for (const r of S.myLendings()) {
    const who = S.user(r.renterId).name, last = seen[r.thread];
    if (r.status === "demandee" && last !== "demandee") out.push({ r, text: `${who} veut louer « ${title(r)} »`, cta: "Répondre" });
    else if (["acceptee", "confirmee"].includes(r.status) && last === undefined) out.push({ r, text: `${who} a réservé « ${title(r)} » (${fmtShort(r.start)} → ${fmtShort(r.end)})`, cta: "Voir" });
    else if (r.status === "rendue" && last !== "rendue") out.push({ r, text: `« ${title(r)} » t'a été rendu : vérifie l'état`, cta: "Vérifier" });
  }
  for (const r of S.myRentals()) {
    const last = seen[r.thread];
    if (r.status === "acceptee" && last !== "acceptee") out.push({ r, text: `Demande acceptée pour « ${title(r)} » : il reste à payer`, cta: "Payer" });
    else if (r.status === "refusee" && last !== "refusee") out.push({ r, text: `Demande refusée pour « ${title(r)} »`, cta: "Voir" });
  }
  return out;
}
function alertBanner() {
  const h = location.hash;
  const list = reservationAlerts().filter((a) => h !== "#/location/" + a.r.id && h !== "#/messages/" + a.r.id);
  if (!list.length) return "";
  const a = list[0];
  return `<a class="resa-alert" href="#/location/${a.r.id}" role="alert">${icon("bell", 18)}<span class="grow">${esc(a.text)}${list.length > 1 ? ` <span class="small">(+${list.length - 1})</span>` : ""}</span><strong>${a.cta} ${icon("chevron", 14)}</strong></a>`;
}

// ---------------------------------------------------------------- Installer l'app, notifications
let deferredInstall = null;
window.addEventListener("beforeinstallprompt", (e) => {
  e.preventDefault();
  deferredInstall = e;
  if (currentTab() === "decouvrir" && !document.querySelector("dialog[open]")) route(true);
});
window.addEventListener("appinstalled", () => { deferredInstall = null; toast("Aïlo est installée : retrouve-la sur ton écran d'accueil."); });
const isStandalone = () => window.matchMedia("(display-mode: standalone)").matches || navigator.standalone === true;
const isIOS = () => /iphone|ipad|ipod/i.test(navigator.userAgent) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
const lsGet = (k) => { try { return localStorage.getItem(k); } catch (e) { return null; } };
const lsSet = (k, v) => { try { localStorage.setItem(k, v); } catch (e) { /* ignore */ } };

function installBanner() {
  if (isStandalone() || lsGet("ailo-install-dismissed") || !(deferredInstall || isIOS())) return "";
  return `<div class="install-banner" role="region" aria-label="Installer l'application">
    <span class="ib-icon">${icon("download", 20)}</span>
    <span class="grow"><strong>Installe Aïlo</strong><span class="small block">Sur ton écran d'accueil, avec les notifications.</span></span>
    <button class="btn sm" data-action="install">Installer</button>
    <button class="icon-btn plain" data-action="install-later" aria-label="Plus tard">${icon("close", 18)}</button>
  </div>`;
}
function installHelp() {
  if (isIOS()) return `<h2 class="h2">Installer Aïlo sur iPhone</h2>
    <ol class="steps-list small">
      <li>Ouvre Aïlo dans <strong>Safari</strong>.</li>
      <li>Touche le bouton <strong>Partager</strong> ${icon("share", 16)} en bas de l'écran.</li>
      <li>Choisis <strong>« Sur l'écran d'accueil »</strong>, puis <strong>Ajouter</strong>.</li>
      <li>Ouvre Aïlo depuis sa nouvelle icône, puis active les notifications dans Profil.</li>
    </ol>`;
  return `<h2 class="h2">Installer Aïlo</h2>
    <ol class="steps-list small">
      <li>Ouvre le menu du navigateur <strong>⋮</strong> (en haut à droite).</li>
      <li>Choisis <strong>« Installer l'application »</strong> ou <strong>« Ajouter à l'écran d'accueil »</strong>.</li>
      <li>Sur ordinateur, tu peux aussi cliquer sur l'icône d'installation à droite de la barre d'adresse.</li>
    </ol>`;
}
// Une seule fois par compte et par appareil : proposer l'installation et les notifications
function maybeWelcome() {
  if (!S.hasSession() || !S.isOnboarded() || document.querySelector("dialog[open]")) return;
  const key = "ailo-welcome-" + S.me().id;
  if (lsGet(key)) return;
  const needInstall = !isStandalone();
  const needNotif = S.pushSupported() && Notification.permission !== "denied";
  if (!needInstall && !needNotif) { lsSet(key, "1"); return; }
  lsSet(key, "1");
  openSheet(`<h2 class="h2">Aïlo dans ta poche</h2>
    <p class="small">Deux petits réglages pour ne rater aucune demande ni aucun message.</p>
    <div class="welcome-steps">
      ${needInstall ? `<div class="box row gap"><span class="ib-icon">${icon("download", 20)}</span><span class="grow"><strong>Installer l'application</strong><span class="small block muted">Installe l'application sur ton écran d'accueil.</span></span>
        <button type="button" class="btn sm" data-action="welcome-install">Installer</button></div>` : ""}
      ${needNotif ? `<div class="box row gap"><span class="ib-icon">${icon("bell", 20)}</span><span class="grow"><strong>Activer les notifications</strong><span class="small block muted">${isIOS() && !isStandalone() ? "Sur iPhone : installe d'abord l'app, puis active-les depuis l'icône." : "Une alerte en haut de l'écran à chaque message ou réservation."}</span></span>
        ${isIOS() && !isStandalone() ? "" : `<button type="button" class="btn sm" data-action="welcome-notif">Activer</button>`}</div>` : ""}
    </div>`);
}

// ---------------------------------------------------------------- Goûts : « Tu pourrais aimer »
const taste = {
  key: () => "ailo-taste-" + (S.me().id || "visiteuse"),
  get() { try { return JSON.parse(lsGet(this.key()) || "{}"); } catch (e) { return {}; } },
  add(i, w) {
    if (!i) return;
    const t = this.get();
    const bump = (k, v) => { if (!v) return; t[k] = t[k] || {}; t[k][v] = (t[k][v] || 0) + w; };
    bump("cat", i.category); bump("color", i.color); bump("style", i.style); bump("size", i.size);
    (i.occasions || []).forEach((o) => bump("occ", o));
    t.n = (t.n || 0) + w;
    lsSet(this.key(), JSON.stringify(t));
  },
  score(i, t) {
    const g = (k, v) => (t[k] && t[k][v]) || 0;
    return g("cat", i.category) * 3 + g("color", i.color) * 2 + g("style", i.style) * 1.5 + g("size", i.size) * 2 + (i.occasions || []).reduce((s, o) => s + g("occ", o), 0);
  }
};
function forYouHTML() {
  const f = ui.filters;
  if (f.q || f.occasion || ui.lookalike || activeFilterCount()) return "";
  const t = taste.get();
  if ((t.n || 0) < 3) return "";
  const items = S.catalog({ radius: f.radius, includeShipping: true })
    .map((i) => ({ i, s: taste.score(i, t) })).filter((x) => x.s > 0)
    .sort((a, b) => b.s - a.s).slice(0, 8).map((x) => x.i);
  if (items.length < 2) return "";
  return `<section class="group"><h2 class="h2">Tu pourrais aimer</h2><div class="hscroll">${items.map(card).join("")}</div></section>`;
}

// ---------------------------------------------------------------- Recherche par photo (Pinterest, capture Zara…)
function similarity(i, a) {
  let s = 0;
  if (a.category && i.category === a.category) s += 4;
  if (a.color && i.color === a.color) s += 3;
  if (a.style && i.style === a.style) s += 2;
  (a.occasions || []).forEach((o) => { if (i.occasions.includes(o)) s += 1; });
  const words = (x) => String(x || "").toLowerCase().split(/[^a-zà-ÿ]+/).filter((w) => w.length > 3);
  const mine = new Set(words(`${i.title} ${i.pattern} ${i.description}`));
  const hits = words(`${a.pattern} ${a.title}`).filter((w) => mine.has(w)).length;
  return s + Math.min(hits, 3);
}
function lookalikeHTML() {
  const L = ui.lookalike;
  if (!L) return "";
  if (L.loading) return `<section class="box lookalike"><img src="${L.photo}" alt="Ta photo d'inspiration"><div class="grow"><strong>Je cherche des pièces qui ressemblent…</strong><p class="muted small">Analyse de ta photo en cours.</p></div></section>`;
  const a = L.a || {};
  const items = S.catalog({ includeShipping: true }).map((i) => ({ i, s: similarity(i, a) })).filter((x) => x.s >= 3).sort((x, y) => y.s - x.s).slice(0, 12).map((x) => x.i);
  const tags = [a.category, a.color, a.pattern, a.style].filter(Boolean).map((x) => `<span class="badge">${esc(x)}</span>`).join("");
  return `<section class="stack lookalike-wrap">
    <div class="box lookalike"><img src="${L.photo}" alt="Ta photo d'inspiration"><div class="grow"><strong>Inspirée de ta photo</strong><div class="tags">${tags || `<span class="muted small">Rien de reconnu sur cette image.</span>`}</div></div>
      <button class="icon-btn plain" data-action="clear-lookalike" aria-label="Effacer la recherche par photo">${icon("close", 18)}</button></div>
    ${items.length ? `<div class="hscroll">${items.map(card).join("")}</div>` : `<p class="muted small">Aucune pièce ne ressemble encore à ça. Essaie une autre photo, ou reviens bientôt : le catalogue grandit.</p>`}
  </section>`;
}
async function photoSearch(file) {
  let img;
  try { img = await resizeImage(file); } catch (e) { toast("Cette image n'a pas pu être lue."); return; }
  ui.lookalike = { photo: img, loading: true };
  route(true);
  try {
    const res = await fetch(aiEndpoint(), { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ images: [img] }) });
    if (!res.ok) throw new Error("HTTP " + res.status);
    const a = await res.json();
    ui.lookalike = { photo: img, a };
    taste.add({ category: a.category, color: a.color, style: a.style, occasions: a.occasions || [] }, 2);
  } catch (e) {
    ui.lookalike = null;
    toast("L'analyse de la photo n'a pas fonctionné. Réessaie dans un instant.");
  }
  if (location.hash === "" || location.hash === "#/") route(true);
}

// ---------------------------------------------------------------- Connexion
// Champ mot de passe avec un œil pour afficher ce qu'on tape
const EYE = '<path d="M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7S2 12 2 12z"/><circle cx="12" cy="12" r="3"/>';
const EYE_OFF = '<path d="M3 3l18 18M10.6 6.1A10.6 10.6 0 0 1 12 6c6.4 0 10 6 10 6a17.6 17.6 0 0 1-3.3 4M6.6 6.6C3.7 8.4 2 12 2 12s3.6 7 10 7a9.8 9.8 0 0 0 5.4-1.6M9.9 9.9a3 3 0 0 0 4.2 4.2"/>';
const eyeSvg = (on) => `<svg aria-hidden="true" width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">${on ? EYE_OFF : EYE}</svg>`;
function pwField(name, label, autocomplete) {
  return `<label class="field"><span>${label}</span><span class="pw">
    <input name="${name}" type="password" autocomplete="${autocomplete}" minlength="8" required autocapitalize="off" autocorrect="off" spellcheck="false">
    <button type="button" class="pw-eye" data-action="toggle-pw" aria-label="Afficher le mot de passe" aria-pressed="false">${eyeSvg(false)}</button></span></label>`;
}

function authView() {
  const signup = ui.authMode !== "login";
  return {
    noTabbar: true, title: signup ? "Créer un compte" : "Connexion",
    html: `<form id="auth" class="page onb" novalidate>
      <div class="logo big-logo">Aïlo</div>
      <h1 class="h1">Loue la tenue de ton prochain événement, ou loue ton dressing.</h1>
      ${ui.authReason ? `<p class="box note small">${esc(ui.authReason)}</p>` : ""}
      <div class="seg" role="group" aria-label="Compte"><button type="button" data-action="auth-mode" data-m="signup" aria-pressed="${signup}">Créer un compte</button><button type="button" data-action="auth-mode" data-m="login" aria-pressed="${!signup}">Me connecter</button></div>
      <label class="field"><span>Adresse e-mail</span><input id="auth-email" name="email" type="email" autocomplete="email" inputmode="email" required></label>
      ${pwField("password", "Mot de passe" + (signup ? " (8 caractères minimum)" : ""), signup ? "new-password" : "current-password")}
      <p id="auth-err" class="err small" role="alert"></p>
      <button class="btn">${signup ? "Créer mon compte" : "Me connecter"}</button>
      ${signup ? "" : `<button type="button" class="linkbtn" data-action="forgot">Mot de passe oublié ?</button>`}
      <a class="btn ghost" href="#/" data-action="guest">Découvrir sans compte</a>
      <p class="muted small center"><a href="#/cgu">Conditions générales et confidentialité</a></p>
    </form>`,
    mount() {
      document.getElementById("auth").addEventListener("submit", async (e) => {
        e.preventDefault();
        const f = e.target, err = document.getElementById("auth-err"), btn = f.querySelector(".btn");
        const email = f.email.value.trim(), password = f.password.value;
        if (!/.+@.+\..+/.test(email)) return (err.textContent = "Adresse e-mail invalide.");
        if (password.length < 8) return (err.textContent = "Le mot de passe doit faire au moins 8 caractères.");
        btn.disabled = true; btn.textContent = "Un instant…"; err.textContent = "";
        const r = signup ? await S.signUp(email, password) : await S.signIn(email, password);
        btn.disabled = false; btn.textContent = signup ? "Créer mon compte" : "Me connecter";
        if (r.error) return (err.textContent = r.error);
        if (r.needConfirm) { err.textContent = ""; toast("Compte créé : confirme ton adresse avec le lien reçu par e-mail, puis connecte-toi."); ui.authMode = "login"; return route(true); }
        ui.authReason = "";
        if (!S.isOnboarded()) { route(); return; } // l'inscription s'affiche ; elle renverra ensuite où on était
        go(afterAuthTarget()); route();
      });
    }
  };
}

function recoveryView() {
  return {
    noTabbar: true, title: "Nouveau mot de passe",
    html: `<form id="rec" class="page onb" novalidate>
      <div class="logo big-logo">Aïlo</div>
      <h1 class="h1">Choisis un nouveau mot de passe</h1>
      ${pwField("password", "Nouveau mot de passe (8 caractères minimum)", "new-password")}
      <p id="rec-err" class="err small" role="alert"></p>
      <button class="btn">Enregistrer</button>
    </form>`,
    mount() {
      document.getElementById("rec").addEventListener("submit", async (e) => {
        e.preventDefault();
        const p = e.target.password.value;
        if (p.length < 8) return (document.getElementById("rec-err").textContent = "8 caractères minimum.");
        const r = await S.setNewPassword(p);
        if (r.error) return (document.getElementById("rec-err").textContent = r.error);
        toast("Mot de passe changé");
        go("#/"); route();
      });
    }
  };
}

// ---------------------------------------------------------------- Démarrage
view.innerHTML = `<div class="page onb"><div class="logo big-logo">Aïlo</div><p class="muted">Chargement…</p></div>`;
tabbar.hidden = true;
S.init().catch(() => {}).finally(() => {
  route();
  // Si les notifications sont déjà autorisées, on (ré)abonne discrètement cet appareil
  if (S.hasSession() && "Notification" in window && Notification.permission === "granted") S.enablePush().catch(() => {});
  setTimeout(maybeWelcome, 1500);
});

// Rafraîchit les données en revenant dans l'app, et régulièrement sur les écrans de suivi
const live = () => /^#\/(messages|location|locations)/.test(location.hash);
document.addEventListener("visibilitychange", () => { if (document.visibilityState === "visible" && S.hasSession()) S.sync().then(() => window.dispatchEvent(new Event("ailo:refresh"))).catch(() => {}); });
// Toutes les 20 s sur les écrans de suivi, toutes les 60 s ailleurs (pastilles à jour même sans temps réel)
let ticks = 0;
setInterval(() => {
  ticks++;
  if (!S.hasSession() || document.visibilityState !== "visible") return;
  if (live() || ticks % 3 === 0) S.sync().then(() => window.dispatchEvent(new Event("ailo:refresh"))).catch(() => {});
}, 20000);
if ("serviceWorker" in navigator && location.protocol === "https:") {
  navigator.serviceWorker.register("sw.js").catch(() => {});
}
