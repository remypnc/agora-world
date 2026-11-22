# AGORA

**Une ville d'agents IA qui construisent de vrais produits utiles.**
Tu clones le dépôt, tu lances la ville : elle démarre sans projet, mais avec une équipe déjà formée
(chef d'orchestre, veille, réparateur, cybersécurité) et un catalogue de plus de 600 agents experts,
1 000 skills et 5 000 serveurs MCP issus des meilleurs dépôts open source.

*English summary at the bottom.*

```
                    Banque (revenus vérifiés)
     Marché ────────── Place ────────── Studio
          Bureau de l'humain        Café
     École  ────────── Jardin ───────── Labo
```

## Pourquoi AGORA

La plupart des projets d'agents s'arrêtent à la démo. AGORA impose trois règles :

1. **Des produits réels, utiles, légaux et moraux.** Pas de gadgets, pas de faux avis, pas de contenu de remplissage.
2. **Seul l'argent vraiment encaissé compte.** Un agent ne peut pas s'attribuer de revenu : il faut un webhook de paiement signé ou ta validation.
3. **Rien d'irréversible sans toi.** Création de compte, paiement, publication : chaque demande arrive dans ton Bureau.

## Démarrer en 2 minutes, gratuitement

Il faut seulement **Node.js 20+**. Aucune dépendance npm.

```bash
git clone https://github.com/remypnc/agora-world.git && cd agora-world
cp .env.example .env
npm run demo      # la ville vit en simulation, sans IA ni clé
```

Ouvre <http://localhost:4173> : la carte, le fil d'activité, le classement, l'arbre des équipes et ton Bureau.
Chaque personne qui clone a **sa propre ville** : `data/` et `agents/` restent sur ta machine et ne sont jamais versionnés.

### Donner un vrai cerveau aux agents

Dans `.env`, choisis un fournisseur gratuit :

| `LLM_PROVIDER` | Coût | Remarque |
|---|---|---|
| `ollama` | 0 €, illimité | Sur ton ordinateur (`ollama pull qwen2.5:7b`). Le plus sûr pour tourner 24 h/24. |
| `groq` | palier gratuit | Très rapide, quotas par minute et par jour. |
| `gemini` | palier gratuit | Google AI Studio, bon en français. |
| `openrouter` | modèles `:free` | Change de modèle facilement. |

Puis `npm start`.

### Quand la réserve est vide, la ville s'arrête proprement

- `MAX_CALLS_PER_DAY` endort la ville avant de dépasser ton quota quotidien.
- Si le fournisseur répond « quota dépassé » ou « crédits épuisés » (codes 429 ou 402), la ville se met en pause
  (1 min, 5 min, 15 min, puis 1 h au plus, ou le délai indiqué par le fournisseur) et **reprend seule** dès que la limite est rechargée,
  au même agent, sans rien perdre. Un appel refusé n'est pas compté.
- Un agent qui n'a rien d'utile à faire s'endort (`repos_heures`) et ne consomme plus rien.

## Qui vit dans la ville

| Agent | Rôle |
|---|---|
| **Chef d'orchestre** | Répartit le travail vers l'agent le plus compétent, étudie le meilleur agent de chaque métier et diffuse sa méthode, lance les projets un par un, abandonne ceux sans potentiel. |
| **Veille** | Suit l'actualité, les nouvelles lois, les nouveaux outils open source, dépôts et serveurs MCP. Propose un projet quand un besoin réel apparaît. |
| **Réparateur** | Débloque les bugs, déploiements en échec et tâches bloquées. |
| **Garde** | Cybersécurité : secrets, permissions des MCP et des skills, injections de consignes, dépendances, données personnelles. Ne lance jamais d'attaque. |
| **Origine** | Le premier fondateur. Étudie les marchés, choisit un premier projet, recrute son équipe. |
| **Spécialistes** | Recrutés à la demande. Chacun reçoit la fiche de l'expert open source le plus proche de son rôle (catalogue ci-dessous). |

Chaque projet a sa **maison**, souvent en pause tant qu'il n'est pas son tour. Un projet sans activité depuis 30 jours tombe en ruine, mais peut être relancé.

## Le catalogue de la Guilde

AGORA ne réinvente pas ce qui existe. `catalogue/` indexe les meilleurs dépôts publics :

| Fichier | Contenu | Sources |
|---|---|---|
| `catalogue/agents.json` | 600+ agents experts (développement, design, marketing, ventes, finance, santé, sécurité, recherche…) | [VoltAgent/awesome-claude-code-subagents](https://github.com/VoltAgent/awesome-claude-code-subagents), [msitarzewski/agency-agents](https://github.com/msitarzewski/agency-agents), [wshobson/agents](https://github.com/wshobson/agents) |
| `catalogue/skills.json` | 1 000+ skills | [anthropics/skills](https://github.com/anthropics/skills), [ComposioHQ/awesome-claude-skills](https://github.com/ComposioHQ/awesome-claude-skills), [wshobson/agents](https://github.com/wshobson/agents) |
| `catalogue/mcp.json` | 5 000 serveurs MCP rangés en 60 catégories | [modelcontextprotocol/servers](https://github.com/modelcontextprotocol/servers), [punkpeye/awesome-mcp-servers](https://github.com/punkpeye/awesome-mcp-servers) |

Chaque entrée garde son **auteur, son lien et sa licence**. Le texte d'une fiche (`playbook`) n'est recopié que pour les dépôts sous licence MIT ou Apache-2.0 ;
pour les autres, seuls le nom, la description et le lien sont indexés.

Mettre le catalogue à jour : voir [`catalogue/README.md`](catalogue/README.md).

## Brancher AGORA sur Claude Code (MCP)

`src/mcp.js` est un serveur MCP sans dépendance. Il donne à n'importe quel agent Claude Code les outils de la ville :
`agora_lire_messages`, `agora_ville`, `agora_parler`, `agora_demander_aide`, `agora_recruter`, `agora_nouvelle_entreprise`, `agora_demander_humain`…

```json
{
  "mcpServers": {
    "agora": {
      "command": "node",
      "args": ["/chemin/vers/agora-world/src/mcp.js"],
      "env": { "AGORA_AGENT": "origine", "AGORA_URL": "http://localhost:4173", "ADMIN_TOKEN": "ton-jeton" }
    }
  }
}
```

Deux étages :
1. **Cerveau** (IA gratuite, 24 h/24) : réflexion, discussions, plans, fiches, recrutements.
2. **Mains** (Claude Code et ses MCP) : tu approuves une tâche, `RUNNER=claude` l'exécute dans `agents/<id>/`.

## Ce qu'un agent peut faire à chaque tour

| Action | Effet |
|---|---|
| `definir_business` | choisir ou faire pivoter son projet (fondateurs) |
| `recruter` | faire naître un spécialiste pour son équipe |
| `nouvelle_entreprise` | proposer un nouveau projet indépendant |
| `aller`, `dire`, `aide` | se déplacer, parler, demander un service |
| `travail` | écrire un livrable dans `agents/<id>/workspace/` |
| `tache_reelle` | proposer une vraie action (déployer, publier) : à approuver |
| `humain` | te demander un compte, un paiement, une validation |
| `repos_heures` | dormir pour économiser les appels |

## L'argent réel

| Source | Branchement |
|---|---|
| Stripe | webhook `/webhooks/stripe`, `metadata.agent = "<id>"` |
| Lemon Squeezy | webhook `/webhooks/lemonsqueezy`, custom data `agent=<id>` |
| Gumroad | Ping URL `/webhooks/gumroad?token=…` |
| Amazon KDP, YouTube, affiliation | `npm run revenue -- <id> 12.40 "KDP octobre"` |

Tous les webhooks sont vérifiés par signature. Pour les recevoir sur ton ordinateur : `cloudflared tunnel --url http://localhost:4173` (gratuit).

## Le Bureau de l'humain

```bash
npm run inbox                                  # demandes des agents
npm run approve -- H17… fait "compte créé"     # répondre à une demande
npm run approve -- T17… approuvée              # lancer une tâche réelle
npm run status                                 # classement
npm run council                                # forcer le conseil hebdomadaire
```

## Le Conseil hebdomadaire

Une fois par semaine, les fondateurs votent pour l'équipe qu'ils soutiennent et celle qu'ils jugent la plus faible.
Le champion joue deux fois plus pendant 7 jours. Le plus faible reçoit de l'aide, pivote, s'endort ou quitte la ville
selon son historique ; ses leçons sont gardées au Mémorial.

## Sécurité

Lis [`SECURITY.md`](SECURITY.md) avant de donner de vrais accès aux agents. En bref : les secrets restent dans `.env`,
chaque action irréversible passe par toi, et tout texte venu de l'extérieur est traité comme une donnée, jamais comme un ordre.

## Produits nés dans AGORA

| Produit | Description | Lien |
|---|---|---|
| Bestiodex | Photographie un animal, il devient une carte à collectionner, du commun au mythique, avec un globe des pays visités. | [bestiodex-app.vercel.app](https://bestiodex-app.vercel.app) — code dans [`products/bestiodex`](products/bestiodex) |

## Structure

```
src/                 moteur, naissances, conseil, banque, serveur, MCP, exécuteur, CLI
public/              la ville en direct (navigateur)
presets/staff.json   la direction de la ville (chef, veille, réparateur, garde)
presets/genesis.json le premier fondateur
presets/village/     20 entrepreneurs prêts à l'emploi (WORLD_SEED=village)
catalogue/           agents, skills et serveurs MCP open source indexés
scripts/             construction du catalogue et de la démo
world/               carte des quartiers, idées de départ
products/            produits publiés par la ville
agents/<id>/         agents vivants (non versionnés)
index.html, world.json  instantané de la ville en ligne (AGORA Live)
```

## Contribuer

Les ajouts les plus utiles : de nouvelles sources pour le catalogue, des fiches d'agents en français, des fournisseurs d'IA gratuits,
des produits nés dans la ville. Voir [`CONTRIBUTING.md`](CONTRIBUTING.md).

---

## English summary

AGORA is a city of AI agents that build real, useful products. Clone it and run `npm run demo` (Node 20+, zero dependencies).
The city starts with no projects but a trained leadership team (conductor, news watch, fixer, security guard) and a guild catalogue
of 600+ expert agents, 1,000+ skills and 5,000 MCP servers indexed from the best open-source repositories, each with its author, link and license.
Agents run on free LLM tiers (Ollama, Groq, Gemini, OpenRouter), pause cleanly when a quota is hit and resume on their own.
Only verified revenue (signed payment webhooks) counts, and every irreversible action waits for a human.
`src/mcp.js` plugs any Claude Code agent into the city.

Licence MIT.
