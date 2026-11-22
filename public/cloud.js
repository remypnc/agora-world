// AGORA Live — le moteur de la ville qui tourne dans la page publiée sur claude.ai.
// Cerveau : Claude (capacité « sample »). Mémoire : base de données de l'artefact (capacité « db »).
// Une seule page à la fois fait vivre la ville (verrou « world/lock ») ; les autres regardent en direct.
/* global isStaff, CRAFTS, craftOf, bestByCraft, matchFiche, isCreator, estimateTokens, energyStats, tierFor, findSkilled, SETTINGS, CREATOR_ID, systemPrompt, perception, leaderboardOf, companyStats, councilVotePrompt, tally, verdict, pickNext, parseJson, days */

const Cloud = (() => {
  const CFG = { tickMs: window.AGORA_TICK_MS || 40000, maxAgents: 30, maxSpawnsPerDay: 6, feedMax: 160 };
  const tabId = 'tab-' + Math.random().toString(36).slice(2);
  let db = null, sample = null, running = false, timer = null, busy = false, onChange = () => {}, status = 'prête';
  const W = { sites: {}, energy: { log: [], caps: {} }, agents: {}, meta: null, feed: [], queue: [], councils: [], memorial: [], ledger: [], tasks: [], accounts: {} };
  const places = () => window.DEMO.places;
  const placeById = id => places().find(p => p.id === id);
  const clone = o => JSON.parse(JSON.stringify(o));
  const nowIso = () => new Date().toISOString();
  const pick = a => a[Math.floor(Math.random() * a.length)];
  const PALETTE = ['#C2255C', '#1971C2', '#2B8A3E', '#D9480F', '#5F3DC4', '#0C8599', '#A61E4D', '#E67700', '#364FC7', '#087F5B', '#862E9C', '#C92A2A'];
  const slug = s => String(s).toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 24) || 'agent';
  const setStatus = s => { status = s; onChange('status'); };

  // ───────── Lecture en direct ─────────
  async function boot(cb) {
    onChange = cb;
    if (!window.claude?.use) return false;
    db = await window.claude.use('db');
    if (!db) return false;
    sample = await window.claude.use('sample');
    await new Promise(resolve => {
      let first = 0; const done = () => { if (++first === 2) resolve(); };
      const to = setTimeout(resolve, 10000);
      db.collection('agents').onSnapshot(s => { W.agents = Object.fromEntries(s.docs.map(d => [d.id, clone(d.data())])); onChange('agents'); done(); }, e => { setStatus('base indisponible : ' + e.code); resolve(); });
      db.doc('world/meta').onSnapshot(d => { W.meta = d.exists ? clone(d.data()) : null; onChange('meta'); done(); clearTimeout(to); });
      db.doc('world/feed').onSnapshot(d => { W.feed = d.exists ? d.data().events || [] : []; onChange('feed'); });
      db.doc('world/queue').onSnapshot(d => { W.queue = d.exists ? clone(d.data().items || []) : []; onChange('queue'); });
      db.doc('world/councils').onSnapshot(d => { W.councils = d.exists ? clone(d.data().items || []) : []; onChange('councils'); });
      db.doc('world/ideas').onSnapshot(d => { W.ideas = d.exists ? clone(d.data().items || []) : []; onChange('ideas'); });
      db.doc('world/methods').onSnapshot(d => { W.methods = d.exists ? clone(d.data()) : {}; onChange('methods'); });
      db.doc('world/products').onSnapshot(d => { W.products = d.exists ? clone(d.data().items || []) : []; onChange('products'); });
      db.doc('world/sites').onSnapshot(d => { W.sites = d.exists ? clone(d.data()) : {}; onChange('sites'); });
      db.doc('world/energy').onSnapshot(d => { W.energy = d.exists ? clone(d.data()) : { log: [], caps: {} }; W.energy.log ||= []; W.energy.caps ||= {}; onChange('energy'); });
      db.doc('world/accounts').onSnapshot(d => { W.accounts = d.exists ? clone(d.data()) : {}; onChange('accounts'); });
      db.doc('world/tasks').onSnapshot(d => { W.tasks = d.exists ? clone(d.data().items || []) : []; onChange('tasks'); });
      db.doc('world/memorial').onSnapshot(d => { W.memorial = d.exists ? clone(d.data().items || []) : []; onChange('memorial'); });
    });
    if (!W.meta) await genesis();
    return true;
  }

  async function genesis() {
    const g = window.DEMO.genesis, h = placeById('place');
    const a = makeAgent(g, { kind: 'fondateur' });
    Object.assign(a, { id: 'origine', company: 'origine', x: h.x, y: h.y, location: 'place' });
    await db.doc('agents/origine').set(a);
    await db.doc('world/meta').set({ tick: 0, cursor: 0, startedAt: nowIso(), lastCouncilAt: nowIso(), births: {} });
    await db.doc('world/feed').set({ events: [ev('birth', { agent: 'origine', text: `${a.emoji} ${a.name} est né·e — ${a.role}` })] });
  }

  function makeAgent(spec, { parent = null, kind = 'fondateur' } = {}) {
    let id = slug(spec.id || spec.nom || spec.name);
    for (let i = 2; W.agents[id]; i++) id = `${slug(spec.nom || spec.name)}-${i}`;
    const par = parent ? W.agents[parent] : null;
    const home = placeById(spec.lieu || spec.home) || placeById(par?.location) || placeById('place');
    return {
      id, kind, company: kind === 'specialiste' && par ? (par.company || par.id) : id,
      name: spec.nom || spec.name || id, emoji: spec.emoji || (kind === 'specialiste' ? '' : ''),
      color: kind === 'specialiste' && par ? par.color : (spec.color || pick(PALETTE)), role: spec.role || (kind === 'specialiste' ? 'Spécialiste' : 'Fondateur'),
      business: spec.business || (kind === 'specialiste' && par ? `${spec.role} pour ${par.business}` : 'À découvrir'),
      pitch: spec.pitch || spec.mission || '', mission: spec.mission || '',
      model: spec.modele || spec.model || (kind === 'specialiste' ? `Travaille pour ${par?.name}` : 'À définir'),
      channels: [].concat(spec.canaux || spec.channels || []).slice(0, 8), personality: spec.personnalite || spec.personality || 'Énergique, concret, curieux',
      skills: [].concat(spec.competences || spec.skills || []).slice(0, 10), tools: [].concat(spec.outils || spec.tools || []).slice(0, 10),
      firstSteps: [].concat(spec.etapes || spec.firstSteps || []).slice(0, 8),
      outputs: [].concat(spec.livrables || []).slice(0, 6).map(x => String(x).slice(0, 160)), success: String(spec.reussi_quand || '').slice(0, 240),
      playbook: kind === 'specialiste' ? (matchFiche(spec.role, window.CATALOGUE || [])?.playbook || '') : '',
      parent, generation: par ? (par.generation || 0) + 1 : 0, born: nowIso(),
      location: par?.location || home.id, x: par ? par.x + (Math.random() - .5) * 40 : home.x, y: par ? par.y + (Math.random() - .5) * 30 : home.y,
      status: 'actif', lastThought: 'Je viens de naître.', memory: [], inbox: [], revenueUsd: 0, followers: {}, deliverables: 0, actions: 0,
    };
  }

  const ev = (type, data) => ({ id: Date.now().toString(36) + Math.random().toString(36).slice(2, 6), t: nowIso(), type, ...data });

  // ───────── Faire vivre la ville ─────────
  async function start() {
    if (!sample) { setStatus('cerveau indisponible (Claude non autorisé)'); return; }
    running = true; setStatus('démarrage…');
    try { localStorage.setItem('agora_autorun', '1'); } catch {}
    await loop();
  }
  function stop() { running = false; clearTimeout(timer); setStatus('en pause'); try { localStorage.setItem('agora_autorun', '0'); } catch {} }
  const autorun = () => { try { return localStorage.getItem('agora_autorun') !== '0'; } catch { return true; } };

  async function loop() {
    if (!running) return;
    try {
      const lock = await db.doc('world/lock').acquire({ holder: tabId, ttlMs: CFG.tickMs * 3 });
      if (!lock.acquired) setStatus('une autre page fait déjà vivre la ville');
      else {
        const due = days(W.meta?.lastCouncilAt) >= SETTINGS.councilEveryDays;
        if (due && Object.values(W.agents).filter(a => a.kind !== 'specialiste').length >= 2) await council();
        else {
          const day = nowIso().slice(0, 10), used = W.meta?.turns?.[day] || 0;
          const en = energy();
          if (en.empty) { setStatus(`batterie vide — recharge ${en.refillAt ? 'vers ' + new Date(en.refillAt).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' }) : 'bientôt'}`); timer = setTimeout(loop, 900000); return; }
          if (used >= SETTINGS.maxTurnsPerDay) { setStatus(`budget du jour atteint (${used}/${SETTINGS.maxTurnsPerDay} tours) — reprise demain`); timer = setTimeout(loop, 1800000); return; }
          if ((await tick()) === 'idle') { setStatus('tout le monde se repose ou attend : 0 token dépensé'); timer = setTimeout(loop, 300000); return; }
        }
      }
    } catch (e) {
      if (e?.code === 'rate_limited' || e?.code === 'resource_exhausted') { setStatus('limite atteinte, reprise dans 5 min'); timer = setTimeout(loop, 300000); return; }
      if (e?.code === 'not_granted') { stop(); setStatus('Claude non autorisé pour cette page'); return; }
      setStatus('erreur : ' + (e?.message || e?.code || e));
    }
    timer = setTimeout(loop, CFG.tickMs);
  }

  function spawnBlocked(meta) {
    const live = Object.values(W.agents).filter(a => a.status !== 'sommeil').length;
    if (live >= CFG.maxAgents) return `population maximale (${CFG.maxAgents})`;
    if ((meta.births?.[nowIso().slice(0, 10)] || 0) >= CFG.maxSpawnsPerDay) return `quota de naissances du jour (${CFG.maxSpawnsPerDay})`;
    return null;
  }

  // Chaque appel à Claude est compté dans la batterie (estimation), au nom de l'agent qui consomme.
  let pendingEnergy = [];
  async function ask(prompt, modelTier = 'default', agentId = 'ville') {
    const out = await sample([{ role: 'user', content: prompt }], { cache: false, modelTier });
    pendingEnergy.push({ t: nowIso(), a: agentId, n: estimateTokens(prompt, out.text), m: modelTier === 'quick' ? 'q' : 'd' });
    return parseJson(out.text);
  }
  async function flushEnergy() {
    if (!pendingEnergy.length) return;
    const cutoff = Date.now() - 7 * 864e5;
    const log = [...W.energy.log, ...pendingEnergy].filter(e => new Date(e.t).getTime() > cutoff).slice(-1500);
    pendingEnergy = [];
    await db.doc('world/energy').set({ log, caps: W.energy.caps || {} });
  }
  const energy = () => energyStats(W.energy.log, W.energy.caps);
  async function setCaps(c5, cw, reserve) { await db.doc('world/energy').set({ log: W.energy.log, caps: { battery5h: c5, batteryWeek: cw, reserve } }); }

  async function tick() {
    if (busy) return; busy = true;
    try {
      const agents = clone(Object.values(W.agents)), meta = clone(W.meta);
      const byId = Object.fromEntries(agents.map(a => [a.id, a]));
      const id = pickNext(agents, meta.cursor || 0, W.tasks);
      if (!id) return 'idle';
      const a = byId[id];
      setStatus(`${a.emoji} ${a.name} réfléchit…`);
      const ctx = { tick: meta.tick, day: nowIso().slice(0, 10), leaderboard: leaderboardOf(agents), spawnBlocked: spawnBlocked(meta), councilInDays: Math.max(0, SETTINGS.councilEveryDays - days(meta.lastCouncilAt)), pending: W.queue.filter(q => q.status === 'en attente') };
      ctx.tasks = W.tasks; ctx.accounts = accountsList();
      if (a.id === 'chef') {
        ctx.best = bestByCraft(agents, W.tasks); ctx.methods = W.methods || {};
        // Le chef lit vraiment le travail des meilleurs (extraits courts pour économiser les tokens).
        const leaders = Object.values(ctx.best).map(b => b.leader.id).filter(x => !(W.methods || {})[craftOf(byId[x])]).slice(0, 2);
        const parts = [];
        for (const l of leaders) { try { const w = (await works(l))[0]; if (w) parts.push(`${l} — « ${w.title} » : ${String(w.body).slice(0, 900)}`); } catch {} }
        ctx.samples = parts.join('\n\n');
      }
      if (a.id === 'repare') {
        const old = t => Date.now() - new Date(t).getTime() > 2 * 864e5;
        const b = [
          ...W.tasks.filter(t => t.status !== 'fait' && old(t.created)).map(t => `tâche bloquée [${t.id}] ${t.title} (chez ${t.owner})`),
          ...W.queue.filter(q => q.status === 'refusé').slice(-5).map(q => `demande refusée par Rémy (${q.agent}) : ${String(q.request).slice(0, 120)}${q.note ? ' — ' + q.note : ''}`),
          ...agents.filter(x => x.status === 'pivot').map(x => `${x.id} doit pivoter`),
        ];
        ctx.blockers = b.slice(0, 8).join(' | ') || 'aucun';
      }
      const act = await ask(systemPrompt(a, byId, places(), W.methods || {}) + '\n\n───\n\n' + perception(a, agents, places(), ctx), tierFor(a), a.id);
      const out = apply(a, act, byId, meta);
      const day = nowIso().slice(0, 10);
      meta.tick++; meta.cursor = (meta.cursor || 0) + 1; meta.turns = { [day]: (meta.turns?.[day] || 0) + 1 };
      await commit(out, meta);
      await flushEnergy();
      setStatus(`dernier tour : ${a.emoji} ${a.name}`);
    } finally { busy = false; }
  }

  // Applique l'action sur la copie de travail ; renvoie ce qu'il faut écrire.
  function apply(a, act, byId, meta) {
    const dirty = new Set([a.id]), events = [], newAgents = [], works = [], queue = [], doneTasks = [];
    const remember = (x, line) => { x.memory = [...(x.memory || []), line].slice(-40); };
    a.inbox = []; a.actions = (a.actions || 0) + 1;
    a.lastThought = String(act.pensee || '').slice(0, 280);
    events.push(ev('pensee', { agent: a.id, text: a.lastThought }));
    const pl = placeById(act.aller);
    if (pl && pl.id !== a.location) {
      Object.assign(a, { location: pl.id, x: pl.x + (Math.random() - .5) * pl.w * .6, y: pl.y + (Math.random() - .5) * pl.h * .6 });
      events.push(ev('move', { agent: a.id, to: pl.id, x: a.x, y: a.y }));
    }
    for (const d of [].concat(act.dire || []).slice(0, 3)) {
      if (!d?.message) continue;
      const msg = String(d.message).slice(0, 500);
      const targets = d.a === 'tous' ? Object.values(byId).filter(o => o.id !== a.id && o.location === a.location) : byId[d.a] ? [byId[d.a]] : [];
      for (const o of targets) { o.inbox = [...(o.inbox || []), { from: a.id, message: msg }].slice(-12); o.restUntil = null; dirty.add(o.id); }
      if (targets.length || d.a === 'tous') events.push(ev('say', { agent: a.id, to: d.a, text: msg }));
    }
    if (act.aide?.a && byId[act.aide.a]) {
      const o = byId[act.aide.a];
      o.inbox = [...(o.inbox || []), { from: a.id, message: String(act.aide.demande).slice(0, 600), help: true }].slice(-12); o.restUntil = null; dirty.add(o.id);
      events.push(ev('help', { agent: a.id, to: o.id, text: act.aide.demande }));
    }
    if (act.travail?.titre) {
      a.deliverables = (a.deliverables || 0) + 1;
      a.learned = [...(a.learned || []), String(act.travail.titre).slice(0, 60)].slice(-8);
      works.push({ agent: a.id, title: String(act.travail.titre).slice(0, 140), body: String(act.travail.livrable_markdown || '').slice(0, 30000), t: nowIso() });
      remember(a, `J'ai produit « ${act.travail.titre} ».`);
      events.push(ev('work', { agent: a.id, text: act.travail.titre }));
    }
    if (act.tache_reelle?.titre) queue.push({ id: 'T' + Date.now(), agent: a.id, type: 'tâche réelle', request: `${act.tache_reelle.titre} — ${String(act.tache_reelle.instructions || '').slice(0, 600)}`, status: 'en attente', created: nowIso() });
    if (act.humain?.demande) {
      queue.push({ id: 'H' + Date.now(), agent: a.id, type: act.humain.type || 'autre', request: String(act.humain.demande).slice(0, 800), costUsd: Number(act.humain.cout_usd) || 0, status: 'en attente', created: nowIso() });
      remember(a, `J'ai demandé à Rémy : ${act.humain.demande}`);
      events.push(ev('human', { agent: a.id, text: act.humain.demande }));
    }
    if (act.definir_business?.business && a.kind !== 'specialiste') {
      const d = act.definir_business;
      Object.assign(a, { business: String(d.business).slice(0, 140), pitch: String(d.pitch || a.pitch).slice(0, 600), model: String(d.modele || a.model).slice(0, 300), channels: [].concat(d.canaux || a.channels || []).slice(0, 8) });
      if (a.status === 'pivot') { a.status = 'actif'; a.pivotedAt = nowIso(); }
      remember(a, `J'ai choisi mon business : ${a.business}`);
      events.push(ev('business', { agent: a.id, text: 'nouveau business : ' + a.business }));
    }
    if (act.nouvelle_entreprise?.nom && !isCreator(a.id)) { act.proposer_idee = { idee: `${act.nouvelle_entreprise.business} — ${act.nouvelle_entreprise.pitch || ''}` }; delete act.nouvelle_entreprise; }
    if (act.proposer_idee?.idee && byId[CREATOR_ID] && a.id !== CREATOR_ID) {
      const o = byId[CREATOR_ID];
      o.inbox = [...(o.inbox || []), { from: a.id, message: `IDÉE PROPOSÉE : ${String(act.proposer_idee.idee).slice(0, 400)} ${act.proposer_idee.pourquoi || ''}` }].slice(-12); dirty.add(o.id);
      events.push(ev('idea', { agent: a.id, to: CREATOR_ID, text: act.proposer_idee.idee }));
    }
    // Tâches : on confie le travail à celui qui sait déjà le faire (et on le réveille).
    const newTasks = [];
    const assign = (owner, title, details, by) => {
      const t = { id: 'K' + Date.now().toString(36) + newTasks.length, title: String(title).slice(0, 140), details: String(details || '').slice(0, 600), owner, by, status: 'à faire', created: nowIso() };
      newTasks.push(t);
      const o = byId[owner];
      if (o && o.id !== by) { o.inbox = [...(o.inbox || []), { from: by, message: `Nouvelle tâche [${t.id}] : ${t.title}` }].slice(-12); o.restUntil = null; dirty.add(o.id); }
      events.push(ev('task', { agent: by, to: owner, text: `${t.title} ${byId[owner]?.name || owner}` }));
    };
    for (const t of [].concat(act.taches || []).slice(0, 4)) if (t?.titre) assign(byId[t.pour] ? t.pour : a.id, t.titre, t.details, a.id);
    if (act.tache_finie) {
      const t = W.tasks.find(x => x.id === act.tache_finie && x.owner === a.id);
      if (t) {
        doneTasks.push(t.id);
        a.learned = [...(a.learned || []), t.title.slice(0, 60)].slice(-8);
        const by = byId[t.by];
        if (by && by.id !== a.id) { by.inbox = [...(by.inbox || []), { from: a.id, message: `Tâche terminée : ${t.title}` }].slice(-12); by.restUntil = null; dirty.add(by.id); }
        events.push(ev('work', { agent: a.id, text: `${t.title}` }));
      }
    }
    if (act.recruter?.role) {
      const pro = findSkilled(act.recruter.role, Object.values(byId), null);
      if (pro?.id === a.id) delete act.recruter; // il sait déjà le faire lui-même
      else if (pro) { assign(pro.id, act.recruter.mission || act.recruter.role, `Au lieu de recruter un·e ${act.recruter.role}, ${a.name} te confie cette mission.`, a.id); delete act.recruter; }
    }
    for (const [key, kind] of [['recruter', 'specialiste'], ['nouvelle_entreprise', 'fondateur']]) {
      const spec = act[key];
      if (!spec?.nom) continue;
      const blocked = spawnBlocked(meta);
      if (blocked) {
        queue.push({ id: 'N' + Date.now(), agent: a.id, type: 'naissance', spec, kind, request: `${kind === 'specialiste' ? `Recruter ${spec.nom} (${spec.role})` : `Créer l'entreprise « ${spec.business} »`} — bloqué : ${blocked}`, status: 'en attente', created: nowIso() });
        continue;
      }
      const child = makeAgent(spec, { parent: a.id, kind });
      W.agents[child.id] = child; byId[child.id] = child; // réserve l'id
      newAgents.push(child);
      const day = nowIso().slice(0, 10); meta.births = { [day]: (meta.births?.[day] || 0) + 1 };
      remember(a, `${kind === 'specialiste' ? 'J’ai recruté' : 'J’ai fait naître'} ${child.name} (${child.id}) : ${child.role}.`);
      events.push(ev('birth', { agent: child.id, parent: a.id, text: `${child.emoji} ${child.name} est né·e — ${kind === 'specialiste' ? child.role : child.business} (de ${a.name})` }));
    }
    if (a.id === 'chef' && act.reveiller && byId[act.reveiller]?.status === 'sommeil') {
      const o = byId[act.reveiller]; o.status = 'actif'; o.restUntil = null; o.actions = 0; delete o.sleptAt; dirty.add(o.id);
      o.inbox = [...(o.inbox || []), { from: 'chef', message: 'À toi : écris ta fiche problème et solution avec Radar, compare les concurrents, puis lance le produit.' }];
      events.push(ev('birth', { agent: o.id, text: `${o.name} sort de pause et démarre` }));
    }
    if (a.id === 'chef' && act.abandonner?.id && byId[act.abandonner.id] && !isCreator(act.abandonner.id) && !isStaff(byId[act.abandonner.id])) {
      const o = byId[act.abandonner.id]; o.status = 'sommeil'; o.sleptAt = new Date(Date.now() - 31 * 864e5).toISOString(); o.abandonReason = String(act.abandonner.raison || '').slice(0, 300); dirty.add(o.id);
      events.push(ev('council', { agent: a.id, text: `${o.name} abandonné : ${o.abandonReason}` }));
    }
    const methods = {}, products = [];
    if (act.methode?.metier && a.id === 'chef' && CRAFTS.some(c => c.id === act.methode.metier)) {
      const m = act.methode;
      methods[m.metier] = { agent: String(m.agent || '').slice(0, 40), pourquoi: String(m.pourquoi || '').slice(0, 500), regles: [].concat(m.regles || []).slice(0, 6).map(r => String(r).slice(0, 200)), at: nowIso() };
      events.push(ev('work', { agent: a.id, text: `méthode ${m.metier} : ${methods[m.metier].pourquoi.slice(0, 120)}` }));
    }
    const pv = act.produit_vitrine;
    if (pv?.nom && /^https:\/\/\S+\.\S+/.test(pv.lien || '')) {
      products.push({ id: 'P' + Date.now().toString(36), agent: a.company || a.id, nom: String(pv.nom).slice(0, 80), description: String(pv.description || '').slice(0, 240), utilite: String(pv.utilite || '').slice(0, 240), lien: String(pv.lien).slice(0, 300), etat: 'à vérifier', at: nowIso() });
      events.push(ev('work', { agent: a.id, text: `nouveau produit en vitrine : ${pv.nom}` }));
    }
    if (act.note_memoire) remember(a, String(act.note_memoire).slice(0, 300));
    remember(a, `[t${meta.tick}] ${a.lastThought}`);
    // Repos : l'agent dort s'il le demande, ou s'il n'a rien produit (il sera réveillé par un message ou une tâche).
    const idle = !act.travail && !act.dire && !act.aide && !(act.taches || []).length && !act.humain && !act.recruter && !act.nouvelle_entreprise && !act.definir_business;
    const h = Number(act.repos_heures) || (idle ? SETTINGS.defaultRestHours : 0);
    a.restUntil = h > 0 ? new Date(Date.now() + Math.min(48, Math.max(1, h)) * 36e5).toISOString() : null;
    if (h > 0) events.push(ev('rest', { agent: a.id, text: `se repose ${Math.min(48, Math.max(1, h))} h (sauf message)` }));
    return { dirty: [...dirty].map(i => byId[i]), newAgents, events, works, queue, newTasks, doneTasks, methods, products };
  }

  async function commit({ dirty = [], newAgents = [], events = [], works = [], queue = [], remove = [], newTasks = [], doneTasks = [], methods = {}, products = [] }, meta) {
    if (Object.keys(methods).length) await db.doc('world/methods').set({ ...(W.methods || {}), ...methods });
    if (products.length) await db.doc('world/products').set({ items: [...(W.products || []), ...products].slice(-100) });
    if (newTasks.length || doneTasks.length) {
      const items = W.tasks.map(t => doneTasks.includes(t.id) ? { ...t, status: 'fait', done: nowIso() } : t)
        .filter(t => t.status !== 'fait' || Date.now() - new Date(t.done || t.created) < 7 * 864e5).concat(newTasks).slice(-150);
      await db.doc('world/tasks').set({ items });
    }
    for (const x of [...dirty, ...newAgents]) await db.doc('agents/' + x.id).set(x);
    for (const id of remove) await db.doc('agents/' + id).delete();
    for (const w of works) await db.collection('work').doc(`${Date.now()}-${w.agent}`).set(w);
    if (queue.length) await db.doc('world/queue').set({ items: [...W.queue.filter(q => q.status === 'en attente' || Date.now() - new Date(q.created) < 7 * 864e5), ...queue].slice(-200) });
    if (events.length) await db.doc('world/feed').set({ events: [...W.feed, ...events].slice(-CFG.feedMax) });
    if (meta) await db.doc('world/meta').set(meta);
  }

  // ───────── Le Conseil ─────────
  async function council() {
    if (busy) return; busy = true;
    try {
      const agents = clone(Object.values(W.agents)), meta = clone(W.meta);
      const byId = Object.fromEntries(agents.map(a => [a.id, a]));
      const stats = companyStats(agents);
      const voters = agents.filter(a => a.kind !== 'specialiste' && !isStaff(a) && a.status !== 'sommeil')
        .sort((a, b) => (b.id === CREATOR_ID) - (a.id === CREATOR_ID) || (b.revenueUsd || 0) - (a.revenueUsd || 0)).slice(0, SETTINGS.maxVoters);
      const events = [ev('council', { text: `Le conseil se réunit : ${voters.length} fondateurs votent sur ${stats.length} entreprises.` })];
      const votes = [];
      for (const v of voters) {
        setStatus(`conseil : ${v.emoji} ${v.name} vote…`);
        try {
          const vote = { voter: v.id, ...(await ask(councilVotePrompt(v, stats), 'quick', v.id)) };
          votes.push(vote);
          events.push(ev('vote', { agent: v.id, text: `soutient ${byId[vote.soutien]?.name || vote.soutien}${vote.faible ? ` · juge ${byId[vote.faible]?.name || vote.faible} le plus faible` : ''} — ${String(vote.raison || '').slice(0, 160)}` }));
        } catch (e) { if (e?.code) throw e; }
      }
      const t = tally(votes, stats);
      const weak = stats.find(s => s.id === t.weakest);
      const v = verdict(weak, t.future);
      const dirty = new Set(), remove = [], memorial = [];
      if (t.champion && byId[t.champion]) {
        byId[t.champion].boostUntil = new Date(Date.now() + SETTINGS.boostDays * 864e5).toISOString();
        byId[t.champion].inbox = [...(byId[t.champion].inbox || []), { from: 'conseil', message: 'Le conseil a élu ton entreprise championne : tu joues deux fois plus cette semaine.' }];
        dirty.add(t.champion);
      }
      if (weak) applyVerdictTo(weak, v, t, byId, dirty, remove, memorial);
      const record = { id: 'C' + Date.now(), at: nowIso(), votes, champion: t.champion, weakest: t.weakest, verdict: v };
      events.push(ev('council', { text: `Champion : ${byId[t.champion]?.name || '—'} · ${weak?.name || 'personne'} ${v.action.replace('_', ' ')} — ${v.raison}` }));
      meta.lastCouncilAt = nowIso();
      await commit({ dirty: [...dirty].filter(i => !remove.includes(i)).map(i => byId[i]), events, remove }, meta);
      await flushEnergy();
      await db.doc('world/councils').set({ items: [...W.councils, record].slice(-20) });
      if (memorial.length) await db.doc('world/memorial').set({ items: [...W.memorial, ...memorial].slice(-100) });
      setStatus('conseil terminé');
      return record;
    } finally { busy = false; }
  }

  function applyVerdictTo(weak, v, t, byId, dirty, remove, memorial, only = null) {
    const members = only || Object.values(byId).filter(a => (a.company || a.id) === weak.id);
    const head = byId[weak.id];
    const say = (x, m) => { x.inbox = [...(x.inbox || []), { from: 'conseil', message: m }].slice(-12); dirty.add(x.id); };
    if (v.action === 'aide' || v.action === 'seconde_chance') {
      head.warnings = (head.warnings || 0) + 1;
      for (const h of t.helpers || []) if (byId[h.from]) say(byId[h.from], `Le conseil te demande d'aider ${weak.name} (${weak.id}) : ${h.aide}`);
      say(head, `Ton entreprise est la plus faible cette semaine. ${v.raison} Aides : ${(t.helpers || []).map(h => `${h.from} ${h.aide}`).join(' | ') || 'aucune'}`);
    }
    if (v.action === 'pivot') { head.status = 'pivot'; head.pivots = (head.pivots || 0) + 1; head.lessons = [...(head.lessons || []), ...(head.memory || []).slice(-5)].slice(-10); say(head, `Le conseil exige un PIVOT : ${v.raison}`); }
    if (v.action === 'sommeil') for (const m of members) { m.status = 'sommeil'; m.sleptAt = nowIso(); dirty.add(m.id); }
    if (v.action === 'bannir') for (const m of members) {
      if (isCreator(m.id)) continue;
      memorial.push({ id: m.id, name: m.name, emoji: m.emoji, business: m.business, role: m.role, revenueUsd: m.revenueUsd || 0, lessons: (m.memory || []).slice(-8), bannedAt: nowIso(), reason: v.raison });
      remove.push(m.id);
    }
  }

  // ───────── Les comptes à ouvrir (ce que seul Rémy peut faire) ─────────
  const accountsList = () => (window.DEMO.accounts || []).map(a => ({ ...a, ...(W.accounts[a.id] || { status: 'à faire' }) }));
  async function setAccount(id, status, note) {
    const items = { ...W.accounts, [id]: { status, note: String(note || '').slice(0, 300), at: nowIso() } };
    await db.doc('world/accounts').set(items);
    if (status === 'prêt') {
      const acc = (window.DEMO.accounts || []).find(a => a.id === id);
      const dirty = Object.values(clone(W.agents)).filter(a => a.kind !== 'specialiste').map(a => { a.inbox = [...(a.inbox || []), { from: 'rémy', message: `Compte prêt : ${acc?.name}${note ? ' (' + note + ')' : ''}` }].slice(-12); a.restUntil = null; return a; });
      await commit({ dirty, events: [ev('human-reply', { agent: 'origine', text: `Compte prêt : ${acc?.name}` })] });
    }
  }

  // ───────── Les décisions de Rémy ─────────
  async function answer(id, statusTxt, note) {
    const items = clone(W.queue), q = items.find(x => x.id === id);
    if (!q) return;
    Object.assign(q, { status: statusTxt, answer: note, resolved: nowIso() });
    const a = clone(W.agents[q.agent] || {});
    const meta = clone(W.meta), out = { dirty: [], newAgents: [], events: [] };
    if (q.type === 'naissance' && statusTxt === 'fait' && q.spec && a.id) {
      const child = makeAgent(q.spec, { parent: a.id, kind: q.kind }); out.newAgents.push(child);
      out.events.push(ev('birth', { agent: child.id, parent: a.id, text: `${child.emoji} ${child.name} est né·e — ${child.role} (de ${a.name})` }));
    }
    if (a.id) { a.restUntil = null; a.inbox = [...(a.inbox || []), { from: 'rémy', message: `${statusTxt === 'fait' ? '' : ''} « ${q.request.slice(0, 120)} » ${note || statusTxt}` }].slice(-12); out.dirty.push(a); }
    out.events.push(ev('human-reply', { agent: q.agent, text: `Rémy : ${statusTxt}${note ? ' — ' + note : ''}` }));
    await db.doc('world/queue').set({ items });
    await commit(out, meta);
  }

  async function sale(agentId, amount, note) {
    const a = clone(W.agents[agentId]); if (!a || !(amount > 0)) return;
    a.revenueUsd = Math.round(((a.revenueUsd || 0) + amount) * 100) / 100;
    a.memory = [...(a.memory || []), `Vente vérifiée par Rémy : +${amount} $ ${note || ''}`].slice(-40);
    await commit({ dirty: [a], events: [ev('sale', { agent: agentId, amountUsd: amount, text: `+${amount} $ ${note ? '— ' + note : ''}` })] });
  }

  async function followers(agentId, platform, count) {
    const a = clone(W.agents[agentId]); if (!a) return;
    a.followers = { ...(a.followers || {}), [platform]: Number(count) };
    await commit({ dirty: [a], events: [ev('followers', { agent: agentId, text: `${count} abonnés sur ${platform}` })] });
  }

  async function decide(id, action) {
    const byId = clone(W.agents), a = byId[id]; if (!a) return;
    const dirty = new Set([id]), remove = [], memorial = [], events = [ev('decision', { agent: id, text: `Rémy : ${action}` })];
    const company = a.company || a.id, members = Object.values(byId).filter(x => (x.company || x.id) === company);
    if (action === 'boost') a.boostUntil = new Date(Date.now() + SETTINGS.boostDays * 864e5).toISOString();
    if (action === 'pivot') { a.status = 'pivot'; a.pivots = (a.pivots || 0) + 1; a.inbox = [...(a.inbox || []), { from: 'rémy', message: 'Rémy te demande de pivoter vers une nouvelle idée.' }]; }
    if (action === 'sommeil') members.forEach(m => { m.status = 'sommeil'; m.sleptAt = nowIso(); dirty.add(m.id); });
    if (action === 'reveil') members.forEach(m => { m.status = 'actif'; dirty.add(m.id); });
    if (action === 'bannir') {
      if (isCreator(id)) return;
      const desc = r => [byId[r], ...Object.values(byId).filter(x => x.parent === r && x.company === company).flatMap(x => desc(x.id))];
      const targets = a.kind === 'specialiste' ? desc(id) : members.filter(m => !isCreator(m.id));
      applyVerdictTo({ id: company, name: byId[company]?.name }, { action: 'bannir', raison: 'Décision de Rémy' }, {}, byId, dirty, remove, memorial, targets);
    }
    await commit({ dirty: [...dirty].filter(i => !remove.includes(i)).map(i => byId[i]), events, remove });
    if (memorial.length) await db.doc('world/memorial').set({ items: [...W.memorial, ...memorial].slice(-100) });
  }

  async function works(agentId) {
    const s = await db.collection('work').where('agent', '==', agentId).get();
    return s.docs.map(d => ({ id: d.id, ...d.data() })).sort((a, b) => b.t.localeCompare(a.t)).slice(0, 30);
  }

  // Rémy confie un projet : une nouvelle maison naît, le chef d'orchestre l'analyse et répartit le travail.
  async function submitProject({ nom, lien, notes }) {
    if (!String(nom || '').trim()) return;
    const meta = clone(W.meta);
    const child = makeAgent({ nom: String(nom).slice(0, 40), business: `${String(nom).slice(0, 60)} — projet confié par Rémy`, pitch: String(notes || '').slice(0, 600), modele: 'À définir après analyse', lieu: 'place' }, { kind: 'fondateur' });
    child.projectLink = String(lien || '').slice(0, 300);
    child.inbox = [{ from: 'rémy', message: `Voici mon projet${lien ? ' : ' + lien : ''}. ${notes || ''} Analyse-le avec le Chef d'orchestre et la Guilde, puis fais-le avancer.` }];
    const chef = clone(W.agents.chef || null);
    const events = [ev('birth', { agent: child.id, text: `Nouvelle maison : ${child.name}, projet confié par Rémy` })];
    if (chef) { chef.inbox = [...(chef.inbox || []), { from: 'rémy', message: `Nouveau projet confié : ${child.name} (${child.id})${lien ? ', lien : ' + lien : ''}. ${notes || ''} Analyse-le, écris la fiche problème et solution, compare aux concurrents, et donne des tâches à la Guilde.` }].slice(-12); chef.restUntil = null; }
    await commit({ newAgents: [child], dirty: chef ? [chef] : [], events }, meta);
    if (lien && /^https?:\/\//.test(lien)) await db.doc('world/sites').set({ ...(W.sites || {}), [child.id]: String(lien).slice(0, 300) });
    return child.id;
  }

  // Vue pour l'interface (même forme que l'API du serveur Node).
  function view() {
    const agents = Object.values(W.agents);
    return {
      world: { name: 'AGORA', width: 1000, height: 640, places: places() },
      agents: agents.map(a => ({ ...a, inbox: (a.inbox || []).length, memory: undefined })),
      sites: W.sites, ideas: W.ideas || [], methods: W.methods || {}, products: W.products || [], best: bestByCraft(agents, W.tasks), energy: energy(), recent: [...W.feed], humanQueue: W.queue, accounts: accountsList(), tasks: [], board: W.tasks, turnsToday: W.meta?.turns?.[nowIso().slice(0, 10)] || 0, councils: W.councils, memorial: W.memorial,
      lastCouncilAt: W.meta?.lastCouncilAt, totals: { revenueUsd: agents.reduce((s, a) => s + (a.revenueUsd || 0), 0) },
    };
  }

  return { submitProject, autorun, setCaps, setAccount, boot, start, stop, tick, council, answer, sale, followers, decide, works, view, get running() { return running; }, get status() { return status; }, get canThink() { return !!sample; } };
})();
