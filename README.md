# AgoraX

> Tu n'as pas une opinion. Tu as une intuition.

Plateforme de paris politiques **hors argent** entre amis — Polymarket × Mon Petit Gazon
adapté aux scrutins français (Présidentielle 2027, Législatives, politique générale)
et au quotidien fou de la Ve République.

## Concept

- **Tu n'argumentes pas. Tu anticipes.** Chaque événement = un marché binaire OUI/NON.
- **Ligues privées** : tu joues entre potes, collègues, anciens du lycée — code à 7 caractères pour rejoindre.
- **Solidi** : la monnaie virtuelle. Chaque membre démarre avec 10 000 S. Le prix d'une part = la
  probabilité estimée par le marché. Une part « OUI » paie 1 S si l'événement se réalise.
- **Moteur LMSR** (Logarithmic Market Scoring Rule) — chaque ligue a son propre carnet, donc les
  prix peuvent diverger d'une ligue à l'autre.
- Le **propriétaire** résout les marchés à leur clôture (paiement automatique des gagnants).

## Features différenciantes

- **⚡ Mode Chaos** : marchés ultra courts (1h, 2h, 4h, 6h, 8h, 12h, 24h, 48h). Très volatiles. Très fun.
  Du genre « Macron va-t-il poster sur X dans la prochaine heure ? », « Lapsus mémorable au 20h ce soir ? »,
  « Le PM va-t-il porter une cravate rouge au JT ? ».
- **🎁 Bonus candidats** : marchés thématiques par personnalité. Macron buzzword bingo (« horizon »),
  Mélenchon cite-t-il un philosophe en meeting, Le Pen utilise-t-elle « décadence », Bardella sur un
  plateau TV, Glucksmann tweet sur l'Ukraine, etc.
- **🎯 Combinés (parlays)** : empile jusqu'à 8 jambes dans un combiné. Toutes doivent gagner.
  Cote multipliée, gain potentiel énorme. Parfait pour les paris fous entre potes.
- **🧠 Indice Politique** : ton score de crédibilité dans la ligue. Tu deviens *Pythie* si tu
  vises juste, *Néophyte* si tu te plantes. Cinq tiers : Pythie · Devin · Sage · Apprenti · Néophyte.
- **🪙 Bankroll publique** : clique sur n'importe quel membre du classement → tu vois ses paris.
  Transparence totale, tension maximale.
- **💬 Trash talk intégré** : chat de ligue dans le panneau de droite. Indispensable.

## Design

Palette pastel funky inspirée Memphis × Y2K : crème buttercream, lilas vif, teal mint, rose corail,
miel doré. Cards arrondies, badges en stickers tournés, accents typographiques.

## Lancer en local

Pré-requis : **Node.js 18+** ([télécharger](https://nodejs.org)).

```bash
cd elysmarket-app
npm install
npm start
```

Puis ouvrir <http://localhost:3000>.

Données persistées dans `db.json` (à la racine du projet par défaut, ou à l'emplacement défini
par la variable d'environnement `DB_PATH` — utile pour un volume persistant en prod).

## Déployer en prod (Railway)

1. Push sur GitHub.
2. *New Project → Deploy from GitHub repo* sur <https://railway.app>.
3. Settings → Volumes → mount `/data`.
4. Settings → Variables → `DB_PATH=/data/db.json`.
5. Settings → Networking → Generate Domain.

## Architecture

```
elysmarket-app/
├── server.js          # Backend Express — auth + leagues + bets + LMSR + Mode Chaos
├── package.json
├── public/
│   └── index.html     # Frontend SPA (auth → home → league)
├── .gitignore
└── db.json            # Persistance (créé au 1er lancement)
```

## API

| Méthode | Route                              | Auth | Description                              |
|---------|------------------------------------|------|------------------------------------------|
| POST    | `/api/signup`                      | non  | `{pseudo, password}` → `{token,...}`     |
| POST    | `/api/login`                       | non  | `{pseudo, password}` → `{token,...}`     |
| GET     | `/api/me`                          | oui  | Mon profil + ligues                      |
| POST    | `/api/leagues`                     | oui  | `{name}` → crée une ligue                |
| POST    | `/api/leagues/join`                | oui  | `{code}` → rejoint une ligue             |
| GET     | `/api/leagues/:id`                 | oui  | Classement (avec Indice Politique), marchés, activité, chat |
| GET     | `/api/leagues/:id/markets/:mid`    | oui  | Détail d'un marché (historique, position, bankroll publique) |
| POST    | `/api/leagues/:id/bet`             | oui  | `{marketId, side:'yes'|'no', amount}`    |
| POST    | `/api/leagues/:id/combo`           | oui  | `{legs:[{marketId,side}], stake}` — combiné parlay |
| POST    | `/api/leagues/:id/combo/:cid/resolve`| oui (owner) | `{outcome:'won'|'lost'}` résout un combiné |
| POST    | `/api/leagues/:id/message`         | oui  | `{text}` poste un message dans le chat   |
| POST    | `/api/leagues/:id/resolve`         | oui (owner) | `{marketId, outcome}` clôt le marché |

Auth par bearer token dans `Authorization: Bearer <token>`.

## Roadmap

- WebSocket pour le push temps-réel des prix et du chat
- Marchés multi-issues (au-delà du binaire OUI/NON)
- Résolution automatique des marchés Mode Chaos via oracle (API X, Wikipédia, etc.)
- Système de saisons (reset trimestriel des classements)
- Trophées et achievements (premier pari gagnant, série de 5, etc.)
- Migration vers SQLite (`better-sqlite3`) au-delà de quelques centaines d'utilisateurs

## Punchlines maison

> « Tu sens venir la dinguerie politique ou pas ? »
> « Les marchés sont chauds. Toi aussi ? »
> « Spoiler : quelqu'un va dire un truc qu'il ne fallait pas. »
