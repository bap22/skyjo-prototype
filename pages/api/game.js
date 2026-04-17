import { storeGet, storeSet } from '../../lib/store';
import {
  generateCode, dealCards, calcScore, calcFullScore,
  checkColumnMatches, aiDecideAction, aiInitialReveal,
  sanitizeGameForPlayer, generateDeck, shuffle
} from '../../lib/game';

const AI_NAMES = ['Alexa', 'Bravo', 'Cosmo', 'Delta'];

function makeAIPlayer(name, id) {
  return { id, name, isAI: true, grid: [], score: 0, roundScore: 0, revealedCount: 0, totalScore: 0, hasDrawn: false, drawnCard: null, initialRevealed: false };
}

function makeHumanPlayer(name, socketId) {
  return { id: socketId, name, isAI: false, grid: [], score: 0, roundScore: 0, revealedCount: 0, totalScore: 0, hasDrawn: false, drawnCard: null, initialRevealed: false };
}

async function getGame(id) {
  const raw = await storeGet(`game:${id}`);
  if (!raw) return null;
  return typeof raw === 'string' ? JSON.parse(raw) : raw;
}

async function saveGame(game) {
  await storeSet(`game:${game.id}`, JSON.stringify(game), 3600 * 12);
}

function advanceTurn(game) {
  game.currentTurn = (game.currentTurn + 1) % game.players.length;
  // Skip removed/disconnected slots (shouldn't happen but safety)
  game.phase = 'draw'; // next player draws
}

function checkRoundEnd(game) {
  const activePlayers = game.players.filter(p => !p.eliminated);
  // Check if final round is already triggered
  if (game.triggeredFinalRound) {
    // Check if ALL players have finished their final turn
    const allFinished = activePlayers.every(p => p.hasPlayedFinalTurn);
    if (allFinished) {
      const finisher = activePlayers.find(p => {
        const active = p.grid.filter(c => !c.removed);
        return active.length > 0 && active.every(c => c.revealed);
      });
      return finisher || activePlayers[0];
    }
    return null; // Keep going until everyone plays
  }
  // First player to finish triggers final round
  const finisher = activePlayers.find(p => {
    const active = p.grid.filter(c => !c.removed);
    return active.length > 0 && active.every(c => c.revealed);
  });
  return finisher || null;
}

function endRound(game, finisherId) {
  // Reveal all cards for all players
  game.players.forEach(p => {
    p.grid = p.grid.map(c => ({ ...c, revealed: true }));
    p.roundScore = calcFullScore(p.grid.filter(c => !c.removed));
  });

  // Penalty: if finisher doesn't have lowest score, double their points
  const finisher = game.players.find(p => p.id === finisherId);
  const minScore = Math.min(...game.players.map(p => p.roundScore));
  if (finisher && finisher.roundScore > minScore) {
    finisher.roundScore *= 2;
  }

  // Add round scores to totals
  game.players.forEach(p => { p.totalScore = (p.totalScore || 0) + p.roundScore; });

  // Check if any player hit 100
  const over100 = game.players.filter(p => p.totalScore >= 100);
  if (over100.length > 0) {
    // Game over
    game.ended = true;
    game.phase = 'ended';
    const minTotal = Math.min(...game.players.map(p => p.totalScore));
    game.winner = game.players.filter(p => p.totalScore === minTotal).map(p => p.name).join(' & ');
    game.winnerDetails = game.players.map(p => ({ name: p.name, total: p.totalScore }))
      .sort((a, b) => a.total - b.total);
  } else {
    // New round
    game.round = (game.round || 1) + 1;
    game.phase = 'roundEnd';
    game.roundEnderId = finisherId;
  }
  
  // Reset final round state
  game.triggeredFinalRound = false;
  game.finalRoundFinisher = null;
  game.players.forEach(p => { p.hasPlayedFinalTurn = false; });
}

function startNewRound(game) {
  const dealt = dealCards(game.players);
  game.players = dealt.players;
  game.deck = dealt.deck;
  game.discard = dealt.discard;
  game.currentTurn = (game.currentTurn + 1) % game.players.length; // rotate start
  game.phase = 'initialReveal';
  game.playersReady = {};
  game.roundEnderId = null;
  // Reset final round state
  game.triggeredFinalRound = false;
  game.finalRoundFinisher = null;
  // Reset per-round state
  game.players.forEach(p => {
    p.hasDrawn = false;
    p.drawnCard = null;
    p.initialRevealed = false;
    p.revealedCount = 0;
    p.hasPlayedFinalTurn = false;
  });
}

// Run AI turns until we hit a human turn or game ends
async function processAITurns(game) {
  let iterations = 0;
  while (game.started && !game.ended && iterations < 20) {
    iterations++;
    if (game.phase === 'initialReveal') {
      // Check if all players have done initial reveal
      const allReady = game.players.every(p => p.initialRevealed);
      if (allReady) {
        game.phase = 'draw';
        continue;
      }
      // AI does initial reveal
      const aiIdx = game.players.findIndex(p => p.isAI && !p.initialRevealed);
      if (aiIdx === -1) break; // waiting for humans
      const ai = game.players[aiIdx];
      const toReveal = aiInitialReveal(ai);
      toReveal.forEach(i => { ai.grid[i].revealed = true; });
      ai.revealedCount = ai.grid.filter(c => c.revealed).length;
      ai.score = calcScore(ai.grid);
      ai.initialRevealed = true;
      continue;
    }

    if (game.phase !== 'draw' && game.phase !== 'play') break;
    const currentPlayer = game.players[game.currentTurn];
    if (!currentPlayer || !currentPlayer.isAI) break;

    if (game.phase === 'draw') {
      // AI draws
      const discardTop = game.discard.length > 0 ? game.discard[game.discard.length - 1] : null;
      const decision = aiDecideAction(currentPlayer, discardTop, null);
      if (decision.action === 'drawDiscard' && game.discard.length > 0) {
        currentPlayer.drawnCard = game.discard.pop();
        currentPlayer.drawnFromDiscard = true;
      } else {
        if (game.deck.length === 0) {
          // Reshuffle discard into deck
          const top = game.discard.pop();
          game.deck = shuffle(game.discard);
          game.discard = top !== undefined ? [top] : [];
        }
        currentPlayer.drawnCard = game.deck.pop();
        currentPlayer.drawnFromDiscard = false;
      }
      currentPlayer.hasDrawn = true;
      game.phase = 'play';
      continue;
    }

    if (game.phase === 'play') {
      const discardTop = game.discard.length > 0 ? game.discard[game.discard.length - 1] : null;
      const decision = aiDecideAction(currentPlayer, discardTop, currentPlayer.drawnCard);

      if (decision.action === 'swap') {
        const pos = decision.pos;
        const oldValue = currentPlayer.grid[pos].value;
        game.discard.push(oldValue);
        currentPlayer.grid[pos] = { value: currentPlayer.drawnCard, revealed: true };
      } else if (decision.action === 'discardAndFlip') {
        game.discard.push(currentPlayer.drawnCard);
        const pos = decision.pos;
        currentPlayer.grid[pos].revealed = true;
      } else {
        // just discard
        game.discard.push(currentPlayer.drawnCard);
      }

      currentPlayer.drawnCard = null;
      currentPlayer.hasDrawn = false;
      currentPlayer.revealedCount = currentPlayer.grid.filter(c => c.revealed && !c.removed).length;
      currentPlayer.score = calcScore(currentPlayer.grid);

      // Check column matches
      const { grid: newGrid, removed } = checkColumnMatches(currentPlayer.grid);
      if (removed) {
        currentPlayer.grid = newGrid;
        currentPlayer.revealedCount = currentPlayer.grid.filter(c => c.revealed && !c.removed).length;
        currentPlayer.score = calcScore(currentPlayer.grid);
      }

      // Check if this triggers the final round
      const finisher = checkRoundEnd(game);
      if (finisher) {
        if (!game.triggeredFinalRound) {
          // First finisher - trigger final round, let others play
          game.triggeredFinalRound = true;
          game.finalRoundFinisher = finisher.name;
          game.log.push(`${finisher.name} finished! Final round - everyone gets one more turn`);
          // Mark finisher as having played their final turn
          finisher.hasPlayedFinalTurn = true;
          advanceTurn(game);
        } else {
          // Everyone has played - actually end the round
          endRound(game, finisher.id);
          break;
        }
      } else {
        advanceTurn(game);
      }
    }
  }
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  
  if (req.method === 'OPTIONS') return res.status(200).end();

  const { action } = req.query;

  try {
    // ── CREATE ──────────────────────────────────────────────────────────────
    if (action === 'create') {
      const { name, maxPlayers = 4 } = req.body;
      const id = generateCode();
      const humanName = name?.trim() || 'Player 1';
      const playerId = `h_${Date.now()}_${Math.random().toString(36).slice(2)}`;

      const aiCount = parseInt(maxPlayers) - 1; // fill rest with AI
      const aiPlayers = Array.from({ length: aiCount }, (_, i) =>
        makeAIPlayer(AI_NAMES[i + 1] || `AI ${i + 2}`, `ai_${i}`)
      );

      const game = {
        id,
        maxPlayers: parseInt(maxPlayers),
        players: [makeHumanPlayer(humanName, playerId), ...aiPlayers],
        deck: [],
        discard: [],
        currentTurn: 0,
        started: false,
        ended: false,
        phase: 'lobby', // lobby | initialReveal | draw | play | roundEnd | ended
        round: 1,
        winner: null,
        winnerDetails: null,
        createdAt: Date.now(),
        roundEnderId: null,
        playersReady: {},
        log: [`${humanName} created the game`],
      };

      await saveGame(game);
      // If the game has AI players filling all slots, it can start immediately.
      // We still return the lobby state so the user can start when ready.
      return res.json({ ok: true, gameId: id, playerId, game: sanitizeGameForPlayer(game, playerId) });
    }

    // ── JOIN ─────────────────────────────────────────────────────────────────
    if (action === 'join') {
      const { gameId, name } = req.body;
      const game = await getGame(gameId);
      if (!game) return res.status(404).json({ error: 'Game not found' });
      if (game.started && !game.players.some(p => p.isAI)) {
        return res.status(400).json({ error: 'Game already started with no AI slots' });
      }

      const humanName = name?.trim() || `Player ${game.players.filter(p => !p.isAI).length + 1}`;
      const playerId = `h_${Date.now()}_${Math.random().toString(36).slice(2)}`;

      if (!game.started) {
        // Pre-game: replace an AI or add if room
        const aiIdx = game.players.findIndex(p => p.isAI);
        if (aiIdx !== -1) {
          game.players[aiIdx] = makeHumanPlayer(humanName, playerId);
        } else if (game.players.length < game.maxPlayers) {
          game.players.push(makeHumanPlayer(humanName, playerId));
        } else {
          return res.status(400).json({ error: 'Game is full' });
        }
        game.log.push(`${humanName} joined`);
      } else {
        // Mid-game: take over an AI player
        const aiIdx = game.players.findIndex(p => p.isAI);
        if (aiIdx === -1) return res.status(400).json({ error: 'No AI slots to take over' });
        const oldName = game.players[aiIdx].name;
        game.players[aiIdx] = {
          ...game.players[aiIdx],
          id: playerId,
          name: humanName,
          isAI: false,
        };
        game.log.push(`${humanName} took over ${oldName}`);
      }

      await saveGame(game);
      return res.json({ ok: true, gameId: game.id, playerId, game: sanitizeGameForPlayer(game, playerId) });
    }

    // ── START ────────────────────────────────────────────────────────────────
    if (action === 'start') {
      const { gameId, playerId } = req.body;
      const game = await getGame(gameId);
      if (!game) return res.status(404).json({ error: 'Game not found' });
      if (game.started) return res.status(400).json({ error: 'Already started' });

      const dealt = dealCards(game.players);
      game.players = dealt.players;
      game.deck = dealt.deck;
      game.discard = dealt.discard;
      game.started = true;
      game.phase = 'initialReveal';
      game.log.push('Game started! Reveal 2 cards each.');

      await saveGame(game);
      await processAITurns(game);
      await saveGame(game);

      return res.json({ ok: true, game: sanitizeGameForPlayer(game, playerId) });
    }

    // ── POLL ─────────────────────────────────────────────────────────────────
    if (action === 'poll') {
      const { gameId, playerId } = req.query;
      const game = await getGame(gameId);
      if (!game) return res.status(404).json({ error: 'Game not found' });
      
      // Check if it's an AI turn and process
      if (game.started && !game.ended) {
        const cp = game.players[game.currentTurn];
        if (cp && cp.isAI) {
          await processAITurns(game);
          await saveGame(game);
        }
      }
      
      return res.json({ ok: true, game: sanitizeGameForPlayer(game, playerId) });
    }

    // ── INITIAL REVEAL ───────────────────────────────────────────────────────
    if (action === 'reveal') {
      const { gameId, playerId, positions } = req.body; // positions: [i, j]
      const game = await getGame(gameId);
      if (!game) return res.status(404).json({ error: 'Game not found' });

      const playerIdx = game.players.findIndex(p => p.id === playerId);
      if (playerIdx === -1) return res.status(403).json({ error: 'Not in game' });

      const player = game.players[playerIdx];
      if (player.initialRevealed) return res.status(400).json({ error: 'Already revealed' });
      if (!Array.isArray(positions) || positions.length !== 2) {
        return res.status(400).json({ error: 'Must reveal exactly 2 cards' });
      }

      positions.forEach(pos => {
        if (pos >= 0 && pos < 12) player.grid[pos].revealed = true;
      });
      player.revealedCount = player.grid.filter(c => c.revealed).length;
      player.score = calcScore(player.grid);
      player.initialRevealed = true;

      game.log.push(`${player.name} revealed 2 cards`);

      // Check if all players revealed
      const allReady = game.players.every(p => p.initialRevealed);
      if (allReady) {
        game.phase = 'draw';
        game.log.push(`${game.players[game.currentTurn].name}'s turn`);
      }

      await saveGame(game);
      await processAITurns(game);
      await saveGame(game);

      return res.json({ ok: true, game: sanitizeGameForPlayer(game, playerId) });
    }

    // ── DRAW ─────────────────────────────────────────────────────────────────
    if (action === 'draw') {
      const { gameId, playerId, from } = req.body; // from: 'deck' | 'discard'
      const game = await getGame(gameId);
      if (!game) return res.status(404).json({ error: 'Game not found' });

      const playerIdx = game.players.findIndex(p => p.id === playerId);
      if (playerIdx === -1) return res.status(403).json({ error: 'Not in game' });
      if (game.currentTurn !== playerIdx) return res.status(400).json({ error: 'Not your turn' });
      if (game.phase !== 'draw') return res.status(400).json({ error: 'Not draw phase' });

      const player = game.players[playerIdx];

      if (from === 'discard') {
        if (game.discard.length === 0) return res.status(400).json({ error: 'Discard empty' });
        player.drawnCard = game.discard.pop();
        player.drawnFromDiscard = true;
      } else {
        if (game.deck.length === 0) {
          const top = game.discard.pop();
          game.deck = shuffle(game.discard);
          game.discard = top !== undefined ? [top] : [];
        }
        if (game.deck.length === 0) return res.status(400).json({ error: 'Deck empty' });
        player.drawnCard = game.deck.pop();
        player.drawnFromDiscard = false;
      }

      player.hasDrawn = true;
      game.phase = 'play';
      await saveGame(game);
      return res.json({ ok: true, game: sanitizeGameForPlayer(game, playerId) });
    }

    // ── SWAP ──────────────────────────────────────────────────────────────────
    if (action === 'swap') {
      const { gameId, playerId, pos } = req.body;
      const game = await getGame(gameId);
      if (!game) return res.status(404).json({ error: 'Game not found' });

      const playerIdx = game.players.findIndex(p => p.id === playerId);
      if (playerIdx === -1) return res.status(403).json({ error: 'Not in game' });
      if (game.currentTurn !== playerIdx) return res.status(400).json({ error: 'Not your turn' });
      if (game.phase !== 'play') return res.status(400).json({ error: 'Wrong phase' });

      const player = game.players[playerIdx];
      if (pos < 0 || pos >= 12 || player.grid[pos].removed) return res.status(400).json({ error: 'Invalid position' });

      const oldValue = player.grid[pos].value;
      game.discard.push(oldValue);
      player.grid[pos] = { value: player.drawnCard, revealed: true };
      player.drawnCard = null;
      player.hasDrawn = false;
      player.revealedCount = player.grid.filter(c => c.revealed && !c.removed).length;
      player.score = calcScore(player.grid);

      game.log.push(`${player.name} swapped pos ${pos}`);

      const { grid: newGrid, removed } = checkColumnMatches(player.grid);
      if (removed) {
        player.grid = newGrid;
        player.revealedCount = player.grid.filter(c => c.revealed && !c.removed).length;
        player.score = calcScore(player.grid);
        game.log.push(`${player.name} matched a column! Cards removed.`);
      }

      // Check if this triggers the final round
      const finisher = checkRoundEnd(game);
      if (finisher) {
        if (!game.triggeredFinalRound) {
          // First finisher - trigger final round, let others play
          game.triggeredFinalRound = true;
          game.finalRoundFinisher = finisher.name;
          game.log.push(`${finisher.name} finished! Final round - everyone gets one more turn`);
          // Mark finisher as having played their final turn
          finisher.hasPlayedFinalTurn = true;
          advanceTurn(game);
          game.log.push(`${game.players[game.currentTurn].name}'s final turn`);
        } else {
          // Everyone has played - actually end the round
          endRound(game, finisher.id);
        }
      } else {
        advanceTurn(game);
        game.log.push(`${game.players[game.currentTurn].name}'s turn`);
      }

      await saveGame(game);
      await processAITurns(game);
      await saveGame(game);
      return res.json({ ok: true, game: sanitizeGameForPlayer(game, playerId) });
    }

    // ── DISCARD (and optionally flip) ─────────────────────────────────────────
    if (action === 'discard') {
      const { gameId, playerId, flipPos } = req.body; // flipPos: index to flip, or -1 to just discard
      const game = await getGame(gameId);
      if (!game) return res.status(404).json({ error: 'Game not found' });

      const playerIdx = game.players.findIndex(p => p.id === playerId);
      if (playerIdx === -1) return res.status(403).json({ error: 'Not in game' });
      if (game.currentTurn !== playerIdx) return res.status(400).json({ error: 'Not your turn' });
      if (game.phase !== 'play') return res.status(400).json({ error: 'Wrong phase' });

      const player = game.players[playerIdx];
      game.discard.push(player.drawnCard);
      player.drawnCard = null;
      player.hasDrawn = false;

      if (flipPos !== undefined && flipPos >= 0 && flipPos < 12 && !player.grid[flipPos].removed) {
        player.grid[flipPos].revealed = true;
        player.revealedCount = player.grid.filter(c => c.revealed && !c.removed).length;
        player.score = calcScore(player.grid);
        game.log.push(`${player.name} discarded and flipped pos ${flipPos}`);

        const { grid: newGrid, removed } = checkColumnMatches(player.grid);
        if (removed) {
          player.grid = newGrid;
          player.revealedCount = player.grid.filter(c => c.revealed && !c.removed).length;
          player.score = calcScore(player.grid);
          game.log.push(`${player.name} matched a column! Cards removed.`);
        }
      } else {
        game.log.push(`${player.name} discarded drawn card`);
      }

      // Check if this triggers the final round
      const finisher = checkRoundEnd(game);
      if (finisher) {
        if (!game.triggeredFinalRound) {
          // First finisher - trigger final round, let others play
          game.triggeredFinalRound = true;
          game.finalRoundFinisher = finisher.name;
          game.log.push(`${finisher.name} finished! Final round - everyone gets one more turn`);
          // Mark finisher as having played their final turn
          finisher.hasPlayedFinalTurn = true;
          advanceTurn(game);
          game.log.push(`${game.players[game.currentTurn].name}'s final turn`);
        } else {
          // Everyone has played - actually end the round
          endRound(game, finisher.id);
        }
      } else {
        advanceTurn(game);
        game.log.push(`${game.players[game.currentTurn].name}'s turn`);
      }

      await saveGame(game);
      await processAITurns(game);
      await saveGame(game);
      return res.json({ ok: true, game: sanitizeGameForPlayer(game, playerId) });
    }

    // ── NEW ROUND ────────────────────────────────────────────────────────────
    if (action === 'newround') {
      const { gameId, playerId } = req.body;
      const game = await getGame(gameId);
      if (!game) return res.status(404).json({ error: 'Game not found' });
      if (game.phase !== 'roundEnd') return res.status(400).json({ error: 'Not round end' });

      game.playersReady = game.playersReady || {};
      game.playersReady[playerId] = true;

      const humanPlayers = game.players.filter(p => !p.isAI);
      const allHumansReady = humanPlayers.every(p => game.playersReady[p.id]);

      if (allHumansReady) {
        startNewRound(game);
        game.log.push(`Round ${game.round} started!`);
        await saveGame(game);
        await processAITurns(game);
        await saveGame(game);
      } else {
        await saveGame(game);
      }

      return res.json({ ok: true, game: sanitizeGameForPlayer(game, playerId) });
    }

    // ── RENAME ───────────────────────────────────────────────────────────────
    if (action === 'rename') {
      const { gameId, playerId, name } = req.body;
      const game = await getGame(gameId);
      if (!game) return res.status(404).json({ error: 'Game not found' });

      const playerIdx = game.players.findIndex(p => p.id === playerId);
      if (playerIdx === -1) return res.status(403).json({ error: 'Not in game' });

      const oldName = game.players[playerIdx].name;
      const newName = name?.trim().slice(0, 20) || oldName;
      game.players[playerIdx].name = newName;
      game.log.push(`${oldName} is now ${newName}`);

      await saveGame(game);
      return res.json({ ok: true, game: sanitizeGameForPlayer(game, playerId) });
    }

    return res.status(400).json({ error: 'Unknown action' });
  } catch (e) {
    console.error('Game API error:', e);
    return res.status(500).json({ error: e.message });
  }
}
