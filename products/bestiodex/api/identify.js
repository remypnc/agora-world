// Identification d'un animal sur une photo, via Vercel AI Gateway (authentification OIDC automatique sur Vercel).
// Le texte de la consigne reste côté serveur : le client n'envoie que l'image, la date et la position.
const hits = new Map();
function prompt(meta) {
  const known = (meta.known || []).slice(0, 80);
  return `Tu es un naturaliste expert du monde entier (faune sauvage, animaux domestiques et leurs races, poissons d'aquarium, vie marine, insectes). Identifie l'animal principal de la photo.
Contexte : ${meta.lat != null ? `photo prise près de latitude ${meta.lat.toFixed(4)}, longitude ${meta.lng.toFixed(4)} (tiens-en compte : la faune locale aide à trancher entre espèces proches, par exemple coq bankiva sauvage en Asie du Sud-Est plutôt que poule domestique)` : meta.tz ? `position GPS absente ; le téléphone est réglé sur le fuseau horaire ${meta.tz}, la photo a donc très probablement été prise dans ce pays : privilégie les espèces présentes là-bas` : 'lieu inconnu'}${meta.date ? `, le ${meta.date.slice(0, 10)}` : ''}.
${known.length ? `Espèces déjà dans la collection : ${known.join(' ; ')}.
Si l'animal est la même espèce qu'une de celles-ci, reprends EXACTEMENT son nom, son nom latin et son groupe.` : ''}
Règles :
- Regarde vraiment les détails visibles (forme, nageoires, couleurs, taille relative, bec, pelage, milieu). Ne propose pas une espèce populaire par défaut (carpe koï, poule domestique…) si ses caractères ne sont pas nettement visibles.
- Entre deux espèces proches (par exemple deux roussettes du genre Pteropus), choisis celle qui est la plus courante dans la région de la photo, sauf détail visible qui prouve l'inverse.
- Si tu ne peux pas aller jusqu'à l'espèce, reste au niveau que tu peux affirmer (genre ou famille, par exemple "Tétra" ou "Poisson-chat") avec "latin" au niveau du genre ou de la famille. N'invente jamais une espèce.
- Si ce n'est pas un animal, ou si tu n'es pas sûr à au moins 50 % même au niveau de la famille, mets "reconnu": false et explique pourquoi dans "raison".
- "groupe" : le nom général de l'animal, au singulier, tel qu'une personne le dirait (ex. "Carpe", "Chauve-souris", "Poule", "Chat", "Tétra", "Gecko"). Deux espèces ou races proches ont le même groupe.
- "race" : seulement pour un animal domestique dont la race est reconnaissable, sinon "".
- "domestique" : true pour un animal domestiqué (chien, chat, poule, poisson rouge…), false pour un animal sauvage, même en captivité.
- Rareté = difficulté pour une personne ordinaire de l'observer à cet endroit : "commun" (moineau, pigeon, chat de gouttière), "peu_commun" (mésange, écureuil, chien de race répandue), "rare" (renard, héron, samoyède), "epique" (martin-pêcheur, chouette, dauphin, chauve-souris en colonie), "legendaire" (hippocampe, loutre, aigle royal), "mythique" (espèce menacée ou presque jamais vue dans cette région).
- "pays", "pays_iso" (code ISO 3166 numérique à 3 chiffres, ex. "250" pour la France, "116" pour le Cambodge) et "lieu" (ville ou région) : déduis-les des coordonnées si elles sont fournies, sinon du fuseau horaire, sinon "".
- Écris en français, sans émojis, phrases courtes.
Réponds UNIQUEMENT avec ce JSON, sans balises de code :
{"reconnu": true, "nom": "nom courant", "latin": "nom scientifique", "groupe": "", "race": "", "categorie": "mammifere|oiseau|poisson|reptile|amphibien|insecte|arachnide|mollusque|crustace|autre", "domestique": false, "rarete": "commun|peu_commun|rare|epique|legendaire|mythique", "raison_rarete": "une phrase", "confiance": 0.0, "habitat": "une phrase", "repartition": "une phrase", "anecdote": "un fait vrai", "statut_uicn": "LC|NT|VU|EN|CR|non évalué", "pays": "", "pays_iso": "", "lieu": "", "raison": ""}`;
}

async function gateway(content, token) {
  const r = await fetch('https://ai-gateway.vercel.sh/v1/chat/completions', {
    method: 'POST', headers: { Authorization: 'Bearer ' + token, 'Content-Type': 'application/json' },
    body: JSON.stringify({ model: process.env.BESTIODEX_MODEL || 'google/gemini-2.5-flash', max_tokens: 8000, messages: [{ role: 'user', content }] }),
  });
  const text = await r.text();
  let j = null; try { j = JSON.parse(text); } catch {}
  if (!r.ok) { console.error('gateway', r.status, text.slice(0, 500)); throw new Error((j?.error?.message || text || 'gateway ' + r.status).slice(0, 300)); }
  return j?.choices?.[0]?.message?.content || '';
}

// Le modèle entoure parfois sa réponse de balises de code, ou la coupe : on récupère le JSON quand même.
function parseJson(text) {
  let t = String(text).replace(/```(?:json)?/gi, '').trim();
  const i = t.indexOf('{'); if (i < 0) throw new Error('Réponse illisible');
  t = t.slice(i); const j = t.lastIndexOf('}');
  try { return JSON.parse(t.slice(0, j + 1)); } catch {}
  // réponse coupée : on ferme la dernière valeur et l'objet
  let cut = t.replace(/,\s*"[^"]*"?\s*:?\s*"?[^"]*$/, '');
  if ((cut.match(/"/g) || []).length % 2) cut += '"';
  return JSON.parse(cut + '}');
}

export default async function handler(req, res) {
  const token = req.headers['x-vercel-oidc-token'] || process.env.AI_GATEWAY_API_KEY || process.env.VERCEL_OIDC_TOKEN;
  if (req.method === 'GET') {
    // Diagnostic : /api/identify?ping=1 vérifie que la connexion à l'IA fonctionne.
    if (req.query?.test) {
      // Diagnostic : identifie une image de test (URL publique) de bout en bout.
      try {
        const im = await fetch(String(req.query.test)); const b = Buffer.from(await im.arrayBuffer());
        const url = 'data:' + (im.headers.get('content-type') || 'image/jpeg') + ';base64,' + b.toString('base64');
        const text = await gateway([{ type: 'text', text: prompt({ lat: 48.85, lng: 2.35, date: null, known: [] }) }, { type: 'image_url', image_url: { url } }], token);
        return res.status(200).json({ ok: true, text: text.slice(0, 1500) });
      } catch (e) { return res.status(200).json({ ok: false, error: e.message }); }
    }
    if (!req.query?.ping) return res.status(405).json({ error: 'POST seulement' });
    try { return res.status(200).json({ ok: true, token: !!token, reply: (await gateway('Réponds juste OK.', token)).slice(0, 40) }); }
    catch (e) { return res.status(200).json({ ok: false, token: !!token, error: e.message }); }
  }
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST seulement' });
  const ip = String(req.headers['x-forwarded-for'] || '').split(',')[0] || 'x', now = Date.now();
  const h = (hits.get(ip) || []).filter(t => now - t < 60000); h.push(now); hits.set(ip, h);
  if (h.length > 12) return res.status(429).json({ error: 'Trop de photos, patientez une minute.' });
  const { image, meta = {} } = req.body || {};
  if (typeof image !== 'string' || !image.startsWith('data:image/') || image.length > 3000000) return res.status(400).json({ error: 'Image invalide' });
  const m = { lat: Number.isFinite(meta.lat) ? meta.lat : null, lng: Number.isFinite(meta.lng) ? meta.lng : null, date: typeof meta.date === 'string' ? meta.date.slice(0, 30) : null, known: Array.isArray(meta.known) ? meta.known.filter(k => typeof k === 'string').slice(0, 80).map(k => k.slice(0, 120).replace(/[`$]/g, '')) : [], tz: typeof meta.tz === 'string' && /^[A-Za-z_\/+-]{1,40}$/.test(meta.tz) ? meta.tz : '' };
  try {
    const text = await gateway([{ type: 'text', text: prompt(m) }, { type: 'image_url', image_url: { url: image } }], token);
    return res.status(200).json(parseJson(text));
  } catch (e) { console.error('identify', e.message); return res.status(502).json({ error: e.message || 'Analyse impossible' }); }
}
