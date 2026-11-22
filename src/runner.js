// Exécuteur : transforme une tâche approuvée en vraie action, via Claude Code
// lancé dans le dossier de l'agent (il y trouve son CLAUDE.md et ses MCP dans .mcp.json).
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { env } from './env.js';
import { state, emit, save, agentDir } from './store.js';

let busy = false;

export function startRunner() {
  if (env.runner !== 'claude') return;
  setInterval(() => {
    if (busy) return;
    const t = state.tasks.find(x => x.status === 'approuvée');
    if (t) run(t);
  }, 5000);
}

function run(t) {
  busy = true;
  t.status = 'en cours'; save();
  emit('task-update', { agent: t.agent, text: `▶ ${t.title}`, taskId: t.id });
  const prompt = `Tu es l'agent ${t.agent} d'AGORA. Lis CLAUDE.md. Exécute cette tâche validée par Rémy, avec tes MCP, sans rien dépenser :\n\n${t.title}\n\n${t.instructions}\n\nTermine par un résumé de 5 lignes max : ce qui a été fait, les liens créés, ce qui reste.`;
  const args = ['-p', prompt, ...(process.env.CLAUDE_ARGS ? process.env.CLAUDE_ARGS.split(' ') : [])];
  const child = spawn('claude', args, { cwd: agentDir(t.agent) });
  let out = '';
  child.stdout.on('data', d => (out += d));
  child.stderr.on('data', d => (out += d));
  child.on('close', code => {
    t.status = code === 0 ? 'terminée' : 'échec';
    t.result = out.slice(-2000);
    const log = path.join(agentDir(t.agent), 'workspace', `${t.id}-resultat.md`);
    fs.mkdirSync(path.dirname(log), { recursive: true });
    fs.writeFileSync(log, `# ${t.title}\n\n${out}`);
    state.agents[t.agent]?.inbox.push({ from: 'exécuteur', message: `Tâche « ${t.title} » ${t.status} : ${out.slice(-400)}` });
    emit('task-update', { agent: t.agent, text: `${t.title} → ${t.status}`, taskId: t.id });
    busy = false; save();
  });
  child.on('error', e => { t.status = 'échec'; t.result = String(e); busy = false; save(); });
}
