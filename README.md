# Aïlo — application de location de tenues (v0.1)

Application web installable (PWA) pour louer entre particuliers des vêtements d'occasion pour un événement.
Nom provisoire. Projet NDdigitalconnect.

## Ce que fait la v0.1

- **Découvrir** : recherche, filtres (catégorie, style, couleur, taille, date, prix, distance, tri), raccourcis par occasion, affichage par catégorie, thématique ou profil, favoris.
- **Fiche vêtement** : prix dégressif (week-end, 1 semaine, 2 semaines), date de remise avec contrôle des disponibilités (+ 2 jours de lavage), option nettoyage (rendu propre ou forfait), caution, réservation instantanée ou sur demande.
- **Mon dressing** : publication d'une pièce (photos réduites automatiquement, listes imposées, prix suggérés à partir du prix d'achat), modification, pause, suppression.
- **Mes locations** : « Je prends » / « Je loue », suivi étape par étape (demandée → confirmée → en cours → rendue → terminée), calendrier, détail du paiement et de la commission (15 %), avis.
- **Messages** : une conversation par réservation.
- **Profil** : note, avis reçus, gains, abonnements (proposition), réinitialisation de la démo.

**Limite importante** : c'est une version de démonstration. Les données restent dans le navigateur de chaque appareil (localStorage), il n'y a ni vrais comptes ni vrais paiements. Un « mode démo » permet de jouer aussi le rôle de l'autre personne pour tester tout le parcours.

## Mettre en ligne sur GitHub Pages

1. Dans le dépôt GitHub, déposer **tout le contenu de ce dossier à la racine** (`index.html` doit être à la racine).
2. *Settings* → *Pages* → *Build and deployment* : *Deploy from a branch*, branche `main`, dossier `/ (root)`.
3. Attendre une à deux minutes : l'app est sur `https://lepoint2023-hue.github.io/<nom-du-dépôt>/`.
4. Sur téléphone, ouvrir le lien puis « Ajouter à l'écran d'accueil ».

À chaque nouvelle version, changer `VERSION` dans `sw.js` pour que les téléphones récupèrent la mise à jour.

## Structure

```
index.html              coquille de l'app + barre d'onglets
css/styles.css          styles (ivoire, vert sapin, Playfair Display + DM Sans)
js/data.js              listes imposées, constantes (commission, durées) et données de démo
js/store.js             couche de données : SEUL fichier à remplacer pour brancher Supabase
js/ui.js                outils d'affichage (prix, dates, icônes, photos, calendrier)
js/app.js               écrans, navigation et actions
sw.js                   fonctionnement hors connexion
manifest.webmanifest    installation sur téléphone
icons/                  icônes de l'app
```

## Étapes suivantes

1. **Supabase** (gratuit au départ) : comptes (e-mail ou Google), base de données (pièces, réservations, messages, avis), stockage des photos. On remplace `js/store.js` sans toucher aux écrans.
2. **Stripe Connect** en mode test : paiement carte et Bancontact, commission prélevée automatiquement, caution débitée puis remboursée, vérification d'identité des loueuses.
3. Notifications (e-mail, puis push), état des lieux photo, modération.
