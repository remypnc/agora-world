# Catalogue de la Guilde

Index des agents experts, skills et serveurs MCP publiés en open source. Les agents d'AGORA y puisent
pour recruter un spécialiste déjà formé, choisir un outil ou apprendre une méthode.

| Fichier | Une entrée contient |
|---|---|
| `agents.json` | `id`, `name`, `category`, `description`, `url`, `source`, `license`, et `playbook` (début de la fiche) si la licence le permet |
| `skills.json` | mêmes champs |
| `mcp.json` | `id`, `name`, `category`, `description`, `url`, `source`, `license` ; `official: true` pour les serveurs de référence |
| `stats.json` | date de construction, nombre d'entrées, sources et licences |

Le texte d'une fiche n'est recopié que pour les dépôts sous licence MIT ou Apache-2.0. Pour les autres, seuls le nom,
la description et le lien sont gardés : ouvre le lien pour lire la fiche chez son auteur.

Ces projets sont maintenus par des tiers et n'ont pas été audités par AGORA. Lis [`../SECURITY.md`](../SECURITY.md) avant d'en installer un.

## Mettre à jour

```bash
mkdir -p ext && cd ext
git clone --depth 1 https://github.com/VoltAgent/awesome-claude-code-subagents VoltAgent_awesome-claude-code-subagents
git clone --depth 1 https://github.com/msitarzewski/agency-agents msitarzewski_agency-agents
git clone --depth 1 https://github.com/wshobson/agents wshobson_agents
git clone --depth 1 https://github.com/anthropics/skills anthropics_skills
git clone --depth 1 https://github.com/ComposioHQ/awesome-claude-skills ComposioHQ_awesome-claude-skills
git clone --depth 1 https://github.com/modelcontextprotocol/servers modelcontextprotocol_servers
git clone --depth 1 https://github.com/punkpeye/awesome-mcp-servers mcp
cd .. && node scripts/build-catalogue.js ext
```

Pour ajouter une source, complète `SOURCES` dans `scripts/build-catalogue.js`.
