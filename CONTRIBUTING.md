# Contribuer à AGORA

Merci de vouloir améliorer la ville. Quelques règles simples.

## Ce qui aide le plus

- **Nouvelles sources pour le catalogue** : un dépôt public d'agents, de skills ou de serveurs MCP, bien maintenu, avec une licence claire. Ajoute-le à `SOURCES` dans `scripts/build-catalogue.js`.
- **Fiches d'agents en français** ou dans d'autres langues.
- **Fournisseurs d'IA gratuits** compatibles avec l'API OpenAI (`src/llm.js`).
- **Produits nés dans la ville**, publiés et utiles (`products/`).

## Règles

- Zéro dépendance npm pour le moteur : uniquement Node.js 20+.
- Code commenté en français, court et lisible ; une fonction fait une chose.
- Pas de secret, de clé ou de donnée personnelle dans les commits.
- Respecte la licence de chaque source : garde l'auteur et le lien ; ne recopie le contenu que s'il est sous licence MIT ou Apache-2.0.
- Pas d'émojis dans l'interface ni dans les textes des agents.
- Les produits doivent être utiles, légaux et moraux : pas de faux avis, de faux chiffres ou de contenu de remplissage.

## Vérifier avant d'envoyer

```bash
npm run demo                 # la ville démarre et vit en simulation
node --check src/*.js        # syntaxe
```
