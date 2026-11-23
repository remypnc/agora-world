// Souche — devis, factures, pipeline et relances pour indépendants.
// Version 1 : tout est enregistré sur l'appareil (localStorage). Aucune donnée n'est envoyée.

const CLE = 'souche.v1';
const $ = (s, el = document) => el.querySelector(s);
const $$ = (s, el = document) => [...el.querySelectorAll(s)];
const uid = () => Math.random().toString(36).slice(2, 10) + Date.now().toString(36).slice(-4);
const esc = (v) => String(v ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const euro = (n) => (Number(n) || 0).toLocaleString('fr-FR', { style: 'currency', currency: 'EUR' });
const auj = () => new Date().toISOString().slice(0, 10);
const plusJours = (iso, j) => { const d = new Date((iso || auj()) + 'T12:00:00'); d.setDate(d.getDate() + Number(j || 0)); return d.toISOString().slice(0, 10); };
const fr = (iso) => iso ? iso.split('-').reverse().join('/') : '—';
const ecart = (iso) => Math.round((new Date(iso + 'T12:00:00') - new Date(auj() + 'T12:00:00')) / 864e5);

const TEINTES = ['#1A2238', '#3F3A8F', '#2F6B4F', '#C8432B', '#B7802A', '#17181C', '#2D5A8C', '#7A2E4A'];
const STATUTS_DEVIS = { brouillon: 'Brouillon', envoye: 'Envoyé', relance: 'Relancé', accepte: 'Accepté', refuse: 'Refusé', expire: 'Expiré' };
const STATUTS_FACT = { brouillon: 'À émettre', envoye: 'Envoyée', partiel: 'Partiellement payée', paye: 'Payée', annule: 'Annulée' };

/* ---------------- état ---------------- */
const vierge = () => ({
  entreprise: {
    nomCommercial: '', nomLegal: '', adresse: '', siren: '', siret: '', ape: '', email: '', tel: '', site: '',
    iban: '', bic: '', franchise: true, tauxTva: 20, delaiPaiement: 30, validiteDevis: 30, relanceJours: 4,
    penalites: "trois fois le taux d'intérêt légal", couleur: '#1A2238', logo: '', mentionLibre: '',
  },
  clients: [], docs: [], compteurs: {},
});
let E;
try { E = JSON.parse(localStorage.getItem(CLE)) || vierge(); } catch { E = vierge(); }
E = { ...vierge(), ...E, entreprise: { ...vierge().entreprise, ...(E.entreprise || {}) } };
const sauver = () => { try { localStorage.setItem(CLE, JSON.stringify(E)); } catch (e) { toast("Stockage plein : retire le logo ou sauvegarde tes données."); } majBadge(); };

const client = (id) => E.clients.find((c) => c.id === id);
const nomClient = (c) => c ? (c.entreprise || c.nom || 'Sans nom') : 'Client à choisir';

/* ---------------- calculs ---------------- */
function totaux(d) {
  const ht = (d.lignes || []).reduce((s, l) => s + (Number(l.qte) || 0) * (Number(l.pu) || 0), 0);
  const taux = E.entreprise.franchise ? 0 : Number(d.tva ?? E.entreprise.tauxTva) || 0;
  const tva = Math.round(ht * taux) / 100;
  const ttc = Math.round((ht + tva) * 100) / 100;
  const acompte = Math.round(ttc * (Number(d.acompte) || 0)) / 100;
  const recu = Number(d.recu) || 0;
  return { ht, taux, tva, ttc, acompte, recu, reste: Math.max(0, Math.round((ttc - recu) * 100) / 100) };
}
function statutAffiche(d) {
  if (d.type === 'facture') {
    if ((d.statut === 'envoye' || d.statut === 'partiel') && d.echeance && ecart(d.echeance) < 0) return ['En retard', 'retard'];
    return [STATUTS_FACT[d.statut] || d.statut, d.statut === 'partiel' ? 'partiel' : d.statut];
  }
  if ((d.statut === 'envoye' || d.statut === 'relance') && d.validite && ecart(d.validite) < 0) return ['Expiré', 'expire'];
  return [STATUTS_DEVIS[d.statut] || d.statut, d.statut];
}
function numero(type, dateIso) {
  const an = (dateIso || auj()).slice(0, 4), k = `${type}-${an}`;
  E.compteurs[k] = (E.compteurs[k] || 0) + 1;
  return `${type === 'devis' ? 'D' : 'F'}-${an}-${String(E.compteurs[k]).padStart(3, '0')}`;
}
function relancesDues() {
  const out = [];
  for (const d of E.docs) {
    if (d.type === 'devis' && (d.statut === 'envoye' || d.statut === 'relance') && d.relance && ecart(d.relance) <= 0 && !(d.validite && ecart(d.validite) < -14))
      out.push({ d, genre: d.validite && ecart(d.validite) <= 3 ? 'expiration' : 'devis', jours: -ecart(d.relance) });
    if (d.type === 'facture' && (d.statut === 'envoye' || d.statut === 'partiel') && d.echeance) {
      const due = d.relance || d.echeance;
      if (ecart(d.echeance) < 0 && ecart(due) <= 0) out.push({ d, genre: 'paiement', jours: -ecart(d.echeance) });
    }
  }
  return out.sort((a, b) => b.jours - a.jours);
}
function majBadge() {
  const n = relancesDues().length, b = $('#badge-relances');
  if (!b) return; b.hidden = !n; b.textContent = n;
}

/* ---------------- messages de relance ---------------- */
function message(genre, d) {
  const c = client(d.client) || {}, prenom = (c.nom || '').split(' ')[0] || 'Madame, Monsieur', t = totaux(d);
  const sign = E.entreprise.nomCommercial || E.entreprise.nomLegal || '';
  if (genre === 'devis') return {
    sujet: `Votre devis ${d.numero} — ${d.objet || ''}`.trim(),
    corps: `Bonjour ${prenom},\n\nJe reviens vers vous au sujet de ma proposition pour ${d.objet || 'votre projet'} (devis ${d.numero}). Avez-vous eu le temps de la parcourir ?\n\nJe peux clarifier le périmètre, les étapes ou adapter la proposition à vos priorités. Si vous préférez, nous pouvons en parler en 10 minutes.\n\nBonne journée,\n${sign}`,
  };
  if (genre === 'expiration') return {
    sujet: `Devis ${d.numero} : échéance le ${fr(d.validite)}`,
    corps: `Bonjour ${prenom},\n\nLa proposition ${d.numero} pour ${d.objet || 'votre projet'} arrive à échéance le ${fr(d.validite)}. Souhaitez-vous que je maintienne le créneau prévu ou que nous ajustions le calendrier ?\n\nAucun souci si le projet a changé de priorité ; un retour rapide me permettra simplement de m'organiser.\n\nBien à vous,\n${sign}`,
  };
  return {
    sujet: `Facture ${d.numero} — rappel de paiement`,
    corps: `Bonjour ${prenom},\n\nSauf erreur de ma part, la facture ${d.numero}, d'un montant de ${euro(t.reste)}, arrivée à échéance le ${fr(d.echeance)}, apparaît encore comme non réglée dans mon suivi.\n\nPourriez-vous me confirmer si le paiement a été effectué ? Je peux vous renvoyer le document ou les informations nécessaires.\n\nMerci par avance,\n${sign}`,
  };
}
const mailto = (d, genre) => { const c = client(d.client) || {}, m = message(genre, d); return `mailto:${encodeURIComponent(c.email || '')}?subject=${encodeURIComponent(m.sujet)}&body=${encodeURIComponent(m.corps)}`; };

/* ---------------- interface : utilitaires ---------------- */
let vueCourante = 'tableau', filtre = 'tous';
function toast(t) { const el = $('#toast'); el.textContent = t; el.classList.add('vu'); clearTimeout(toast.t); toast.t = setTimeout(() => el.classList.remove('vu'), 2600); }
function puce(d) { const [l, c] = statutAffiche(d); return `<span class="puce p-${c}">${esc(l)}</span>`; }
function aller(v) {
  vueCourante = v;
  $$('.nav nav button').forEach((b) => b.classList.toggle('on', b.dataset.vue === v));
  ({ tableau, documents, pipeline, relances, clients, reglages })[v]();
  $('#vue').focus({ preventScroll: true }); window.scrollTo(0, 0);
}
$$('.nav nav button').forEach((b) => b.addEventListener('click', () => aller(b.dataset.vue)));
function ouvrirFeuille(html, apres) {
  const f = $('#feuille'); f.innerHTML = `<div class="panneau" role="dialog" aria-modal="true">${html}</div>`; f.hidden = false;
  document.body.style.overflow = 'hidden';
  f.onclick = (e) => { if (e.target === f) fermerFeuille(); };
  $$('[data-fermer]', f).forEach((b) => b.onclick = fermerFeuille);
  apres && apres($('.panneau', f));
  setTimeout(() => $('input,select,textarea', f)?.focus(), 60);
}
function fermerFeuille() { $('#feuille').hidden = true; document.body.style.overflow = ''; aller(vueCourante); }
document.addEventListener('keydown', (e) => { if (e.key === 'Escape') { if (!$('#apercu').hidden) fermerApercu(); else if (!$('#feuille').hidden) fermerFeuille(); } });
const lire = (form) => Object.fromEntries(new FormData(form).entries());

/* ---------------- vue : tableau ---------------- */
function tableau() {
  const mois = auj().slice(0, 7);
  const fact = E.docs.filter((d) => d.type === 'facture' && d.statut !== 'annule' && d.statut !== 'brouillon');
  const encaisse = E.docs.reduce((s, d) => s + (d.paiements || []).filter((p) => p.date.slice(0, 7) === mois).reduce((a, p) => a + Number(p.montant), 0), 0);
  const reste = fact.reduce((s, d) => s + totaux(d).reste, 0);
  const devis = E.docs.filter((d) => d.type === 'devis');
  const attente = devis.filter((d) => ['envoye', 'relance'].includes(d.statut) && statutAffiche(d)[1] !== 'expire');
  const decides = devis.filter((d) => ['accepte', 'refuse'].includes(d.statut));
  const taux = decides.length ? Math.round(100 * decides.filter((d) => d.statut === 'accepte').length / decides.length) + ' %' : '—';
  const dues = relancesDues();
  const etapes = [
    ['Renseigne ton entreprise et ton logo', !!(E.entreprise.nomLegal && E.entreprise.siren), 'reglages'],
    ['Ajoute ton premier client', E.clients.length > 0, 'clients'],
    ['Crée ton premier devis', devis.length > 0, 'documents'],
  ];
  $('#vue').innerHTML = `
    <div class="tete"><div><p>${new Date().toLocaleDateString('fr-FR', { weekday: 'long', day: 'numeric', month: 'long' })}</p><h1>Ton <em>carnet</em></h1></div>
      <div class="actions"><button class="btn clair" data-nouveau="devis"><svg><use href="#i-plus"/></svg>Devis</button><button class="btn" data-nouveau="facture"><svg><use href="#i-plus"/></svg>Facture</button></div></div>
    ${etapes.every((e) => e[1]) ? '' : `<div class="demarrer"><h2>Démarrer en trois minutes</h2><p class="aide">Rien n'est envoyé sur internet : tout reste dans ce navigateur. Pense à sauvegarder de temps en temps (en bas du menu).</p>
      <ol>${etapes.map((e) => `<li class="${e[1] ? 'fait' : ''}"><span>${e[0]} ${e[1] ? '' : `<button class="btn petit clair" data-aller="${e[2]}" style="margin-left:8px">Faire</button>`}</span></li>`).join('')}</ol></div>`}
    <div class="chiffres">
      <div><span>Encaissé ce mois</span><strong>${euro(encaisse)}</strong><small>argent vraiment reçu</small></div>
      <div><span>Reste à encaisser</span><strong>${euro(reste)}</strong><small>${fact.filter((d) => totaux(d).reste > 0).length} facture(s)</small></div>
      <div><span>Devis en attente</span><strong>${euro(attente.reduce((s, d) => s + totaux(d).ttc, 0))}</strong><small>${attente.length} devis</small></div>
      <div><span>Taux d'acceptation</span><strong>${taux}</strong><small>${decides.length} devis tranché(s)</small></div>
    </div>
    <div class="deux">
      <section class="bloc"><h2>À relancer <small>${dues.length} AUJOURD'HUI</small></h2>${dues.length ? dues.slice(0, 5).map(ligneRelance).join('') : '<p class="vide">Rien à relancer aujourd\'hui. Les devis envoyés apparaîtront ici à leur date de relance, les factures dès qu\'elles sont en retard.</p>'}</section>
      <section class="bloc"><h2>Derniers documents</h2>${E.docs.length ? `<div class="liste">${[...E.docs].sort((a, b) => b.majLe.localeCompare(a.majLe)).slice(0, 6).map(ligneDoc).join('')}</div>` : '<p class="vide">Aucun document pour l\'instant.</p>'}</section>
    </div>`;
  brancherListe();
}
function ligneDoc(d) {
  const t = totaux(d);
  return `<div class="ligne-doc" data-doc="${d.id}" role="button" tabindex="0"><span class="ref">${esc(d.numero || (d.type === 'facture' ? 'Facture à émettre' : 'Brouillon'))}</span>
    <span class="qui"><b>${esc(nomClient(client(d.client)))}</b><small>${esc(d.objet || '')}</small></span>
    <span class="dt">${fr(d.date)}</span><span class="st">${puce(d)}</span><span class="mt">${euro(d.type === 'facture' && t.recu ? t.reste : t.ttc)}</span></div>`;
}
function ligneRelance({ d, genre, jours }) {
  const c = client(d.client), lab = genre === 'paiement' ? `Facture en retard de ${jours} jour${jours > 1 ? 's' : ''}` : genre === 'expiration' ? `Devis bientôt expiré (${fr(d.validite)})` : `Devis sans réponse depuis ${fr(d.envoyeLe || d.date)}`;
  return `<div class="relance"><div class="q"><b>${esc(nomClient(c))}</b><small class="${genre === 'paiement' ? 'retard' : ''}">${esc(d.numero)} · ${lab} · ${euro(genre === 'paiement' ? totaux(d).reste : totaux(d).ttc)}</small></div>
    <div class="a"><a class="btn petit" href="${mailto(d, genre)}" data-ecrit="${d.id}"><svg><use href="#i-mail"/></svg>Écrire</a><button class="btn petit clair" data-fait="${d.id}">C'est fait</button><button class="btn petit clair" data-plustard="${d.id}">Dans 2 jours</button></div></div>`;
}
function brancherListe() {
  $$('[data-doc]').forEach((el) => { el.onclick = () => editerDoc(el.dataset.doc); el.onkeydown = (e) => e.key === 'Enter' && editerDoc(el.dataset.doc); });
  $$('[data-nouveau]').forEach((b) => b.onclick = () => editerDoc(null, b.dataset.nouveau));
  $$('[data-aller]').forEach((b) => b.onclick = () => b.dataset.aller === 'documents' ? editerDoc(null, 'devis') : b.dataset.aller === 'clients' ? editerClient() : aller(b.dataset.aller));
  $$('[data-fait]').forEach((b) => b.onclick = () => relanceFaite(b.dataset.fait));
  $$('[data-plustard]').forEach((b) => b.onclick = () => { const d = E.docs.find((x) => x.id === b.dataset.plustard); d.relance = plusJours(auj(), 2); d.majLe = new Date().toISOString(); sauver(); toast('Reporté de 2 jours'); aller(vueCourante); });
}
function relanceFaite(id) {
  const d = E.docs.find((x) => x.id === id);
  d.historique = [...(d.historique || []), { date: auj(), quoi: 'Relance envoyée' }];
  if (d.type === 'devis') d.statut = 'relance';
  d.relance = plusJours(auj(), 7); d.majLe = new Date().toISOString();
  sauver(); toast('Relance notée. Prochain rappel dans 7 jours.'); aller(vueCourante);
}

/* ---------------- vue : documents ---------------- */
function documents() {
  const F = { tous: () => true, devis: (d) => d.type === 'devis', factures: (d) => d.type === 'facture', encaisser: (d) => d.type === 'facture' && ['envoye', 'partiel'].includes(d.statut) };
  const liste = [...E.docs].filter(F[filtre]).sort((a, b) => (b.date + b.creeLe).localeCompare(a.date + a.creeLe));
  $('#vue').innerHTML = `
    <div class="tete"><div><p>${E.docs.length} document(s)</p><h1>Devis et <em>factures</em></h1></div>
      <div class="actions"><button class="btn clair" data-nouveau="devis"><svg><use href="#i-plus"/></svg>Nouveau devis</button><button class="btn" data-nouveau="facture"><svg><use href="#i-plus"/></svg>Nouvelle facture</button></div></div>
    <div class="filtres">${[['tous', 'Tout'], ['devis', 'Devis'], ['factures', 'Factures'], ['encaisser', 'À encaisser']].map(([k, l]) => `<button data-f="${k}" class="${filtre === k ? 'on' : ''}">${l}</button>`).join('')}</div>
    ${liste.length ? `<div class="liste">${liste.map(ligneDoc).join('')}</div>` : '<p class="vide">Aucun document ici. Commence par un devis : tu pourras le transformer en facture une fois accepté.</p>'}`;
  $$('[data-f]').forEach((b) => b.onclick = () => { filtre = b.dataset.f; documents(); });
  brancherListe();
}

/* ---------------- éditeur de document ---------------- */
function editerDoc(id, type = 'devis', brouillon = null) {
  const neuf = brouillon ? !E.docs.some((x) => x.id === brouillon.id) : !id;
  const d = brouillon ? brouillon : neuf ? {
    id: uid(), type, numero: type === 'devis' ? '' : '', date: auj(), client: E.clients[0]?.id || '', objet: '',
    lignes: [{ designation: '', detail: '', qte: 1, pu: 0 }], tva: E.entreprise.tauxTva, acompte: type === 'devis' ? 30 : 0,
    statut: 'brouillon', validite: plusJours(auj(), E.entreprise.validiteDevis), echeance: plusJours(auj(), E.entreprise.delaiPaiement),
    datePrestation: auj(), notes: '', recu: 0, paiements: [], creeLe: new Date().toISOString(), majLe: new Date().toISOString(),
  } : structuredClone(E.docs.find((x) => x.id === id));
  const estDevis = d.type === 'devis';
  const optsStatut = Object.entries(estDevis ? STATUTS_DEVIS : STATUTS_FACT).filter(([k]) => estDevis || k !== 'partiel' || d.statut === 'partiel');
  const verrou = !estDevis && d.numero; // facture émise : le contenu ne se modifie plus
  ouvrirFeuille(`
    <div class="panneau-tete"><h2>${estDevis ? 'Devis' : 'Facture'} <em>${esc(d.numero || (neuf ? 'nouveau' : 'brouillon'))}</em></h2><button class="fermer" data-fermer aria-label="Fermer"><svg><use href="#i-x"/></svg></button></div>
    ${verrou ? '<p class="aide" style="margin-bottom:16px">Cette facture est émise : son contenu est verrouillé, comme l\'exige la numérotation. Pour corriger une erreur, annule-la et émets une nouvelle facture.</p>' : ''}
    <form id="fdoc">
      <fieldset ${verrou ? 'disabled' : ''}><legend>Client et objet</legend><div class="grille">
        <label class="champ"><span>Client</span><select name="client" required><option value="">Choisir…</option>${E.clients.map((c) => `<option value="${c.id}" ${c.id === d.client ? 'selected' : ''}>${esc(nomClient(c))}</option>`).join('')}</select></label>
        <div style="display:flex;align-items:flex-end"><button type="button" class="btn clair petit" id="nv-client"><svg><use href="#i-plus"/></svg>Nouveau client</button></div>
        <label class="champ plein"><span>Objet</span><input name="objet" value="${esc(d.objet)}" placeholder="Ex. Refonte du site vitrine" required></label>
      </div></fieldset>
      <fieldset ${verrou ? 'disabled' : ''}><legend>Dates</legend><div class="grille">
        <label class="champ"><span>Date du ${estDevis ? 'devis' : 'document'}</span><input type="date" name="date" value="${d.date}"></label>
        ${estDevis ? `<label class="champ"><span>Valable jusqu'au</span><input type="date" name="validite" value="${d.validite || ''}"></label>`
                   : `<label class="champ"><span>Échéance de paiement</span><input type="date" name="echeance" value="${d.echeance || ''}"></label>`}
        <label class="champ"><span>Date de la prestation</span><input type="date" name="datePrestation" value="${d.datePrestation || ''}"></label>
        ${estDevis ? `<label class="champ"><span>Acompte demandé (%)</span><input type="number" name="acompte" min="0" max="100" step="1" value="${d.acompte ?? 0}"></label>` : ''}
      </div></fieldset>
      <fieldset ${verrou ? 'disabled' : ''}><legend>Lignes</legend>
        <div class="lignes" id="lignes"></div>
        <button type="button" class="btn clair petit" id="aj-ligne" style="margin-top:10px"><svg><use href="#i-plus"/></svg>Ajouter une ligne</button>
        ${E.entreprise.franchise ? '' : `<div class="grille" style="margin-top:14px"><label class="champ"><span>Taux de TVA (%)</span><input type="number" name="tva" step="0.1" value="${d.tva ?? E.entreprise.tauxTva}"></label></div>`}
        <div class="totaux" id="totaux"></div>
      </fieldset>
      <fieldset><legend>Suivi</legend><div class="grille">
        <label class="champ"><span>Statut</span><select name="statut" ${!estDevis && !d.numero ? 'disabled' : ''}>${optsStatut.map(([k, l]) => `<option value="${k}" ${k === d.statut ? 'selected' : ''} ${!estDevis && k === 'brouillon' && d.numero ? 'disabled' : ''}>${l}</option>`).join('')}</select></label>
        <label class="champ"><span>${estDevis ? 'Prochaine relance' : 'Rappel de paiement le'}</span><input type="date" name="relance" value="${d.relance || ''}"></label>
        <label class="champ plein"><span>Notes (imprimées en bas du document)</span><textarea name="notes" placeholder="Conditions, planning, remarques…">${esc(d.notes)}</textarea></label>
      </div>
      ${!estDevis && d.numero ? `<div class="bloc" style="margin-top:14px"><h2>Paiements reçus <small>${euro(totaux(d).recu)} / ${euro(totaux(d).ttc)}</small></h2>
        ${(d.paiements || []).map((p) => `<p class="mono" style="font-size:13px;padding:4px 0;border-bottom:1px solid var(--papier-3)">${fr(p.date)} · ${euro(p.montant)} · ${esc(p.moyen)}</p>`).join('') || '<p class="vide">Aucun paiement enregistré.</p>'}
        <div class="grille" style="margin-top:10px"><label class="champ"><span>Montant reçu</span><input type="number" step="0.01" id="p-montant" value="${totaux(d).reste}"></label>
        <label class="champ"><span>Reçu le</span><input type="date" id="p-date" value="${auj()}"></label>
        <label class="champ"><span>Moyen</span><select id="p-moyen"><option>Virement</option><option>Carte</option><option>Espèces</option><option>Chèque</option><option>Autre</option></select></label>
        <div style="display:flex;align-items:flex-end"><button type="button" class="btn petit" id="aj-paiement">Enregistrer le paiement</button></div></div>
        <p class="aide">Ne saisis que l'argent vraiment arrivé sur ton compte.</p></div>` : ''}
      </fieldset>
      <div class="barre-actions">
        ${neuf || (estDevis && d.statut === 'brouillon') || (!estDevis && !d.numero) ? '<button type="button" class="btn danger petit" id="suppr">Supprimer</button>' : ''}
        ${estDevis && !neuf && d.statut === 'accepte' && !E.docs.some((x) => x.deDevis === d.id) ? '<button type="button" class="btn clair" id="facturer">Transformer en facture</button>' : ''}
        ${!estDevis && !d.numero ? '<button type="button" class="btn clair" id="emettre">Émettre la facture</button>' : ''}
        ${estDevis && d.statut === 'brouillon' ? '<button type="button" class="btn clair" id="envoye">Marquer envoyé</button>' : ''}
        <button type="button" class="btn clair" id="voir"><svg><use href="#i-pdf"/></svg>Aperçu PDF</button>
        <button class="btn">Enregistrer</button>
      </div>
    </form>`, (p) => {
    const form = $('#fdoc', p), zone = $('#lignes', p);
    const dessinerLignes = () => {
      zone.innerHTML = d.lignes.map((l, i) => `<div class="l" data-i="${i}">
        <div><label class="champ"><span>Désignation</span><input data-k="designation" value="${esc(l.designation)}" placeholder="Ex. Maquettes des pages"></label><textarea data-k="detail" class="champ" placeholder="Détail (facultatif)" style="width:100%;background:var(--blanc);border:1px solid var(--papier-3);padding:8px">${esc(l.detail)}</textarea></div>
        <label class="champ"><span>Qté</span><input data-k="qte" type="number" step="0.25" min="0" value="${l.qte}"></label>
        <label class="champ"><span>Prix unitaire HT</span><input data-k="pu" type="number" step="0.01" value="${l.pu}"></label>
        <span class="tot">${euro((Number(l.qte) || 0) * (Number(l.pu) || 0))}</span>
        <button type="button" data-del="${i}" aria-label="Retirer la ligne" ${d.lignes.length < 2 ? 'disabled' : ''}><svg><use href="#i-x"/></svg></button></div>`).join('');
      if (verrou) $$('input,textarea,button', zone).forEach((x) => x.disabled = true);
      dessinerTotaux();
    };
    const dessinerTotaux = () => {
      const t = totaux(d);
      $('#totaux', p).innerHTML = `<div><span>Total HT</span><span>${euro(t.ht)}</span></div>
        <div><span>${E.entreprise.franchise ? 'TVA non applicable' : `TVA ${t.taux} %`}</span><span>${euro(t.tva)}</span></div>
        <div class="fort"><span>Total ${E.entreprise.franchise ? '' : 'TTC'}</span><span>${euro(t.ttc)}</span></div>
        ${estDevis && Number(d.acompte) ? `<div><span>Acompte ${d.acompte} %</span><span>${euro(t.acompte)}</span></div>` : ''}`;
    };
    zone.addEventListener('input', (e) => {
      const el = e.target, i = +el.closest('.l').dataset.i, k = el.dataset.k; if (!k) return;
      d.lignes[i][k] = (k === 'qte' || k === 'pu') ? el.value : el.value;
      $('.tot', el.closest('.l')).textContent = euro((Number(d.lignes[i].qte) || 0) * (Number(d.lignes[i].pu) || 0));
      dessinerTotaux();
    });
    zone.addEventListener('click', (e) => { const b = e.target.closest('[data-del]'); if (!b) return; d.lignes.splice(+b.dataset.del, 1); dessinerLignes(); });
    $('#aj-ligne', p).onclick = () => { d.lignes.push({ designation: '', detail: '', qte: 1, pu: 0 }); dessinerLignes(); $$('#lignes .l', p).at(-1).querySelector('input').focus(); };
    form.addEventListener('input', (e) => { if (e.target.name === 'acompte') { d.acompte = e.target.value; dessinerTotaux(); } if (e.target.name === 'tva') { d.tva = e.target.value; dessinerTotaux(); } });
    dessinerLignes();

    const recueillir = () => {
      const v = lire(form);
      if (!verrou) Object.assign(d, { client: v.client, objet: v.objet, date: v.date, datePrestation: v.datePrestation, ...(estDevis ? { validite: v.validite, acompte: Number(v.acompte) || 0 } : { echeance: v.echeance }), ...(v.tva !== undefined ? { tva: Number(v.tva) } : {}) });
      const avant = d.statut;
      d.statut = v.statut || d.statut; d.relance = v.relance || ''; d.notes = v.notes;
      if (estDevis && avant === 'brouillon' && d.statut === 'envoye') marquerEnvoye(true);
      d.majLe = new Date().toISOString();
    };
    const enregistrer = () => {
      recueillir();
      if (estDevis && !d.numero) d.numero = numero('devis', d.date);
      const i = E.docs.findIndex((x) => x.id === d.id); i < 0 ? E.docs.push(d) : (E.docs[i] = d);
      sauver();
    };
    const marquerEnvoye = (dejaRecueilli) => {
      if (!dejaRecueilli) recueillir();
      d.statut = 'envoye'; d.envoyeLe = auj(); if (!d.relance) d.relance = plusJours(auj(), E.entreprise.relanceJours);
      d.historique = [...(d.historique || []), { date: auj(), quoi: 'Envoyé' }];
    };
    form.onsubmit = (e) => { e.preventDefault(); if (!form.reportValidity()) return; enregistrer(); toast('Enregistré'); fermerFeuille(); };
    $('#nv-client', p) && ($('#nv-client', p).onclick = () => { recueillir(); editerClient(null, (c) => { d.client = c.id; editerDoc(null, d.type, d); }); });
    $('#voir', p).onclick = () => { if (!form.reportValidity()) return; enregistrer(); apercu(d.id); };
    $('#envoye', p) && ($('#envoye', p).onclick = () => { if (!form.reportValidity()) return; marquerEnvoye(); enregistrer(); toast(`Devis envoyé. Relance prévue le ${fr(d.relance)}.`); fermerFeuille(); });
    $('#emettre', p) && ($('#emettre', p).onclick = () => {
      if (!form.reportValidity()) return;
      if (!E.entreprise.nomLegal || !E.entreprise.siren) { toast('Renseigne d\'abord ton nom et ton SIREN dans Mon entreprise.'); return; }
      recueillir(); d.numero = numero('facture', d.date); d.statut = 'envoye'; d.envoyeLe = auj();
      d.historique = [...(d.historique || []), { date: auj(), quoi: 'Émise' }];
      const i = E.docs.findIndex((x) => x.id === d.id); i < 0 ? E.docs.push(d) : (E.docs[i] = d); sauver();
      toast(`Facture ${d.numero} émise`); editerDoc(d.id); apercu(d.id);
    });
    $('#facturer', p) && ($('#facturer', p).onclick = () => {
      enregistrer();
      const f = { ...structuredClone(d), id: uid(), type: 'facture', numero: '', statut: 'brouillon', deDevis: d.id, date: auj(), echeance: plusJours(auj(), E.entreprise.delaiPaiement), relance: '', recu: 0, paiements: [], historique: [], acompte: 0, creeLe: new Date().toISOString(), majLe: new Date().toISOString() };
      E.docs.push(f); sauver(); toast('Facture créée à partir du devis'); editerDoc(f.id);
    });
    $('#aj-paiement', p) && ($('#aj-paiement', p).onclick = () => {
      const m = Number($('#p-montant', p).value); if (!(m > 0)) return toast('Indique un montant reçu');
      recueillir();
      d.paiements = [...(d.paiements || []), { date: $('#p-date', p).value || auj(), montant: m, moyen: $('#p-moyen', p).value }];
      d.recu = d.paiements.reduce((s, x) => s + Number(x.montant), 0);
      d.statut = totaux(d).reste <= 0 ? 'paye' : 'partiel'; d.relance = '';
      const i = E.docs.findIndex((x) => x.id === d.id); i < 0 ? E.docs.push(d) : (E.docs[i] = d); sauver(); toast(d.statut === 'paye' ? 'Facture payée' : 'Paiement partiel enregistré'); editerDoc(d.id);
    });
    $('#suppr', p) && ($('#suppr', p).onclick = () => { if (!confirm('Supprimer ce document ?')) return; E.docs = E.docs.filter((x) => x.id !== d.id); sauver(); fermerFeuille(); });
  });
}

/* ---------------- aperçu PDF ---------------- */
function apercu(id) {
  const d = E.docs.find((x) => x.id === id), c = client(d.client) || {}, e = E.entreprise, t = totaux(d), devis = d.type === 'devis';
  const pro = c.type === 'pro';
  const mentions = [
    e.franchise ? 'TVA non applicable, art. 293 B du CGI.' : '',
    'Catégorie de l\'opération : prestation de services.',
    devis ? `Devis valable jusqu'au ${fr(d.validite)}. ${Number(d.acompte) ? `Un acompte de ${d.acompte} % (${euro(t.acompte)}) est demandé à la commande.` : ''}`
          : `Paiement à réception, au plus tard le ${fr(d.echeance)}. Pas d'escompte pour paiement anticipé. En cas de retard, des pénalités au taux de ${e.penalites} sont exigibles${pro ? ', ainsi qu\'une indemnité forfaitaire pour frais de recouvrement de 40 €' : ''}.`,
    e.mentionLibre || '',
  ].filter(Boolean).join(' ');
  const titre = devis ? 'DEVIS' : 'FACTURE';
  document.title = `${d.numero || titre} ${nomClient(c)}`.trim();
  $('#apercu').innerHTML = `
    <div class="apercu-barre"><span>${esc(d.numero || 'Brouillon')} · ${esc(nomClient(c))}</span>
      <div class="actions">${c.email && d.numero ? `<a class="btn petit clair" href="mailto:${encodeURIComponent(c.email)}?subject=${encodeURIComponent(`${devis ? 'Devis' : 'Facture'} ${d.numero} — ${d.objet}`)}&body=${encodeURIComponent(`Bonjour,\n\nVous trouverez ci-joint ${devis ? 'le devis' : 'la facture'} ${d.numero} pour ${d.objet}.\n\nBien à vous,\n${e.nomCommercial || e.nomLegal}`)}">Préparer l'e-mail</a>` : ''}
      <button class="btn petit" id="imprimer"><svg><use href="#i-pdf"/></svg>Télécharger en PDF</button><button class="btn petit clair" id="fermer-apercu">Fermer</button></div></div>
    <article class="page-pdf" style="--accent:${esc(e.couleur)}">
      <header class="pdf-tete">
        <div class="emet">${e.logo ? `<img src="${e.logo}" alt="">` : ''}<b>${esc(e.nomCommercial || e.nomLegal || 'Ton entreprise')}</b>
          ${esc(e.nomLegal)}${e.nomLegal ? '<br>' : ''}${esc(e.adresse).replace(/\n/g, '<br>')}<br>
          ${e.siren ? `SIREN ${esc(e.siren)}` : '<span style="color:#C8432B">SIREN à renseigner</span>'}${e.siret ? ` · SIRET ${esc(e.siret)}` : ''}${e.ape ? `<br>APE ${esc(e.ape)}` : ''}<br>
          ${[e.email, e.tel, e.site].filter(Boolean).map(esc).join(' · ')}</div>
        <div class="pdf-titre"><h1>${titre}</h1><p>N° ${esc(d.numero || 'brouillon')}</p></div>
      </header>
      <section class="pdf-parties">
        <div><h4>${devis ? 'Pour' : 'Facturé à'}</h4><p><b>${esc(c.entreprise || c.nom || '')}</b>${c.entreprise && c.nom ? `<br>${esc(c.nom)}` : ''}<br>${esc(c.adresse || '').replace(/\n/g, '<br>')}${c.siren ? `<br>SIREN ${esc(c.siren)}` : ''}${c.email ? `<br>${esc(c.email)}` : ''}</p></div>
        <div class="dates"><h4>Références</h4>
          <p><span>Date</span><span>${fr(d.date)}</span></p>
          ${d.datePrestation ? `<p><span>Prestation</span><span>${fr(d.datePrestation)}</span></p>` : ''}
          ${devis ? `<p><span>Valable jusqu'au</span><span>${fr(d.validite)}</span></p>` : `<p><span>Échéance</span><span>${fr(d.echeance)}</span></p>`}
          ${d.deDevis ? `<p><span>Devis</span><span>${esc(E.docs.find((x) => x.id === d.deDevis)?.numero || '')}</span></p>` : ''}</div>
      </section>
      <p class="pdf-objet"><b>Objet</b>${esc(d.objet)}</p>
      <table class="pdf-lignes"><thead><tr><th>Désignation</th><th class="n">Qté</th><th class="n">Prix unitaire HT</th><th class="n">Total HT</th></tr></thead>
        <tbody>${d.lignes.map((l) => `<tr><td>${esc(l.designation)}${l.detail ? `<small>${esc(l.detail)}</small>` : ''}</td><td class="n">${esc(l.qte)}</td><td class="n">${euro(l.pu)}</td><td class="n">${euro((Number(l.qte) || 0) * (Number(l.pu) || 0))}</td></tr>`).join('')}</tbody></table>
      <section class="pdf-bas">
        <div class="pdf-reg">${!devis || Number(d.acompte) ? `<h4>Règlement</h4><p>${esc(e.iban ? 'Par virement bancaire' : 'Moyen de paiement à convenir')}</p>${e.iban ? `<p class="mono">IBAN ${esc(e.iban)}${e.bic ? `<br>BIC ${esc(e.bic)}` : ''}</p>` : ''}` : ''}
          ${d.notes ? `<h4 style="margin-top:4mm">Notes</h4><p>${esc(d.notes).replace(/\n/g, '<br>')}</p>` : ''}</div>
        <div class="pdf-tot"><div><span>Total HT</span><span>${euro(t.ht)}</span></div>
          ${e.franchise ? '' : `<div><span>TVA ${t.taux} %</span><span>${euro(t.tva)}</span></div>`}
          <div class="fort"><span>${e.franchise ? 'Net à payer' : 'Total TTC'}</span><span>${euro(t.ttc)}</span></div>
          ${!devis && t.recu ? `<div><span>Déjà réglé</span><span>${euro(t.recu)}</span></div><div><span>Reste dû</span><span>${euro(t.reste)}</span></div>` : ''}
          ${devis && Number(d.acompte) ? `<div><span>Acompte ${d.acompte} %</span><span>${euro(t.acompte)}</span></div>` : ''}
          ${e.franchise ? '<span class="mention">TVA non applicable, art. 293 B du CGI</span>' : ''}</div>
      </section>
      ${devis ? '<section class="pdf-accord"><div>Date et signature du client, précédées de la mention « Bon pour accord »</div><div>Cachet de l\'entreprise</div></section>' : ''}
      ${!devis && d.statut === 'paye' ? '<div class="pdf-tampon">PAYÉE</div>' : ''}
      <footer class="pdf-mentions">${esc(mentions)}<br>${esc(e.nomLegal || e.nomCommercial)}${e.siren ? ` · SIREN ${esc(e.siren)}` : ''}${e.adresse ? ` · ${esc(e.adresse.replace(/\n/g, ', '))}` : ''}</footer>
    </article>`;
  $('#apercu').hidden = false; document.body.style.overflow = 'hidden';
  $('#imprimer').onclick = () => window.print();
  $('#fermer-apercu').onclick = fermerApercu;
}
function fermerApercu() { $('#apercu').hidden = true; document.title = 'Souche · devis, factures et relances'; if ($('#feuille').hidden) document.body.style.overflow = ''; }

/* ---------------- vue : pipeline ---------------- */
function pipeline() {
  const cols = [['brouillon', 'Brouillon'], ['envoye', 'Envoyé'], ['relance', 'Relancé'], ['accepte', 'Accepté'], ['refuse', 'Refusé']];
  const devis = E.docs.filter((d) => d.type === 'devis');
  $('#vue').innerHTML = `
    <div class="tete"><div><p>Glisse une carte pour changer son statut</p><h1>Le <em>pipeline</em></h1></div>
      <div class="actions"><button class="btn" data-nouveau="devis"><svg><use href="#i-plus"/></svg>Nouveau devis</button></div></div>
    <div class="colonnes">${cols.map(([k, l]) => {
      const items = devis.filter((d) => d.statut === k);
      return `<div class="col" data-col="${k}"><h3>${l}<small>${euro(items.reduce((s, d) => s + totaux(d).ttc, 0))}</small></h3>
        ${items.map((d) => { const due = d.relance && ecart(d.relance) <= 0 && ['envoye', 'relance'].includes(k); const fact = E.docs.find((x) => x.deDevis === d.id);
          return `<div class="carte" data-carte="${d.id}"><div class="r"><span>${esc(d.numero || 'Brouillon')}</span><span>${fr(d.date)}</span></div><b>${esc(nomClient(client(d.client)))}</b><div class="m">${euro(totaux(d).ttc)}</div>
          ${due ? '<div class="alerte">À relancer</div>' : ''}${k === 'accepte' ? `<div class="alerte" style="color:var(--vert)">${fact ? `Facture ${esc(fact.numero || 'à émettre')}` : 'À facturer'}</div>` : ''}</div>`; }).join('') || '<p class="vide" style="padding:8px 2px;font-size:12px">Vide</p>'}</div>`;
    }).join('')}</div>`;
  brancherListe();
  // glisser-déposer au doigt et à la souris
  $$('.carte').forEach((carte) => {
    carte.addEventListener('pointerdown', (e) => {
      const x0 = e.clientX, y0 = e.clientY; let clone = null, cible = null;
      const bouge = (ev) => {
        if (!clone && Math.hypot(ev.clientX - x0, ev.clientY - y0) < 8) return;
        if (!clone) { clone = carte.cloneNode(true); clone.classList.add('leve'); document.body.appendChild(clone); carte.style.opacity = '.35'; }
        clone.style.left = ev.clientX - 110 + 'px'; clone.style.top = ev.clientY - 30 + 'px';
        const sous = document.elementFromPoint(ev.clientX, ev.clientY)?.closest('.col');
        $$('.col').forEach((c) => c.classList.toggle('survol', c === sous)); cible = sous;
      };
      const fin = () => {
        removeEventListener('pointermove', bouge); removeEventListener('pointerup', fin); removeEventListener('pointercancel', fin);
        if (!clone) { editerDoc(carte.dataset.carte); return; }
        clone.remove(); carte.style.opacity = '';
        if (cible) {
          const d = E.docs.find((x) => x.id === carte.dataset.carte), nv = cible.dataset.col;
          if (d.statut !== nv) {
            if (nv === 'envoye' && d.statut === 'brouillon') { d.envoyeLe = auj(); if (!d.relance) d.relance = plusJours(auj(), E.entreprise.relanceJours); }
            if (!d.numero) d.numero = numero('devis', d.date);
            d.statut = nv; d.majLe = new Date().toISOString(); d.historique = [...(d.historique || []), { date: auj(), quoi: STATUTS_DEVIS[nv] }];
            sauver(); toast(`${d.numero} : ${STATUTS_DEVIS[nv]}`);
          }
        }
        pipeline();
      };
      addEventListener('pointermove', bouge); addEventListener('pointerup', fin); addEventListener('pointercancel', fin);
    });
  });
}

/* ---------------- vue : relances ---------------- */
function relances() {
  const dues = relancesDues();
  const prochaines = E.docs.filter((d) => d.relance && ecart(d.relance) > 0 && ['envoye', 'relance', 'partiel'].includes(d.statut)).sort((a, b) => a.relance.localeCompare(b.relance));
  $('#vue').innerHTML = `
    <div class="tete"><div><p>Les messages sont déjà écrits, il reste à les envoyer</p><h1>Les <em>relances</em></h1></div></div>
    <div class="deux">
      <section class="bloc"><h2>Aujourd'hui <small>${dues.length}</small></h2>${dues.length ? dues.map(ligneRelance).join('') : '<p class="vide">Tout est à jour. Quand un devis envoyé n\'a pas de réponse à sa date de relance, ou qu\'une facture dépasse son échéance, il apparaît ici avec son message prêt.</p>'}</section>
      <section class="bloc"><h2>À venir</h2>${prochaines.length ? prochaines.map((d) => `<div class="relance"><div class="q"><b>${esc(nomClient(client(d.client)))}</b><small>${esc(d.numero)} · le ${fr(d.relance)}</small></div><div class="a">${puce(d)}</div></div>`).join('') : '<p class="vide">Aucune relance programmée.</p>'}
        <p class="aide" style="margin-top:14px">Règle : un devis envoyé est relancé ${E.entreprise.relanceJours} jours après, puis tous les 7 jours. Tu peux changer ce délai dans Mon entreprise.</p></section>
    </div>`;
  brancherListe();
}

/* ---------------- vue : clients ---------------- */
function clients() {
  $('#vue').innerHTML = `
    <div class="tete"><div><p>${E.clients.length} client(s)</p><h1>Les <em>clients</em></h1></div><div class="actions"><button class="btn" id="nv"><svg><use href="#i-plus"/></svg>Nouveau client</button></div></div>
    ${E.clients.length ? `<div class="liste">${E.clients.map((c) => { const docs = E.docs.filter((d) => d.client === c.id); const enc = docs.reduce((s, d) => s + (Number(d.recu) || 0), 0);
      return `<div class="ligne-doc" data-cl="${c.id}" role="button" tabindex="0" style="grid-template-columns:1fr 160px 120px"><span class="qui"><b>${esc(nomClient(c))}</b><small>${esc(c.email || '')}</small></span><span class="dt">${docs.length} document(s)</span><span class="mt">${euro(enc)}</span></div>`; }).join('')}</div>`
      : '<p class="vide">Aucun client. Ajoute le premier pour pouvoir lui faire un devis.</p>'}`;
  $('#nv').onclick = () => editerClient();
  $$('[data-cl]').forEach((el) => el.onclick = () => editerClient(el.dataset.cl));
}
function editerClient(id, ensuite) {
  const c = id ? { ...client(id) } : { id: uid(), nom: '', entreprise: '', email: '', tel: '', adresse: '', siren: '', type: 'pro', notes: '' };
  ouvrirFeuille(`
    <div class="panneau-tete"><h2>${id ? esc(nomClient(c)) : 'Nouveau <em>client</em>'}</h2><button class="fermer" data-fermer aria-label="Fermer"><svg><use href="#i-x"/></svg></button></div>
    <form id="fcl"><fieldset><legend>Identité</legend><div class="grille">
      <label class="champ"><span>Entreprise</span><input name="entreprise" value="${esc(c.entreprise)}" placeholder="Atelier Marnier"></label>
      <label class="champ"><span>Contact (prénom nom)</span><input name="nom" value="${esc(c.nom)}"></label>
      <label class="champ"><span>E-mail</span><input type="email" name="email" value="${esc(c.email)}"></label>
      <label class="champ"><span>Téléphone</span><input name="tel" value="${esc(c.tel)}"></label>
      <label class="champ plein"><span>Adresse</span><textarea name="adresse">${esc(c.adresse)}</textarea></label>
      <label class="champ"><span>Type</span><select name="type"><option value="pro" ${c.type === 'pro' ? 'selected' : ''}>Professionnel en France</option><option value="particulier" ${c.type === 'particulier' ? 'selected' : ''}>Particulier</option><option value="etranger" ${c.type === 'etranger' ? 'selected' : ''}>Étranger</option></select></label>
      <label class="champ"><span>SIREN</span><input name="siren" value="${esc(c.siren)}" inputmode="numeric"></label>
      <label class="champ plein"><span>Notes</span><textarea name="notes">${esc(c.notes)}</textarea></label>
    </div><p class="aide">Pour un client professionnel en France, le SIREN devient une mention obligatoire des factures avec la réforme de la facture électronique.</p></fieldset>
    <div class="barre-actions">${id && !E.docs.some((d) => d.client === id) ? '<button type="button" class="btn danger petit" id="suppr">Supprimer</button>' : ''}<button class="btn">Enregistrer</button></div></form>`, (p) => {
    $('#fcl', p).onsubmit = (e) => {
      e.preventDefault(); const v = lire(e.target);
      if (!v.entreprise && !v.nom) return toast('Indique au moins un nom');
      Object.assign(c, v); const i = E.clients.findIndex((x) => x.id === c.id); i < 0 ? E.clients.push(c) : (E.clients[i] = c);
      sauver(); toast('Client enregistré');
      if (ensuite) { $('#feuille').hidden = true; ensuite(c); } else fermerFeuille();
    };
    $('#suppr', p) && ($('#suppr', p).onclick = () => { E.clients = E.clients.filter((x) => x.id !== c.id); sauver(); fermerFeuille(); });
  });
}

/* ---------------- vue : réglages ---------------- */
function reglages() {
  const e = E.entreprise;
  $('#vue').innerHTML = `
    <div class="tete"><div><p>Imprimé sur tes devis et factures</p><h1>Mon <em>entreprise</em></h1></div></div>
    <form id="freg" style="max-width:820px">
      <fieldset><legend>Identité</legend><div class="grille">
        <label class="champ"><span>Nom commercial</span><input name="nomCommercial" value="${esc(e.nomCommercial)}" placeholder="Studio Marnier"></label>
        <label class="champ"><span>Nom légal et statut</span><input name="nomLegal" value="${esc(e.nomLegal)}" placeholder="Camille Martin, Entrepreneur individuel"></label>
        <label class="champ plein"><span>Adresse</span><textarea name="adresse">${esc(e.adresse)}</textarea></label>
        <label class="champ"><span>SIREN</span><input name="siren" value="${esc(e.siren)}" inputmode="numeric"></label>
        <label class="champ"><span>SIRET</span><input name="siret" value="${esc(e.siret)}" inputmode="numeric"></label>
        <label class="champ"><span>Code APE (facultatif)</span><input name="ape" value="${esc(e.ape)}"></label>
        <label class="champ"><span>E-mail</span><input type="email" name="email" value="${esc(e.email)}"></label>
        <label class="champ"><span>Téléphone</span><input name="tel" value="${esc(e.tel)}"></label>
        <label class="champ"><span>Site</span><input name="site" value="${esc(e.site)}"></label>
      </div></fieldset>
      <fieldset><legend>Apparence des documents</legend>
        <div class="logo-zone">${e.logo ? `<img src="${e.logo}" alt="Ton logo">` : ''}<label class="btn clair petit">${e.logo ? 'Changer le logo' : 'Ajouter ton logo'}<input type="file" id="logo" accept="image/png,image/jpeg,image/svg+xml,image/webp" hidden></label>${e.logo ? '<button type="button" class="btn danger petit" id="sans-logo">Retirer</button>' : ''}</div>
        <p class="aide">PNG, JPG ou SVG. L'image est réduite et gardée sur cet appareil.</p>
        <p class="aide" style="margin-top:14px">Couleur d'accent</p>
        <div class="teintes">${TEINTES.map((t) => `<button type="button" data-teinte="${t}" style="background:${t}" class="${t === e.couleur ? 'on' : ''}" aria-label="Couleur ${t}"></button>`).join('')}</div>
      </fieldset>
      <fieldset><legend>Fiscalité et paiement</legend><div class="grille">
        <label class="coche plein"><input type="checkbox" name="franchise" ${e.franchise ? 'checked' : ''}><span>Franchise en base de TVA (micro-entreprise) : « TVA non applicable, art. 293 B du CGI »</span></label>
        <label class="champ"><span>Taux de TVA par défaut (%)</span><input type="number" step="0.1" name="tauxTva" value="${e.tauxTva}"></label>
        <label class="champ"><span>Délai de paiement (jours)</span><input type="number" name="delaiPaiement" value="${e.delaiPaiement}"></label>
        <label class="champ"><span>Validité des devis (jours)</span><input type="number" name="validiteDevis" value="${e.validiteDevis}"></label>
        <label class="champ"><span>Première relance après (jours)</span><input type="number" name="relanceJours" value="${e.relanceJours}"></label>
        <label class="champ"><span>IBAN</span><input name="iban" value="${esc(e.iban)}"></label>
        <label class="champ"><span>BIC</span><input name="bic" value="${esc(e.bic)}"></label>
        <label class="champ plein"><span>Taux des pénalités de retard</span><input name="penalites" value="${esc(e.penalites)}"></label>
        <label class="champ plein"><span>Mention libre (facultatif)</span><input name="mentionLibre" value="${esc(e.mentionLibre)}" placeholder="Ex. Dispensé d'immatriculation au RCS et au RM"></label>
      </div><p class="aide">Souche ajoute les mentions courantes d'une facture française, mais vérifie toujours ce qui s'applique à ton statut. À partir du 1er septembre 2027, les micro-entreprises devront émettre leurs factures entre professionnels via une plateforme agréée : Souche t'aide à préparer et suivre, il ne remplace pas cette plateforme.</p></fieldset>
      <div class="barre-actions"><button class="btn">Enregistrer</button></div>
    </form>`;
  const f = $('#freg');
  f.onsubmit = (ev) => {
    ev.preventDefault(); const v = lire(f);
    Object.assign(E.entreprise, v, { franchise: !!v.franchise, tauxTva: Number(v.tauxTva) || 0, delaiPaiement: Number(v.delaiPaiement) || 30, validiteDevis: Number(v.validiteDevis) || 30, relanceJours: Number(v.relanceJours) || 4 });
    sauver(); toast('Entreprise enregistrée');
  };
  $$('[data-teinte]').forEach((b) => b.onclick = () => { E.entreprise.couleur = b.dataset.teinte; sauver(); $$('[data-teinte]').forEach((x) => x.classList.toggle('on', x === b)); });
  $('#logo').onchange = async (ev) => {
    const fichier = ev.target.files[0]; if (!fichier) return;
    E.entreprise.logo = await reduireImage(fichier); sauver(); toast('Logo ajouté'); reglages();
  };
  $('#sans-logo') && ($('#sans-logo').onclick = () => { E.entreprise.logo = ''; sauver(); reglages(); });
}
function reduireImage(fichier) {
  return new Promise((ok) => {
    if (fichier.type === 'image/svg+xml') { const r = new FileReader(); r.onload = () => ok(r.result); r.readAsDataURL(fichier); return; }
    const img = new Image(); img.onload = () => {
      const k = Math.min(1, 600 / Math.max(img.width, img.height)), c = document.createElement('canvas');
      c.width = Math.round(img.width * k); c.height = Math.round(img.height * k);
      c.getContext('2d').drawImage(img, 0, 0, c.width, c.height); ok(c.toDataURL('image/png'));
    };
    img.src = URL.createObjectURL(fichier);
  });
}

/* ---------------- sauvegarde ---------------- */
$('#exporter').onclick = () => {
  const blob = new Blob([JSON.stringify(E, null, 1)], { type: 'application/json' }), a = document.createElement('a');
  a.href = URL.createObjectURL(blob); a.download = `souche-sauvegarde-${auj()}.json`; a.click(); toast('Sauvegarde téléchargée');
};
$('#importer').onchange = async (ev) => {
  try { const v = JSON.parse(await ev.target.files[0].text()); if (!v.docs || !v.entreprise) throw 0; if (!confirm('Remplacer les données de cet appareil par cette sauvegarde ?')) return; E = { ...vierge(), ...v }; sauver(); aller('tableau'); toast('Données restaurées'); }
  catch { toast('Fichier de sauvegarde illisible'); }
};

/* ---------------- démarrage ---------------- */
const demande = new URLSearchParams(location.search).get('vue');
aller(['tableau', 'documents', 'pipeline', 'relances', 'clients', 'reglages'].includes(demande) ? demande : 'tableau');
majBadge();
