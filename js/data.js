// Aïlo — référentiels, règles et données de démonstration
// Les listes ci-dessous sont imposées : la loueuse choisit, elle ne tape pas.

export const CATEGORIES = ["Robe", "Robe de mariée", "Costume", "Combinaison", "Jupe", "Haut", "Pantalon", "Veste", "Manteau", "Sac", "Accessoire", "Chaussures"];
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
export const OCCASIONS = ["Mariage", "Soirée", "Cocktail", "Gala", "Communion", "Baptême", "Tous les jours"];
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
