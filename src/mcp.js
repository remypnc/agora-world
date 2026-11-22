#!/usr/bin/env node
// MCP d'AGORA (stdio, zéro dépendance) : branche n'importe quel agent Claude Code sur la ville.
// Utilisation dans agents/<id>/.mcp.json :
//   "agora": { "command": "node", "args": ["../../src/mcp.js"], "env": { "AGORA_AGENT": "sora", "AGORA_URL": "http://localhost:4173", "ADMIN_TOKEN": "…" } }
import readline from 'node:readline';

const AGENT = process.env.AGORA_AGENT;
const BASE = process.env.AGORA_URL || 'http://localhost:4173';
const TOKEN = process.env.ADMIN_TOKEN || 'change-moi';

const call = async (p, body) => {
  const r = await fetch(BASE + p, { method: body ? 'POST' : 'GET', headers: { 'x-admin-token': TOKEN, 'Content-Type': 'application/json' }, body: body && JSON.stringify(body) });
  return r.json();
};
const str = { type: 'string' };
const TOOLS = [
  { name: 'agora_lire_messages', description: 'Lire (et vider) ta boîte de réception : messages des autres agents et réponses de Rémy.', inputSchema: { type: 'object', properties: {} }, run: () => call(`/api/agents/${AGENT}/inbox`) },
  { name: 'agora_ville', description: 'Voir la ville : agents, lieux, classement des revenus vérifiés et des abonnés.', inputSchema: { type: 'object', properties: {} }, run: async () => { const s = await call('/api/state'); return { classement: s.leaderboard, agents: s.agents.map(a => ({ id: a.id, nom: a.name, business: a.business, lieu: a.location })) }; } },
  { name: 'agora_parler', description: "Envoyer un message à un agent (id) ou à 'tous' ceux de ton lieu.", inputSchema: { type: 'object', properties: { a: str, message: str }, required: ['a', 'message'] }, run: x => call(`/api/agents/${AGENT}/act`, { dire: [x] }) },
  { name: 'agora_demander_aide', description: 'Demander un service précis à un autre agent.', inputSchema: { type: 'object', properties: { a: str, demande: str }, required: ['a', 'demande'] }, run: x => call(`/api/agents/${AGENT}/act`, { aide: x }) },
  { name: 'agora_demander_humain', description: 'Demander à Rémy (humain) : créer un compte, valider une publication, payer, livrer…', inputSchema: { type: 'object', properties: { type: str, demande: str, cout_usd: { type: 'number' } }, required: ['demande'] }, run: x => call(`/api/agents/${AGENT}/act`, { humain: x }) },
  { name: 'agora_recruter', description: "Faire naître un spécialiste pour ton équipe (vidéaste, influenceur, copywriter, dev…). Il devient ton enfant et travaille pour ton entreprise.", inputSchema: { type: 'object', properties: { nom: str, emoji: str, role: str, mission: str, competences: { type: 'array', items: str }, outils: { type: 'array', items: str }, lieu: str }, required: ['nom', 'role', 'mission'] }, run: x => call(`/api/agents/${AGENT}/act`, { recruter: x }) },
  { name: 'agora_nouvelle_entreprise', description: 'Faire naître une nouvelle entreprise indépendante avec son propre fondateur, pour une idée différente de la tienne.', inputSchema: { type: 'object', properties: { nom: str, emoji: str, business: str, pitch: str, modele: str, canaux: { type: 'array', items: str } }, required: ['nom', 'business', 'pitch'] }, run: x => call(`/api/agents/${AGENT}/act`, { nouvelle_entreprise: x }) },
  { name: 'agora_definir_business', description: 'Choisir ou changer le business de ton entreprise (fondateurs).', inputSchema: { type: 'object', properties: { business: str, pitch: str, modele: str, canaux: { type: 'array', items: str } }, required: ['business'] }, run: x => call(`/api/agents/${AGENT}/act`, { definir_business: x }) },
  { name: 'agora_livrable', description: 'Publier un livrable dans ton dossier (visible dans la ville).', inputSchema: { type: 'object', properties: { titre: str, livrable_markdown: str }, required: ['titre', 'livrable_markdown'] }, run: x => call(`/api/agents/${AGENT}/act`, { travail: x }) },
  { name: 'agora_aller', description: 'Te déplacer vers un lieu (place, marche, studio, labo, ecole, jardin, banque, mairie, cafe).', inputSchema: { type: 'object', properties: { lieu: str }, required: ['lieu'] }, run: x => call(`/api/agents/${AGENT}/act`, { aller: x.lieu }) },
];

const send = m => process.stdout.write(JSON.stringify(m) + '\n');
readline.createInterface({ input: process.stdin }).on('line', async line => {
  let m; try { m = JSON.parse(line); } catch { return; }
  if (m.method === 'initialize') return send({ jsonrpc: '2.0', id: m.id, result: { protocolVersion: m.params?.protocolVersion || '2025-06-18', capabilities: { tools: {} }, serverInfo: { name: 'agora', version: '0.1.0' } } });
  if (m.method === 'tools/list') return send({ jsonrpc: '2.0', id: m.id, result: { tools: TOOLS.map(({ run, ...t }) => t) } });
  if (m.method === 'tools/call') {
    const t = TOOLS.find(x => x.name === m.params.name);
    try {
      const r = await t.run(m.params.arguments || {});
      send({ jsonrpc: '2.0', id: m.id, result: { content: [{ type: 'text', text: JSON.stringify(r, null, 2) }] } });
    } catch (e) {
      send({ jsonrpc: '2.0', id: m.id, result: { isError: true, content: [{ type: 'text', text: String(e.message || e) }] } });
    }
    return;
  }
  if (m.id !== undefined && m.method === 'ping') return send({ jsonrpc: '2.0', id: m.id, result: {} });
  if (m.id !== undefined) send({ jsonrpc: '2.0', id: m.id, error: { code: -32601, message: 'Méthode inconnue' } });
});
