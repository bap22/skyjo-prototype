import { storeKeys, storeGet } from '../../lib/store';

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  try {
    const keys = await storeKeys('game:*');
    const openGames = [];
    const activeGames = [];

    for (const key of keys) {
      const game = await storeGet(key);
      if (!game) continue;
      const g = typeof game === 'string' ? JSON.parse(game) : game;
      if (g.ended) continue;

      const humanCount = g.players.filter(p => !p.isAI).length;
      const aiCount = g.players.filter(p => p.isAI).length;

      if (!g.started) {
        openGames.push({
          id: g.id,
          playerCount: g.players.length,
          maxPlayers: g.maxPlayers,
          humanCount,
          aiCount,
          players: g.players.map(p => p.name),
          hasAI: aiCount > 0,
          inProgress: false,
        });
      } else if (aiCount > 0) {
        // In-progress game with AI slots that humans can take over
        activeGames.push({
          id: g.id,
          playerCount: g.players.length,
          maxPlayers: g.maxPlayers,
          humanCount,
          aiCount,
          players: g.players.map(p => p.name),
          hasAI: true,
          inProgress: true,
          round: g.round || 1,
        });
      }
    }

    res.json({ games: openGames, activeGames });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
}
