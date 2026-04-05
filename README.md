# SkyJo Prototype

Online multiplayer SkyJo (2-4 players).

**Features:**
- Public open rooms list in lobby (shows code, player count/names; **click to auto-join**).
- Case-insensitive room codes.
- **Auto-ready on create/join** (no ready toggle).
- **Host can start when >=2 players** (no ready check).
- Real-time updates on room changes.

## Local
`npm install && npm start` → http://localhost:3000

## Vercel
Deploy via vercel.com → import repo.

Rules: Basic impl - draw/swap/discard, lowest revealed sum wins.