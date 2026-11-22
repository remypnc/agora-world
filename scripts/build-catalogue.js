// Construit le catalogue de la Guilde : agents experts, skills et serveurs MCP déjà publiés en open source.
//
// Principe : on ne réinvente pas ce qui existe. AGORA indexe les meilleurs dépôts publics et
// garde, pour chaque entrée, sa source, son lien et sa licence. Le contenu d'une fiche n'est
// recopié (champ "playbook") que si le dépôt d'origine est sous licence MIT ou Apache-2.0 ;
// sinon on garde seulement le nom, la description et le lien.
//
// Utilisation :
//   node scripts/build-catalogue.js <dossier des dépôts clonés>
// Le dossier doit contenir les dépôts listés dans SOURCES, clonés sous le nom owner_repo :
//   git clone --depth 1 https://github.com/VoltAgent/awesome-claude-code-subagents ext/VoltAgent_awesome-claude-code-subagents
//
// Sortie : catalogue/agents.json, catalogue/skills.json, catalogue/mcp.json
import { readdirSync, readFileSync, statSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { join, relative, dirname, basename } from 'node:path';

const SOURCES = [
  { repo: 'VoltAgent/awesome-claude-code-subagents', kind: 'agents', license: 'MIT', branch: 'main' },
  { repo: 'msitarzewski/agency-agents', kind: 'agents', license: 'MIT', branch: 'main' },
  { repo: 'wshobson/agents', kind: 'agents+skills', license: 'MIT', branch: 'main' },
  { repo: 'anthropics/skills', kind: 'skills', license: 'voir chaque skill', branch: 'main' },
  { repo: 'ComposioHQ/awesome-claude-skills', kind: 'skills', license: 'non précisée', branch: 'master' },
  { repo: 'modelcontextprotocol/servers', kind: 'mcp', license: 'MIT / Apache-2.0', branch: 'main' },
  { repo: 'punkpeye/awesome-mcp-servers', kind: 'mcp', license: 'MIT', branch: 'main', dir: 'mcp' },
];
const COPYABLE = new Set(['MIT', 'Apache-2.0']);
const PLAYBOOK_CHARS = 1500; // assez pour former un agent, assez court pour économiser les tokens

const root = process.argv[2];
if (!root) { console.error('Usage : node scripts/build-catalogue.js <dossier des dépôts clonés>'); process.exit(1); }

const walk = d => readdirSync(d).flatMap(f => {
  const p = join(d, f);
  if (f.startsWith('.') || f === 'node_modules') return [];
  return statSync(p).isDirectory() ? walk(p) : f.endsWith('.md') ? [p] : [];
});
const field = (fm, k) => (fm.match(new RegExp(`^${k}:\\s*(.+)$`, 'm')) || [])[1]?.replace(/^["'>|]\s*|["']$/g, '').trim() || '';
const slug = s => String(s).toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 64);
const clean = s => String(s).replace(/[\p{Extended_Pictographic}\u{1F1E6}-\u{1F1FF}\uFE0F\u200D]/gu, '').replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim();
const ghUrl = (src, file) => `https://github.com/${src.repo}/blob/${src.branch}/${relative(join(root, src.dir || src.repo.replace('/', '_')), file).split('\\').join('/')}`;

const agents = new Map(), skills = new Map(), mcp = new Map();
const add = (map, e) => { if (!e.id || map.has(e.id)) return; map.set(e.id, e); };

for (const src of SOURCES) {
  const dir = join(root, src.dir || src.repo.replace('/', '_'));
  if (!existsSync(dir)) { console.warn(`Absent, ignoré : ${dir}`); continue; }

  if (src.kind === 'mcp' && src.repo === 'punkpeye/awesome-mcp-servers') {
    // Liste communautaire : "- [owner/repo](url) icônes - description", rangée par "### catégorie".
    let cat = '';
    for (const line of readFileSync(join(dir, 'README.md'), 'utf8').split('\n')) {
      const h = line.match(/^###\s+(.*)$/); if (h) { cat = clean(h[1]); continue; }
      const m = line.match(/^\s*[-*]\s+\[([^\]]+)\]\((https?:[^)]+)\)(.*)$/);
      if (!m || !cat) continue;
      const desc = clean(m[3].replace(/\[!\[[^\]]*\]\([^)]*\)\]\([^)]*\)/g, '').split(/\s[-–]\s/).slice(1).join(' - '));
      if (!desc) continue;
      add(mcp, { id: slug(m[1]), name: m[1], category: cat, description: desc.slice(0, 280), url: m[2], source: src.repo, license: 'voir le dépôt' });
    }
    continue;
  }
  if (src.kind === 'mcp') {
    // Serveurs de référence officiels : "- **[Nom](src/nom)** - description".
    for (const line of readFileSync(join(dir, 'README.md'), 'utf8').split('\n')) {
      const m = line.match(/^\s*-\s+\*\*\[([^\]]+)\]\(([^)]+)\)\*\*\s+-\s+(.*)$/);
      if (!m) continue;
      const url = m[2].startsWith('http') ? m[2] : `https://github.com/${src.repo}/tree/${src.branch}/${m[2]}`;
      add(mcp, { id: slug(m[1]), name: m[1], category: m[2].startsWith('src/') ? 'Référence officielle' : 'Officiel', description: clean(m[3]).slice(0, 280), url, source: src.repo, license: src.license, official: m[2].startsWith('src/') });
    }
    continue;
  }

  for (const file of walk(dir)) {
    const txt = readFileSync(file, 'utf8').replace(/\r\n/g, '\n');
    const m = txt.match(/^---\n([\s\S]*?)\n---\n?([\s\S]*)$/);
    if (!m) continue;
    const name = field(m[1], 'name'); const description = clean(field(m[1], 'description'));
    if (!name || !description) continue;
    const isSkill = basename(file) === 'SKILL.md';
    if (isSkill && !src.kind.includes('skills')) continue;
    if (!isSkill && !src.kind.includes('agents')) continue;
    const rel = relative(dir, file).split(/[\\/]/);
    const category = clean((isSkill ? rel.slice(0, -2) : rel.slice(0, -1)).filter(p => !['categories', 'plugins', 'agents', 'skills'].includes(p)).join(' / ') || 'général').replace(/^\d+-/, '');
    const entry = { id: slug(name), name, category, description: description.slice(0, 300), url: ghUrl(src, file), source: src.repo, license: src.license };
    if (COPYABLE.has(src.license)) entry.playbook = clean(m[2].replace(/\n/g, ' \n ')).slice(0, PLAYBOOK_CHARS);
    add(isSkill ? skills : agents, entry);
  }
}

mkdirSync('catalogue', { recursive: true });
const write = (name, map) => {
  const list = [...map.values()].sort((a, b) => a.category.localeCompare(b.category) || a.name.localeCompare(b.name));
  writeFileSync(`catalogue/${name}.json`, JSON.stringify(list, null, 1) + '\n');
  return list.length;
};
const n = { agents: write('agents', agents), skills: write('skills', skills), mcp: write('mcp', mcp) };
writeFileSync('catalogue/stats.json', JSON.stringify({ built: new Date().toISOString().slice(0, 10), ...n, sources: SOURCES.map(s => ({ repo: `https://github.com/${s.repo}`, kind: s.kind, license: s.license })) }, null, 1) + '\n');
console.log(`Catalogue : ${n.agents} agents, ${n.skills} skills, ${n.mcp} serveurs MCP.`);
