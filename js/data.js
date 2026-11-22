// Aïlo — référentiels et données de démonstration
// Les listes ci-dessous sont imposées : la loueuse choisit, elle ne tape pas.

export const CATEGORIES = ["Robe", "Costume", "Combinaison", "Jupe", "Haut", "Pantalon", "Veste", "Accessoire", "Chaussures"];
export const STYLES = ["Chic", "Classique", "Bohème", "Glamour", "Vintage", "Minimaliste", "Rock"];
export const COLORS = [
  { name: "Noir", hex: "#1F1F1D" },
  { name: "Blanc", hex: "#FFFFFF" },
  { name: "Beige", hex: "#E3D5C0" },
  { name: "Rouge", hex: "#B3312C" },
  { name: "Rose", hex: "#E3A9B5" },
  { name: "Bleu", hex: "#2E4A7D" },
  { name: "Vert", hex: "#2F6B4F" },
  { name: "Violet", hex: "#7A5C99" },
  { name: "Doré", hex: "#C9A54C" },
  { name: "Argenté", hex: "#B8BCC2" }
];
export const SIZES = ["XS", "S", "M", "L", "XL", "34", "36", "38", "40", "42", "44", "46", "48", "50", "52", "Unique"];
export const OCCASIONS = ["Mariage", "Soirée", "Bal", "Communion", "Cocktail", "Gala", "Baptême"];
export const CONDITIONS = ["Neuf avec étiquette", "Très bon état", "Bon état"];
export const HANDOVER = { main: "Main propre", envoi: "Envoi", both: "Main propre ou envoi" };

export const DURATIONS = [
  { id: "we", label: "Week-end", days: 3, hint: "jusqu'à 4 jours" },
  { id: "sem", label: "1 semaine", days: 7, hint: "7 jours" },
  { id: "deux", label: "2 semaines", days: 14, hint: "14 jours" }
];

export const COMMISSION_RATE = 0.15; // part de la plateforme sur le prix de location
export const BUFFER_DAYS = 2; // jours bloqués après un retour (lavage, contrôle)

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

function addDays(iso, n) {
  const d = new Date(iso + "T12:00:00");
  d.setDate(d.getDate() + n);
  return d.toISOString().slice(0, 10);
}

export function demoData() {
  const today = new Date().toISOString().slice(0, 10);
  const users = {
    u1: { id: "u1", name: "Julie D.", city: "Libramont", km: 0, plan: "premium", type: "particuliere", rating: 4.9, reviews: 23, verified: true },
    u2: { id: "u2", name: "Sarah L.", city: "Bastogne", km: 4, plan: "base", type: "particuliere", rating: 4.9, reviews: 23, verified: true },
    u3: { id: "u3", name: "Thomas M.", city: "Saint-Hubert", km: 12, plan: "base", type: "particuliere", rating: 4.7, reviews: 9, verified: true },
    u4: { id: "u4", name: "Boutique partenaire", city: "Bastogne", km: 5, plan: "partenaire", type: "boutique", rating: 5.0, reviews: 41, verified: true },
    u5: { id: "u5", name: "Camille R.", city: "Marche-en-Famenne", km: 18, plan: "pro", type: "pro", rating: 4.8, reviews: 15, verified: true }
  };
  const mk = (id, ownerId, o) => Object.assign({
    id, ownerId, photos: [], tint: tintFor(Number(id.slice(1))), description: "",
    condition: "Très bon état", handover: "both", instant: false, cleaningFee: 8, cleaningRequired: false,
    status: "online", createdAt: today
  }, o);
  const items = [
    mk("i1", "u2", { title: "Robe longue satinée", category: "Robe", style: "Chic", color: "Vert", size: "38", occasions: ["Mariage", "Gala"], prices: { we: 20, sem: 30, deux: 45 }, deposit: 75, brand: "Mango", description: "Robe longue en satin vert émeraude, fendue sur le côté. Portée deux fois." }),
    mk("i2", "u3", { title: "Costume trois pièces", category: "Costume", style: "Classique", color: "Bleu", size: "50", occasions: ["Mariage", "Communion"], prices: { we: 25, sem: 38, deux: 55 }, deposit: 100, brand: "Suitsupply", description: "Costume bleu nuit, veste, gilet et pantalon. Coupe ajustée." , instant: true }),
    mk("i3", "u4", { title: "Robe cocktail à sequins", category: "Robe", style: "Glamour", color: "Doré", size: "36", occasions: ["Soirée", "Cocktail", "Gala"], prices: { we: 18, sem: 27, deux: 40 }, deposit: 60, brand: "", description: "Robe courte à sequins dorés, doublée.", cleaningRequired: true, instant: true }),
    mk("i4", "u5", { title: "Combinaison fluide", category: "Combinaison", style: "Minimaliste", color: "Noir", size: "40", occasions: ["Soirée", "Cocktail"], prices: { we: 15, sem: 22, deux: 32 }, deposit: 50, brand: "& Other Stories", description: "Combinaison noire jambes larges, crêpe fluide." }),
    mk("i5", "u2", { title: "Robe bohème brodée", category: "Robe", style: "Bohème", color: "Blanc", size: "M", occasions: ["Baptême", "Communion", "Mariage"], prices: { we: 16, sem: 24, deux: 35 }, deposit: 50, brand: "Sézane", description: "Robe midi blanche en coton brodé, manches ballon." }),
    mk("i6", "u4", { title: "Smoking noir", category: "Costume", style: "Chic", color: "Noir", size: "48", occasions: ["Gala", "Bal", "Soirée"], prices: { we: 30, sem: 45, deux: 65 }, deposit: 120, brand: "", description: "Smoking col châle satin, pantalon à bande.", cleaningRequired: true }),
    mk("i7", "u3", { title: "Robe de bal rose poudré", category: "Robe", style: "Glamour", color: "Rose", size: "38", occasions: ["Bal", "Gala"], prices: { we: 28, sem: 40, deux: 58 }, deposit: 100, brand: "", description: "Robe longue en tulle rose poudré, bustier." }),
    mk("i8", "u5", { title: "Veste en velours vintage", category: "Veste", style: "Vintage", color: "Violet", size: "S", occasions: ["Soirée", "Cocktail"], prices: { we: 10, sem: 15, deux: 22 }, deposit: 35, brand: "", description: "Veste cintrée en velours prune, années 70." }),
    mk("i9", "u4", { title: "Pochette perlée", category: "Accessoire", style: "Chic", color: "Argenté", size: "Unique", occasions: ["Mariage", "Soirée", "Gala"], prices: { we: 6, sem: 9, deux: 13 }, deposit: 25, brand: "", description: "Petite pochette perlée argent avec chaîne." }),
    mk("i10", "u1", { title: "Robe rouge drapée", category: "Robe", style: "Glamour", color: "Rouge", size: "38", occasions: ["Soirée", "Gala", "Mariage"], prices: { we: 22, sem: 32, deux: 48 }, deposit: 80, brand: "Zara", description: "Robe longue drapée rouge, épaules dénudées." }),
    mk("i11", "u1", { title: "Jupe plissée dorée", category: "Jupe", style: "Chic", color: "Doré", size: "36", occasions: ["Cocktail", "Soirée"], prices: { we: 9, sem: 14, deux: 20 }, deposit: 30, brand: "", description: "Jupe midi plissée effet métallisé.", status: "paused" }),
    mk("i12", "u1", { title: "Blazer beige oversize", category: "Veste", style: "Minimaliste", color: "Beige", size: "M", occasions: ["Communion", "Baptême"], prices: { we: 8, sem: 12, deux: 18 }, deposit: 30, brand: "", description: "Blazer beige oversize en laine mélangée.", instant: true })
  ];
  const reservations = [
    { id: "r1", itemId: "i1", renterId: "u1", ownerId: "u2", durationId: "sem", start: addDays(today, 19), end: addDays(today, 26), cleaning: "propre", price: 30, cleaningFee: 0, deposit: 75, status: "confirmee", createdAt: today },
    { id: "r2", itemId: "i10", renterId: "u5", ownerId: "u1", durationId: "we", start: addDays(today, 6), end: addDays(today, 9), cleaning: "forfait", price: 22, cleaningFee: 8, deposit: 80, status: "demandee", createdAt: today },
    { id: "r3", itemId: "i12", renterId: "u3", ownerId: "u1", durationId: "sem", start: addDays(today, -20), end: addDays(today, -13), cleaning: "propre", price: 12, cleaningFee: 0, deposit: 30, status: "terminee", createdAt: addDays(today, -25), review: { rating: 5, text: "Blazer impeccable, remise très simple à Libramont." } }
  ];
  const messages = {
    r1: [
      { from: "system", text: "Réservation confirmée · 30 € payés", at: today },
      { from: "u2", text: "Bonjour Julie ! Ta réservation est confirmée, la robe sera prête pour la remise.", at: today },
      { from: "u1", text: "Merci ! On peut se retrouver vers 18 h ?", at: today },
      { from: "u2", text: "Parfait. Je suis à Bastogne, près de la gare. Je t'envoie l'adresse exacte.", at: today }
    ],
    r2: [
      { from: "system", text: "Nouvelle demande de réservation", at: today },
      { from: "u5", text: "Bonjour ! Votre robe rouge serait parfaite pour un gala. Elle est toujours disponible ?", at: today }
    ]
  };
  return { version: 1, me: "u1", users, items, reservations, messages, favorites: ["i3"], seq: 100 };
}

export { addDays };
