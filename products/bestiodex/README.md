# Bestiodex

Photographie un animal : il devient une carte à collectionner, de « commun » à « mythique », avec son espèce, sa race,
la date et le lieu tirés des métadonnées de la photo. Plusieurs photos d'une même espèce se font glisser sur une seule carte ;
les espèces proches (plusieurs carpes, plusieurs chauves-souris) partagent une case qu'on ouvre pour voir chacune.
L'onglet Globe montre les pays où tu as photographié des animaux, avec rotation, zoom au doigt et recherche de pays.

En ligne : <https://bestiodex-app.vercel.app>

## Fonctionnement

- `index.html` : toute l'application (HTML, CSS, JS), collection gardée sur le téléphone (IndexedDB).
- `api/identify.js` : fonction Vercel qui envoie la photo réduite à un modèle de vision via Vercel AI Gateway (authentification OIDC, aucune clé dans le code). Limite : 12 photos par minute et par adresse.
- La consigne d'identification reste côté serveur. Le client envoie seulement l'image, la date, la position, le fuseau horaire et la liste des espèces déjà vues (pour garder les mêmes noms).

Diagnostic : `GET /api/identify?ping=1` vérifie la connexion au modèle.

## Déployer

Importe ce dossier dans Vercel (dossier racine `products/bestiodex`, aucun framework). Le modèle se change avec la variable `BESTIODEX_MODEL` (par défaut `google/gemini-2.5-flash`).
