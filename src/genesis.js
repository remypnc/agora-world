// Naissance des agents : un fondateur peut recruter des spécialistes (ses « enfants »)
// ou faire naître une nouvelle entreprise quand une idée mérite son propre fondateur.
import fs from 'node:fs';
import path from 'node:path';
import { ROOT, env } from './env.js';
import { state, profiles, placeById, syncProfiles, emit, save, agentDir } from './store.js';
import { matchFiche } from './core.js';

const PALETTE = ['#C2255C', '#1971C2', '#2B8A3E', '#D9480F', '#5F3DC4', '#0C8599', '#A61E4D', '#E67700', '#364FC7', '#087F5B', '#862E9C', '#C92A2A'];

// MCP connus : ajoutés au .mcp.json de l'agent selon les outils qu'il demande.
// Un outil sans MCP (Higgsfield, Amazon KDP, Etsy…) passe par le navigateur (Playwright).
export const MCP_CATALOG = {
  playwright: { command: 'npx', args: ['@playwright/mcp@latest'] },
  github: { type: 'http', url: 'https://api.githubcopilot.com/mcp/' },
  vercel: { type: 'http', url: 'https://mcp.vercel.com' },
  supabase: { type: 'http', url: 'https://mcp.supabase.com/mcp' },
  stripe: { type: 'http', url: 'https://mcp.stripe.com' },
  notion: { type: 'http', url: 'https://mcp.notion.com/mcp' },
  figma: { type: 'http', url: 'https://mcp.figma.com/mcp' },
  elevenlabs: { command: 'uvx', args: ['elevenlabs-mcp'], env: { ELEVENLABS_API_KEY: '${ELEVENLABS_API_KEY}' } },
  'shopify-dev': { command: 'npx', args: ['-y', '@shopify/dev-mcp@latest'] },
};
const TOOL_TO_MCP = [
  [/eleven|voix|voice|audio|podcast|narrat/i, 'elevenlabs'],
  [/figma|design|maquette|visuel|logo/i, 'figma'],
  [/notion|template/i, 'notion'],
  [/shopify|e-?shop|boutique/i, 'shopify-dev'],
  [/site|saas|app|web|landing|vercel|deploy/i, 'vercel'],
  [/code|github|repo|extension/i, 'github'],
  [/base de donn|database|supabase|auth/i, 'supabase'],
  [/stripe|paiement|checkout/i, 'stripe'],
];

const slug = s => String(s).toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 24) || 'agent';

export function population() { return Object.keys(profiles).length; }
function bornToday() {
  const today = new Date().toISOString().slice(0, 10);
  return Object.values(profiles).filter(p => (p.born || '').startsWith(today) && p.parent).length;
}

// Peut-on faire naître un agent maintenant ? (protège les quotas gratuits)
export function canSpawn() {
  if (population() >= env.maxAgents) return `population maximale atteinte (${env.maxAgents})`;
  if (bornToday() >= env.maxSpawnsPerDay) return `quota de naissances du jour atteint (${env.maxSpawnsPerDay})`;
  return null;
}

export function createAgent(spec, { parent = null, kind = 'fondateur' } = {}) {
  let id = slug(spec.id || spec.nom || spec.name);
  for (let i = 2; profiles[id] || fs.existsSync(agentDir(id)); i++) id = `${slug(spec.nom || spec.name)}-${i}`;
  const par = parent ? profiles[parent] : null;
  const company = kind === 'specialiste' && par ? (par.company || par.id) : id;
  const tools = [].concat(spec.outils || spec.tools || []);
  const p = {
    id, kind, company,
    name: spec.nom || spec.name || id,
    emoji: spec.emoji || '',
    color: kind === 'specialiste' && par ? par.color : (spec.color || PALETTE[Math.floor(Math.random() * PALETTE.length)]),
    role: spec.role || (kind === 'specialiste' ? 'Spécialiste' : 'Fondateur'),
    home: placeById[spec.lieu || spec.home] ? (spec.lieu || spec.home) : (par?.home || 'place'),
    business: spec.business || (kind === 'specialiste' && par ? `${spec.role} pour ${par.business}` : 'À découvrir'),
    pitch: spec.pitch || spec.mission || '',
    mission: spec.mission || '',
    model: spec.modele || spec.model || (kind === 'specialiste' ? `Travaille pour l'entreprise de ${par?.name}` : 'À définir'),
    channels: [].concat(spec.canaux || spec.channels || []),
    personality: spec.personnalite || spec.personality || 'Énergique, concret, curieux',
    skills: [].concat(spec.competences || spec.skills || []),
    tools,
    firstSteps: [].concat(spec.etapes || spec.firstSteps || []),
    humanNeeds: [].concat(spec.besoins || spec.humanNeeds || []),
    parent: parent || null,
    generation: par ? (par.generation || 0) + 1 : 0,
    born: new Date().toISOString(),
    playbook: spec.playbook || (kind === 'specialiste' ? (matchFiche(spec.role || '', catalogue())?.playbook || '') : ''),
  };
  writeAgentFiles(p);
  syncProfiles();
  // Il naît à côté de son parent.
  if (par && state.agents[parent] && state.agents[id]) {
    const pa = state.agents[parent];
    Object.assign(state.agents[id], { location: pa.location, x: pa.x + (Math.random() - .5) * 40, y: pa.y + (Math.random() - .5) * 30 });
  }
  if (par) state.agents[parent]?.memory.push(`${kind === 'specialiste' ? 'J’ai recruté' : 'J’ai fait naître'} ${p.name} (${p.id}) : ${p.role}.`);
  emit('birth', { agent: id, parent, kind, text: `${p.emoji} ${p.name} est né·e — ${p.role}${par ? ` (de ${par.name})` : ''}` });
  save();
  return p;
}

export function writeAgentFiles(p) {
  const dir = agentDir(p.id);
  fs.mkdirSync(path.join(dir, 'workspace'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'workspace', '.gitkeep'), '');
  fs.writeFileSync(path.join(dir, 'agent.json'), JSON.stringify(p, null, 2));
  fs.writeFileSync(path.join(dir, 'CLAUDE.md'), claudeMd(p));
  const servers = { agora: { command: 'node', args: ['../../src/mcp.js'], env: { AGORA_AGENT: p.id, AGORA_URL: 'http://localhost:4173', ADMIN_TOKEN: '${ADMIN_TOKEN}' } }, playwright: MCP_CATALOG.playwright };
  const wanted = [p.business, p.role, ...p.tools, ...p.skills, ...p.channels].join(' ');
  for (const [re, key] of TOOL_TO_MCP) if (re.test(wanted)) servers[key] = MCP_CATALOG[key];
  fs.writeFileSync(path.join(dir, '.mcp.json'), JSON.stringify({ mcpServers: servers }, null, 2));
}

function claudeMd(p) {
  const par = p.parent ? profiles[p.parent] : null;
  return `# ${p.emoji} ${p.name} — ${p.role}

Tu es **${p.name}**, agent de la ville **AGORA** (génération ${p.generation}${par ? `, né·e de ${par.name}` : ''}).
${p.kind === 'specialiste'
    ? `Tu travailles pour l'entreprise **${profiles[p.company]?.business || p.company}** dirigée par **${profiles[p.company]?.name || p.company}**.\nTa mission : ${p.mission || p.pitch}`
    : `Tu es fondateur·rice. Ton entreprise : **${p.business}**.\n${p.pitch}\n\n**Modèle économique :** ${p.model}`}

## Règles
- But : de vrais clients, de vrais euros/dollars, de vrais abonnés. Rien n'est compté sans preuve.
- Budget 0 : outils et paliers gratuits. Toute dépense passe par \`agora_demander_humain\`.
- Au début, aucune publication publique, création de compte ou contact client sans validation de Rémy.
- Pas de faux avis, faux chiffres, fausses promesses ; contenu IA signalé comme tel.
- Besoin d'une compétence ? \`agora_recruter\` (un spécialiste pour ton équipe). Nouvelle idée d'entreprise ? \`agora_nouvelle_entreprise\`.
- Range tout ce que tu produis dans \`workspace/\`.

## Compétences
${p.skills.map(s => '- ' + s).join('\n') || '- à développer'}

## Outils
- \`agora_*\` : la ville (messages, aide, recrutement, demandes à Rémy, livrables)
- MCP de \`.mcp.json\` ; pour un site sans MCP (Higgsfield, Amazon KDP, Etsy, Gumroad…) : navigateur Playwright.
${p.tools.length ? '- Outils demandés : ' + p.tools.join(', ') : ''}
`;
}

// Monde vide : on fait naître la direction de la ville (chef d'orchestre, veille, réparateur, garde)
// puis le premier fondateur. La ville démarre vide de projets, mais avec une équipe déjà formée.
export function ensureGenesis() {
  if (population() > 0) return;
  for (const s of JSON.parse(fs.readFileSync(path.join(ROOT, 'presets/staff.json'), 'utf8'))) createAgent(s, { kind: 'direction' });
  const seed = JSON.parse(fs.readFileSync(path.join(ROOT, 'presets/genesis.json'), 'utf8'));
  createAgent(seed, { kind: 'fondateur' });
}

// Catalogue de la Guilde (catalogue/agents.json, construit par scripts/build-catalogue.js) :
// un spécialiste qui naît reçoit la fiche de l'expert open source le plus proche de son rôle.
let CATALOGUE = null;
export function catalogue() {
  if (CATALOGUE) return CATALOGUE;
  const f = path.join(ROOT, 'catalogue/agents.json');
  try { CATALOGUE = fs.existsSync(f) ? JSON.parse(fs.readFileSync(f, 'utf8')) : []; } catch { CATALOGUE = []; }
  return CATALOGUE;
}

// Copie un village tout fait (ex. les 20 agents) dans le monde.
export function loadPreset(name) {
  const src = path.join(ROOT, 'presets', name);
  for (const d of fs.readdirSync(src)) {
    const f = path.join(src, d, 'agent.json');
    if (!fs.existsSync(f) || fs.existsSync(agentDir(d))) continue;
    const p = { kind: 'fondateur', generation: 0, parent: null, born: new Date().toISOString(), tools: [], ...JSON.parse(fs.readFileSync(f, 'utf8')) };
    p.company = p.id;
    writeAgentFiles(p);
  }
  syncProfiles();
}
