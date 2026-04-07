// ─── SkyJo Game Logic ───────────────────────────────────────────────────────

export function generateDeck() {
  const deck = [];
  // SkyJo deck: -2(5), -1(5), 0(15), 1-12(10 each)
  const counts = {
    '-2': 5, '-1': 5,
    '0': 15,
    '1': 10, '2': 10, '3': 10, '4': 10, '5': 10,
    '6': 10, '7': 10, '8': 10, '9': 10, '10': 10,
    '11': 10, '12': 10
  };
  for (const [val, count] of Object.entries(counts)) {
    for (let i = 0; i < count; i++) deck.push(parseInt(val));
  }
  return shuffle(deck);
}

export function shuffle(arr) {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

export function generateCode() {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ';
  let code = '';
  for (let i = 0; i < 4; i++) code += chars[Math.floor(Math.random() * chars.length)];
  return code;
}

export function dealCards(players, existingDeck = null) {
  const deck = existingDeck || generateDeck();
  const deckCopy = [...deck];
  
  const updatedPlayers = players.map(player => {
    const grid = [];
    for (let i = 0; i < 12; i++) {
      const value = deckCopy.pop();
      grid.push({ value, revealed: false });
    }
    return { ...player, grid, score: 0, roundScore: 0, revealedCount: 0 };
  });
  
  // Flip one discard card to start
  const discardTop = deckCopy.pop();
  
  return { players: updatedPlayers, deck: deckCopy, discard: [discardTop] };
}

export function calcScore(grid) {
  return grid.reduce((sum, c) => {
    if (c.removed) return sum; // removed cards count as 0
    return sum + (c.revealed ? c.value : 0);
  }, 0);
}

export function calcFullScore(grid) {
  return grid.reduce((sum, c) => sum + c.value, 0);
}

export function checkColumnMatches(grid) {
  // Grid is 3 rows x 4 cols, stored as [row0col0, row0col1, row0col2, row0col3, row1col0, ... row2col3]
  // col 0: indices 0, 4, 8
  // col 1: indices 1, 5, 9
  // col 2: indices 2, 6, 10
  // col 3: indices 3, 7, 11
  const newGrid = grid.map(c => ({ ...c }));
  let removed = false;
  
  for (let col = 0; col < 4; col++) {
    const indices = [col, col + 4, col + 8];
    const cards = indices.map(i => newGrid[i]);
    if (cards.every(c => c.revealed) && cards.every(c => c.value === cards[0].value)) {
      indices.forEach(i => { newGrid[i] = { value: newGrid[i].value, revealed: true, removed: true }; });
      removed = true;
    }
  }
  
  return { grid: newGrid, removed };
}

// ─── AI Logic ────────────────────────────────────────────────────────────────

export function aiDecideAction(player, discardTop, deckDrawn = null) {
  // Phase 1: If AI hasn't drawn yet, decide draw from deck or discard
  if (deckDrawn === null) {
    // Take discard if it's low value and we have a high unrevealed or high revealed card
    const highestRevealed = Math.max(...player.grid.filter(c => c.revealed).map(c => c.value), -99);
    const hasUnrevealed = player.grid.some(c => !c.revealed);
    
    if (discardTop !== null && discardTop <= 3 && (highestRevealed >= 7 || hasUnrevealed)) {
      return { action: 'drawDiscard' };
    }
    return { action: 'drawDeck' };
  }
  
  // Phase 2: AI has drawn a card, decide swap or discard
  // Find best card to swap (highest revealed, or any unrevealed)
  let bestSwapIdx = -1;
  let bestSwapValue = -99;
  
  // Look for highest revealed card that's worse than drawn
  for (let i = 0; i < player.grid.length; i++) {
    const card = player.grid[i];
    if (card.removed) continue;
    if (card.revealed && card.value > deckDrawn && card.value > bestSwapValue) {
      bestSwapValue = card.value;
      bestSwapIdx = i;
    }
  }
  
  // If no good swap found from revealed, maybe flip an unrevealed
  if (bestSwapIdx === -1 && deckDrawn <= 3) {
    // Find an unrevealed card to swap
    const unrevealedIdx = player.grid.findIndex(c => !c.revealed && !c.removed);
    if (unrevealedIdx !== -1) {
      bestSwapIdx = unrevealedIdx;
    }
  }
  
  if (bestSwapIdx !== -1) {
    return { action: 'swap', pos: bestSwapIdx };
  }
  
  // Discard and flip an unrevealed card
  const unrevealedIdx = player.grid.findIndex(c => !c.revealed && !c.removed);
  if (unrevealedIdx !== -1) {
    return { action: 'discardAndFlip', pos: unrevealedIdx };
  }
  
  // Just discard
  return { action: 'discard' };
}

export function aiInitialReveal(player) {
  // At game start, AI reveals 2 cards - pick the ones most likely to be high
  const indices = player.grid.map((_, i) => i);
  // Just pick first two unrevealed
  return indices.filter(i => !player.grid[i].revealed).slice(0, 2);
}

export function sanitizeGameForPlayer(game, playerId) {
  if (!game) return null;
  return {
    ...game,
    players: game.players.map(p => ({
      ...p,
      grid: p.grid.map(card => ({
        ...card,
        // Hide unrevealed card values from other players (but show to owner)
        value: (card.revealed || p.id === playerId) ? card.value : null
      }))
    })),
    // Hide deck contents
    deck: null,
    deckSize: game.deck ? game.deck.length : 0,
  };
}
