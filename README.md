# ÉlysMarket

Plateforme de paris politiques **hors argent** entre amis — équivalent Mon Petit Gazon
adapté aux marchés prédictifs sur les élections françaises (Présidentielle 2027,
Législatives, politique générale).

## Concept

- Chaque joueur crée ou rejoint une **ligue privée** via un code à 7 caractères.
- À l'inscription dans une ligue, chacun reçoit **10 000 bulletins virtuels (₿)**.
- Les marchés sont des questions binaires (OUI / NON). Le prix d'une part = la
  probabilité estimée par le marché. Une part « OUI » paie 1 bulletin si l'événement
  se réalise, sinon 0.
- Le moteur de marché est un **LMSR** (Logarithmic Market Scoring Rule) — chaque
  ligue a son propre carnet, donc les prix peuvent diverger d'une ligue à l'autre.
- Le **propriétaire** de la ligue résout les marchés à leur clôture (paiement
  automatique de tous les détenteurs de parts gagnantes).

## Lancer en local

Pré-requis : **Node.js 18+** ([télécharger](https://nodejs.org)).

```bash
cd elysmarket-app
npm install
npm start
```

Puis ouvrir <http://localhost:3000>.

Les données persistent dans `db.json` à la racine du projet — supprimez ce fichier
pour repartir de zéro.

## Architecture

```
elysmarket-app/
├── server.js          # Backend Express — auth + leagues + bets + LMSR
├── package.json
├── public/
│   └── index.html     # Frontend SPA vanilla JS (auth → home → league)
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
| GET     | `/api/leagues/:id`                 | oui  | Classement, marchés, activité, chat      |
| GET     | `/api/leagues/:id/markets/:mid`    | oui  | Détail d'un marché (historique, position)|
| POST    | `/api/leagues/:id/bet`             | oui  | `{marketId, side:'yes'|'no', amount}`    |
| POST    | `/api/leagues/:id/message`         | oui  | `{text}` poste un message dans le chat   |
| POST    | `/api/leagues/:id/resolve`         | oui (owner) | `{marketId, outcome:'yes'|'no'}` clôt le marché |

Auth par **bearer token** dans `Authorization: Bearer <token>`.

## Stack

- **Backend** : Node.js + Express, persistance JSON (zero native deps).
- **Frontend** : HTML/CSS/JS vanilla — un seul fichier, pas de build.
- **Market maker** : LMSR avec liquidité paramétrable par ligue.

## Roadmap

- WebSocket pour le push temps-réel des prix et du chat
- Marchés multi-issues (au-delà du binaire OUI/NON)
- Résolution automatique via oracle (Wikipédia / API ministère de l'intérieur)
- Système de saisons (reset trimestriel des classements)
- Trophées et achievements (premier pari gagnant, série de 5, etc.)
- Migration vers SQLite (`better-sqlite3`) au-delà de quelques centaines d'utilisateurs
