// Aïlo — localisation
// Liste des codes postaux belges avec coordonnées (data/places.json, d'après bpost et © contributeurs OpenStreetMap).
// On ne garde jamais l'adresse exacte : seulement la commune, pour afficher une distance approximative.

let places = null;

export async function loadPlaces() {
  if (places) return places;
  const res = await fetch("data/places.json");
  places = (await res.json()).map(([zip, city, lat, lng]) => ({ zip, city, lat, lng, key: norm(zip + " " + city) }));
  return places;
}

const norm = (s) => s.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[-']/g, " ");

export async function searchPlaces(q, limit = 8) {
  const list = await loadPlaces();
  const n = norm(q.trim());
  if (n.length < 2) return [];
  const starts = list.filter((p) => norm(p.city).startsWith(n) || p.zip.startsWith(n));
  const contains = starts.length < limit ? list.filter((p) => !starts.includes(p) && p.key.includes(n)) : [];
  return starts.concat(contains).slice(0, limit);
}

export async function nearestPlace(lat, lng) {
  const list = await loadPlaces();
  let best = null, bd = Infinity;
  for (const p of list) {
    const d = distanceKm(lat, lng, p.lat, p.lng);
    if (d < bd) { bd = d; best = p; }
  }
  return best;
}

export function distanceKm(lat1, lng1, lat2, lng2) {
  if ([lat1, lng1, lat2, lng2].some((v) => typeof v !== "number")) return null;
  const R = 6371, rad = Math.PI / 180;
  const dLat = (lat2 - lat1) * rad, dLng = (lng2 - lng1) * rad;
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(lat1 * rad) * Math.cos(lat2 * rad) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(a));
}

// Distance affichée : arrondie, jamais en dessous de 1 km (pour ne pas trahir une adresse)
export function kmLabel(d) {
  if (d === null || d === undefined) return "";
  if (d < 1.5) return "< 2 km";
  return Math.round(d) + " km";
}

export function currentPosition() {
  return new Promise((resolve, reject) => {
    if (!("geolocation" in navigator)) return reject(new Error("unsupported"));
    navigator.geolocation.getCurrentPosition((p) => resolve({ lat: p.coords.latitude, lng: p.coords.longitude }), reject, { enableHighAccuracy: false, timeout: 10000, maximumAge: 600000 });
  });
}
