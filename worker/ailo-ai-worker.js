// Aïlo — Worker Cloudflare « analyse IA des photos »
// Reçoit 1 à 3 photos d'un vêtement et renvoie une proposition de fiche
// (catégorie, style, couleur, taille, marque, occasions, titre, description),
// toujours dans les listes imposées de l'app.
//
// Variable secrète à définir dans Cloudflare : OPENROUTER_API_KEY
// Routes : POST /analyse   corps JSON : { "images": ["data:image/jpeg;base64,...", ...] }
//          POST /moderer   corps JSON : { "images": [...], "text": "titre + description" }
//                          → { "ok": true|false, "clothing": bool, "explicit": bool, "reason": "..." }

const ALLOWED_ORIGINS = ["https://lepoint2023-hue.github.io"];
// Modèle OpenRouter qui lit les images, rapide et bon marché. Pour en changer : openrouter.ai/models (filtre « image » en entrée).
const MODEL = "google/gemini-3.1-flash-lite";
const MAX_BODY = 4_000_000; // ~4 Mo : 3 photos réduites par l'app passent largement

const LISTS = {
  category: ["Robe", "Robe de mariée", "Costume", "Combinaison", "Jupe", "Haut", "Pantalon", "Veste", "Manteau", "Sac", "Accessoire", "Chaussures"],
  style: ["Chic", "Classique", "Bohème", "Glamour", "Vintage", "Minimaliste", "Rock"],
  color: ["Noir", "Blanc", "Écru", "Beige", "Camel", "Marron", "Gris", "Rouge", "Bordeaux", "Rose", "Orange", "Jaune", "Vert", "Kaki", "Bleu", "Marine", "Turquoise", "Violet", "Doré", "Argenté", "Multicolore"],
  size: ["XS", "S", "M", "L", "XL", "34", "36", "38", "40", "42", "44", "46", "48", "50", "52", "Unique"],
  occasions: ["Mariage", "Soirée", "Cocktail", "Gala", "Communion", "Baptême", "Tous les jours"]
};

const SYSTEM = `Tu aides une particulière à publier un vêtement à louer sur Aïlo, une app belge de location de tenues pour des événements.
Analyse les photos et réponds UNIQUEMENT avec un objet JSON de cette forme :
{"category": "...", "style": "...", "color": "...", "pattern": "... ou null", "size": "... ou null", "brand": "... ou null", "occasions": ["..."], "title": "...", "description": "...", "estimatedValue": nombre ou null}
Règles :
- category parmi : ${LISTS.category.join(", ")}.
- style parmi : ${LISTS.style.join(", ")}.
- color parmi : ${LISTS.color.join(", ")} (la couleur dominante ; Multicolore si aucune ne domine).
- pattern : motif ou précision en 2 à 4 mots si la pièce n'est pas unie (ex. « imprimé léopard », « rayures marinières », « fleurs ») ; null si unie.
- size parmi : ${LISTS.size.join(", ")}, UNIQUEMENT si elle est lisible sur une étiquette ; sinon null.
- brand UNIQUEMENT si elle est lisible sur une étiquette ou un logo ; sinon null. N'invente jamais.
- occasions : 1 à 3 valeurs parmi : ${LISTS.occasions.join(", ")}.
- title : 3 à 6 mots en français, sans la marque (ex. « Robe longue satinée »).
- description : 1 à 2 phrases en français, factuelles (coupe, matière apparente, détails visibles). Pas de superlatifs, pas d'état d'usure supposé.
- estimatedValue : prix d'achat neuf approximatif en euros (nombre entier), estimé d'après le type de pièce et la marque si elle est lisible ; null si tu ne peux pas estimer.`;

const MODERATION = `Tu es la modératrice d'Aïlo, une app belge où des particulières louent UNIQUEMENT des vêtements et accessoires de mode.
On te donne les photos et le texte d'une annonce. Réponds UNIQUEMENT avec un objet JSON :
{"clothing": true ou false, "explicit": true ou false, "reason": "une courte phrase en français"}
- clothing = true si l'annonce propose un vêtement, des chaussures, un sac ou un accessoire de mode (bijou, chapeau, ceinture, foulard, nœud papillon…), porté ou non, sur cintre, mannequin ou à plat. Une photo d'étiquette ou de détail d'un vêtement compte aussi.
- clothing = false pour tout autre objet ou service (meuble, instrument de musique, véhicule, électronique, décoration, animal, nourriture, logement…), ou si aucune photo ni aucun texte ne montre un vêtement.
- explicit = true en cas de nudité, de contenu sexuel ou suggestif, de violence, d'arme ou de symbole haineux, sur une photo ou dans le texte.
- reason : explique ta décision en une phrase simple, adressée à la personne qui publie.`;

async function askModel(env, system, userText, images, maxTokens) {
  const r = await fetch("https://openrouter.ai/api/v1/chat/completions", {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${env.OPENROUTER_API_KEY}`,
      "Content-Type": "application/json",
      "HTTP-Referer": "https://lepoint2023-hue.github.io/A-lo/",
      "X-Title": "Ailo"
    },
    body: JSON.stringify({
      model: MODEL, temperature: 0, max_tokens: maxTokens, response_format: { type: "json_object" },
      messages: [
        { role: "system", content: system },
        { role: "user", content: [{ type: "text", text: userText }, ...images.map((u) => ({ type: "image_url", image_url: { url: u } }))] }
      ]
    })
  });
  if (!r.ok) throw new Error("IA " + r.status);
  const data = await r.json();
  const txt = data.choices[0].message.content || "";
  return JSON.parse((txt.match(/\{[\s\S]*\}/) || [txt])[0]);
}

export default {
  async fetch(request, env) {
    const origin = request.headers.get("Origin") || "";
    const allowed = ALLOWED_ORIGINS.includes(origin);
    const cors = {
      "Access-Control-Allow-Origin": allowed ? origin : ALLOWED_ORIGINS[0],
      "Access-Control-Allow-Methods": "POST, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type",
      "Vary": "Origin"
    };
    if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: cors });

    const url = new URL(request.url);
    if (request.method !== "POST" || !["/analyse", "/moderer"].includes(url.pathname)) return json({ error: "Introuvable" }, 404, cors);
    if (!allowed) return json({ error: "Origine non autorisée" }, 403, cors);
    if (Number(request.headers.get("Content-Length") || 0) > MAX_BODY) return json({ error: "Photos trop lourdes" }, 413, cors);
    if (!env.OPENROUTER_API_KEY) return json({ error: "Clé IA manquante sur le serveur" }, 500, cors);

    let body;
    try { body = await request.json(); } catch { return json({ error: "Requête illisible" }, 400, cors); }
    const images = (Array.isArray(body.images) ? body.images : [])
      .filter((s) => typeof s === "string" && /^data:image\/(jpeg|png|webp);base64,/.test(s))
      .slice(0, url.pathname === "/moderer" ? 4 : 3);

    if (url.pathname === "/moderer") {
      const text = typeof body.text === "string" ? body.text.slice(0, 800) : "";
      if (!images.length && !text.trim()) return json({ error: "Rien à vérifier" }, 400, cors);
      try {
        const m = await askModel(env, MODERATION, "Annonce : " + (text || "(pas de texte)"), images, 120);
        const clothing = m.clothing !== false, explicit = m.explicit === true;
        return json({ ok: clothing && !explicit, clothing, explicit, reason: typeof m.reason === "string" ? m.reason.slice(0, 200) : "" }, 200, cors);
      } catch {
        return json({ error: "Vérification indisponible" }, 502, cors);
      }
    }
    if (!images.length) return json({ error: "Aucune photo" }, 400, cors);

    let ai;
    try {
      const r = await fetch("https://openrouter.ai/api/v1/chat/completions", {
        method: "POST",
        headers: {
          "Authorization": `Bearer ${env.OPENROUTER_API_KEY}`,
          "Content-Type": "application/json",
          "HTTP-Referer": "https://lepoint2023-hue.github.io/A-lo/",
          "X-Title": "Ailo"
        },
        body: JSON.stringify({
          model: MODEL,
          temperature: 0.2,
          max_tokens: 400,
          response_format: { type: "json_object" },
          messages: [
            { role: "system", content: SYSTEM },
            { role: "user", content: [{ type: "text", text: "Voici les photos du vêtement." }, ...images.map((u) => ({ type: "image_url", image_url: { url: u } }))] }
          ]
        })
      });
      if (!r.ok) return json({ error: "IA indisponible", status: r.status }, 502, cors);
      const data = await r.json();
      const txt = data.choices[0].message.content || "";
      ai = JSON.parse((txt.match(/\{[\s\S]*\}/) || [txt])[0]); // tolère un JSON entouré de texte
    } catch {
      return json({ error: "Réponse IA illisible" }, 502, cors);
    }
    return json(clean(ai), 200, cors);
  }
};

// Ne renvoie que des valeurs autorisées : l'app ne doit jamais recevoir n'importe quoi
export function clean(a = {}) {
  const pick = (v, list) => (typeof v === "string" && list.includes(v.trim()) ? v.trim() : null);
  const text = (v, max) => (typeof v === "string" && v.trim() ? v.trim().slice(0, max) : null);
  return {
    category: pick(a.category, LISTS.category),
    style: pick(a.style, LISTS.style),
    color: pick(a.color, LISTS.color),
    size: pick(a.size, LISTS.size),
    brand: text(a.brand, 40),
    pattern: text(a.pattern, 60),
    occasions: Array.isArray(a.occasions) ? a.occasions.filter((o) => LISTS.occasions.includes(o)).slice(0, 3) : [],
    title: text(a.title, 60),
    description: text(a.description, 500),
    estimatedValue: Number.isFinite(Number(a.estimatedValue)) && Number(a.estimatedValue) > 0 ? Math.min(5000, Math.round(Number(a.estimatedValue))) : null
  };
}

function json(obj, status, headers) {
  return new Response(JSON.stringify(obj), { status, headers: { ...headers, "Content-Type": "application/json; charset=utf-8" } });
}
