// Aïlo — réglages
// Adresse du Worker Cloudflare qui fait l'analyse IA des photos (voir worker/README-worker.md).
// Laisser vide tant que le Worker n'est pas en ligne : le bouton « Remplir avec l'IA » prévient alors l'utilisatrice.
export const AI_ENDPOINT = "https://ailo-ai.lepoint2023.workers.dev/analyse";

// Pour tester un autre Worker sans republier l'app : dans la console du navigateur,
// localStorage.setItem("ailo-ai-endpoint", "https://…/analyse")
export function aiEndpoint() {
  try { return localStorage.getItem("ailo-ai-endpoint") || AI_ENDPOINT; } catch (e) { return AI_ENDPOINT; }
}

// Supabase (comptes, données, photos) — projet « ailo-eu » (Francfort).
// La clé « publishable » est faite pour être publique : la sécurité repose sur les règles RLS de la base.
// (Ne jamais mettre ici la clé « secret ».)
export const SUPABASE_URL = "https://yiiwwnrayhestpozgckv.supabase.co";
export const SUPABASE_KEY = "sb_publishable_9j-HTpE7_Hxzxksu3t45FA_Sz1UFmUL";

// Étape « Demande acceptée, à payer » (migration 004 appliquée).
// Tant qu'elle n'est pas appliquée, une demande acceptée passe directement à « Confirmée ».
export const PAYMENT_STEP = true;
// Fonction serveur (notifications push, paiement Stripe)
export const FUNCTIONS_URL = SUPABASE_URL + "/functions/v1/ailo";
