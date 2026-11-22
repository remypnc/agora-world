// Serveur d'AGORA : la ville en direct (SSE), l'API, les webhooks de paiement, le bureau de l'humain.
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { ROOT, env } from './env.js';
import { publicState, onEvent, state, profiles, syncProfiles, agentDir } from './store.js';
import { startLoop, tickAgent, applyAction } from './engine.js';
import { handleWebhook, recordSale, setFollowers, resolveHuman, resolveTask } from './bank.js';
import { startRunner } from './runner.js';
import { runCouncil, humanDecision } from './council.js';
import { ensureGenesis, loadPreset } from './genesis.js';

if (env.seed !== 'genesis') loadPreset(env.seed);
ensureGenesis();

const PUBLIC = path.join(ROOT, 'public');
const json = (res, code, data) => { res.writeHead(code, { 'Content-Type': 'application/json; charset=utf-8' }); res.end(JSON.stringify(data)); };
const readBody = req => new Promise(r => { let b = ''; req.on('data', c => (b += c)); req.on('end', () => r(b)); });
const isAdmin = req => req.headers['x-admin-token'] === env.adminToken;

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://x');
  try {
    if (url.pathname === '/api/state') return json(res, 200, publicState());

    if (url.pathname === '/api/stream') {
      res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', Connection: 'keep-alive' });
      res.write('retry: 3000\n\n');
      const off = onEvent(ev => res.write(`data: ${JSON.stringify(ev)}\n\n`));
      req.on('close', off);
      return;
    }

    const ag = url.pathname.match(/^\/api\/agents\/([a-z0-9-]+)$/);
    if (ag && profiles[ag[1]]) {
      const ws = path.join(agentDir(ag[1]), 'workspace');
      const files = fs.existsSync(ws) ? fs.readdirSync(ws).sort().reverse() : [];
      return json(res, 200, { profile: profiles[ag[1]], state: state.agents[ag[1]], files, sales: state.ledger.filter(l => l.agent === ag[1]) });
    }

    // ── Actions envoyées par un agent externe (Claude Code via le MCP d'AGORA) ──
    const act = url.pathname.match(/^\/api\/agents\/([a-z0-9-]+)\/(act|inbox)$/);
    if (act && profiles[act[1]] && isAdmin(req)) {
      const a = state.agents[act[1]];
      if (act[2] === 'inbox') { const msgs = a.inbox; a.inbox = []; return json(res, 200, msgs); }
      const body = JSON.parse((await readBody(req)) || '{}');
      applyAction(act[1], { pensee: body.pensee || '(action externe)', ...body });
      return json(res, 200, { ok: true });
    }

    const wh = url.pathname.match(/^\/webhooks\/(lemonsqueezy|gumroad|stripe)$/);
    if (wh && req.method === 'POST') {
      const entry = handleWebhook(wh[1], await readBody(req), req.headers, url.searchParams);
      return json(res, 200, { ok: true, entry });
    }

    // ── Bureau de l'humain (protégé par ADMIN_TOKEN) ──
    if (url.pathname.startsWith('/api/admin/')) {
      if (!isAdmin(req)) return json(res, 401, { error: 'x-admin-token requis' });
      const body = JSON.parse((await readBody(req)) || '{}');
      if (url.pathname === '/api/admin/human') return json(res, 200, resolveHuman(body.id, body.status, body.answer));
      if (url.pathname === '/api/admin/task') return json(res, 200, resolveTask(body.id, body.status, body.answer));
      if (url.pathname === '/api/admin/sale') return json(res, 200, recordSale({ ...body, source: body.source || 'manuel' }));
      if (url.pathname === '/api/admin/followers') return json(res, 200, setFollowers(body.agent, body.platform, body.count));
      if (url.pathname === '/api/admin/tick') { await tickAgent(body.agent); return json(res, 200, { ok: true }); }
      if (url.pathname === '/api/admin/battery') { state.energyCaps = { battery5h: Number(body.battery5h), batteryWeek: Number(body.batteryWeek), reserve: Number(body.reserve ?? .4) }; return json(res, 200, { ok: true }); }
      if (url.pathname === '/api/admin/council') return json(res, 200, await runCouncil({ force: true }));
      if (url.pathname === '/api/admin/decision') return json(res, 200, humanDecision(body.id, body.action) || { ok: true });
      if (url.pathname === '/api/admin/reload') { syncProfiles(); return json(res, 200, { ok: true }); }
    }

    // ── Fichiers statiques ──
    const file = path.join(PUBLIC, url.pathname === '/' ? 'index.html' : path.normalize(url.pathname));
    if (file.startsWith(PUBLIC) && fs.existsSync(file) && fs.statSync(file).isFile()) {
      const types = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.png': 'image/png' };
      res.writeHead(200, { 'Content-Type': (types[path.extname(file)] || 'application/octet-stream') + '; charset=utf-8' });
      return fs.createReadStream(file).pipe(res);
    }
    json(res, 404, { error: 'introuvable' });
  } catch (e) {
    json(res, 400, { error: String(e.message || e) });
  }
});

server.listen(env.port, () => {
  console.log(`\nAGORA est en ligne : http://localhost:${env.port}`);
  console.log(`   Cerveau : ${env.provider}${env.model ? ' / ' + env.model : ''} — un agent agit toutes les ${env.tickSeconds}s`);
  console.log(`   Agents : ${Object.keys(profiles).length} — exécuteur : ${env.runner}\n`);
  if (!process.env.NO_LOOP) startLoop();
  startRunner();
});
