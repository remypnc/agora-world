// Cerveau des agents : n'importe quelle API compatible OpenAI, avec des fournisseurs gratuits.
import { env } from './env.js';
import fs from 'node:fs';
import path from 'node:path';
import { ROOT } from './env.js';
import { map } from './store.js';

const INSPI = JSON.parse(fs.readFileSync(path.join(ROOT, 'world/inspiration.json'), 'utf8'));

const PROVIDERS = {
  openrouter: { url: 'https://openrouter.ai/api/v1/chat/completions', model: 'meta-llama/llama-3.3-70b-instruct:free' },
  groq:       { url: 'https://api.groq.com/openai/v1/chat/completions', model: 'llama-3.3-70b-versatile' },
  gemini:     { url: 'https://generativelanguage.googleapis.com/v1beta/openai/chat/completions', model: 'gemini-2.0-flash' },
  ollama:     { url: 'http://localhost:11434/v1/chat/completions', model: 'qwen2.5:7b' },
};

export class QuotaError extends Error {
  constructor(message, retryMs) { super(message); this.name = 'QuotaError'; this.retryMs = retryMs; }
}

export async function think(messages, { agent, others } = {}) {
  if (env.provider === 'mock') return mock(agent, others);
  const p = PROVIDERS[env.provider];
  if (!p) throw new Error(`LLM_PROVIDER inconnu : ${env.provider}`);
  const res = await fetch(p.url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...(env.apiKey ? { Authorization: `Bearer ${env.apiKey}` } : {}) },
    body: JSON.stringify({ model: env.model || p.model, messages, temperature: 0.8, max_tokens: 1400, response_format: { type: 'json_object' } }),
  });
  if (!res.ok) {
    const body = (await res.text()).slice(0, 300);
    // Réserve épuisée (quota gratuit, crédits, limite par minute) : on le signale proprement
    // pour que la ville se mette en pause et reprenne seule, au lieu d'insister et d'échouer en boucle.
    if (res.status === 429 || res.status === 402 || /quota|rate.?limit|insufficient|credit/i.test(body)) {
      const ra = Number(res.headers.get('retry-after'));
      throw new QuotaError(`${env.provider} ${res.status}: ${body}`, Number.isFinite(ra) && ra > 0 ? ra * 1000 : null);
    }
    throw new Error(`${env.provider} ${res.status}: ${body}`);
  }
  const data = await res.json();
  return data.choices?.[0]?.message?.content || '{}';
}

// ── Mode simulation : aucun appel d'IA, mais la ville vit quand même ──
const pick = a => a[Math.floor(Math.random() * a.length)];
function mock(agent, others = []) {
  const other = pick(others.length ? others : [{ id: 'tous', name: 'tous' }]);
  const place = pick(map.places).id;
  const r = Math.random();
  if (agent.business === 'À découvrir') {
    const b = INSPI.businesses[Math.floor(Math.random() * INSPI.businesses.length)];
    return JSON.stringify({ pensee: `Après comparaison des marchés, je lance : ${b.business}.`, definir_business: b });
  }
  if (r > .9) {
    const want = agent.kind === 'specialiste' ? null : Math.random() < .6
      ? { recruter: { ...pick(INSPI.specialists) } }
      : { nouvelle_entreprise: { ...pick(INSPI.businesses) } };
    if (want) return JSON.stringify({ pensee: want.recruter ? `Il me faut un·e ${want.recruter.role}.` : `Cette idée mérite sa propre entreprise : ${want.nouvelle_entreprise.business}.`, ...want });
  }
  const out = { pensee: pick([
    `Je teste un nouveau hook pour ${agent.business}.`,
    `Il me faut une page de vente plus claire.`,
    `Je compare 3 fournisseurs avant de commander.`,
    `Mon contenu d'hier a fait peu de vues : je change l'accroche.`,
    `Une collaboration avec ${other.name} pourrait nous aider tous les deux.`,
  ]), aller: r < .5 ? place : null };
  if (r < .45) out.dire = [{ a: other.id, message: pick([
    `Tu veux qu'on fasse une vidéo croisée cette semaine ?`,
    `Tu as un bon fournisseur à me conseiller ?`,
    `Ton dernier post est top, c'était quoi ton hook ?`,
    `Je peux te faire des visuels en échange d'un shoutout.`,
  ]) }];
  else if (r < .6) out.aide = { a: other.id, demande: `Peux-tu relire ma page de vente et me dire ce qui bloque l'achat ?` };
  else if (r < .85) out.travail = { titre: pick(['Plan de contenu 7 jours', 'Fiche produit v1', 'Script vidéo 30 s', 'Étude des concurrents', 'Grille de prix']), livrable_markdown: `# Brouillon\n\n(Simulation : en mode réel, le livrable complet est écrit ici.)` };
  else if (r < .93) out.humain = { type: pick(['compte', 'validation', 'paiement']), demande: pick([
    `Créer le compte Instagram de ma marque (je fournis bio + photo).`,
    `Valider la publication de ma première vidéo.`,
    `Brancher le webhook Lemon Squeezy de ma boutique.`,
  ]), cout_usd: 0 };
  else out.note_memoire = `Les vidéos courtes avec texte à l'écran marchent mieux.`;
  return JSON.stringify(out);
}
