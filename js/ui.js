// Aïlo — petits outils d'affichage partagés

export const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

export function euro(n) {
  const v = Number(n) || 0;
  return v.toLocaleString("fr-BE", { minimumFractionDigits: v % 1 ? 2 : 0, maximumFractionDigits: 2 }) + " €";
}

const d = (iso) => new Date(iso.slice(0, 10) + "T12:00:00");
export const fmtDate = (iso) => d(iso).toLocaleDateString("fr-BE", { weekday: "short", day: "numeric", month: "short" });
export const fmtShort = (iso) => d(iso).toLocaleDateString("fr-BE", { day: "numeric", month: "short" });
export const today = () => new Date().toISOString().slice(0, 10);
export const initials = (name) => name.split(/\s+/).map((p) => p[0]).join("").slice(0, 2).toUpperCase();

export const ICONS = {
  home: '<path d="M3 10.5 12 3l9 7.5V21h-6v-6H9v6H3z"/>',
  hanger: '<path d="M12 6a2 2 0 1 1 2 2c-1 .4-2 1-2 2v1M12 11 3.6 17.4c-.8.6-.4 1.6.6 1.6h15.6c1 0 1.4-1 .6-1.6L12 11"/>',
  calendar: '<rect x="3" y="5" width="18" height="16" rx="2"/><path d="M3 10h18M8 3v4M16 3v4"/>',
  chat: '<path d="M4 5h16v11H9l-5 4z"/>',
  user: '<circle cx="12" cy="8" r="4"/><path d="M4 21c1.5-4 4.5-6 8-6s6.5 2 8 6"/>',
  heart: '<path d="M12 20s-7-4.4-7-10a4 4 0 0 1 7-2.6A4 4 0 0 1 19 10c0 5.6-7 10-7 10z"/>',
  search: '<circle cx="11" cy="11" r="7"/><path d="M20 20l-4-4"/>',
  filter: '<path d="M4 6h16M7 12h10M10 18h4"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  back: '<path d="M15 5l-7 7 7 7"/>',
  chevron: '<path d="M9 5l7 7-7 7"/>',
  send: '<path d="M4 12l16-8-6 16-2-6z"/>',
  camera: '<rect x="3" y="7" width="18" height="13" rx="2"/><circle cx="12" cy="13.5" r="3.5"/><path d="M8 7l2-3h4l2 3"/>',
  bolt: '<path d="M13 3 5 14h6l-1 7 8-11h-6z"/>',
  close: '<path d="M6 6l12 12M18 6 6 18"/>',
  check: '<path d="M5 12.5l4.5 4.5L19 7.5"/>',
  shop: '<path d="M4 9l1.5-5h13L20 9M4 9v11h16V9M4 9h16M9 20v-6h6v6"/>'
};
export const icon = (name, size = 22, extra = "") =>
  `<svg aria-hidden="true" width="${size}" height="${size}" viewBox="0 0 24 24" fill="${name === "heart-fill" ? "currentColor" : "none"}" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" ${extra}>${ICONS[name === "heart-fill" ? "heart" : name]}</svg>`;

export function photo(itm, cls = "") {
  if (itm.photos && itm.photos.length) return `<img class="ph ${cls}" src="${itm.photos[0]}" alt="${esc(itm.title)}" loading="lazy">`;
  return `<div class="ph ph-empty ${cls}" style="background:${itm.tint}" role="img" aria-label="${esc(itm.title)} (pas encore de photo)">${icon("hanger", 40)}</div>`;
}

export function toast(msg) {
  const t = document.getElementById("toast");
  t.textContent = msg;
  t.classList.add("show");
  clearTimeout(toast._t);
  toast._t = setTimeout(() => t.classList.remove("show"), 3200);
}

// Réduit une photo avant de l'enregistrer (max 1000 px, JPEG)
export function resizeImage(file, max = 1000) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    const url = URL.createObjectURL(file);
    img.onload = () => {
      const k = Math.min(1, max / Math.max(img.width, img.height));
      const c = document.createElement("canvas");
      c.width = Math.round(img.width * k);
      c.height = Math.round(img.height * k);
      c.getContext("2d").drawImage(img, 0, 0, c.width, c.height);
      URL.revokeObjectURL(url);
      resolve(c.toDataURL("image/jpeg", 0.78));
    };
    img.onerror = reject;
    img.src = url;
  });
}

// Mini-calendrier d'un mois, avec des plages surlignées
export function calendar(monthIso, ranges) {
  const first = d(monthIso.slice(0, 7) + "-01");
  const year = first.getFullYear(), month = first.getMonth();
  const daysIn = new Date(year, month + 1, 0).getDate();
  const lead = (first.getDay() + 6) % 7; // lundi = 0
  const title = first.toLocaleDateString("fr-BE", { month: "long", year: "numeric" });
  let cells = "";
  for (let i = 0; i < lead; i++) cells += "<span></span>";
  for (let n = 1; n <= daysIn; n++) {
    const iso = `${year}-${String(month + 1).padStart(2, "0")}-${String(n).padStart(2, "0")}`;
    let cls = "";
    for (const r of ranges) {
      if (iso === r.start || iso === r.end) cls = `edge ${r.kind || ""}`;
      else if (iso > r.start && iso < r.end && !cls) cls = `mid ${r.kind || ""}`;
    }
    if (iso === today()) cls += " today";
    cells += `<span class="${cls}">${n}</span>`;
  }
  return `<div class="cal"><div class="cal-title">${title}</div><div class="cal-grid"><b>L</b><b>M</b><b>M</b><b>J</b><b>V</b><b>S</b><b>D</b>${cells}</div></div>`;
}
