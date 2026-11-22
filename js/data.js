// Aïlo — référentiels, règles et données de démonstration
// Les listes ci-dessous sont imposées : la loueuse choisit, elle ne tape pas.

export const CATEGORIES = ["Robe", "Costume", "Combinaison", "Jupe", "Haut", "Pantalon", "Veste", "Manteau", "Sac", "Accessoire", "Chaussures"];
export const STYLES = ["Chic", "Classique", "Bohème", "Glamour", "Vintage", "Minimaliste", "Rock"];
export const COLORS = [
  { name: "Noir", hex: "#1F1F1D" },
  { name: "Blanc", hex: "#FFFFFF" },
  { name: "Écru", hex: "#F3EBDA" },
  { name: "Beige", hex: "#E3D5C0" },
  { name: "Camel", hex: "#C19A6B" },
  { name: "Marron", hex: "#6F4E37" },
  { name: "Gris", hex: "#9A9A9A" },
  { name: "Rouge", hex: "#B3312C" },
  { name: "Bordeaux", hex: "#6D1A2A" },
  { name: "Rose", hex: "#E3A9B5" },
  { name: "Orange", hex: "#E07B39" },
  { name: "Jaune", hex: "#E8C547" },
  { name: "Vert", hex: "#2F6B4F" },
  { name: "Kaki", hex: "#7A7A4B" },
  { name: "Bleu", hex: "#4A78B5" },
  { name: "Marine", hex: "#1F2E4D" },
  { name: "Turquoise", hex: "#3AAFA9" },
  { name: "Violet", hex: "#7A5C99" },
  { name: "Doré", hex: "#C9A54C" },
  { name: "Argenté", hex: "#B8BCC2" },
  { name: "Multicolore", hex: "conic-gradient(#B3312C, #E8C547, #2F6B4F, #4A78B5, #7A5C99, #B3312C)" }
];
export const SIZES = ["XS", "S", "M", "L", "XL", "34", "36", "38", "40", "42", "44", "46", "48", "50", "52", "Unique"];
export const OCCASIONS = ["Mariage", "Soirée", "Bal", "Communion", "Cocktail", "Gala", "Baptême"];
export const CONDITIONS = ["Neuf avec étiquette", "Neuf sans étiquette", "Comme neuf", "Très bon état", "Bon état"];
export const CONDITION_HINTS = {
  "Neuf avec étiquette": "Jamais portée, étiquette encore attachée",
  "Neuf sans étiquette": "Jamais portée, sans étiquette",
  "Comme neuf": "Portée une ou deux fois, aucun signe d'usure",
  "Très bon état": "Portée quelques fois, très légers signes d'usure",
  "Bon état": "Portée, petits signes d'usure visibles : décris-les dans « Défauts »"
};

// Durées proposées. La loueuse remplit le prix de celles qu'elle accepte :
// une durée sans prix n'est pas proposée (c'est ainsi qu'elle fixe sa durée minimale et maximale).
export const DURATIONS = [
  { id: "we", label: "Week-end", days: 3 },
  { id: "sem", label: "1 semaine", days: 7 },
  { id: "deux", label: "2 semaines", days: 14 },
  { id: "mois", label: "1 mois", days: 30 }
];

// ---- Argent (proposition, à ajuster) ----
export const COMMISSION_RATE = 0.15;      // prélevée sur la part de la loueuse
export const SERVICE_FEE = { fixed: 1, rate: 0.05 }; // frais de service payés par la locataire : 1 € + 5 % de la location
export const SHIPPING_FEE = 12;           // forfait envoi aller-retour, un seul par colis (étiquette retour incluse)
export const SHIPPING_MIN = 30;           // location minimale pour un envoi (plusieurs pièces de la même loueuse s'additionnent)

// ---- Calendrier ----
export const BUFFER_DAYS = 2;   // jours bloqués après un retour (lavage, contrôle)
export const SHIPPING_DAYS = 2; // jours de transport bloqués avant la remise et après le retour
export const DEFAULT_RADIUS = 30; // km

export const HANDOVER = { main: "Main propre", envoi: "Envoi", both: "Main propre ou envoi" };

export const STATUS = {
  demandee: { label: "Demandée", tone: "wait" },
  confirmee: { label: "Confirmée", tone: "ok" },
  remise: { label: "En cours", tone: "ok" },
  rendue: { label: "Rendue", tone: "info" },
  terminee: { label: "Terminée", tone: "done" },
  refusee: { label: "Refusée", tone: "off" },
  annulee: { label: "Annulée", tone: "off" },
  litige: { label: "Litige", tone: "warn" }
};

const TINTS = ["#DCC7C4", "#C9D3CC", "#D6D2E0", "#E8DCCB", "#CFC7BD", "#E5D9D0", "#D2DAD6", "#E2D3D8", "#D9D4C7", "#C7D0DA"];
export const tintFor = (i) => TINTS[Math.abs(i) % TINTS.length];

export function addDays(iso, n) {
  const d = new Date(iso + "T12:00:00");
  d.setDate(d.getDate() + n);
  return d.toISOString().slice(0, 10);
}

export function demoData() {
  const today = new Date().toISOString().slice(0, 10);
  const place = (zip, city, lat, lng) => ({ zip, city, lat, lng });
  const users = {
    u1: Object.assign({ id: "u1", name: "", plan: "premium", type: "particuliere", rating: 4.9, reviews: 23, verified: false, acceptedTerms: false, photo: "" }, place("6800", "Libramont-Chevigny", 49.9197, 5.3824)),
    u2: Object.assign({ id: "u2", name: "Sarah L.", plan: "base", type: "particuliere", rating: 4.9, reviews: 23, verified: true }, place("6600", "Bastogne", 50.001, 5.7153)),
    u3: Object.assign({ id: "u3", name: "Thomas M.", plan: "base", type: "particuliere", rating: 4.7, reviews: 9, verified: true }, place("6870", "Saint-Hubert", 50.0251, 5.3739)),
    u4: Object.assign({ id: "u4", name: "Boutique partenaire", plan: "partenaire", type: "boutique", rating: 5.0, reviews: 41, verified: true }, place("6600", "Bastogne", 50.001, 5.7153)),
    u5: Object.assign({ id: "u5", name: "Camille R.", plan: "pro", type: "pro", rating: 4.8, reviews: 15, verified: true }, place("6900", "Marche-en-Famenne", 50.2241, 5.3429)),
    u6: Object.assign({ id: "u6", name: "Laura V.", plan: "base", type: "particuliere", rating: 4.6, reviews: 4, verified: true }, place("6680", "Sainte-Ode", 50.0363, 5.5245))
  };
  const mk = (id, ownerId, o) => Object.assign({
    id, ownerId, photos: [], tint: tintFor(Number(id.slice(1))), description: "", defects: "",
    condition: "Très bon état", handover: "both", instant: false, cleaningFee: 8, cleaningRequired: false,
    unavailable: [], status: "online", createdAt: today
  }, o);
  const items = [
    mk("i1", "u2", { title: "Robe longue satinée", category: "Robe", style: "Chic", color: "Vert", size: "38", occasions: ["Mariage", "Gala"], prices: { we: 20, sem: 30, deux: 45, mois: "" }, deposit: 75, brand: "Mango", description: "Robe longue en satin vert émeraude, fendue sur le côté. Portée deux fois." }),
    mk("i2", "u3", { title: "Costume trois pièces", category: "Costume", style: "Classique", color: "Bleu", size: "50", occasions: ["Mariage", "Communion"], prices: { we: 25, sem: 38, deux: 55, mois: 80 }, deposit: 100, brand: "Suitsupply", description: "Costume bleu nuit, veste, gilet et pantalon. Coupe ajustée.", instant: true }),
    mk("i3", "u4", { title: "Robe cocktail à sequins", category: "Robe", style: "Glamour", color: "Doré", size: "36", occasions: ["Soirée", "Cocktail", "Gala"], prices: { we: 18, sem: 27, deux: 40, mois: "" }, deposit: 60, brand: "", description: "Robe courte à sequins dorés, doublée.", cleaningRequired: true, instant: true, condition: "Comme neuf" }),
    mk("i4", "u5", { title: "Combinaison fluide", category: "Combinaison", style: "Minimaliste", color: "Noir", size: "40", occasions: ["Soirée", "Cocktail"], prices: { we: 15, sem: 22, deux: 32, mois: 50 }, deposit: 50, brand: "& Other Stories", description: "Combinaison noire jambes larges, crêpe fluide.", condition: "Neuf sans étiquette", handover: "envoi" }),
    mk("i5", "u2", { title: "Robe bohème brodée", category: "Robe", style: "Bohème", color: "Blanc", size: "M", occasions: ["Baptême", "Communion", "Mariage"], prices: { we: 16, sem: 24, deux: 35, mois: "" }, deposit: 50, brand: "Sézane", description: "Robe midi blanche en coton brodé, manches ballon." }),
    mk("i6", "u4", { title: "Smoking noir", category: "Costume", style: "Chic", color: "Noir", size: "48", occasions: ["Gala", "Bal", "Soirée"], prices: { we: 30, sem: 45, deux: 65, mois: "" }, deposit: 120, brand: "", description: "Smoking col châle satin, pantalon à bande.", cleaningRequired: true }),
    mk("i7", "u3", { title: "Robe de bal rose poudré", category: "Robe", style: "Glamour", color: "Rose", size: "38", occasions: ["Bal", "Gala"], prices: { we: 28, sem: 40, deux: "", mois: "" }, deposit: 100, brand: "", description: "Robe longue en tulle rose poudré, bustier.", condition: "Comme neuf", handover: "main" }),
    mk("i8", "u5", { title: "Veste en velours vintage", category: "Veste", style: "Vintage", color: "Violet", size: "S", occasions: ["Soirée", "Cocktail"], prices: { we: 10, sem: 15, deux: 22, mois: 35 }, deposit: 35, brand: "", description: "Veste cintrée en velours prune, années 70.", condition: "Bon état", defects: "Légère usure aux poignets." }),
    mk("i9", "u4", { title: "Pochette perlée", category: "Sac", style: "Chic", color: "Argenté", size: "Unique", occasions: ["Mariage", "Soirée", "Gala"], prices: { we: 6, sem: 9, deux: 13, mois: "" }, deposit: 25, brand: "", description: "Petite pochette perlée argent avec chaîne.", condition: "Neuf avec étiquette" }),
    mk("i13", "u6", { title: "Manteau long camel", category: "Manteau", style: "Classique", color: "Beige", size: "38", occasions: ["Mariage", "Baptême"], prices: { we: 14, sem: 20, deux: 28, mois: 40 }, deposit: 60, brand: "Max Mara", description: "Manteau long en laine camel, col cranté.", condition: "Très bon état", handover: "main" }),
    mk("i10", "u1", { title: "Robe rouge drapée", category: "Robe", style: "Glamour", color: "Rouge", size: "38", occasions: ["Soirée", "Gala", "Mariage"], prices: { we: 22, sem: 32, deux: 48, mois: "" }, deposit: 80, brand: "Zara", description: "Robe longue drapée rouge, épaules dénudées." }),
    mk("i11", "u1", { title: "Jupe plissée dorée", category: "Jupe", style: "Chic", color: "Doré", size: "36", occasions: ["Cocktail", "Soirée"], prices: { we: 9, sem: 14, deux: 20, mois: "" }, deposit: 30, brand: "", description: "Jupe midi plissée effet métallisé.", status: "paused" }),
    mk("i12", "u1", { title: "Blazer beige oversize", category: "Veste", style: "Minimaliste", color: "Beige", size: "M", occasions: ["Communion", "Baptême"], prices: { we: 8, sem: 12, deux: 18, mois: 25 }, deposit: 30, brand: "", description: "Blazer beige oversize en laine mélangée.", instant: true })
  ];
  const R = (o) => Object.assign({ thread: o.id, handover: "main", shippingFee: 0, serviceFee: 0, creditUsed: 0, cleaningFee: 0, cleaning: "propre" }, o);
  const reservations = [
    R({ id: "r1", itemId: "i1", renterId: "u1", ownerId: "u2", durationId: "sem", start: addDays(today, 19), end: addDays(today, 26), price: 30, serviceFee: 2.5, deposit: 75, status: "confirmee", createdAt: today }),
    R({ id: "r2", itemId: "i10", renterId: "u5", ownerId: "u1", durationId: "we", start: addDays(today, 6), end: addDays(today, 9), cleaning: "forfait", handover: "envoi", shippingFee: 12, price: 22, cleaningFee: 8, serviceFee: 2.1, deposit: 80, status: "demandee", createdAt: today }),
    R({ id: "r3", itemId: "i12", renterId: "u3", ownerId: "u1", durationId: "sem", start: addDays(today, -20), end: addDays(today, -13), price: 12, serviceFee: 1.6, deposit: 30, status: "terminee", createdAt: addDays(today, -25), review: { rating: 5, text: "Blazer impeccable, remise très simple à Libramont." } })
  ];
  const messages = {
    r1: [
      { from: "system", text: "Réservation confirmée.", at: today },
      { from: "u2", text: "Bonjour ! Ta réservation est confirmée, la robe sera prête pour la remise.", at: today },
      { from: "u1", text: "Merci ! On peut se retrouver vers 18 h ?", at: today },
      { from: "u2", text: "Parfait. Je suis à Bastogne, près de la gare. Je t'envoie l'adresse exacte.", at: today }
    ],
    r2: [
      { from: "system", text: "Nouvelle demande de réservation", at: today },
      { from: "u5", text: "Bonjour ! Votre robe rouge serait parfaite pour un gala. Elle est toujours disponible ?", at: today }
    ]
  };
  return { version: 3, me: "u1", users, items, reservations, messages, favorites: ["i3"], creditUsed: 0, seq: 100 };
}
