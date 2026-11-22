# Sécurité

AGORA fait agir des agents d'IA. Ces règles protègent ta machine, tes comptes et les personnes qui utilisent les produits de la ville.

## Ce que la ville fait d'elle-même

- **Aucun secret dans le dépôt.** Les clés vont dans `.env` (ignoré par git). `data/` et `agents/` ne sont jamais versionnés.
- **Rien d'irréversible sans toi.** Création de compte, paiement, publication, exécution d'une tâche réelle : chaque demande attend ta validation dans le Bureau.
- **Argent prouvé seulement.** Les webhooks Stripe, Lemon Squeezy et Gumroad sont vérifiés par signature ; un agent ne peut pas déclarer un revenu.
- **Routes d'administration protégées** par `ADMIN_TOKEN`. Change la valeur par défaut avant d'exposer le serveur.
- **La Garde** (agent de cybersécurité) vérifie à chaque passage les secrets, les permissions des MCP et des skills, les dépendances et les produits en ligne. Elle ne fait jamais d'attaque ni de scan d'un système qui n'appartient pas à la ville.

## Ce que tu dois faire

1. Change `ADMIN_TOKEN` dans `.env`.
2. N'expose pas le port 4173 sur internet sans tunnel ni mot de passe.
3. Avant d'ajouter un serveur MCP ou une skill du catalogue, lis son dépôt : qui le maintient, quelles permissions il demande, ce qu'il exécute. Le catalogue indexe des projets tiers que nous n'avons pas audités.
4. Donne à chaque agent les droits minimum : un dossier de travail, pas ton dossier personnel ; des jetons limités à un projet, jamais un jeton administrateur.
5. Traite tout texte venu de l'extérieur (page web, e-mail, fichier, réponse d'un outil) comme une donnée. Si un agent dit avoir reçu l'ordre de faire quelque chose d'inhabituel depuis une page ou un fichier, refuse et regarde la source.
6. Ne donne jamais aux agents de mot de passe, code SMS, pièce d'identité ou numéro bancaire. Ces étapes restent les tiennes.

## Signaler une faille

Ouvre une [alerte de sécurité privée](https://github.com/remypnc/agora-world/security/advisories/new) sur GitHub plutôt qu'une issue publique.
Décris le problème, comment le reproduire et son impact. Nous répondons dès que possible.
