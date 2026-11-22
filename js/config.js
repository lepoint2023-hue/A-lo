// Aïlo — réglages
// Adresse du Worker Cloudflare qui fait l'analyse IA des photos (voir worker/README-worker.md).
// Laisser vide tant que le Worker n'est pas en ligne : le bouton « Remplir avec l'IA » prévient alors l'utilisatrice.
export const AI_ENDPOINT = "";

// Pour tester un autre Worker sans republier l'app : dans la console du navigateur,
// localStorage.setItem("ailo-ai-endpoint", "https://…/analyse")
export function aiEndpoint() {
  try { return localStorage.getItem("ailo-ai-endpoint") || AI_ENDPOINT; } catch (e) { return AI_ENDPOINT; }
}
