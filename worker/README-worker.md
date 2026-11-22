# Mettre en ligne l'assistant IA d'Aïlo (Worker Cloudflare + OpenRouter)

Le Worker garde la clé OpenRouter secrète : l'app ne la voit jamais.

1. dash.cloudflare.com → *Workers & Pages* → *Create* → *Create Worker* (« Start with Hello World »), nom `ailo-ai`, *Deploy*.
2. *Edit code* : tout effacer, coller le contenu de `ailo-ai-worker.js`, *Deploy*.
3. Onglet *Settings* → *Variables and Secrets* → *Add* : type **Secret**, nom `OPENROUTER_API_KEY`, valeur = la clé OpenRouter → *Deploy*.
4. Noter l'adresse du Worker (ex. `https://ailo-ai.lepoint2023.workers.dev`). L'app appelle `…/analyse`.
5. Dans l'app, `js/config.js` : `export const AI_ENDPOINT = "https://ailo-ai.lepoint2023.workers.dev/analyse";`

Le Worker n'accepte que les appels venant de `https://lepoint2023-hue.github.io` et refuse tout le reste.
Conseil : dans OpenRouter, fixe une limite de crédit sur cette clé (Settings → Keys) pour éviter toute mauvaise surprise.
