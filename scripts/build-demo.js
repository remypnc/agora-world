// Génère les versions « un seul fichier » de la ville :
//   dist/agora-demo.html  → simulation jouable sans serveur ni IA
//   dist/agora-live.html  → AGORA Live : à publier comme artefact claude.ai (base de données + Claude comme cerveau)
import fs from 'node:fs';
import path from 'node:path';
import { ROOT } from '../src/env.js';

const read = f => fs.readFileSync(path.join(ROOT, f), 'utf8');
const data = JSON.stringify({
  places: JSON.parse(read('world/map.json')).places,
  genesis: JSON.parse(read('presets/genesis.json')),
  inspiration: JSON.parse(read('world/inspiration.json')),
  accounts: JSON.parse(read('world/accounts.json')),
}).replace(/</g, '\\u003c');
const html = read('public/index.html');
const core = read('src/core.js').replace(/^export /gm, '');
const cloud = read('public/cloud.js');

fs.mkdirSync(path.join(ROOT, 'dist'), { recursive: true });
fs.writeFileSync(path.join(ROOT, 'dist/agora-demo.html'), html.replace('/* DEMO_DATA */', () => `window.DEMO = ${data};\n</script>\n<script>\n${core}\n</script>\n<script>`));
fs.writeFileSync(path.join(ROOT, 'dist/agora-live.html'), html
  .replace('<title>AGORA — la ville des agents IA</title>', '<title>AGORA Live</title>')
  .replace('/* DEMO_DATA */', () => `window.DEMO = ${data};\nwindow.CLOUD = true;\nwindow.CATALOGUE = ${JSON.stringify(JSON.parse(fs.readFileSync(path.join(ROOT, 'catalogue/agents.json'), 'utf8')).map(c => ({ id: c.id, name: c.name, description: c.description, playbook: (c.playbook || '').slice(0, 900), url: c.url })))};\n</script>\n<script>\n${core}\n</script>\n<script>\n${cloud}\n</script>\n<script>`));
fs.mkdirSync(path.join(ROOT, 'dist/vercel'), { recursive: true });
fs.writeFileSync(path.join(ROOT, 'dist/vercel/index.html'), html.replace('/* DEMO_DATA */', () => `window.DEMO = ${data};\nwindow.SNAPSHOT = true;\n</script>\n<script>\n${core}\n</script>\n<script>`));
console.log('dist/agora-demo.html + dist/agora-live.html + dist/vercel/index.html');

// Version Vercel allégée : instantané en lecture seule (pas de moteur, pas de simulation).
{
  const places = JSON.parse(read('world/map.json')).places.map(({ emoji, purpose, ...p }) => p);
  const coreLite = read('src/core.js').replace(/^export /gm, '');
  const energyOnly = coreLite.slice(coreLite.indexOf('export const SETTINGS') >= 0 ? 0 : 0);
  const pick = (src, start, end) => src.slice(src.indexOf(start), src.indexOf(end));
  const lite = pick(coreLite, 'const SETTINGS', 'const CREATOR_ID');
  let page = html
    .replace(/\/\/ ───────── Simulation sans serveur ─────────[\s\S]*?\/\/ ───────── Le plan de la ville ─────────/, '// ───────── Le plan de la ville ─────────\nconst demoState = () => null, demoTick = () => {};')
    .replace('/* DEMO_DATA */', () => `window.DEMO = ${JSON.stringify({ places })};\nwindow.SNAPSHOT = true;\n</script>\n<script>\n${lite}\n</script>\n<script>`);
  page = page.split('\n').map(l => l.trim()).filter(l => l && !l.startsWith('//') && !l.startsWith('/*')).join('\n');
  fs.writeFileSync(path.join(ROOT, 'dist/vercel/index.html'), page);
  console.log('vercel', page.length);
}
