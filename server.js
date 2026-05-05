/**
 * AgoraX — backend d'une plateforme de paris politiques hors argent
 * (à la Mon Petit Gazon). Stockage : un simple fichier JSON sur disque.
 *
 * Lancer :
 *   npm install
 *   npm start
 * Puis ouvrir http://localhost:3000
 */

const express = require('express');
const fs      = require('fs');
const path    = require('path');
const crypto  = require('crypto');

const PORT    = process.env.PORT || 3000;
// DB_PATH peut être surchargé via variable d'environnement (utile pour
// monter un volume persistant sur Railway/Fly/etc.). Par défaut : à côté du code.
const DB_FILE = process.env.DB_PATH || path.join(__dirname, 'db.json');
const STARTING_SOLIDI = 10000; // Solde initial par membre dans une ligue (en Solidi)

/* ------------------------------------------------------------------ */
/* Définitions de marchés (questions globales — la liquidité est par ligue) */
/* ------------------------------------------------------------------ */
// type: 'long' = marché classique, 'chaos' = Mode Chaos (court, volatile, fun)
const SEED_MARKETS = [
  // === Marchés long terme ===
  { id:'p27-philippe',   cat:'pres', type:'long', icon:'EP',  q:"Édouard Philippe sera-t-il élu Président en 2027 ?",         sub:"Présidentielle 2027 · Vainqueur", p0:0.21 },
  { id:'p27-bardella',   cat:'pres', type:'long', icon:'JB',  q:"Jordan Bardella sera-t-il élu Président en 2027 ?",          sub:"Présidentielle 2027 · Vainqueur", p0:0.20 },
  { id:'p27-lepen',      cat:'pres', type:'long', icon:'MLP', q:"Marine Le Pen sera-t-elle élue Présidente en 2027 ?",         sub:"Présidentielle 2027 · Vainqueur", p0:0.11 },
  { id:'p27-attal',      cat:'pres', type:'long', icon:'GA',  q:"Gabriel Attal sera-t-il élu Président en 2027 ?",             sub:"Présidentielle 2027 · Vainqueur", p0:0.08 },
  { id:'p27-glucksmann', cat:'pres', type:'long', icon:'RG',  q:"Raphaël Glucksmann sera-t-il élu Président en 2027 ?",        sub:"Présidentielle 2027 · Vainqueur", p0:0.07 },
  { id:'p27-melenchon',  cat:'pres', type:'long', icon:'JLM', q:"Jean-Luc Mélenchon sera-t-il élu Président en 2027 ?",        sub:"Présidentielle 2027 · Vainqueur", p0:0.04 },
  { id:'p27-other',      cat:'pres', type:'long', icon:'?',   q:"Un autre candidat sera-t-il élu Président en 2027 ?",         sub:"Présidentielle 2027 · Vainqueur", p0:0.20 },
  { id:'p27-r2-bardella',cat:'pres', type:'long', icon:'JB',  q:"Jordan Bardella se qualifiera-t-il pour le 2nd tour de 2027 ?",sub:"Présidentielle 2027 · 2nd tour", p0:0.64 },
  { id:'p27-r2-philippe',cat:'pres', type:'long', icon:'EP',  q:"Édouard Philippe se qualifiera-t-il pour le 2nd tour de 2027 ?",sub:"Présidentielle 2027 · 2nd tour", p0:0.55 },
  { id:'p27-r2-melenchon',cat:'pres',type:'long', icon:'JLM', q:"Jean-Luc Mélenchon se qualifiera-t-il pour le 2nd tour de 2027 ?",sub:"Présidentielle 2027 · 2nd tour", p0:0.18 },
  { id:'leg-rn-1st',     cat:'leg',  type:'long', icon:'RN',  q:"Le RN sera-t-il le premier groupe à l'Assemblée après les prochaines législatives ?", sub:"Législatives · Composition", p0:0.49 },
  { id:'leg-nfp-1st',    cat:'leg',  type:'long', icon:'NFP', q:"Le NFP sera-t-il le premier groupe à l'Assemblée après les prochaines législatives ?", sub:"Législatives · Composition", p0:0.21 },
  { id:'leg-maj-abs',    cat:'leg',  type:'long', icon:'%',   q:"Un seul parti aura-t-il la majorité absolue après les prochaines législatives ?", sub:"Législatives · Composition", p0:0.17 },
  { id:'leg-cohab',      cat:'leg',  type:'long', icon:'⇄',   q:"Y aura-t-il une cohabitation après les prochaines législatives ?", sub:"Législatives · Conséquences", p0:0.46 },
  { id:'gov-pm-2026',    cat:'other',type:'long', icon:'PM',  q:"Y aura-t-il un nouveau Premier ministre avant le 31/12/2026 ?", sub:"Politique générale · Gouvernement", p0:0.37 },
  { id:'gov-dissol-26',  cat:'other',type:'long', icon:'⨯',   q:"L'Assemblée nationale sera-t-elle dissoute en 2026 ?",         sub:"Politique générale · Institutions", p0:0.24 },
  { id:'gov-censure',    cat:'other',type:'long', icon:'⚖',   q:"Une motion de censure sera-t-elle adoptée d'ici fin 2026 ?",   sub:"Politique générale · Institutions", p0:0.19 },
  { id:'gov-ref',        cat:'other',type:'long', icon:'☑',   q:"Un référendum aura-t-il lieu en France avant 2027 ?",          sub:"Politique générale · Institutions", p0:0.12 },

  // === Mode Chaos — marchés ultra courts, fun, volatiles ===
  { id:'chaos-tweet-em-1h',cat:'chaos', type:'chaos', durationH:1,  icon:'⚡', q:"Macron va-t-il poster sur X dans la prochaine heure ?", sub:"Mode Chaos · 1h", p0:0.21 },
  { id:'chaos-jt-cravate', cat:'chaos', type:'chaos', durationH:6,  icon:'👔', q:"Le PM va-t-il porter une cravate rouge au JT ce soir ?", sub:"Mode Chaos · 6h", p0:0.34 },
  { id:'chaos-lapsus-jt',  cat:'chaos', type:'chaos', durationH:4,  icon:'🎙️', q:"Y aura-t-il un lapsus mémorable au 20h ce soir ?", sub:"Mode Chaos · 4h", p0:0.27 },
  { id:'chaos-question-rep',cat:'chaos',type:'chaos', durationH:4,  icon:'🏛️', q:"Le mot « République » sera-t-il prononcé 5+ fois aux questions au gouvernement ?", sub:"Mode Chaos · 4h", p0:0.81 },
  { id:'chaos-pm-demission-6h',cat:'chaos', type:'chaos', durationH:6, icon:'💥', q:"Le PM annoncera-t-il sa démission ce soir ?", sub:"Mode Chaos · 6h", p0:0.05 },
  { id:'chaos-buzzword-24h',cat:'chaos', type:'chaos', durationH:24, icon:'🤬', q:"Le mot « inacceptable » prononcé à l'Assemblée demain ?", sub:"Mode Chaos · 24h", p0:0.78 },
  { id:'chaos-bardella-hue', cat:'chaos', type:'chaos', durationH:8, icon:'😬', q:"Bardella va-t-il se faire huer en déplacement aujourd'hui ?", sub:"Mode Chaos · 8h", p0:0.22 },
  { id:'chaos-melenchon-live',cat:'chaos', type:'chaos', durationH:6, icon:'📺', q:"Mélenchon va-t-il faire un live YouTube ce soir ?", sub:"Mode Chaos · 6h", p0:0.48 },
  { id:'chaos-greve-48h',  cat:'chaos', type:'chaos', durationH:48, icon:'✊', q:"Une grève nationale sera-t-elle annoncée d'ici 48h ?", sub:"Mode Chaos · 48h", p0:0.27 },
  { id:'chaos-sondage-12h',cat:'chaos', type:'chaos', durationH:12, icon:'📊', q:"Un nouveau sondage va-t-il sortir avant minuit ?", sub:"Mode Chaos · 12h", p0:0.62 },
  { id:'chaos-clash-6h',   cat:'chaos', type:'chaos', durationH:6,  icon:'🔥', q:"Quelqu'un va-t-il dire un truc qu'il ne fallait pas avant ce soir ?", sub:"Mode Chaos · 6h", p0:0.84 },
  { id:'chaos-demission-12h',cat:'chaos', type:'chaos', durationH:12, icon:'🚪', q:"Un membre du gouvernement va-t-il démissionner avant minuit ?", sub:"Mode Chaos · 12h", p0:0.07 },
  { id:'chaos-tendance-12h',cat:'chaos', type:'chaos', durationH:12, icon:'📈', q:"Un sujet politique va-t-il faire trending #1 sur X France aujourd'hui ?", sub:"Mode Chaos · 12h", p0:0.71 },

  // === Bonus candidats — gimmicks marrants par personnalité ===
  { id:'bonus-em-horizon',cat:'bonus', type:'bonus', candidate:'Macron', durationH:24, icon:'🌅', q:"Macron — buzzword bingo : prononce-t-il « horizon » aujourd'hui ?", sub:"Bonus Macron · 24h", p0:0.43 },
  { id:'bonus-em-meme',   cat:'bonus', type:'bonus', candidate:'Macron', durationH:24, icon:'🤳', q:"Macron — apparaît-il dans un mème viral aujourd'hui ?", sub:"Bonus Macron · 24h", p0:0.55 },
  { id:'bonus-jlm-philo', cat:'bonus', type:'bonus', candidate:'Mélenchon', durationH:24, icon:'📚', q:"Mélenchon — cite-t-il un philosophe en meeting aujourd'hui ?", sub:"Bonus Mélenchon · 24h", p0:0.74 },
  { id:'bonus-mlp-decadence',cat:'bonus', type:'bonus', candidate:'Le Pen', durationH:24, icon:'⚜️', q:"Le Pen — utilise-t-elle le mot « décadence » dans une intervention ?", sub:"Bonus Le Pen · 24h", p0:0.36 },
  { id:'bonus-jb-tv',     cat:'bonus', type:'bonus', candidate:'Bardella', durationH:8, icon:'🎬', q:"Bardella — apparaît-il sur un plateau TV ce soir ?", sub:"Bonus Bardella · 8h", p0:0.48 },
  { id:'bonus-rg-ukraine',cat:'bonus', type:'bonus', candidate:'Glucksmann', durationH:24, icon:'🇺🇦', q:"Glucksmann — tweete-t-il sur l'Ukraine aujourd'hui ?", sub:"Bonus Glucksmann · 24h", p0:0.79 },
  { id:'bonus-ep-cravate',cat:'bonus', type:'bonus', candidate:'Philippe', durationH:24, icon:'👞', q:"Philippe — apparaît-il en chemise sans cravate aujourd'hui ?", sub:"Bonus Philippe · 24h", p0:0.24 },
  { id:'bonus-ga-jeune',  cat:'bonus', type:'bonus', candidate:'Attal', durationH:24, icon:'🧒', q:"Attal — fait-il référence à sa jeunesse dans une interview ?", sub:"Bonus Attal · 24h", p0:0.41 },
  { id:'bonus-ez-livre',  cat:'bonus', type:'bonus', candidate:'Zemmour', durationH:48, icon:'📖', q:"Zemmour — annonce-t-il un nouveau livre ou tweet polémique ?", sub:"Bonus Zemmour · 48h", p0:0.52 },
  { id:'bonus-of-faure',  cat:'bonus', type:'bonus', candidate:'Faure', durationH:24, icon:'🌹', q:"Faure — critique-t-il publiquement LFI aujourd'hui ?", sub:"Bonus Faure · 24h", p0:0.31 },

  // === News & Monde — Trump, cabinet US, guerres, géopolitique ===
  // Trump short-term (Mode Chaos international)
  { id:'monde-trump-truth-2h',  cat:'monde', type:'chaos', durationH:2,  icon:'📱', q:"Trump va-t-il poster sur Truth Social dans les 2 prochaines heures ?", sub:"News & Monde · 2h", p0:0.71 },
  { id:'monde-trump-fakenews-12h',cat:'monde', type:'chaos', durationH:12, icon:'📰', q:"Trump va-t-il dire « fake news » dans une intervention aujourd'hui ?", sub:"News & Monde · 12h", p0:0.83 },
  { id:'monde-trump-insult-24h',cat:'monde', type:'chaos', durationH:24, icon:'🥊', q:"Trump va-t-il insulter publiquement un journaliste aujourd'hui ?", sub:"News & Monde · 24h", p0:0.74 },
  { id:'monde-trump-allcaps-12h',cat:'monde', type:'chaos', durationH:12, icon:'🔠', q:"Trump va-t-il poster un message TOUT EN MAJUSCULES aujourd'hui ?", sub:"News & Monde · 12h", p0:0.79 },

  // Cabinet & administration US
  { id:'monde-vance-eu',     cat:'monde', type:'long', icon:'🇺🇸', q:"JD Vance va-t-il critiquer un allié européen avant fin du mois ?",                  sub:"News & Monde · Cabinet US", p0:0.62 },
  { id:'monde-rubio-lavrov', cat:'monde', type:'long', icon:'🤝', q:"Marco Rubio va-t-il rencontrer Lavrov en bilatéral d'ici fin du mois ?",         sub:"News & Monde · Cabinet US", p0:0.41 },
  { id:'monde-cabinet-demis',cat:'monde', type:'long', icon:'🚪', q:"Un ministre US va-t-il démissionner ou être limogé ce trimestre ?",                sub:"News & Monde · Cabinet US", p0:0.45 },
  { id:'monde-rfk-polemic',  cat:'monde', type:'chaos', durationH:24, icon:'💉', q:"RFK Jr. va-t-il faire une déclaration polémique sur la santé cette semaine ?", sub:"News & Monde · 24h", p0:0.66 },
  { id:'monde-musk-trump',   cat:'monde', type:'long', icon:'🚀', q:"Elon Musk et Trump vont-ils publiquement s'engueuler avant fin du trimestre ?",  sub:"News & Monde · Politique US", p0:0.38 },
  { id:'monde-impeach',      cat:'monde', type:'long', icon:'⚖️', q:"Une procédure d'impeachment sera-t-elle lancée contre Trump avant fin 2026 ?",   sub:"News & Monde · Politique US", p0:0.18 },

  // Russie-Ukraine
  { id:'monde-uk-cessez',    cat:'monde', type:'long', icon:'☮️', q:"Cessez-le-feu Russie-Ukraine signé avant fin 2026 ?",                            sub:"News & Monde · Russie-Ukraine", p0:0.32 },
  { id:'monde-trump-poutine',cat:'monde', type:'long', icon:'🇷🇺', q:"Trump va-t-il rencontrer Poutine en personne en 2026 ?",                          sub:"News & Monde · Russie-Ukraine", p0:0.41 },
  { id:'monde-uk-otan',      cat:'monde', type:'long', icon:'🛡️', q:"L'Ukraine sera-t-elle invitée à rejoindre l'OTAN avant fin 2027 ?",              sub:"News & Monde · Russie-Ukraine", p0:0.14 },
  { id:'monde-sanctions-ru', cat:'monde', type:'long', icon:'🪙', q:"Sanctions US contre la Russie significativement allégées d'ici fin 2026 ?",       sub:"News & Monde · Russie-Ukraine", p0:0.27 },

  // Moyen-Orient
  { id:'monde-gaza-cessez',  cat:'monde', type:'long', icon:'🕊️', q:"Cessez-le-feu durable à Gaza tenu plus de 6 mois en 2026 ?",                     sub:"News & Monde · Israël-Gaza", p0:0.29 },
  { id:'monde-iran-escal',   cat:'monde', type:'chaos', durationH:48, icon:'⚠️', q:"Nouvelle escalade militaire Israël-Iran d'ici 48h ?",              sub:"News & Monde · 48h", p0:0.18 },
  { id:'monde-iran-nuke',    cat:'monde', type:'long', icon:'☢️', q:"L'Iran va-t-il annoncer la possession de l'arme nucléaire avant fin 2027 ?",     sub:"News & Monde · Moyen-Orient", p0:0.16 },
  { id:'monde-saoud-iran',   cat:'monde', type:'long', icon:'🇸🇦', q:"Reprise des relations diplomatiques pleines Arabie-Iran avant fin 2026 ?",      sub:"News & Monde · Moyen-Orient", p0:0.43 },

  // Asie / Pacifique
  { id:'monde-chine-taiwan', cat:'monde', type:'long', icon:'🇨🇳', q:"La Chine va-t-elle mener une action militaire autour de Taïwan en 2026 ?",      sub:"News & Monde · Chine-Taïwan", p0:0.21 },
  { id:'monde-coree',        cat:'monde', type:'long', icon:'🇰🇵', q:"Trump va-t-il rencontrer Kim Jong-un en 2026 ?",                                 sub:"News & Monde · Corée du Nord", p0:0.34 },

  // Économie / Marchés
  { id:'monde-sp500-ath',    cat:'monde', type:'long', icon:'📈', q:"Le S&P 500 atteindra-t-il un nouveau plus haut historique avant fin du trimestre ?", sub:"News & Monde · Marchés", p0:0.52 },
  { id:'monde-recess-us',    cat:'monde', type:'long', icon:'📉', q:"Récession officielle aux États-Unis annoncée avant fin 2026 ?",                  sub:"News & Monde · Marchés", p0:0.31 },
  { id:'monde-eurusd',       cat:'monde', type:'chaos', durationH:24, icon:'💶', q:"L'EUR/USD passera-t-il sous 1,05 d'ici demain soir ?",            sub:"News & Monde · 24h", p0:0.22 },
];

/* ------------------------------------------------------------------ */
/* LMSR — Logarithmic Market Scoring Rule                             */
/* ------------------------------------------------------------------ */
function lmsrPrice(qY, qN, b) {
  const m = Math.max(qY, qN);
  const eY = Math.exp((qY - m) / b), eN = Math.exp((qN - m) / b);
  return eY / (eY + eN);
}
function lmsrCost(qY, qN, b) {
  const m = Math.max(qY, qN);
  return m + b * Math.log(Math.exp((qY - m) / b) + Math.exp((qN - m) / b));
}
function tradeCost(state, side, shares) {
  const dY = side === 'yes' ? shares : 0, dN = side === 'no' ? shares : 0;
  return lmsrCost(state.qY + dY, state.qN + dN, state.b) - lmsrCost(state.qY, state.qN, state.b);
}
function sharesForBudget(state, side, budget) {
  if (budget <= 0) return 0;
  let lo = 0, hi = budget * 100;
  for (let i = 0; i < 60; i++) {
    const mid = (lo + hi) / 2;
    if (tradeCost(state, side, mid) < budget) lo = mid; else hi = mid;
  }
  return lo;
}

/* ------------------------------------------------------------------ */
/* Persistence                                                         */
/* ------------------------------------------------------------------ */
let db = null;
function defaultDb() {
  return { users: [], leagues: [], _nextId: { league: 1, bet: 1, msg: 1 } };
}
function loadDb() {
  // Créer le dossier parent s'il manque (utile pour les volumes montés vides)
  const dir = path.dirname(DB_FILE);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });

  if (fs.existsSync(DB_FILE)) {
    try { db = JSON.parse(fs.readFileSync(DB_FILE, 'utf8')); }
    catch (e) { console.error('db corrupt, reinit'); db = defaultDb(); }
  } else {
    db = defaultDb();
  }
  if (!db._nextId) db._nextId = { league: 1, bet: 1, msg: 1 };
  console.log(`Base de données : ${DB_FILE}`);
}
let saveTimer = null;
function saveDb() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    fs.writeFileSync(DB_FILE, JSON.stringify(db));
  }, 100);
}
function nextId(kind) { db._nextId[kind] = (db._nextId[kind] || 0) + 1; return db._nextId[kind]; }

/* ------------------------------------------------------------------ */
/* Helpers                                                             */
/* ------------------------------------------------------------------ */
function hashPassword(pwd, salt) {
  return crypto.scryptSync(pwd, salt, 32).toString('hex');
}
function newToken() { return crypto.randomBytes(24).toString('hex'); }
function leagueCode() {
  const C = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let s = '';
  for (let i = 0; i < 7; i++) s += C[Math.floor(Math.random() * C.length)];
  return s.slice(0,3) + '-' + s.slice(3);
}
function initMarketState(p0) {
  const b = 4000 + Math.floor(Math.random() * 4000); // liquidity per league
  const qY = b * Math.log(p0 / (1 - p0));
  return { qY, qN: 0, b, vol: 0, history: [{ t: Date.now(), p: p0 }] };
}

/* ------------------------------------------------------------------ */
/* Saison hebdomadaire — points par rang à la fin de chaque semaine    */
/* ------------------------------------------------------------------ */
// Clé ISO semaine, ex "2026-W18" — semaines lundi → dimanche
function getWeekKey(t) {
  const d = new Date(t);
  d.setUTCHours(0, 0, 0, 0);
  // Jeudi de la même semaine ISO
  d.setUTCDate(d.getUTCDate() + 4 - (d.getUTCDay() || 7));
  const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
  const weekNum = Math.ceil((((d - yearStart) / 86400000) + 1) / 7);
  return `${d.getUTCFullYear()}-W${String(weekNum).padStart(2,'0')}`;
}
// Timestamp UTC du prochain dimanche 23:59:59 (= fin de la semaine en cours)
function getEndOfWeek(t) {
  const d = new Date(t);
  const dayOfWeek = d.getUTCDay() || 7; // 1=lundi … 7=dimanche
  const daysUntilSunday = 7 - dayOfWeek;
  d.setUTCDate(d.getUTCDate() + daysUntilSunday);
  d.setUTCHours(23, 59, 59, 999);
  return d.getTime();
}
// Points attribués selon le rang en fin de semaine (style MPG)
function pointsForRank(rank, totalMembers) {
  if (rank === 1) return 10;
  if (rank === 2) return 7;
  if (rank === 3) return 5;
  if (rank === 4) return 3;
  if (rank === 5) return 2;
  return 1; // tout le monde marque au moins 1 point
}
// Snapshot la semaine écoulée si nécessaire. Mute league.members in-place.
function rolloverWeekIfNeeded(league) {
  const nowKey = getWeekKey(Date.now());
  if (!league.lastWeekKey) {
    league.lastWeekKey = nowKey;
    return false;
  }
  if (league.lastWeekKey === nowKey) return false;

  // On clôture la semaine précédente : on classe les membres par leur total actuel,
  // on attribue les points et on les ajoute à seasonPoints.
  const ranking = league.members.map(m => {
    let posValue = 0;
    for (const [mid, pos] of Object.entries(m.positions || {})) {
      const ms = league.markets[mid]; if (!ms) continue;
      const p = lmsrPrice(ms.qY, ms.qN, ms.b);
      posValue += (pos.yes || 0) * p + (pos.no || 0) * (1 - p);
    }
    let comboValue = 0;
    for (const c of (m.combos || [])) {
      if (c.status !== 'open') continue;
      let jp = 1;
      for (const leg of c.legs) {
        const ms = league.markets[leg.marketId]; if (!ms) { jp = 0; break; }
        const p = lmsrPrice(ms.qY, ms.qN, ms.b);
        jp *= (leg.side === 'yes' ? p : (1 - p));
      }
      comboValue += c.stake * (jp / Math.max(c.jointProbAtPlacement, 1e-6));
    }
    return { userId: m.userId, total: m.balance + posValue + comboValue };
  }).sort((a, b) => b.total - a.total);

  league.seasonHistory = league.seasonHistory || [];
  const closedWeek = league.lastWeekKey;
  const podium = [];
  for (let i = 0; i < ranking.length; i++) {
    const rank = i + 1;
    const points = pointsForRank(rank, ranking.length);
    const member = league.members.find(m => m.userId === ranking[i].userId);
    if (!member) continue;
    member.seasonPoints = (member.seasonPoints || 0) + points;
    member.weeklyHistory = member.weeklyHistory || [];
    member.weeklyHistory.push({ weekKey: closedWeek, rank, points, total: ranking[i].total });
    if (member.weeklyHistory.length > 30) member.weeklyHistory = member.weeklyHistory.slice(-30);
    if (rank <= 3) podium.push({ userId: member.userId, rank, points, total: ranking[i].total });
  }
  league.seasonHistory.unshift({ weekKey: closedWeek, podium, closedAt: Date.now() });
  league.seasonHistory = league.seasonHistory.slice(0, 30);

  // Activité publique : annonce du leader de la semaine
  if (podium[0]) {
    const winner = db.users.find(u => u.id === podium[0].userId);
    league.activity.unshift({
      t: Date.now(), type: 'season', userId: podium[0].userId,
      text: `🏆 Semaine ${closedWeek} bouclée — @${winner?.pseudo || '?'} prend ${podium[0].points} pts (1ᵉʳ)`
    });
    league.activity = league.activity.slice(0, 50);
  }

  league.lastWeekKey = nowKey;
  return true;
}

/* ------------------------------------------------------------------ */
/* Auth middleware                                                     */
/* ------------------------------------------------------------------ */
function authMiddleware(req, res, next) {
  const tok = req.headers.authorization?.replace(/^Bearer\s+/, '');
  if (!tok) return res.status(401).json({ error: 'auth requise' });
  const user = db.users.find(u => u.token === tok);
  if (!user) return res.status(401).json({ error: 'token invalide' });
  req.user = user;
  next();
}

/* ------------------------------------------------------------------ */
/* App                                                                 */
/* ------------------------------------------------------------------ */
loadDb();
const app = express();
app.use(express.json({ limit: '64kb' }));
app.use(express.static(path.join(__dirname, 'public')));

// --- Health
app.get('/api/health', (req, res) => res.json({ ok: true, t: Date.now() }));

// --- Auth: signup
app.post('/api/signup', (req, res) => {
  const { pseudo, password } = req.body || {};
  if (!pseudo || !password || pseudo.length < 2 || password.length < 4)
    return res.status(400).json({ error: 'pseudo (2+) et mot de passe (4+) requis' });
  if (db.users.find(u => u.pseudo.toLowerCase() === pseudo.toLowerCase()))
    return res.status(400).json({ error: 'pseudo déjà pris' });
  const salt  = crypto.randomBytes(8).toString('hex');
  const token = newToken();
  const user = {
    id: db.users.length + 1,
    pseudo,
    salt,
    pwd: hashPassword(password, salt),
    token,
    createdAt: Date.now(),
  };
  db.users.push(user);
  saveDb();
  res.json({ token, pseudo: user.pseudo, id: user.id });
});

// --- Auth: login
app.post('/api/login', (req, res) => {
  const { pseudo, password } = req.body || {};
  const user = db.users.find(u => u.pseudo.toLowerCase() === (pseudo||'').toLowerCase());
  if (!user) return res.status(400).json({ error: 'identifiants invalides' });
  if (hashPassword(password || '', user.salt) !== user.pwd)
    return res.status(400).json({ error: 'identifiants invalides' });
  // rotate token
  user.token = newToken();
  saveDb();
  res.json({ token: user.token, pseudo: user.pseudo, id: user.id });
});

// --- Me
app.get('/api/me', authMiddleware, (req, res) => {
  const user = req.user;
  const myLeagues = db.leagues
    .filter(l => l.members.some(m => m.userId === user.id))
    .map(l => ({
      id: l.id, code: l.code, name: l.name,
      memberCount: l.members.length,
      myBalance: l.members.find(m => m.userId === user.id)?.balance || 0,
      ownerId: l.ownerId,
    }));
  res.json({ id: user.id, pseudo: user.pseudo, leagues: myLeagues });
});

// --- Create league
app.post('/api/leagues', authMiddleware, (req, res) => {
  const { name } = req.body || {};
  if (!name || name.length < 3) return res.status(400).json({ error: 'nom de ligue requis (3+)' });
  const id   = nextId('league');
  const code = leagueCode();
  const markets = {};
  for (const def of SEED_MARKETS) markets[def.id] = initMarketState(def.p0);
  const league = {
    id, code, name,
    ownerId: req.user.id,
    members: [{ userId: req.user.id, joinedAt: Date.now(), balance: STARTING_SOLIDI, positions: {}, combos: [], seasonPoints: 0, weeklyHistory: [] }],
    markets,
    bets: [],
    messages: [],
    activity: [{ t: Date.now(), type: 'create', userId: req.user.id, text: `${req.user.pseudo} a créé la ligue` }],
    createdAt: Date.now(),
    lastWeekKey: getWeekKey(Date.now()),
    seasonHistory: [],
  };
  db.leagues.push(league);
  saveDb();
  res.json({ id, code, name });
});

// --- Join league
app.post('/api/leagues/join', authMiddleware, (req, res) => {
  const code = (req.body?.code || '').toUpperCase().trim();
  const league = db.leagues.find(l => l.code === code);
  if (!league) return res.status(404).json({ error: 'code de ligue invalide' });
  if (league.members.some(m => m.userId === req.user.id))
    return res.status(400).json({ error: 'vous êtes déjà membre' });
  league.members.push({ userId: req.user.id, joinedAt: Date.now(), balance: STARTING_SOLIDI, positions: {}, combos: [], seasonPoints: 0, weeklyHistory: [] });
  league.activity.unshift({ t: Date.now(), type: 'join', userId: req.user.id, text: `${req.user.pseudo} a rejoint la ligue` });
  league.activity = league.activity.slice(0, 50);
  saveDb();
  res.json({ id: league.id, code: league.code, name: league.name });
});

// --- League detail (leaderboard, members, markets summary, activity)
app.get('/api/leagues/:id', authMiddleware, (req, res) => {
  const league = db.leagues.find(l => l.id === parseInt(req.params.id));
  if (!league) return res.status(404).json({ error: 'ligue introuvable' });
  if (!league.members.some(m => m.userId === req.user.id))
    return res.status(403).json({ error: 'vous n\'êtes pas membre' });

  // Snapshot semaine si on est passé en semaine suivante
  rolloverWeekIfNeeded(league);

  // Leaderboard : balance + valeur des positions (mark-to-market) + combos + Indice Politique
  const leaderboard = league.members.map(m => {
    const u = db.users.find(uu => uu.id === m.userId);
    let posValue = 0;
    for (const [mid, pos] of Object.entries(m.positions || {})) {
      const ms = league.markets[mid]; if (!ms) continue;
      const p  = lmsrPrice(ms.qY, ms.qN, ms.b);
      posValue += (pos.yes || 0) * p + (pos.no || 0) * (1 - p);
    }
    // Mark-to-market des combinés ouverts : stake × (jointProbNow / jointProbAtPlacement)
    let comboValue = 0;
    let openCombos = 0;
    for (const c of (m.combos || [])) {
      if (c.status !== 'open') continue;
      openCombos++;
      let jointNow = 1;
      for (const leg of c.legs) {
        const ms = league.markets[leg.marketId]; if (!ms) { jointNow = 0; break; }
        const p = lmsrPrice(ms.qY, ms.qN, ms.b);
        jointNow *= (leg.side === 'yes' ? p : (1 - p));
      }
      comboValue += c.stake * (jointNow / Math.max(c.jointProbAtPlacement, 1e-6));
    }
    const total = m.balance + posValue + comboValue;
    // Indice Politique : ROI vs solde initial. Tier de crédibilité dérivé.
    const indicePolitique = (total - STARTING_SOLIDI) / STARTING_SOLIDI; // ex: +0.157 = +15,7%
    let tier = 'Apprenti';
    if (indicePolitique >  0.25) tier = 'Pythie';
    else if (indicePolitique >  0.10) tier = 'Devin';
    else if (indicePolitique >  0)    tier = 'Sage';
    else if (indicePolitique > -0.10) tier = 'Apprenti';
    else                              tier = 'Néophyte';
    // Bankroll publique : nombre de positions ouvertes, montant exposé
    const positionsCount = Object.values(m.positions || {}).filter(p => (p.yes||0) + (p.no||0) > 0.01).length;
    return {
      userId: m.userId,
      pseudo: u ? u.pseudo : '?',
      balance: m.balance,
      positionsValue: posValue,
      comboValue,
      openCombos,
      total,
      indicePolitique,
      tier,
      positionsCount,
      seasonPoints: m.seasonPoints || 0,
      weeklyHistory: (m.weeklyHistory || []).slice(-8),
    };
  }).sort((a, b) => b.total - a.total);

  // Pour chaque entrée, on calcule aussi les points hypothétiques de la semaine
  // (basés sur le rang actuel — ça matérialise « si la semaine se clôturait maintenant »).
  leaderboard.forEach((m, i) => {
    m.weeklyRank = i + 1;
    m.weeklyPointsLive = pointsForRank(i + 1, leaderboard.length);
  });

  // Markets snapshot — inclut le Mode Chaos avec son timer
  const now = Date.now();
  const markets = SEED_MARKETS.map(def => {
    const s = league.markets[def.id] || initMarketState(def.p0);
    if (!league.markets[def.id]) league.markets[def.id] = s;
    // Timer du mode Chaos : démarre à la création du marché dans la ligue
    let chaosUntil = null;
    if (def.type === 'chaos' && def.durationH) {
      const startedAt = s.history[0]?.t || s.createdAt || now;
      chaosUntil = startedAt + def.durationH * 3600 * 1000;
    }
    return {
      ...def,
      price: lmsrPrice(s.qY, s.qN, s.b),
      vol: s.vol,
      history: s.history.slice(-30),
      chaosUntil,
    };
  });

  // Saison : classement cumulatif + historique des semaines closes + countdown
  const season = {
    currentWeekKey: league.lastWeekKey || getWeekKey(Date.now()),
    endOfWeek: getEndOfWeek(Date.now()),
    standings: leaderboard.map(m => ({ userId: m.userId, pseudo: m.pseudo, seasonPoints: m.seasonPoints }))
                          .sort((a, b) => b.seasonPoints - a.seasonPoints),
    history: (league.seasonHistory || []).slice(0, 12).map(h => ({
      weekKey: h.weekKey,
      closedAt: h.closedAt,
      podium: h.podium.map(p => ({
        ...p,
        pseudo: db.users.find(u => u.id === p.userId)?.pseudo || '?'
      })),
    })),
  };

  res.json({
    id: league.id, code: league.code, name: league.name,
    ownerId: league.ownerId, createdAt: league.createdAt,
    leaderboard, markets, season,
    activity: league.activity.slice(0, 25),
    messages: league.messages.slice(-30).map(m => ({
      ...m, pseudo: db.users.find(u => u.id === m.userId)?.pseudo || '?'
    })),
  });
});

// --- Single market detail (history + my position)
app.get('/api/leagues/:id/markets/:mid', authMiddleware, (req, res) => {
  const league = db.leagues.find(l => l.id === parseInt(req.params.id));
  if (!league || !league.members.some(m => m.userId === req.user.id))
    return res.status(404).json({ error: 'ligue ou marché introuvable' });
  const def = SEED_MARKETS.find(m => m.id === req.params.mid);
  if (!def) return res.status(404).json({ error: 'marché inconnu' });
  const s = league.markets[def.id] || (league.markets[def.id] = initMarketState(def.p0));
  const member = league.members.find(m => m.userId === req.user.id);
  const pos = member.positions?.[def.id] || { yes: 0, no: 0, costYes: 0, costNo: 0 };
  res.json({
    ...def,
    price: lmsrPrice(s.qY, s.qN, s.b),
    b: s.b, vol: s.vol,
    history: s.history,
    myPosition: pos,
    myBalance: member.balance,
    recent: league.bets.filter(b => b.marketId === def.id).slice(-15).reverse().map(b => ({
      ...b, pseudo: db.users.find(u => u.id === b.userId)?.pseudo || '?'
    })),
  });
});

// --- Place a bet
app.post('/api/leagues/:id/bet', authMiddleware, (req, res) => {
  const league = db.leagues.find(l => l.id === parseInt(req.params.id));
  if (!league) return res.status(404).json({ error: 'ligue introuvable' });
  const member = league.members.find(m => m.userId === req.user.id);
  if (!member) return res.status(403).json({ error: 'pas membre' });

  const { marketId, side, amount } = req.body || {};
  if (!marketId || !['yes','no'].includes(side) || !(amount > 0))
    return res.status(400).json({ error: 'paramètres invalides' });
  if (amount > member.balance)
    return res.status(400).json({ error: 'solde insuffisant' });

  const def = SEED_MARKETS.find(m => m.id === marketId);
  if (!def) return res.status(404).json({ error: 'marché inconnu' });
  const s = league.markets[marketId] || (league.markets[marketId] = initMarketState(def.p0));

  const shares = sharesForBudget(s, side, amount);
  const realCost = tradeCost(s, side, shares); // ≈ amount
  // Update market state
  if (side === 'yes') s.qY += shares; else s.qN += shares;
  s.vol += amount;
  s.history.push({ t: Date.now(), p: lmsrPrice(s.qY, s.qN, s.b) });
  if (s.history.length > 1000) s.history.shift();

  // Update member
  member.balance -= amount;
  member.positions = member.positions || {};
  const pos = member.positions[marketId] || { yes: 0, no: 0, costYes: 0, costNo: 0 };
  if (side === 'yes') { pos.yes += shares; pos.costYes += amount; }
  else                { pos.no  += shares; pos.costNo  += amount; }
  member.positions[marketId] = pos;

  // Log bet & activity
  const betId = nextId('bet');
  league.bets.push({ id: betId, userId: req.user.id, marketId, side, shares, cost: amount, t: Date.now() });
  if (league.bets.length > 500) league.bets = league.bets.slice(-500);
  league.activity.unshift({
    t: Date.now(), type: 'bet', userId: req.user.id,
    text: `${req.user.pseudo} a acheté ${shares.toFixed(0)} ${side.toUpperCase()} sur « ${def.q.slice(0,60)} »`
  });
  league.activity = league.activity.slice(0, 50);
  saveDb();

  res.json({
    ok: true, shares, cost: amount,
    newPrice: lmsrPrice(s.qY, s.qN, s.b),
    balance: member.balance,
  });
});

// --- Place a COMBO bet (parlay) — toutes les jambes doivent gagner
app.post('/api/leagues/:id/combo', authMiddleware, (req, res) => {
  const league = db.leagues.find(l => l.id === parseInt(req.params.id));
  if (!league) return res.status(404).json({ error: 'ligue introuvable' });
  const member = league.members.find(m => m.userId === req.user.id);
  if (!member) return res.status(403).json({ error: 'pas membre' });

  const { legs, stake } = req.body || {};
  if (!Array.isArray(legs) || legs.length < 2)
    return res.status(400).json({ error: 'un combiné a besoin de 2 jambes minimum' });
  if (legs.length > 8) return res.status(400).json({ error: '8 jambes maximum' });
  if (!(stake > 0)) return res.status(400).json({ error: 'mise invalide' });
  if (stake > member.balance) return res.status(400).json({ error: 'solde insuffisant' });

  // Validation : marchés existent, sides valides, pas de doublons
  const seen = new Set();
  const enriched = [];
  for (const leg of legs) {
    if (!leg || !leg.marketId || !['yes','no'].includes(leg.side))
      return res.status(400).json({ error: 'jambe invalide' });
    if (seen.has(leg.marketId))
      return res.status(400).json({ error: 'doublon de marché dans le combiné' });
    seen.add(leg.marketId);
    const def = SEED_MARKETS.find(m => m.id === leg.marketId);
    if (!def) return res.status(400).json({ error: 'marché ' + leg.marketId + ' inconnu' });
    const s = league.markets[leg.marketId] || (league.markets[leg.marketId] = initMarketState(def.p0));
    const p = lmsrPrice(s.qY, s.qN, s.b);
    const sidePrice = leg.side === 'yes' ? p : (1 - p);
    enriched.push({ marketId: leg.marketId, side: leg.side, atPrice: sidePrice, q: def.q });
  }

  const jointProb = enriched.reduce((acc, l) => acc * l.atPrice, 1);
  const potentialPayout = stake / Math.max(jointProb, 1e-6);

  const combo = {
    id: nextId('bet'),
    userId: req.user.id,
    legs: enriched,
    stake,
    jointProbAtPlacement: jointProb,
    potentialPayout,
    status: 'open', // 'open' | 'won' | 'lost'
    createdAt: Date.now(),
  };
  member.combos = member.combos || [];
  member.combos.push(combo);
  member.balance -= stake;

  league.activity.unshift({
    t: Date.now(), type: 'combo', userId: req.user.id,
    text: `${req.user.pseudo} a placé un combiné × ${enriched.length} pour ${Math.round(stake)} S (gain potentiel ${Math.round(potentialPayout)} S)`
  });
  league.activity = league.activity.slice(0, 50);
  saveDb();
  res.json({ ok: true, combo, balance: member.balance });
});

// --- (Owner) résoudre un combo manuellement (won / lost)
app.post('/api/leagues/:id/combo/:cid/resolve', authMiddleware, (req, res) => {
  const league = db.leagues.find(l => l.id === parseInt(req.params.id));
  if (!league) return res.status(404).json({ error: 'ligue introuvable' });
  if (league.ownerId !== req.user.id) return res.status(403).json({ error: 'propriétaire seulement' });
  const { outcome } = req.body || {};
  if (!['won','lost'].includes(outcome)) return res.status(400).json({ error: 'outcome invalide' });
  const cid = parseInt(req.params.cid);
  for (const m of league.members) {
    const c = (m.combos || []).find(c => c.id === cid);
    if (!c) continue;
    if (c.status !== 'open') return res.status(400).json({ error: 'combiné déjà résolu' });
    c.status = outcome;
    if (outcome === 'won') m.balance += c.potentialPayout;
    saveDb();
    return res.json({ ok: true });
  }
  res.status(404).json({ error: 'combiné introuvable' });
});

// --- Post message in league chat
app.post('/api/leagues/:id/message', authMiddleware, (req, res) => {
  const league = db.leagues.find(l => l.id === parseInt(req.params.id));
  if (!league) return res.status(404).json({ error: 'ligue introuvable' });
  if (!league.members.some(m => m.userId === req.user.id))
    return res.status(403).json({ error: 'pas membre' });
  const text = (req.body?.text || '').toString().slice(0, 280).trim();
  if (!text) return res.status(400).json({ error: 'message vide' });
  const msg = { id: nextId('msg'), userId: req.user.id, text, t: Date.now() };
  league.messages.push(msg);
  if (league.messages.length > 200) league.messages = league.messages.slice(-200);
  saveDb();
  res.json({ ...msg, pseudo: req.user.pseudo });
});

// --- (Owner only) Resolve a market
app.post('/api/leagues/:id/resolve', authMiddleware, (req, res) => {
  const league = db.leagues.find(l => l.id === parseInt(req.params.id));
  if (!league) return res.status(404).json({ error: 'ligue introuvable' });
  if (league.ownerId !== req.user.id) return res.status(403).json({ error: 'propriétaire seulement' });
  const { marketId, outcome } = req.body || {};
  if (!['yes','no'].includes(outcome)) return res.status(400).json({ error: 'outcome invalide' });
  const def = SEED_MARKETS.find(m => m.id === marketId);
  if (!def) return res.status(404).json({ error: 'marché inconnu' });

  // Each YES share pays 1 if outcome=yes else 0 ; symmetric for NO.
  for (const m of league.members) {
    const pos = m.positions?.[marketId];
    if (!pos) continue;
    const payout = outcome === 'yes' ? pos.yes : pos.no;
    m.balance += payout;
    delete m.positions[marketId];
  }
  // Mark market as closed by setting price to 1 or 0
  const s = league.markets[marketId];
  if (s) s.history.push({ t: Date.now(), p: outcome === 'yes' ? 1 : 0 });
  league.activity.unshift({
    t: Date.now(), type: 'resolve', userId: req.user.id,
    text: `Marché « ${def.q.slice(0,60)} » résolu : ${outcome.toUpperCase()}`
  });
  saveDb();
  res.json({ ok: true });
});

// --- 404 fallback for /api
app.use('/api', (req, res) => res.status(404).json({ error: 'route inconnue' }));

// Sur Railway/Fly/Heroku le serveur DOIT écouter sur 0.0.0.0 (toutes interfaces)
// — sinon le proxy ne peut pas l'atteindre depuis l'extérieur du conteneur.
app.listen(PORT, '0.0.0.0', () => {
  console.log(`AgoraX démarré · port ${PORT} · DB ${DB_FILE}`);
});
