// Aïlo — application (v0.1, données locales)
import * as S from "./store.js";
import { CATEGORIES, STYLES, COLORS, SIZES, OCCASIONS, CONDITIONS, HANDOVER, DURATIONS, STATUS, COMMISSION_RATE, addDays } from "./data.js";
import { esc, euro, fmtDate, fmtShort, today, initials, icon, photo, toast, resizeImage, calendar } from "./ui.js";

const view = document.getElementById("view");
const tabbar = document.getElementById("tabbar");

// État de l'interface (non enregistré)
const ui = {
  filters: { q: "", category: "", style: "", color: "", size: "", occasion: "", maxPrice: "", maxKm: "", date: "", sort: "km" },
  groupBy: "tout",
  locTab: "prends",
  dressFilter: "",
  booking: {},   // itemId -> { durationId, start, cleaning }
  draft: null    // pièce en cours d'édition
};

// ---------------------------------------------------------------- Routeur
const routes = [
  [/^#?\/?$/, decouvrir],
  [/^#\/favoris$/, favoris],
  [/^#\/item\/(\w+)$/, fiche],
  [/^#\/dressing$/, dressing],
  [/^#\/dressing\/nouveau$/, () => itemForm()],
  [/^#\/dressing\/(\w+)$/, (id) => itemForm(id)],
  [/^#\/locations$/, locations],
  [/^#\/location\/(\w+)$/, locationDetail],
  [/^#\/messages$/, messagesList],
  [/^#\/messages\/(\w+)$/, thread],
  [/^#\/profil$/, profil]
];

function route(keep) {
  const h = location.hash || "#/";
  for (const [re, fn] of routes) {
    const m = h.match(re);
    if (m) {
      const out = fn(...m.slice(1));
      view.innerHTML = out.html;
      tabbar.hidden = !!out.noTabbar;
      document.body.classList.toggle("has-bottombar", !!out.bottomBar);
      setTab(out.tab);
      if (out.mount) out.mount();
      if (!keep) window.scrollTo(0, 0);
      document.title = out.title ? `${out.title} · Aïlo` : "Aïlo";
      return;
    }
  }
  location.hash = "#/";
}
window.addEventListener("hashchange", () => route());
window.addEventListener("ailo:toast", (e) => toast(e.detail));

function setTab(tab) {
  tabbar.querySelectorAll("a").forEach((a) => {
    const on = a.dataset.tab === tab;
    a.classList.toggle("on", on);
    if (on) a.setAttribute("aria-current", "page"); else a.removeAttribute("aria-current");
  });
  const pending = S.myLendings().filter((r) => r.status === "demandee").length;
  const badge = tabbar.querySelector("[data-tab=locations] .dot");
  badge.hidden = !pending;
}

const go = (h) => { location.hash = h; };
const back = (fallback) => (history.length > 1 ? history.back() : go(fallback));

// ---------------------------------------------------------------- Composants
function card(i) {
  const owner = S.user(i.ownerId);
  const fav = S.isFav(i.id);
  return `<article class="card">
    <a href="#/item/${i.id}" class="card-link">
      <div class="card-ph">${photo(i)}${i.instant ? `<span class="tag-instant">${icon("bolt", 12)} Instantané</span>` : ""}</div>
      <h3>${esc(i.title)}</h3>
      <p class="muted small">T. ${esc(i.size)} · ${esc(owner.city)} · ${owner.km} km</p>
      <p class="price"><strong>${euro(i.prices.we)}</strong><span class="muted"> / week-end</span></p>
    </a>
    <button class="fav ${fav ? "on" : ""}" data-action="fav" data-id="${i.id}" aria-label="${fav ? "Retirer des" : "Ajouter aux"} favoris" aria-pressed="${fav}">${icon(fav ? "heart-fill" : "heart", 16)}</button>
  </article>`;
}

const grid = (items) => `<div class="grid2">${items.map(card).join("")}</div>`;
const empty = (title, text, cta = "") => `<div class="empty"><p class="empty-title">${title}</p><p class="muted">${text}</p>${cta}</div>`;
const statusPill = (s) => `<span class="pill tone-${STATUS[s].tone}">${STATUS[s].label}</span>`;
const ownerBadge = (u) => u.type === "boutique" ? `<span class="badge">${icon("shop", 12)} Boutique partenaire</span>` : u.type === "pro" ? `<span class="badge">Pro</span>` : "";
const opts = (list, sel, placeholder) => `<option value="">${placeholder}</option>` + list.map((v) => `<option ${v === sel ? "selected" : ""}>${esc(v)}</option>`).join("");

// ---------------------------------------------------------------- Découvrir
function activeFilterCount() {
  const f = ui.filters;
  return ["category", "style", "color", "size", "maxPrice", "maxKm", "date"].filter((k) => f[k]).length;
}

function resultsHTML() {
  const items = S.catalog(ui.filters);
  if (!items.length) return empty("Aucune pièce trouvée", "Essaie d'élargir les filtres ou la distance.", `<button class="btn ghost" data-action="clear-filters">Effacer les filtres</button>`);
  const count = `<p class="muted small count">${items.length} pièce${items.length > 1 ? "s" : ""}</p>`;
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
      ? `<div class="group-owner"><span class="avatar sm">${initials(S.user(k).name)}</span><span>${esc(S.user(k).name)}</span>${ownerBadge(S.user(k))}<span class="muted small">★ ${S.user(k).rating.toFixed(1).replace(".", ",")}</span></div>`
      : `<h2 class="h2">${esc(k)} <span class="muted small">${groups.get(k).length}</span></h2>`;
    return `<section class="group">${title}<div class="hscroll">${groups.get(k).map(card).join("")}</div></section>`;
  }).join("");
}

function decouvrir() {
  const f = ui.filters, n = activeFilterCount();
  const seg = [["tout", "Tout"], ["categorie", "Catégorie"], ["theme", "Thématique"], ["profil", "Profil"]];
  return {
    tab: "decouvrir",
    html: `<div class="page">
      <header class="topbar"><div class="logo">Aïlo</div>
        <a class="icon-btn" href="#/favoris" aria-label="Mes favoris">${icon("heart", 20)}</a></header>
      <p class="muted">Bonjour ${esc(S.me().name.split(" ")[0])}</p>
      <h1 class="h1">Quelle tenue pour ton prochain événement ?</h1>
      <div class="searchrow">
        <label class="search">${icon("search", 18)}<span class="sr">Rechercher</span>
          <input id="q" type="search" placeholder="Robe, costume, taille 38…" value="${esc(f.q)}" autocomplete="off"></label>
        <button class="icon-btn solid" data-action="open-filters" aria-label="Filtres">${icon("filter", 20)}${n ? `<span class="count-badge">${n}</span>` : ""}</button>
      </div>
      <div class="label-caps">Afficher par</div>
      <div class="seg" role="group" aria-label="Afficher par">${seg.map(([k, l]) => `<button data-action="group" data-k="${k}" aria-pressed="${ui.groupBy === k}">${l}</button>`).join("")}</div>
      <div class="chips hscroll-chips">${OCCASIONS.map((o) => `<button class="chip ${f.occasion === o ? "on" : ""}" data-action="occasion" data-o="${o}" aria-pressed="${f.occasion === o}">${o}</button>`).join("")}</div>
      <div class="section-head"><h2 class="h2">${f.occasion ? `Occasion : ${esc(f.occasion)}` : "Près de chez toi"}</h2></div>
      <div id="results">${resultsHTML()}</div>
    </div>
    ${filtersSheet()}`,
    mount() {
      const q = document.getElementById("q");
      q.addEventListener("input", () => { ui.filters.q = q.value; document.getElementById("results").innerHTML = resultsHTML(); });
    }
  };
}

function filtersSheet() {
  const f = ui.filters;
  return `<dialog id="filters" class="sheet" aria-labelledby="filters-title">
    <form method="dialog" id="filters-form">
      <div class="sheet-head"><h2 id="filters-title" class="h2">Filtres</h2><button class="icon-btn" value="cancel" aria-label="Fermer">${icon("close", 20)}</button></div>
      <div class="fields">
        <label class="field"><span>Catégorie</span><select name="category">${opts(CATEGORIES, f.category, "Toutes")}</select></label>
        <label class="field"><span>Style</span><select name="style">${opts(STYLES, f.style, "Tous")}</select></label>
        <fieldset class="field"><legend>Couleur</legend><div class="swatches">
          <label class="sw"><input type="radio" name="color" value="" ${!f.color ? "checked" : ""}><span class="sw-any">Toutes</span></label>
          ${COLORS.map((c) => `<label class="sw" title="${c.name}"><input type="radio" name="color" value="${c.name}" ${f.color === c.name ? "checked" : ""}><span style="background:${c.hex}"></span><span class="sr">${c.name}</span></label>`).join("")}
        </div></fieldset>
        <label class="field"><span>Taille</span><select name="size">${opts(SIZES, f.size, "Toutes")}</select></label>
        <label class="field"><span>Disponible à partir du</span><input type="date" name="date" min="${today()}" value="${f.date}"></label>
        <label class="field"><span>Prix week-end max : <output id="pv">${f.maxPrice ? euro(f.maxPrice) : "sans limite"}</output></span><input type="range" name="maxPrice" min="5" max="50" step="5" value="${f.maxPrice || 50}"></label>
        <label class="field"><span>Distance max</span><select name="maxKm"><option value="">Sans limite</option>${[5, 10, 20, 50].map((k) => `<option value="${k}" ${String(f.maxKm) === String(k) ? "selected" : ""}>${k} km</option>`).join("")}</select></label>
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
  const b = ui.booking[id] || (ui.booking[id] = { durationId: "sem", start: "", cleaning: i.cleaningRequired ? "forfait" : "propre" });
  const fav = S.isFav(id);
  const ranges = S.bookedRanges(id);
  const photos = i.photos.length ? i.photos.map((p, k) => `<img src="${p}" alt="${esc(i.title)}, photo ${k + 1}">`).join("") : photo(i, "big");
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
          <p class="muted">Taille ${esc(i.size)} · ${esc(i.color)} · ${esc(i.condition)}${i.brand ? " · " + esc(i.brand) : ""}</p></div>
        <div class="tags">${i.instant ? `<span class="badge accent">${icon("bolt", 12)} Réservation instantanée</span>` : ""}<span class="badge">${esc(i.category)}</span><span class="badge">${esc(i.style)}</span>${i.occasions.map((x) => `<span class="badge">${esc(x)}</span>`).join("")}</div>
        <div class="box row gap">
          <span class="avatar">${initials(o.name)}</span>
          <div class="grow"><strong>${esc(o.name)}</strong> ${ownerBadge(o)}<div class="muted small">★ ${o.rating.toFixed(1).replace(".", ",")} · ${o.reviews} avis · ${esc(o.city)}, ${o.km} km</div></div>
        </div>
        ${i.description ? `<p class="desc">${esc(i.description)}</p>` : ""}
        ${mine ? `<div class="box note">C'est une pièce de ton dressing. <a href="#/dressing/${id}">La modifier</a></div>` : `
        <section class="stack">
          <h2 class="h3">Durée de location</h2>
          <div class="dur">${DURATIONS.map((d) => `<button data-action="dur" data-id="${id}" data-d="${d.id}" aria-pressed="${b.durationId === d.id}"><span class="small">${d.label}</span><strong>${euro(i.prices[d.id])}</strong><span class="tiny">${euro(Math.round(i.prices[d.id] / d.days * 100) / 100)}/jour</span></button>`).join("")}</div>
          <label class="field"><span>Date de remise</span><input type="date" id="start" min="${addDays(today(), 1)}" value="${b.start}"></label>
          <p id="avail" class="small"></p>
          ${ranges.length ? `<p class="muted small">Déjà réservée : ${ranges.map((r) => `${fmtShort(r.start)} → ${fmtShort(r.end)}`).join(", ")} (lavage compris)</p>` : ""}
        </section>
        <section class="stack">
          <h2 class="h3">Nettoyage</h2>
          ${i.cleaningRequired ? `<p class="box note small">Pièce délicate : le forfait nettoyage (${euro(i.cleaningFee)}) est obligatoire.</p>` : `
          <div class="radios">
            <label class="radio"><input type="radio" name="clean" value="propre" ${b.cleaning === "propre" ? "checked" : ""}><span><strong>Je la rends propre</strong><span class="muted small">Lavage selon l'étiquette, contrôlé au retour</span></span></label>
            <label class="radio"><input type="radio" name="clean" value="forfait" ${b.cleaning === "forfait" ? "checked" : ""}><span><strong>Forfait nettoyage · ${euro(i.cleaningFee)}</strong><span class="muted small">La loueuse s'en occupe</span></span></label>
          </div>`}
        </section>
        <section class="box list" id="recap"></section>
        <p class="muted small">Remise : ${HANDOVER[i.handover]}. La caution est remboursée après le retour contrôlé.</p>
        `}
      </div>
      ${mine ? "" : `<div class="bottombar"><div><strong id="bb-total" class="big accent"></strong><div id="bb-sub" class="muted small"></div></div>
        <button class="btn" data-action="book" data-id="${id}" id="book-btn">${i.instant ? "Réserver" : "Demander"}</button></div>`}`,
    mount() { if (!mine) updateBooking(id); }
  };
}

function updateBooking(id) {
  const i = S.item(id), b = ui.booking[id];
  const q = S.quote(i, b.durationId, b.cleaning);
  const dur = DURATIONS.find((d) => d.id === b.durationId);
  const avail = document.getElementById("avail");
  let ok = true;
  if (b.start) {
    const end = addDays(b.start, dur.days);
    ok = S.isAvailable(id, b.start, end);
    avail.innerHTML = ok ? `<span class="ok">${icon("check", 14)} Disponible</span> · retour le ${fmtDate(end)}` : `<span class="err">Pas disponible à ces dates.</span>`;
  } else avail.textContent = "Choisis la date à laquelle tu récupères le vêtement.";
  document.getElementById("recap").innerHTML = `
    <div class="li"><span>Location · ${dur.label.toLowerCase()}</span><span>${euro(q.price)}</span></div>
    ${q.cleaningFee ? `<div class="li"><span>Forfait nettoyage</span><span>${euro(q.cleaningFee)}</span></div>` : ""}
    <div class="li"><span>Caution <span class="muted small">(remboursée)</span></span><span>${euro(q.deposit)}</span></div>
    <div class="li total"><span>À payer</span><span>${euro(q.total)}</span></div>`;
  document.getElementById("bb-total").textContent = euro(q.price + q.cleaningFee);
  document.getElementById("bb-sub").textContent = `${dur.label}${b.start ? " · " + fmtShort(b.start) + " → " + fmtShort(addDays(b.start, dur.days)) : ""} + caution`;
  document.getElementById("book-btn").disabled = !b.start || !ok;
}

// ---------------------------------------------------------------- Dressing
function dressing() {
  const items = S.myItems();
  const cats = [...new Set(items.map((i) => i.category))];
  const shown = ui.dressFilter ? items.filter((i) => i.category === ui.dressFilter) : items;
  const active = S.myLendings().filter((r) => ["confirmee", "remise", "rendue"].includes(r.status)).length;
  const pending = S.myLendings().filter((r) => r.status === "demandee").length;
  const badge = (i) => {
    const out = S.myLendings().some((r) => r.itemId === i.id && ["remise", "rendue"].includes(r.status));
    if (i.status === "paused") return `<span class="st paused">En pause</span>`;
    return out ? `<span class="st out">Louée</span>` : `<span class="st on">En ligne</span>`;
  };
  return {
    tab: "dressing", title: "Mon dressing",
    html: `<div class="page">
      <h1 class="h1">Mon dressing</h1>
      <div class="stats"><div><strong>${items.length}</strong><span>pièces</span></div><div><strong>${active}</strong><span>en location</span></div><div class="accent-bg"><strong>${euro(S.earnings())}</strong><span>gains prévus</span></div></div>
      ${pending ? `<a class="box alert" href="#/locations" data-action="tab-loue">${pending} demande${pending > 1 ? "s" : ""} de location en attente ${icon("chevron", 16)}</a>` : ""}
      <div class="chips">${["", ...cats].map((c) => `<button class="chip ${ui.dressFilter === c ? "on" : ""}" data-action="dress-filter" data-c="${esc(c)}" aria-pressed="${ui.dressFilter === c}">${c || "Tout"}</button>`).join("")}</div>
      <div class="grid3">
        <a class="add-tile" href="#/dressing/nouveau">${icon("plus", 26)}<span>Ajouter</span></a>
        ${shown.map((i) => `<a class="tile" href="#/dressing/${i.id}" aria-label="${esc(i.title)}">${photo(i)}${badge(i)}</a>`).join("")}
      </div>
      ${items.length ? "" : `<p class="muted center">Ajoute ta première pièce : 3 photos, une description, tes prix. Deux minutes suffisent.</p>`}
    </div>`
  };
}

// ---------------------------------------------------------------- Formulaire pièce
function itemForm(id) {
  const existing = id ? S.item(id) : null;
  if (id && (!existing || existing.ownerId !== S.me().id)) return { html: empty("Pièce introuvable", "", `<a class="btn" href="#/dressing">Retour</a>`) };
  if (!ui.draft || ui.draft._for !== (id || "new")) {
    ui.draft = existing ? JSON.parse(JSON.stringify(existing)) : {
      photos: [], title: "", description: "", brand: "", category: "", style: "", color: "", size: "", condition: "Très bon état",
      occasions: [], prices: { we: "", sem: "", deux: "" }, deposit: "", cleaningFee: 8, cleaningRequired: false, handover: "both", instant: false
    };
    ui.draft._for = id || "new";
  }
  const d = ui.draft;
  return {
    noTabbar: true, bottomBar: true, title: existing ? "Modifier" : "Nouvelle pièce",
    html: `<form id="item-form" class="page" novalidate>
      <header class="topbar"><button type="button" class="icon-btn" data-action="cancel-form" aria-label="Annuler">${icon("close", 20)}</button><h1 class="h1 inline">${existing ? "Modifier la pièce" : "Nouvelle pièce"}</h1><span></span></header>

      <section class="stack"><h2 class="h3">1. Photos <span class="muted small">(3 à 8, format portrait)</span></h2>
        <div class="photo-strip" id="photo-strip">${photoStrip(d)}</div>
        <p class="muted small">Astuce : fond neutre, lumière du jour, la pièce entière puis les détails.</p>
      </section>

      <section class="stack"><h2 class="h3">2. Description</h2>
        <label class="field"><span>Titre *</span><input name="title" required maxlength="60" placeholder="Ex. Robe longue satinée" value="${esc(d.title)}"></label>
        <label class="field"><span>Description</span><textarea name="description" rows="3" maxlength="500" placeholder="Coupe, matière, nombre de fois portée, défauts éventuels…">${esc(d.description)}</textarea></label>
        <div class="two">
          <label class="field"><span>Catégorie *</span><select name="category" required>${opts(CATEGORIES, d.category, "Choisir")}</select></label>
          <label class="field"><span>Style *</span><select name="style" required>${opts(STYLES, d.style, "Choisir")}</select></label>
          <label class="field"><span>Taille *</span><select name="size" required>${opts(SIZES, d.size, "Choisir")}</select></label>
          <label class="field"><span>État</span><select name="condition">${opts(CONDITIONS, d.condition, "Choisir")}</select></label>
        </div>
        <label class="field"><span>Marque</span><input name="brand" maxlength="40" value="${esc(d.brand)}"></label>
        <fieldset class="field"><legend>Couleur *</legend><div class="swatches">
          ${COLORS.map((c) => `<label class="sw" title="${c.name}"><input type="radio" name="color" value="${c.name}" ${d.color === c.name ? "checked" : ""}><span style="background:${c.hex}"></span><span class="sr">${c.name}</span></label>`).join("")}
        </div><span class="muted small" id="color-name">${esc(d.color)}</span></fieldset>
        <fieldset class="field"><legend>Occasions</legend><div class="chips wrap">
          ${OCCASIONS.map((o) => `<label class="chip check"><input type="checkbox" name="occasions" value="${o}" ${d.occasions.includes(o) ? "checked" : ""}><span>${o}</span></label>`).join("")}
        </div></fieldset>
      </section>

      <section class="stack"><h2 class="h3">3. Prix et caution</h2>
        <div class="box suggest"><label class="field"><span>Prix d'achat (pour suggérer les prix)</span><input type="number" id="buy" min="0" step="1" inputmode="numeric" placeholder="Ex. 150"></label><button type="button" class="btn ghost sm" data-action="suggest">Suggérer</button></div>
        <div class="three">
          ${DURATIONS.map((x) => `<label class="field"><span>${x.label} *</span><input type="number" name="p-${x.id}" min="1" step="1" inputmode="numeric" value="${d.prices[x.id]}" required></label>`).join("")}
        </div>
        <label class="field"><span>Caution *</span><input type="number" name="deposit" min="0" step="5" inputmode="numeric" value="${d.deposit}" required></label>
        <p class="muted small">Aïlo prélève ${COMMISSION_RATE * 100} % sur le prix de location. Le forfait nettoyage et la caution ne sont pas commissionnés.</p>
      </section>

      <section class="stack"><h2 class="h3">4. Nettoyage, remise, réservation</h2>
        <label class="field"><span>Forfait nettoyage</span><input type="number" name="cleaningFee" min="0" step="1" value="${d.cleaningFee}"></label>
        <label class="toggle"><input type="checkbox" name="cleaningRequired" ${d.cleaningRequired ? "checked" : ""}><span>Forfait obligatoire (pièce délicate, pressing)</span></label>
        <label class="field"><span>Remise</span><select name="handover">${Object.entries(HANDOVER).map(([k, v]) => `<option value="${k}" ${d.handover === k ? "selected" : ""}>${v}</option>`).join("")}</select></label>
        <label class="toggle"><input type="checkbox" name="instant" ${d.instant ? "checked" : ""}><span>Réservation instantanée<span class="muted small block">Si le calendrier est libre, la location est confirmée sans attendre ton accord.</span></span></label>
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
      });
      form.addEventListener("submit", (e) => { e.preventDefault(); submitItem(form, id); });
    }
  };
}

function photoStrip(d) {
  return d.photos.map((p, k) => `<div class="thumb"><img src="${p}" alt="Photo ${k + 1}"><button type="button" class="thumb-x" data-action="rm-photo" data-k="${k}" aria-label="Retirer la photo ${k + 1}">${icon("close", 14)}</button>${k === 0 ? '<span class="thumb-main">Principale</span>' : ""}</div>`).join("") +
    (d.photos.length < 8 ? `<label class="thumb add">${icon("camera", 24)}<span>Ajouter</span><input type="file" accept="image/*" multiple id="photo-input" class="sr"></label>` : "");
}

function syncDraft(form) {
  const d = ui.draft, fd = new FormData(form);
  for (const k of ["title", "description", "brand", "category", "style", "size", "condition", "handover"]) d[k] = fd.get(k) ?? d[k];
  d.color = fd.get("color") || d.color;
  d.occasions = fd.getAll("occasions");
  d.prices = { we: num(fd.get("p-we")), sem: num(fd.get("p-sem")), deux: num(fd.get("p-deux")) };
  d.deposit = num(fd.get("deposit"));
  d.cleaningFee = num(fd.get("cleaningFee")) || 0;
  d.cleaningRequired = fd.get("cleaningRequired") === "on";
  d.instant = fd.get("instant") === "on";
}
const num = (v) => (v === null || v === "" ? "" : Number(v));

function submitItem(form, id) {
  syncDraft(form);
  const d = ui.draft, err = document.getElementById("form-err");
  const missing = [];
  if (!d.title.trim()) missing.push("titre");
  for (const k of ["category", "style", "size", "color"]) if (!d[k]) missing.push({ category: "catégorie", style: "style", size: "taille", color: "couleur" }[k]);
  if (!d.prices.we || !d.prices.sem || !d.prices.deux) missing.push("les trois prix");
  if (d.deposit === "") missing.push("caution");
  if (missing.length) { err.textContent = "Il manque : " + missing.join(", ") + "."; err.scrollIntoView({ block: "center" }); return; }
  if (!(d.prices.we <= d.prices.sem && d.prices.sem <= d.prices.deux)) { err.textContent = "Le prix total doit augmenter avec la durée (week-end ≤ 1 semaine ≤ 2 semaines)."; return; }
  const data = Object.assign({}, d);
  delete data._for;
  if (!d.photos.length && !id) toast("Publiée sans photo : ajoute-en vite, c'est ce qui fait louer.");
  const newId = S.saveItem(data);
  ui.draft = null;
  toast(id ? "Modifications enregistrées" : "Ta pièce est en ligne !");
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

function locCard(r) {
  const i = S.item(r.itemId) || { title: "Pièce supprimée", tint: "#EEE", photos: [] };
  const other = S.user(ui.locTab === "prends" ? r.ownerId : r.renterId);
  return `<a class="box loc" href="#/location/${r.id}">
    <div class="loc-ph">${photo(i)}</div>
    <div class="grow"><strong>${esc(i.title)}</strong>
      <div class="muted small">${ui.locTab === "prends" ? "Chez" : "Louée par"} ${esc(other.name)}</div>
      <div class="small">${fmtShort(r.start)} → ${fmtShort(r.end)}</div></div>
    ${statusPill(r.status)}</a>`;
}

function locationDetail(id) {
  const r = S.reservation(id);
  if (!r) return { html: empty("Location introuvable", "", `<a class="btn" href="#/locations">Retour</a>`) };
  const i = S.item(r.itemId) || { title: "Pièce supprimée", tint: "#EEE", photos: [] };
  const amRenter = r.renterId === S.me().id;
  const other = S.user(amRenter ? r.ownerId : r.renterId);
  const steps = ["demandee", "confirmee", "remise", "rendue", "terminee"];
  const cur = steps.indexOf(r.status === "litige" ? "rendue" : r.status);
  const myRole = amRenter ? "renter" : "owner";
  const acts = (S.TRANSITIONS[r.status] || []);
  const mine = acts.filter((a) => a.by === "both" || a.by === myRole);
  const theirs = acts.filter((a) => a.by !== "both" && a.by !== myRole);
  const total = r.price + r.cleaningFee + r.deposit;
  return {
    tab: "locations", title: "Location",
    html: `<div class="page">
      <header class="topbar"><a class="icon-btn" href="#/locations" aria-label="Retour">${icon("back", 20)}</a><h1 class="h1 inline">${amRenter ? "Ma location" : "Location de ma pièce"}</h1><span></span></header>
      <a class="box loc" href="#/item/${r.itemId}"><div class="loc-ph">${photo(i)}</div>
        <div class="grow"><strong>${esc(i.title)}</strong><div class="muted small">${amRenter ? "Chez" : "Louée par"} ${esc(other.name)} · ${esc(other.city)}</div></div>${statusPill(r.status)}</a>
      ${["refusee", "annulee"].includes(r.status) ? "" : `<ol class="steps">${steps.map((s, k) => `<li class="${k < cur ? "done" : k === cur ? "cur" : ""}">${STATUS[s].label}</li>`).join("")}</ol>`}
      <div class="two"><div class="box mini"><span class="muted small">Remise</span><strong>${fmtDate(r.start)}</strong></div><div class="box mini"><span class="muted small">Retour</span><strong>${fmtDate(r.end)}</strong></div></div>
      <div class="box stack">${calendar(r.start, [{ start: r.start, end: r.end }])}${r.end.slice(0, 7) !== r.start.slice(0, 7) ? calendar(r.end, [{ start: r.start, end: r.end }]) : ""}</div>
      <section class="box list">
        <div class="li"><span>Location</span><span>${euro(r.price)}</span></div>
        ${r.cleaningFee ? `<div class="li"><span>Forfait nettoyage</span><span>${euro(r.cleaningFee)}</span></div>` : `<div class="li"><span>Nettoyage</span><span>Rendue propre</span></div>`}
        <div class="li"><span>Caution</span><span>${euro(r.deposit)}</span></div>
        ${amRenter ? `<div class="li total"><span>Total payé</span><span>${euro(total)}</span></div>` :
          `<div class="li"><span class="muted">Commission Aïlo (${COMMISSION_RATE * 100} %)</span><span class="muted">− ${euro(r.price * COMMISSION_RATE)}</span></div><div class="li total"><span>Tu recevras</span><span>${euro(S.payoutFor(r))}</span></div>`}
      </section>
      ${mine.length ? `<div class="stack">${mine.map((a) => `<button class="btn ${a.ghost ? "ghost" : ""}" data-action="transition" data-id="${r.id}" data-to="${a.to}">${a.label}</button>`).join("")}</div>` : ""}
      ${theirs.length ? `<div class="box demo"><p class="small"><strong>Mode démo</strong> · à faire par ${esc(other.name)} :</p>${theirs.map((a) => `<button class="btn ghost sm" data-action="transition" data-id="${r.id}" data-to="${a.to}">${a.label}</button>`).join("")}</div>` : ""}
      <a class="btn ghost" href="#/messages/${r.id}">${icon("chat", 18)} Écrire à ${esc(other.name.split(" ")[0])}</a>
      ${r.status === "terminee" && amRenter && !r.review ? reviewForm(r.id) : ""}
      ${r.review ? `<div class="box"><p class="small muted">Avis laissé</p><p>${"★".repeat(r.review.rating)}${"☆".repeat(5 - r.review.rating)}</p><p>${esc(r.review.text)}</p></div>` : ""}
    </div>`,
    mount() {
      const f = document.getElementById("review-form");
      if (f) f.addEventListener("submit", (e) => {
        e.preventDefault();
        const fd = new FormData(f);
        if (!fd.get("rating")) { toast("Choisis une note"); return; }
        S.review(r.id, Number(fd.get("rating")), fd.get("text") || "");
        toast("Merci pour ton avis !");
        route();
      });
    }
  };
}

function reviewForm(rid) {
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
        const i = S.item(r.itemId) || { title: "Pièce supprimée" };
        return `<a class="conv" href="#/messages/${r.id}"><span class="avatar">${initials(other.name)}</span>
          <span class="grow"><strong>${esc(other.name)}</strong> <span class="muted small">· ${esc(i.title)}</span>
          <span class="muted small ellipsis block">${last.from === "system" ? "" : last.from === S.me().id ? "Toi : " : ""}${esc(last.text)}</span></span>${icon("chevron", 16)}</a>`;
      }).join("")}</div>` : empty("Pas encore de messages", "Une conversation s'ouvre avec chaque réservation.")}
    </div>`
  };
}

function thread(rid) {
  const r = S.reservation(rid);
  if (!r) return { html: empty("Conversation introuvable", "", `<a class="btn" href="#/messages">Retour</a>`) };
  const other = S.user(r.renterId === S.me().id ? r.ownerId : r.renterId);
  const i = S.item(r.itemId) || { title: "Pièce supprimée" };
  const msgs = S.messages(rid);
  return {
    tab: "messages", title: other.name,
    html: `<div class="thread">
      <header class="thread-head"><a class="icon-btn" href="#/messages" aria-label="Retour">${icon("back", 20)}</a><span class="avatar">${initials(other.name)}</span>
        <a class="grow plain" href="#/location/${r.id}"><strong>${esc(other.name)}</strong><span class="muted small block">${esc(i.title)} · ${fmtShort(r.start)} → ${fmtShort(r.end)}</span></a></header>
      <div class="bubbles" id="bubbles">${msgs.map((m) => m.from === "system" ? `<p class="sys">${esc(m.text)}</p>` : `<p class="bubble ${m.from === S.me().id ? "me" : ""}">${esc(m.text)}</p>`).join("")}
        ${["confirmee"].includes(r.status) ? `<p class="tip">${icon("camera", 16)} À la remise, faites ensemble l'état des lieux photo : il protège la caution.</p>` : ""}</div>
      <form class="composer" id="composer"><label class="grow"><span class="sr">Écrire un message</span><input name="t" placeholder="Écrire un message…" autocomplete="off" maxlength="1000"></label>
        <button class="icon-btn solid" aria-label="Envoyer">${icon("send", 20)}</button></form>
    </div>`,
    mount() {
      const b = document.getElementById("bubbles");
      b.scrollTop = b.scrollHeight;
      window.scrollTo(0, document.body.scrollHeight);
      document.getElementById("composer").addEventListener("submit", (e) => {
        e.preventDefault();
        const t = e.target.t.value.trim();
        if (!t) return;
        S.sendMessage(rid, t);
        route(true);
      });
    }
  };
}

// ---------------------------------------------------------------- Profil
function profil() {
  const u = S.me();
  const received = S.myLendings().filter((r) => r.review);
  const plans = { base: "Base", premium: "Premium", pro: "Pro", partenaire: "Partenaire" };
  return {
    tab: "profil", title: "Mon profil",
    html: `<div class="page">
      <div class="row gap"><span class="avatar xl">${initials(u.name)}</span>
        <div class="grow"><h1 class="h1 inline">${esc(u.name)}</h1><div class="muted small">${esc(u.city)}${u.verified ? " · identité vérifiée" : ""}</div></div>
        <span class="pill tone-ok solid">${plans[u.plan]}</span></div>
      <div class="box center rating">
        <div class="score">${u.rating.toFixed(1).replace(".", ",")}</div><div class="accent" aria-label="Note de ${u.rating} sur 5">★★★★★</div>
        <div class="muted small">${u.reviews} avis</div>
        <div class="crit"><div><span class="muted small">Propreté</span><strong>5,0</strong></div><div><span class="muted small">Conformité</span><strong>4,9</strong></div><div><span class="muted small">Ponctualité</span><strong>4,8</strong></div></div>
      </div>
      ${received.map((r) => `<div class="box"><div class="row between small"><strong>${esc(S.user(r.renterId).name)}</strong><span class="muted">${"★".repeat(r.review.rating)}</span></div><p>${esc(r.review.text)}</p></div>`).join("")}
      <nav class="box list menu" aria-label="Mon compte">
        <a href="#/favoris"><span>Mes favoris</span><span class="muted">${S.favorites().length} ${icon("chevron", 16)}</span></a>
        <button data-action="earnings"><span>Mes gains</span><span class="muted">${euro(S.earnings())} ${icon("chevron", 16)}</span></button>
        <button data-action="plans"><span>Mon abonnement</span><span class="muted">${plans[u.plan]} ${icon("chevron", 16)}</span></button>
        <button data-action="edit-profile"><span>Modifier mon profil</span><span class="muted">${icon("chevron", 16)}</span></button>
        <button data-action="reset"><span>Réinitialiser la démo</span><span class="muted">${icon("chevron", 16)}</span></button>
      </nav>
      <p class="muted small center">Aïlo v0.1 · version de démonstration : les données restent sur cet appareil et aucun paiement n'est réel.</p>
    </div>
    <dialog id="sheet" class="sheet"></dialog>`
  };
}

function openSheet(html) {
  const s = document.getElementById("sheet");
  s.innerHTML = `<form method="dialog">${html}<div class="sheet-actions"><button class="btn">Fermer</button></div></form>`;
  s.showModal();
}

// ---------------------------------------------------------------- Actions (délégation)
const actions = {
  back: () => back("#/"),
  fav(el) { S.toggleFav(el.dataset.id); route(true); },
  group(el) { ui.groupBy = el.dataset.k; route(true); },
  occasion(el) { ui.filters.occasion = ui.filters.occasion === el.dataset.o ? "" : el.dataset.o; route(true); },
  "open-filters"() {
    const dlg = document.getElementById("filters");
    const form = document.getElementById("filters-form");
    form.maxPrice.addEventListener("input", () => { document.getElementById("pv").textContent = form.maxPrice.value >= 50 ? "sans limite" : euro(form.maxPrice.value); });
    dlg.addEventListener("close", () => {
      if (dlg.returnValue !== "apply") return;
      const fd = new FormData(form);
      for (const k of ["category", "style", "color", "size", "maxKm", "date", "sort"]) ui.filters[k] = fd.get(k) || "";
      ui.filters.maxPrice = Number(fd.get("maxPrice")) >= 50 ? "" : fd.get("maxPrice");
      route();
    }, { once: true });
    dlg.showModal();
  },
  "clear-filters"() {
    ui.filters = { q: "", category: "", style: "", color: "", size: "", occasion: "", maxPrice: "", maxKm: "", date: "", sort: "km" };
    const dlg = document.getElementById("filters");
    if (dlg && dlg.open) dlg.close("cancel");
    route();
  },
  dur(el) { ui.booking[el.dataset.id].durationId = el.dataset.d; view.querySelectorAll("[data-action=dur]").forEach((b) => b.setAttribute("aria-pressed", b === el)); updateBooking(el.dataset.id); },
  book(el) {
    const id = el.dataset.id, b = ui.booking[id];
    const res = S.book(id, b.durationId, b.start, b.cleaning);
    if (res.error) { toast(res.error); return; }
    delete ui.booking[id];
    ui.locTab = "prends";
    toast(res.reservation.status === "confirmee" ? "Réservation confirmée !" : "Demande envoyée à la loueuse");
    go(`#/location/${res.reservation.id}`);
  },
  "dress-filter"(el) { ui.dressFilter = el.dataset.c; route(true); },
  "tab-loue"() { ui.locTab = "loue"; },
  "loc-tab"(el) { ui.locTab = el.dataset.k; route(true); },
  "rm-photo"(el) { ui.draft.photos.splice(Number(el.dataset.k), 1); document.getElementById("photo-strip").innerHTML = photoStrip(ui.draft); },
  suggest() {
    const buy = Number(document.getElementById("buy").value);
    if (!buy) { toast("Indique le prix d'achat"); return; }
    const f = document.getElementById("item-form");
    const r5 = (n) => Math.max(5, Math.round(n));
    f["p-we"].value = r5(buy * 0.13); f["p-sem"].value = r5(buy * 0.2); f["p-deux"].value = r5(buy * 0.3);
    f.deposit.value = Math.round(buy * 0.5 / 5) * 5;
    syncDraft(f);
    toast("Prix suggérés : ajuste-les si besoin");
  },
  "cancel-form"() { ui.draft = null; back("#/dressing"); },
  pause(el) { const i = S.item(el.dataset.id); S.setItemStatus(i.id, i.status === "paused" ? "online" : "paused"); ui.draft = null; toast(i.status === "paused" ? "Pièce en pause : elle n'apparaît plus" : "Pièce remise en ligne"); go("#/dressing"); },
  delete(el) {
    const active = S.myLendings().some((r) => r.itemId === el.dataset.id && ["demandee", "confirmee", "remise", "rendue"].includes(r.status));
    if (active) { toast("Impossible : une location est en cours sur cette pièce."); return; }
    if (!confirm("Supprimer définitivement cette pièce ?")) return;
    S.deleteItem(el.dataset.id); ui.draft = null; toast("Pièce supprimée"); go("#/dressing");
  },
  transition(el) { S.transition(el.dataset.id, el.dataset.to); toast(STATUS[el.dataset.to].label); route(true); },
  earnings() {
    const list = S.myLendings().filter((r) => ["confirmee", "remise", "rendue", "terminee"].includes(r.status));
    openSheet(`<h2 class="h2">Mes gains</h2><p class="muted small">Montants nets, après la commission de ${COMMISSION_RATE * 100} %. Versés après chaque retour contrôlé.</p>
      <div class="box list">${list.map((r) => `<div class="li"><span>${esc((S.item(r.itemId) || {}).title || "—")} <span class="muted small">${fmtShort(r.start)}</span></span><span>${euro(S.payoutFor(r))}</span></div>`).join("") || '<p class="muted">Aucune location pour l\'instant.</p>'}
      <div class="li total"><span>Total</span><span>${euro(S.earnings())}</span></div></div>`);
  },
  plans() {
    openSheet(`<h2 class="h2">Abonnements</h2><p class="muted small">Contenu à définir — proposition.</p>
      <div class="plans">
        <div class="box"><strong>Base · gratuit</strong><p class="small">Publier et louer. Commission de ${COMMISSION_RATE * 100} % par location.</p></div>
        <div class="box accent-border"><strong>Premium</strong><p class="small">Statistiques de ce qui se loue, badge qualité, annonces en haut de page.</p></div>
        <div class="box"><strong>Pro</strong><p class="small">Pour les professionnelles : badge Pro, annonces illimitées, page vitrine.</p></div>
      </div>`);
  },
  "edit-profile"() {
    const u = S.me();
    openSheet(`<h2 class="h2">Mon profil</h2>
      <label class="field"><span>Prénom et initiale</span><input id="pf-name" value="${esc(u.name)}" maxlength="30"></label>
      <label class="field"><span>Commune</span><input id="pf-city" value="${esc(u.city)}" maxlength="40"></label>`);
    document.getElementById("sheet").addEventListener("close", () => {
      const n = document.getElementById("pf-name").value.trim(), c = document.getElementById("pf-city").value.trim();
      if (n && c) { S.updateMe({ name: n, city: c }); route(); }
    }, { once: true });
  },
  reset() { if (confirm("Remettre les données de démonstration ? Tes ajouts seront effacés.")) { S.resetDemo(); ui.draft = null; toast("Démo réinitialisée"); go("#/"); route(); } }
};

document.addEventListener("click", (e) => {
  const el = e.target.closest("[data-action]");
  if (!el || !actions[el.dataset.action]) return;
  if (el.tagName === "A" && el.dataset.action !== "tab-loue") e.preventDefault();
  actions[el.dataset.action](el, e);
});

// Champs de la fiche (date, nettoyage) et ajout de photos
document.addEventListener("change", async (e) => {
  const t = e.target;
  if (t.id === "start") { const id = location.hash.split("/")[2]; ui.booking[id].start = t.value; updateBooking(id); }
  if (t.name === "clean") { const id = location.hash.split("/")[2]; ui.booking[id].cleaning = t.value; updateBooking(id); }
  if (t.id === "photo-input") {
    const files = [...t.files].slice(0, 8 - ui.draft.photos.length);
    for (const f of files) {
      try { ui.draft.photos.push(await resizeImage(f)); } catch (err) { toast("Photo illisible : " + f.name); }
    }
    document.getElementById("photo-strip").innerHTML = photoStrip(ui.draft);
  }
});

// ---------------------------------------------------------------- Démarrage
route();
if ("serviceWorker" in navigator && location.protocol === "https:") {
  navigator.serviceWorker.register("sw.js").catch(() => {});
}
