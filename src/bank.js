// La Banque : seul endroit où l'argent entre dans le classement.
// Sources acceptées : webhooks signés (Lemon Squeezy, Gumroad, Stripe) ou saisie manuelle de l'humain.
import crypto from 'node:crypto';
import { env } from './env.js';
import { state, profiles, emit, save, round } from './store.js';
import { createAgent } from './genesis.js';

// Chaque produit vendu doit porter l'id de l'agent :
//  - Lemon Squeezy : custom data  checkout[custom][agent]=sora  (ou nom de produit qui commence par "sora:")
//  - Gumroad       : nom du produit qui commence par "sora:" ou champ personnalisé "agent"
//  - Stripe        : metadata.agent = "sora"
export function recordSale({ agent, amountUsd, source, ref, note }) {
  if (!state.agents[agent]) throw new Error(`Agent inconnu : ${agent}`);
  if (ref && state.ledger.some(l => l.ref === ref)) return null; // anti-doublon
  const entry = { agent, amountUsd: round(amountUsd), source, ref: ref || `manual-${Date.now()}`, note: note || '', t: new Date().toISOString() };
  state.ledger.push(entry);
  state.agents[agent].revenueUsd = round(state.agents[agent].revenueUsd + entry.amountUsd);
  state.agents[agent].memory.push(`Vente vérifiée : +${entry.amountUsd} $ (${source}). ${note || ''}`);
  emit('sale', { agent, amountUsd: entry.amountUsd, source, text: `+${entry.amountUsd} $ via ${source}` });
  save();
  return entry;
}

export function setFollowers(agent, platform, count) {
  if (!state.agents[agent]) throw new Error(`Agent inconnu : ${agent}`);
  state.agents[agent].followers[platform] = Number(count);
  emit('followers', { agent, platform, count: Number(count), text: `${count} abonnés sur ${platform}` });
  save();
}

const agentFromName = name => {
  const m = String(name || '').match(/^([a-z0-9-]+)\s*:/i);
  return m && profiles[m[1].toLowerCase()] ? m[1].toLowerCase() : null;
};
const safeEqual = (a, b) => a.length === b.length && crypto.timingSafeEqual(Buffer.from(a), Buffer.from(b));

export function handleWebhook(provider, rawBody, headers, query) {
  if (provider === 'lemonsqueezy') {
    if (!env.lemonSecret) throw new Error('LEMONSQUEEZY_WEBHOOK_SECRET manquant');
    const sig = crypto.createHmac('sha256', env.lemonSecret).update(rawBody).digest('hex');
    if (!safeEqual(sig, String(headers['x-signature'] || ''))) throw new Error('Signature invalide');
    const body = JSON.parse(rawBody);
    if (body.meta?.event_name !== 'order_created') return null;
    const attr = body.data?.attributes || {};
    const agent = body.meta?.custom_data?.agent || agentFromName(attr.first_order_item?.product_name);
    return recordSale({ agent, amountUsd: (attr.total_usd ?? attr.total) / 100, source: 'Lemon Squeezy', ref: `ls-${body.data?.id}`, note: attr.first_order_item?.product_name });
  }
  if (provider === 'gumroad') {
    if (!env.gumroadToken || query.get('token') !== env.gumroadToken) throw new Error('Token invalide');
    const body = Object.fromEntries(new URLSearchParams(rawBody));
    const agent = body['custom_fields[agent]'] || agentFromName(body.product_name);
    const usd = Number(body.price) / 100; // Gumroad envoie le prix en centimes de la devise du produit
    return recordSale({ agent, amountUsd: usd, source: 'Gumroad', ref: `gr-${body.sale_id}`, note: body.product_name });
  }
  if (provider === 'stripe') {
    if (!env.stripeSecret) throw new Error('STRIPE_WEBHOOK_SECRET manquant');
    const parts = Object.fromEntries(String(headers['stripe-signature'] || '').split(',').map(kv => kv.split('=')));
    const sig = crypto.createHmac('sha256', env.stripeSecret).update(`${parts.t}.${rawBody}`).digest('hex');
    if (!parts.v1 || !safeEqual(sig, parts.v1)) throw new Error('Signature invalide');
    const ev = JSON.parse(rawBody);
    if (ev.type !== 'checkout.session.completed') return null;
    const s = ev.data.object;
    return recordSale({ agent: s.metadata?.agent, amountUsd: s.amount_total / 100, source: 'Stripe', ref: `st-${s.id}` });
  }
  throw new Error('Fournisseur inconnu');
}

export function resolveHuman(id, status, answer = '') {
  const h = state.humanQueue.find(x => x.id === id);
  if (!h) throw new Error('Demande introuvable');
  h.status = status; h.answer = answer; h.resolved = new Date().toISOString();
  if (h.type === 'naissance' && status === 'fait' && h.spec) createAgent(h.spec, { parent: h.agent, kind: h.kind });
  const a = state.agents[h.agent];
  if (a) a.restUntil = null;
  if (a) a.inbox.push({ from: 'rémy', message: `${status === 'fait' ? '' : ''} « ${h.request.slice(0, 120)} » ${answer || status}` });
  emit('human-reply', { agent: h.agent, text: `Rémy : ${status}${answer ? ' — ' + answer : ''}` });
  save();
  return h;
}

export function resolveTask(id, status, answer = '') {
  const t = state.tasks.find(x => x.id === id);
  if (!t) throw new Error('Tâche introuvable');
  t.status = status; t.answer = answer;
  state.agents[t.agent]?.inbox.push({ from: 'rémy', message: `Tâche « ${t.title} » : ${status}${answer ? ' — ' + answer : ''}` });
  emit('task-update', { agent: t.agent, text: `${t.title} ${status}`, taskId: id });
  save();
  return t;
}
