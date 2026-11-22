// Le Conseil hebdomadaire : les fondateurs votent, la ville soutient le meilleur projet
// et décide du sort du plus faible (aide, pivot, sommeil ou bannissement).
import fs from 'node:fs';
import path from 'node:path';
import { ROOT, env } from './env.js';
import { think } from './llm.js';
import { state, profiles, emit, save, agentDir } from './store.js';
import { merged, logEnergy } from './engine.js';
import { isCreator, SETTINGS, CREATOR_ID, companyStats, councilVotePrompt, tally, verdict, parseJson, estimateTokens } from './core.js';

const pick = a => a[Math.floor(Math.random() * a.length)];

export async function runCouncil({ force = false } = {}) {
  const now = new Date().toISOString();
  const all = merged();
  const stats = companyStats(all);
  state.lastCouncilAt = now;
  if (stats.length < 2 && !force) { emit('council', { text: 'Conseil reporté : il faut au moins 2 entreprises.' }); save(); return null; }

  const voters = all.filter(a => a.kind !== 'specialiste' && a.status !== 'sommeil')
    .sort((a, b) => (b.id === CREATOR_ID) - (a.id === CREATOR_ID) || (b.revenueUsd || 0) - (a.revenueUsd || 0))
    .slice(0, SETTINGS.maxVoters);
  emit('council', { text: `Le conseil se réunit : ${voters.length} fondateurs votent sur ${stats.length} entreprises.` });

  const votes = [];
  for (const v of voters) {
    try {
      const raw = env.provider === 'mock'
        ? { soutien: pick(stats.filter(s => s.id !== v.id)).id, faible: pick(stats).id, potentiel_futur: Math.random() < .3, aide: 'Je peux relire ton offre et te donner 10 hooks.', raison: 'Simulation.' }
        : await (async () => { const q = councilVotePrompt(v, stats), r = await think([{ role: 'user', content: q }], { agent: v }); logEnergy(v.id, estimateTokens(q, r)); return parseJson(r); })();
      const vote = { voter: v.id, ...raw };
      votes.push(vote);
      emit('vote', { agent: v.id, text: `soutient ${vote.soutien}${vote.faible ? `, juge ${vote.faible} le plus faible` : ''} — ${String(vote.raison || '').slice(0, 160)}` });
    } catch (e) { emit('error', { agent: v.id, text: 'Vote : ' + e.message }); }
  }

  const t = tally(votes, stats);
  const weak = stats.find(s => s.id === t.weakest);
  const v = verdict(weak, t.future);
  const record = { id: `C${Date.now()}`, at: now, votes, champion: t.champion, weakest: t.weakest, verdict: v };
  applyVerdict(record, t, weak);
  (state.councils ||= []).push(record);
  emit('council', { text: `Champion : ${profiles[t.champion]?.name || '—'} · ${profiles[t.weakest]?.name || 'personne'} ${v.action.replace('_', ' ')} (${v.raison})` });
  save();
  return record;
}

export function applyVerdict(record, t, weak, only = null) {
  const until = new Date(Date.now() + SETTINGS.boostDays * 864e5).toISOString();
  if (t.champion && state.agents[t.champion]) {
    state.agents[t.champion].boostUntil = until;
    state.agents[t.champion].inbox.push({ from: 'conseil', message: `Le conseil a élu ton entreprise championne : tu joues deux fois plus jusqu'au ${until.slice(0, 10)}.` });
  }
  if (!weak) return;
  const members = only || Object.values(state.agents).filter(a => (profiles[a.id]?.company || a.id) === weak.id);
  const head = state.agents[weak.id];
  if (members.some(m => isCreator(m.id)) && record.verdict.action === 'bannir') throw new Error('Un créateur ne peut pas être banni');
  const action = record.verdict.action;
  if (action === 'aide' || action === 'seconde_chance') {
    head.warnings = (head.warnings || 0) + 1;
    for (const h of t.helpers) state.agents[h.from]?.inbox.push({ from: 'conseil', message: `Le conseil te demande d'aider ${weak.name} (${weak.id}) : ${h.aide}`, help: true });
    head.inbox.push({ from: 'conseil', message: `Ton entreprise est la plus faible cette semaine. ${record.verdict.raison} Aides proposées : ${t.helpers.map(h => `${h.from} ${h.aide}`).join(' | ') || 'aucune'}` });
  }
  if (action === 'pivot') {
    head.status = 'pivot';
    head.pivots = (head.pivots || 0) + 1;
    head.lessons = [...(head.lessons || []), ...head.memory.slice(-5)].slice(-10);
    head.inbox.push({ from: 'conseil', message: `Le conseil exige un PIVOT : ${record.verdict.raison}` });
  }
  if (action === 'sommeil') for (const m of members) { m.status = 'sommeil'; m.sleptAt = new Date().toISOString(); }
  if (action === 'bannir') {
    const mem = path.join(ROOT, 'data', 'memorial');
    fs.mkdirSync(mem, { recursive: true });
    for (const m of members) {
      (state.memorial ||= []).push({ id: m.id, name: profiles[m.id]?.name, business: profiles[m.id]?.business, role: profiles[m.id]?.role, revenueUsd: m.revenueUsd, lessons: m.memory.slice(-8), bannedAt: record.at, reason: record.verdict.raison });
      if (fs.existsSync(agentDir(m.id))) fs.renameSync(agentDir(m.id), path.join(mem, `${m.id}-${Date.now()}`));
      delete state.agents[m.id];
      delete profiles[m.id];
      emit('ban', { agent: m.id, text: `${m.id} quitte la ville (archivé au Mémorial)` });
    }
  }
}

// Décisions manuelles de Rémy (dashboard / CLI).
export function humanDecision(id, action) {
  const a = state.agents[id];
  if (!a) throw new Error('Agent inconnu');
  const company = profiles[id]?.company || id;
  const members = Object.values(state.agents).filter(x => (profiles[x.id]?.company || x.id) === company);
  if (action === 'boost') a.boostUntil = new Date(Date.now() + SETTINGS.boostDays * 864e5).toISOString();
  if (action === 'pivot') { a.status = 'pivot'; a.pivots = (a.pivots || 0) + 1; a.inbox.push({ from: 'rémy', message: 'Rémy te demande de pivoter vers une nouvelle idée.' }); }
  if (action === 'sommeil') members.forEach(m => { m.status = 'sommeil'; m.sleptAt = new Date().toISOString(); });
  if (action === 'reveil') members.forEach(m => (m.status = 'actif'));
  if (action === 'bannir') {
    // Un spécialiste part seul (avec ses propres recrues) ; un fondateur emporte toute son entreprise.
    const descendants = root => { const out = [state.agents[root]]; for (const x of Object.values(state.agents)) if (profiles[x.id]?.parent === root && profiles[x.id]?.company === company) out.push(...descendants(x.id)); return out; };
    const targets = profiles[id]?.kind === 'specialiste' ? descendants(id) : members;
    applyVerdict({ at: new Date().toISOString(), verdict: { action: 'bannir', raison: 'Décision de Rémy' } }, { helpers: [] }, { id: company, name: profiles[company]?.name }, targets);
  }
  emit('decision', { agent: id, text: `Rémy : ${action}` });
  save();
}
