// La boucle du monde : à chaque tick, un agent perçoit, réfléchit et agit.
import fs from 'node:fs';
import path from 'node:path';
import { env } from './env.js';
import { think } from './llm.js';
import { runCouncil } from './council.js';
import { state, profiles, placeById, map, emit, save, agentDir, leaderboard, syncProfiles } from './store.js';
import { createAgent, canSpawn, writeAgentFiles } from './genesis.js';
import { isCreator, SETTINGS, CREATOR_ID, systemPrompt, perception, parseJson, pickNext, days, findSkilled, estimateTokens, energyStats } from './core.js';

export function logEnergy(agent, n) {
  const cutoff = Date.now() - 7 * 864e5;
  state.energyLog = [...(state.energyLog || []), { t: new Date().toISOString(), a: agent, n }].filter(e => new Date(e.t).getTime() > cutoff).slice(-1500);
}
export const energyNow = () => energyStats(state.energyLog || [], state.energyCaps || {});

// Vue fusionnée profil + état, utilisée par le cœur partagé.
export const merged = () => Object.values(state.agents).filter(a => profiles[a.id]).map(a => ({ ...profiles[a.id], ...a, company: profiles[a.id].company || a.id }));
const nextCouncilIn = () => Math.max(0, SETTINGS.councilEveryDays - days(state.lastCouncilAt || state.startedAt || new Date().toISOString()));

const parse = parseJson;

const slug = s => s.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9]+/g, '-').slice(0, 50);
const remember = (a, line) => { a.memory.push(line); if (a.memory.length > 60) a.memory.splice(0, a.memory.length - 60); };

export async function tickAgent(id) {
  const a = state.agents[id]; const p = profiles[id];
  if (!a || !p) return;
  const today = new Date().toISOString().slice(0, 10);
  if (state.day !== today) { state.day = today; state.callsToday = 0; }
  if (state.callsToday >= env.maxCallsPerDay) { emit('system', { text: 'Quota quotidien atteint : la ville dort jusqu’à demain.' }); return; }
  state.callsToday++;
  state.tick++;

  const others = Object.values(state.agents).filter(o => o.id !== id && profiles[o.id]).map(o => ({ id: o.id, name: profiles[o.id].name }));
  let act;
  try {
    const all = merged(), me = all.find(x => x.id === id), byId = Object.fromEntries(all.map(x => [x.id, x]));
    const ctx = { tick: state.tick, day: state.day, leaderboard: leaderboard(), spawnBlocked: canSpawn(), councilInDays: nextCouncilIn(), pending: state.humanQueue.filter(q => q.status === 'en attente'), tasks: (state.board ||= []) };
    const sys = systemPrompt(me, byId, map.places), user = perception(me, all, map.places, ctx);
    const raw = await think([{ role: 'system', content: sys }, { role: 'user', content: user }], { agent: me, others });
    logEnergy(id, estimateTokens(sys + user, raw));
    act = parse(raw);
  } catch (e) {
    state.callsToday--; // un appel refusé ne compte pas
    if (e.name === 'QuotaError') return pauseForQuota(e);
    emit('error', { agent: id, text: String(e.message || e).slice(0, 300) });
    return;
  }
  a.inbox = [];
  applyAction(id, act);
}

// Applique une action d'agent (venant du LLM, ou d'un agent Claude Code via le MCP d'AGORA).
export function applyAction(id, act) {
  const a = state.agents[id];
  if (!a) throw new Error(`Agent inconnu : ${id}`);
  const today = new Date().toISOString().slice(0, 10);
  a.actions++;
  a.lastThought = String(act.pensee || '').slice(0, 280);
  emit('pensee', { agent: id, text: a.lastThought });

  if (act.aller && placeById[act.aller] && act.aller !== a.location) {
    const pl = placeById[act.aller];
    a.location = pl.id;
    a.x = pl.x + (Math.random() - .5) * pl.w * .6;
    a.y = pl.y + (Math.random() - .5) * pl.h * .6;
    emit('move', { agent: id, to: pl.id, x: a.x, y: a.y });
  }

  for (const d of [].concat(act.dire || []).slice(0, 3)) {
    if (!d?.message) continue;
    const msg = String(d.message).slice(0, 500);
    if (d.a === 'tous') {
      for (const o of Object.values(state.agents)) if (o.id !== id && o.location === a.location) o.inbox.push({ from: id, message: msg });
      emit('say', { agent: id, to: 'tous', place: a.location, text: msg });
    } else if (state.agents[d.a]) {
      state.agents[d.a].inbox.push({ from: id, message: msg });
      state.agents[d.a].restUntil = null;
      emit('say', { agent: id, to: d.a, text: msg });
    }
  }

  if (act.aide?.a && state.agents[act.aide.a]) {
    state.agents[act.aide.a].inbox.push({ from: id, message: String(act.aide.demande).slice(0, 600), help: true });
    emit('help', { agent: id, to: act.aide.a, text: act.aide.demande });
  }

  if (act.travail?.titre) {
    const dir = path.join(agentDir(id), 'workspace');
    fs.mkdirSync(dir, { recursive: true });
    const file = `${today}-${slug(act.travail.titre)}.md`;
    fs.writeFileSync(path.join(dir, file), `# ${act.travail.titre}\n\n${act.travail.livrable_markdown || ''}\n`);
    a.deliverables++;
    a.learned = [...(a.learned || []), String(act.travail.titre).slice(0, 60)].slice(-8);
    remember(a, `J'ai produit « ${act.travail.titre} » (workspace/${file}).`);
    emit('work', { agent: id, text: act.travail.titre, file: `agents/${id}/workspace/${file}` });
  }

  if (act.tache_reelle?.titre) {
    const t = { id: `T${Date.now()}`, agent: id, title: act.tache_reelle.titre, instructions: act.tache_reelle.instructions || '', status: 'à valider', created: new Date().toISOString() };
    state.tasks.push(t);
    emit('task', { agent: id, text: t.title, taskId: t.id });
  }

  if (act.humain?.demande) {
    const h = { id: `H${Date.now()}`, agent: id, type: act.humain.type || 'autre', request: String(act.humain.demande).slice(0, 800), costUsd: Number(act.humain.cout_usd) || 0, status: 'en attente', created: new Date().toISOString() };
    state.humanQueue.push(h);
    remember(a, `J'ai demandé à Rémy : ${h.request}`);
    emit('human', { agent: id, text: h.request, reqId: h.id });
  }

  if (act.definir_business?.business && profiles[id].kind !== 'specialiste') {
    const p = profiles[id], d = act.definir_business;
    Object.assign(p, { business: String(d.business).slice(0, 140), pitch: String(d.pitch || p.pitch).slice(0, 600), model: String(d.modele || p.model).slice(0, 300), channels: [].concat(d.canaux || p.channels || []).slice(0, 8) });
    writeAgentFiles(p);
    if (a.status === 'pivot') { a.status = 'actif'; a.pivotedAt = new Date().toISOString(); }
    remember(a, `J'ai choisi mon business : ${p.business}`);
    emit('business', { agent: id, text: `nouveau business : ${p.business}` });
  }

  // Tâches déléguées à ceux qui savent déjà faire (réveil du destinataire).
  const board = (state.board ||= []);
  const wake = o => { if (o) o.restUntil = null; };
  const assign = (owner, title, details) => {
    const t = { id: 'K' + Date.now().toString(36) + board.length, title: String(title).slice(0, 140), details: String(details || '').slice(0, 600), owner, by: id, status: 'à faire', created: new Date().toISOString() };
    board.push(t);
    if (owner !== id && state.agents[owner]) { state.agents[owner].inbox.push({ from: id, message: `Nouvelle tâche [${t.id}] : ${t.title}` }); wake(state.agents[owner]); }
    emit('task', { agent: id, to: owner, text: `${t.title} ${owner}` });
  };
  for (const t of [].concat(act.taches || []).slice(0, 4)) if (t?.titre) assign(state.agents[t.pour] ? t.pour : id, t.titre, t.details);
  const done = act.tache_finie && board.find(t => t.id === act.tache_finie && t.owner === id);
  if (done) {
    done.status = 'fait'; done.done = new Date().toISOString();
    a.learned = [...(a.learned || []), done.title.slice(0, 60)].slice(-8);
    if (done.by !== id && state.agents[done.by]) { state.agents[done.by].inbox.push({ from: id, message: `Tâche terminée : ${done.title}` }); wake(state.agents[done.by]); }
  }
  if (act.recruter?.role) {
    const pro = findSkilled(act.recruter.role, merged(), null);
    if (pro?.id === id) delete act.recruter;
    else if (pro) { assign(pro.id, act.recruter.mission || act.recruter.role, `Au lieu de recruter, ${id} te confie cette mission.`); delete act.recruter; }
  }
  if (act.nouvelle_entreprise?.nom && !isCreator(id)) { act.proposer_idee = { idee: `${act.nouvelle_entreprise.business} — ${act.nouvelle_entreprise.pitch || ''}`, pourquoi: '' }; delete act.nouvelle_entreprise; }
  if (act.proposer_idee?.idee && state.agents[CREATOR_ID] && id !== CREATOR_ID) {
    state.agents[CREATOR_ID].inbox.push({ from: id, message: `IDÉE PROPOSÉE : ${String(act.proposer_idee.idee).slice(0, 400)} ${act.proposer_idee.pourquoi || ''}` });
    emit('idea', { agent: id, to: CREATOR_ID, text: act.proposer_idee.idee });
  }
  for (const [key, kind] of [['recruter', 'specialiste'], ['nouvelle_entreprise', 'fondateur']]) {
    const spec = act[key];
    if (!spec?.nom) continue;
    const blocked = canSpawn();
    const label = kind === 'specialiste' ? `Recruter ${spec.nom} (${spec.role})` : `Faire naître l'entreprise « ${spec.business} » (${spec.nom})`;
    if (env.autoSpawn && !blocked) {
      try { createAgent(spec, { parent: id, kind }); } catch (e) { emit('error', { agent: id, text: String(e.message) }); }
    } else {
      const h = { id: `H${Date.now()}${kind[0]}`, agent: id, type: 'naissance', request: `${label}${blocked ? ` — en attente : ${blocked}` : ''}`, spec, kind, costUsd: 0, status: 'en attente', created: new Date().toISOString() };
      state.humanQueue.push(h);
      emit('human', { agent: id, text: h.request, reqId: h.id });
    }
  }

  if (act.note_memoire) remember(a, String(act.note_memoire).slice(0, 300));
  remember(a, `[t${state.tick}] ${a.lastThought}`);
  const idle = !act.travail && !act.dire && !act.aide && !(act.taches || []).length && !act.humain && !act.recruter && !act.nouvelle_entreprise && !act.definir_business;
  const h = Number(act.repos_heures) || (idle ? SETTINGS.defaultRestHours : 0);
  a.restUntil = h > 0 ? new Date(Date.now() + Math.min(48, Math.max(1, h)) * 36e5).toISOString() : null;
  if (h > 0) emit('rest', { agent: id, text: `se repose ${Math.min(48, Math.max(1, h))} h` });
  state.board = board.filter(t => t.status !== 'fait' || Date.now() - new Date(t.done) < 7 * 864e5).slice(-150);
  save();
}

// Pause sur limite : attente croissante (1 min, 5 min, 15 min, puis 1 h max) tant que le fournisseur refuse,
// remise à zéro dès qu'un appel passe. La ville ne perd rien : elle reprend au même agent.
let pausedUntil = 0, pauseStep = 0;
const PAUSES = [60e3, 300e3, 900e3, 3600e3];
function pauseForQuota(e) {
  const ms = e.retryMs || PAUSES[Math.min(pauseStep++, PAUSES.length - 1)];
  pausedUntil = Date.now() + ms;
  emit('system', { text: `Réserve du fournisseur d’IA épuisée : pause jusqu’à ${new Date(pausedUntil).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' })}, reprise automatique.` });
}
export const pauseState = () => ({ paused: Date.now() < pausedUntil, until: pausedUntil ? new Date(pausedUntil).toISOString() : null });

let cursor = 0;
export function nextAgentId() { return pickNext(merged(), cursor++, state.board || []); }

export function startLoop() {
  const loop = async () => {
    if (Date.now() < pausedUntil) { setTimeout(loop, pausedUntil - Date.now() + 1000); return; }
    if (energyNow().empty) { emit('system', { text: 'Batterie vide : la ville se met en veille jusqu’à la recharge.' }); setTimeout(loop, 900000); return; }
    if (nextCouncilIn() <= 0) await runCouncil().catch(e => emit('error', { text: 'Conseil : ' + e.message }));
    const id = nextAgentId();
    if (id) { const before = pausedUntil; await tickAgent(id); if (pausedUntil === before) pauseStep = 0; }
    else { setTimeout(loop, 300000); return; } // tout le monde dort : 0 token, on revérifie dans 5 min
    setTimeout(loop, env.tickSeconds * 1000);
  };
  setTimeout(loop, 1500);
}
