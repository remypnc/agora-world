// État du monde : un fichier JSON + un journal d'événements (JSONL).
// Simple, lisible, versionnable. Remplaçable par Supabase/SQLite plus tard.
import fs from 'node:fs';
import path from 'node:path';
import { ROOT } from './env.js';
import { energyStats } from './core.js';

const DATA = path.join(ROOT, 'data');
const STATE_FILE = path.join(DATA, 'world.json');
const EVENTS_FILE = path.join(DATA, 'events.jsonl');
const AGENTS_DIR = path.join(ROOT, 'agents');
fs.mkdirSync(DATA, { recursive: true });
fs.mkdirSync(AGENTS_DIR, { recursive: true });

export const map = JSON.parse(fs.readFileSync(path.join(ROOT, 'world/map.json'), 'utf8'));
export const placeById = Object.fromEntries(map.places.map(p => [p.id, p]));

const listeners = new Set();
export const onEvent = fn => (listeners.add(fn), () => listeners.delete(fn));

export function loadProfiles() {
  return fs.readdirSync(AGENTS_DIR, { withFileTypes: true })
    .filter(d => d.isDirectory() && fs.existsSync(path.join(AGENTS_DIR, d.name, 'agent.json')))
    .map(d => JSON.parse(fs.readFileSync(path.join(AGENTS_DIR, d.name, 'agent.json'), 'utf8')));
}

export const agentDir = id => path.join(AGENTS_DIR, id);

function freshAgentState(p) {
  const home = placeById[p.home] || placeById.place;
  return {
    id: p.id, location: home.id,
    x: home.x + (Math.random() - .5) * home.w * .6,
    y: home.y + (Math.random() - .5) * home.h * .6,
    status: 'arrive en ville', lastThought: '',
    memory: [], inbox: [],
    revenueUsd: 0, followers: {}, deliverables: 0, actions: 0,
  };
}

export const state = fs.existsSync(STATE_FILE)
  ? JSON.parse(fs.readFileSync(STATE_FILE, 'utf8'))
  : { tick: 0, day: new Date().toISOString().slice(0, 10), callsToday: 0, agents: {}, ledger: [], humanQueue: [], tasks: [], recent: [], councils: [], memorial: [] };
state.startedAt ||= new Date().toISOString();

export const profiles = {};
export function syncProfiles() {
  for (const p of loadProfiles()) {
    profiles[p.id] = p;
    if (!state.agents[p.id]) state.agents[p.id] = freshAgentState(p);
  }
}
syncProfiles();

let saveTimer = null;
export function save() {
  if (saveTimer) return; // regroupe les écritures sans jamais les repousser indéfiniment
  saveTimer = setTimeout(() => {
    saveTimer = null;
    fs.writeFileSync(STATE_FILE + '.tmp', JSON.stringify(state, null, 2));
    fs.renameSync(STATE_FILE + '.tmp', STATE_FILE);
  }, 200);
}

let seq = 0;
export function emit(type, data) {
  const ev = { id: `${Date.now()}-${seq++}`, t: new Date().toISOString(), type, ...data };
  fs.appendFileSync(EVENTS_FILE, JSON.stringify(ev) + '\n');
  state.recent.push(ev);
  if (state.recent.length > 250) state.recent.splice(0, state.recent.length - 250);
  for (const fn of listeners) { try { fn(ev); } catch {} }
  save();
  return ev;
}

export function publicState() {
  return {
    world: { name: map.name, tick: state.tick, day: state.day, width: map.width, height: map.height, places: map.places },
    agents: Object.values(state.agents).filter(a => profiles[a.id]).map(a => ({
      ...a, memory: undefined, inbox: a.inbox.length,
      name: profiles[a.id].name, emoji: profiles[a.id].emoji, color: profiles[a.id].color,
      business: profiles[a.id].business, pitch: profiles[a.id].pitch, channels: profiles[a.id].channels,
      links: profiles[a.id].links || {}, role: profiles[a.id].role, model: profiles[a.id].model,
      kind: profiles[a.id].kind || 'fondateur', parent: profiles[a.id].parent || null,
      company: profiles[a.id].company || a.id, generation: profiles[a.id].generation || 0, born: profiles[a.id].born,
      mission: profiles[a.id].mission,
    })),
    leaderboard: leaderboard(),
    humanQueue: state.humanQueue.filter(h => h.status === 'en attente'),
    tasks: state.tasks.slice(-50),
    councils: (state.councils || []).slice(-6),
    board: (state.board || []).slice(-80),
    energy: energyStats(state.energyLog || [], state.energyCaps || {}),
    memorial: (state.memorial || []).slice(-30),
    lastCouncilAt: state.lastCouncilAt || state.startedAt,
    recent: state.recent.slice(-80),
    totals: { revenueUsd: round(state.ledger.reduce((s, l) => s + l.amountUsd, 0)), sales: state.ledger.length },
  };
}

// Classement par entreprise : le fondateur + toute son équipe de spécialistes.
export function leaderboard() {
  const co = {};
  for (const a of Object.values(state.agents)) {
    const p = profiles[a.id]; if (!p) continue;
    const cid = p.company || a.id;
    const c = co[cid] || (co[cid] = { id: cid, name: profiles[cid]?.name || cid, emoji: profiles[cid]?.emoji || '', business: profiles[cid]?.business || '', revenueUsd: 0, followers: 0, team: 0 });
    c.revenueUsd = round(c.revenueUsd + a.revenueUsd);
    c.followers += Object.values(a.followers || {}).reduce((s, n) => s + n, 0);
    c.team++;
  }
  return Object.values(co).sort((a, b) => b.revenueUsd - a.revenueUsd || b.followers - a.followers || b.team - a.team);
}

export const round = n => Math.round(n * 100) / 100;
