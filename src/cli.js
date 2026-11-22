// Ligne de commande du Bureau de l'humain.
//   npm run status                         → classement + demandes en attente
//   npm run inbox                          → toutes les demandes des agents
//   npm run approve -- H123 fait "compte créé : @parfums.mekong"
//   npm run approve -- T456 approuvée       → l'exécuteur lance la tâche
//   npm run revenue -- sora 24.90 "commande ABA #881"
//   npm run tick -- sora                    → faire agir un agent maintenant
//   npm run new-agent -- iris "" "Boutique de bougies parfumées"
//   npm run seed -- village                → ajoute les 20 entrepreneurs prêts
import { state, leaderboard, profiles, save } from './store.js';
import { recordSale, resolveHuman, resolveTask } from './bank.js';
import { tickAgent } from './engine.js';
import { createAgent, loadPreset } from './genesis.js';
import { runCouncil, humanDecision } from './council.js';

const [cmd, ...args] = process.argv.slice(2);
const flush = () => new Promise(r => setTimeout(r, 400));

if (cmd === 'status') {
  console.table(leaderboard());
  const open = state.humanQueue.filter(h => h.status === 'en attente');
  console.log(`\n${open.length} demande(s) en attente — ${state.tasks.filter(t => t.status === 'à valider').length} tâche(s) à valider`);
} else if (cmd === 'inbox') {
  for (const h of state.humanQueue.filter(h => h.status === 'en attente')) console.log(`[${h.id}] ${profiles[h.agent]?.emoji} ${h.agent} (${h.type}${h.costUsd ? `, ${h.costUsd}$` : ''}) : ${h.request}`);
  for (const t of state.tasks.filter(t => t.status === 'à valider')) console.log(`[${t.id}] ${t.agent} : ${t.title}\n      ${t.instructions.slice(0, 200)}`);
} else if (cmd === 'approve') {
  const [id, status = 'fait', ...rest] = args;
  console.log(id.startsWith('T') ? resolveTask(id, status, rest.join(' ')) : resolveHuman(id, status, rest.join(' ')));
} else if (cmd === 'revenue') {
  const [agent, amount, ...note] = args;
  console.log(recordSale({ agent, amountUsd: Number(amount), source: 'manuel', note: note.join(' ') }));
} else if (cmd === 'tick') {
  await tickAgent(args[0]);
  console.log(state.agents[args[0]].lastThought);
} else if (cmd === 'new-agent') {
  const [nom, emoji = '', ...idea] = args;
  const p = createAgent({ nom, emoji, business: idea.join(' ') || 'À découvrir' }, { kind: 'fondateur' });
  console.log(`Agent créé : agents/${p.id}/`);
} else if (cmd === 'council') {
  console.log(JSON.stringify(await runCouncil({ force: true }), null, 2));
} else if (cmd === 'decide') {
  humanDecision(args[0], args[1]);
  console.log('ok');
} else if (cmd === 'seed') {
  loadPreset(args[0] || 'village');
  console.log(`Preset ${args[0] || 'village'} chargé.`);
} else {
  console.log('Commandes : status | inbox | approve | revenue | tick | new-agent | seed | council | decide <id> boost|pivot|sommeil|reveil|bannir');
}
save();
await flush();
