/**
 * ÉlysMarket — backend d'une plateforme de paris politiques hors argent
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
const STARTING_BULLETINS = 10000; // Solde initial par membre dans une ligue

/* ------------------------------------------------------------------ */
/* Définitions de marchés (questions globales — la liquidité est par ligue) */
/* ------------------------------------------------------------------ */
const SEED_MARKETS = [
  { id:'p27-philippe',   cat:'pres', icon:'EP',  q:"Édouard Philippe sera-t-il élu Président en 2027 ?",         sub:"Présidentielle 2027 · Vainqueur", p0:0.21 },
  { id:'p27-bardella',   cat:'pres', icon:'JB',  q:"Jordan Bardella sera-t-il élu Président en 2027 ?",          sub:"Présidentielle 2027 · Vainqueur", p0:0.20 },
  { id:'p27-lepen',      cat:'pres', icon:'MLP', q:"Marine Le Pen sera-t-elle élue Présidente en 2027 ?",         sub:"Présidentielle 2027 · Vainqueur", p0:0.11 },
  { id:'p27-attal',      cat:'pres', icon:'GA',  q:"Gabriel Attal sera-t-il élu Président en 2027 ?",             sub:"Présidentielle 2027 · Vainqueur", p0:0.08 },
  { id:'p27-glucksmann', cat:'pres', icon:'RG',  q:"Raphaël Glucksmann sera-t-il élu Président en 2027 ?",        sub:"Présidentielle 2027 · Vainqueur", p0:0.07 },
  { id:'p27-melenchon',  cat:'pres', icon:'JLM', q:"Jean-Luc Mélenchon sera-t-il élu Président en 2027 ?",        sub:"Présidentielle 2027 · Vainqueur", p0:0.04 },
  { id:'p27-other',      cat:'pres', icon:'?',   q:"Un autre candidat sera-t-il élu Président en 2027 ?",         sub:"Présidentielle 2027 · Vainqueur", p0:0.20 },
  { id:'p27-r2-bardella',cat:'pres', icon:'JB',  q:"Jordan Bardella se qualifiera-t-il pour le 2nd tour de 2027 ?",sub:"Présidentielle 2027 · 2nd tour", p0:0.64 },
  { id:'p27-r2-philippe',cat:'pres', icon:'EP',  q:"Édouard Philippe se qualifiera-t-il pour le 2nd tour de 2027 ?",sub:"Présidentielle 2027 · 2nd tour", p0:0.55 },
  { id:'p27-r2-melenchon',cat:'pres',icon:'JLM', q:"Jean-Luc Mélenchon se qualifiera-t-il pour le 2nd tour de 2027 ?",sub:"Présidentielle 2027 · 2nd tour", p0:0.18 },
  { id:'leg-rn-1st',     cat:'leg',  icon:'RN',  q:"Le RN sera-t-il le premier groupe à l'Assemblée après les prochaines législatives ?", sub:"Législatives · Composition", p0:0.49 },
  { id:'leg-nfp-1st',    cat:'leg',  icon:'NFP', q:"Le NFP sera-t-il le premier groupe à l'Assemblée après les prochaines législatives ?", sub:"Législatives · Composition", p0:0.21 },
  { id:'leg-maj-abs',    cat:'leg',  icon:'%',   q:"Un seul parti aura-t-il la majorité absolue après les prochaines législatives ?", sub:"Législatives · Composition", p0:0.17 },
  { id:'leg-cohab',      cat:'leg',  icon:'⇄',   q:"Y aura-t-il une cohabitation après les prochaines législatives ?", sub:"Législatives · Conséquences", p0:0.46 },
  { id:'gov-pm-2026',    cat:'other',icon:'PM',  q:"Y aura-t-il un nouveau Premier ministre avant le 31/12/2026 ?", sub:"Politique générale · Gouvernement", p0:0.37 },
  { id:'gov-dissol-26',  cat:'other',icon:'⨯',   q:"L'Assemblée nationale sera-t-elle dissoute en 2026 ?",         sub:"Politique générale · Institutions", p0:0.24 },
  { id:'gov-censure',    cat:'other',icon:'⚖',   q:"Une motion de censure sera-t-elle adoptée d'ici fin 2026 ?",   sub:"Politique générale · Institutions", p0:0.19 },
  { id:'gov-ref',        cat:'other',icon:'☑',   q:"Un référendum aura-t-il lieu en France avant 2027 ?",          sub:"Politique générale · Institutions", p0:0.12 },
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
    members: [{ userId: req.user.id, joinedAt: Date.now(), balance: STARTING_BULLETINS, positions: {} }],
    markets,
    bets: [],
    messages: [],
    activity: [{ t: Date.now(), type: 'create', userId: req.user.id, text: `${req.user.pseudo} a créé la ligue` }],
    createdAt: Date.now(),
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
  league.members.push({ userId: req.user.id, joinedAt: Date.now(), balance: STARTING_BULLETINS, positions: {} });
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

  // Leaderboard : balance + valeur des positions (mark-to-market)
  const leaderboard = league.members.map(m => {
    const u = db.users.find(uu => uu.id === m.userId);
    let posValue = 0;
    for (const [mid, pos] of Object.entries(m.positions || {})) {
      const ms = league.markets[mid]; if (!ms) continue;
      const p  = lmsrPrice(ms.qY, ms.qN, ms.b);
      posValue += (pos.yes || 0) * p + (pos.no || 0) * (1 - p);
    }
    return {
      userId: m.userId,
      pseudo: u ? u.pseudo : '?',
      balance: m.balance,
      positionsValue: posValue,
      total: m.balance + posValue,
    };
  }).sort((a, b) => b.total - a.total);

  // Markets snapshot
  const markets = SEED_MARKETS.map(def => {
    const s = league.markets[def.id] || initMarketState(def.p0);
    if (!league.markets[def.id]) league.markets[def.id] = s;
    return {
      ...def,
      price: lmsrPrice(s.qY, s.qN, s.b),
      vol: s.vol,
      history: s.history.slice(-30),
    };
  });

  res.json({
    id: league.id, code: league.code, name: league.name,
    ownerId: league.ownerId, createdAt: league.createdAt,
    leaderboard, markets,
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
  console.log(`ÉlysMarket démarré · port ${PORT} · DB ${DB_FILE}`);
});
