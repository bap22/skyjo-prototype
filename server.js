const express = require('express');
const http = require('http');
const socketIo = require('socket.io');
const path = require('path');

const app = express();
const server = http.createServer(app);
const io = new socketIo.Server(server, {
  cors: {
    origin: '*',
    methods: ['GET', 'POST']
  }
});

app.use(express.static(path.join(__dirname, 'public')));
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

const PORT = process.env.PORT || 3000;

const rooms = new Map();

function emitRoomList() {
  const list = Array.from(rooms.entries())
    .filter(([_, room]) => !room.started && room.players.length < 4)
    .map(([code, room]) => ({
      code,
      playerCount: room.players.length,
      players: room.players.map(p => p.name.substring(0, 10))
    }));
  io.emit('roomList', list);
}

function generateDeck() {
  const deck = [];
  for (let i = -5; i <= 15; i++) {
    const count = (i === -5 || i === 15) ? 3 : 2;
    for (let j = 0; j < count; j++) {
      deck.push(i);
    }
  }
  // Shuffle
  for (let i = deck.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [deck[i], deck[j]] = [deck[j], deck[i]];
  }
  return deck;
}

function generateRoomCode() {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';
  let code = '';
  while (code.length < 4) {
    code += chars[Math.floor(Math.random() * chars.length)];
  }
  return code;
}

function calculateScore(player) {
  return player.grid.reduce((sum, card) => sum + (card.revealed ? card.value : 0), 0);
}

function sanitizePlayer(player, isOwner = false) {
  return {
    id: player.id,
    name: player.name,
    grid: player.grid.map(card => ({
      value: (isOwner || card.revealed) ? card.value : null,
      revealed: card.revealed
    })),
    revealedCount: player.revealedCount,
    score: player.score,
    finalScore: player.finalScore
  };
}

function sanitizeRoom(room, socketId) {
  const viewerPlayer = room.players.find(p => p.id === socketId);
  const isOwner = !!viewerPlayer;
  return {
    code: room.code,
    hostId: room.host,
    players: room.players.map(p => sanitizePlayer(p, p.id === socketId)),
    discardTop: room.discard.length > 0 ? room.discard[room.discard.length - 1] : null,
    deckSize: room.deck.length,
    currentTurn: room.currentTurn,
    started: room.started,
    ended: room.ended,
    winner: room.winner
  };
}

function dealCards(room) {
  let deck = generateDeck();
  room.deck = [];
  room.discard = [];
  room.players.forEach(player => {
    player.grid = [];
    player.score = 0;
    player.revealedCount = 0;
    player.finalScore = 0;
    for (let i = 0; i < 12; i++) {
      if (deck.length === 0) {
        deck = generateDeck(); // Reshuffle if needed for proto
      }
      const cardValue = deck.pop();
      player.grid.push({
        value: cardValue,
        revealed: (i === 0 || i === 11)
      });
    }
    player.revealedCount = player.grid.filter(c => c.revealed).length;
    player.score = calculateScore(player);
  });
  room.deck = deck;
  room.currentTurn = 0;
}

io.on('connection', (socket) => {
  console.log('User connected:', socket.id);
  emitRoomList();

  socket.on('createRoom', (name) => {
    let code;
    do {
      code = generateRoomCode();
    } while (rooms.has(code));
    const room = {
      code,
      players: [{
        id: socket.id,
        name: name || `Player ${Math.floor(Math.random() * 1000)}`,
        grid: [],
        revealedCount: 0,
        score: 0,
        ready: true,
        finalScore: 0
      }],
      deck: [],
      discard: [],
      currentTurn: 0,
      started: false,
      ended: false,
      winner: null,
      host: socket.id
    };
    rooms.set(code, room);
    socket.join(code);
    socket.emit('roomCreated', { code, players: [room.players[0]] });
    socket.emit('roomUpdate', sanitizeRoom(room, socket.id));
    emitRoomList();
  });

  socket.on('joinRoom', ({ code, name }) => {
    code = code.toUpperCase();
    const room = rooms.get(code);
    if (!room) {
      socket.emit('error', 'Room not found');
      return;
    }
    if (room.players.length >= 4) {
      socket.emit('error', 'Room full');
      return;
    }
    if (room.started) {
      socket.emit('error', 'Game started');
      return;
    }
    const player = {
      id: socket.id,
      name: name || `Player ${Math.floor(Math.random() * 1000)}`,
      grid: [],
      revealedCount: 0,
      score: 0,
      ready: true,
      finalScore: 0
    };
    room.players.push(player);
    socket.join(code);
    room.players.forEach(p => io.to(p.id).emit('roomUpdate', sanitizeRoom(room, p.id)));
    socket.emit('roomJoined', sanitizeRoom(room, socket.id));
    emitRoomList();
  });

  socket.on('startGame', (code) => {
    code = code.toUpperCase();
    const room = rooms.get(code);
    if (!room || room.host !== socket.id || room.players.length < 2 || room.started) {
      socket.emit('error', 'Cannot start game');
      return;
    }
    dealCards(room);
    room.started = true;
    emitRoomList();
    io.to(code).emit('gameStarted', sanitizeRoom(room, socket.id));
  });

  socket.on('drawDeck', (code) => {
    const room = rooms.get(code);
    if (!room || !room.started || room.ended) return;
    const playerIdx = room.currentTurn;
    const player = room.players[playerIdx];
    if (player.id !== socket.id) return;
    if (room.deck.length === 0) {
      socket.emit('error', 'Deck empty');
      return;
    }
    const drawn = room.deck.pop();
    socket.emit('cardDrawn', { value: drawn, fromDeck: true });
  });

  socket.on('drawDiscard', (code) => {
    const room = rooms.get(code);
    if (!room || !room.started || room.ended) return;
    const playerIdx = room.currentTurn;
    const player = room.players[playerIdx];
    if (player.id !== socket.id) return;
    if (room.discard.length === 0) {
      socket.emit('error', 'No discard');
      return;
    }
    const drawn = room.discard.pop();
    socket.emit('cardDrawn', { value: drawn, fromDeck: false });
  });

  socket.on('swapCard', ({ code, pos, drawnValue }) => {
    const room = rooms.get(code);
    if (!room || !room.started || room.ended) return;
    const playerIdx = room.currentTurn;
    const player = room.players[playerIdx];
    if (player.id !== socket.id || pos < 0 || pos > 11) return;
    const oldValue = player.grid[pos].value;
    player.grid[pos] = { value: drawnValue, revealed: true };
    room.discard.push(oldValue);
    player.revealedCount = player.grid.filter(c => c.revealed).length;
    player.score = calculateScore(player);

    // Check if this player just finished (all cards revealed)
    if (player.revealedCount === 12 && !room.triggeredFinalRound) {
      // Mark that final round has been triggered
      room.triggeredFinalRound = true;
      room.finalRoundFinisher = player.name;
      // Continue giving turns to remaining players
      room.currentTurn = (room.currentTurn + 1) % room.players.length;
      io.to(code).emit('gameUpdate', sanitizeRoom(room, socket.id));
      return;
    }

    // If we're in final round mode, check if everyone has had their turn
    if (room.triggeredFinalRound) {
      // Check if we're back to the finisher (everyone had a turn)
      if (room.currentTurn === room.players.findIndex(p => p.name === room.finalRoundFinisher)) {
        // Now actually end the game
        room.ended = true;
        room.phase = 'roundEnd';
        // Reveal all cards for all players
        room.players.forEach(p => {
          p.grid.forEach(c => { c.revealed = true; });
          p.finalScore = calculateScore(p);
        });
        let minScore = Infinity;
        room.players.forEach(p => {
          if (p.finalScore < minScore) minScore = p.finalScore;
        });
        const winners = room.players.filter(p => p.finalScore === minScore).map(p => p.name);
        room.winner = winners.join(', ');
        io.to(code).emit('gameUpdate', sanitizeRoom(room, socket.id));
        return;
      }
    }

    // Normal turn progression
    room.currentTurn = (room.currentTurn + 1) % room.players.length;
    io.to(code).emit('gameUpdate', sanitizeRoom(room, socket.id));
  });

  socket.on('discardCard', ({ code, flipPos }) => {
    const room = rooms.get(code);
    if (!room || !room.started || room.ended) return;
    const playerIdx = room.currentTurn;
    const player = room.players[playerIdx];
    if (player.id !== socket.id) return;
    
    // Discard the drawn card and optionally flip a card
    if (flipPos !== undefined && flipPos >= 0 && flipPos <= 11) {
      player.grid[flipPos].revealed = true;
      player.revealedCount = player.grid.filter(c => c.revealed).length;
      player.score = calculateScore(player);
    }

    // Check if this player just finished (all cards revealed)
    if (player.revealedCount === 12 && !room.triggeredFinalRound) {
      room.triggeredFinalRound = true;
      room.finalRoundFinisher = player.name;
      room.currentTurn = (room.currentTurn + 1) % room.players.length;
      io.to(code).emit('gameUpdate', sanitizeRoom(room, socket.id));
      return;
    }

    // If we're in final round mode, check if everyone has had their turn
    if (room.triggeredFinalRound) {
      if (room.currentTurn === room.players.findIndex(p => p.name === room.finalRoundFinisher)) {
        room.ended = true;
        room.phase = 'roundEnd';
        room.players.forEach(p => {
          p.grid.forEach(c => { c.revealed = true; });
          p.finalScore = calculateScore(p);
        });
        let minScore = Infinity;
        room.players.forEach(p => {
          if (p.finalScore < minScore) minScore = p.finalScore;
        });
        const winners = room.players.filter(p => p.finalScore === minScore).map(p => p.name);
        room.winner = winners.join(', ');
        io.to(code).emit('gameUpdate', sanitizeRoom(room, socket.id));
        return;
      }
    }

    room.currentTurn = (room.currentTurn + 1) % room.players.length;
    io.to(code).emit('gameUpdate', sanitizeRoom(room, socket.id));
  });

  socket.on('newRound', (code) => {
    code = code.toUpperCase();
    const room = rooms.get(code);
    if (!room || !room.ended) return;
    
    // Reset for new round
    room.ended = false;
    room.triggeredFinalRound = false;
    room.finalRoundFinisher = null;
    room.phase = 'initialReveal';
    dealCards(room);
    io.to(code).emit('gameStarted', sanitizeRoom(room, socket.id));
  });

  socket.on('newGame', (code) => {
    code = code.toUpperCase();
    const room = rooms.get(code);
    if (!room) return;
    
    // Full reset
    room.ended = false;
    room.started = false;
    room.triggeredFinalRound = false;
    room.finalRoundFinisher = null;
    room.phase = 'lobby';
    room.winner = null;
    room.players.forEach(p => {
      p.grid = [];
      p.score = 0;
      p.revealedCount = 0;
      p.finalScore = 0;
    });
    io.to(code).emit('roomUpdate', sanitizeRoom(room, socket.id));
  });

  socket.on('disconnect', () => {
    for (const [code, room] of rooms.entries()) {
      const idx = room.players.findIndex(p => p.id === socket.id);
      if (idx !== -1) {
        room.players.splice(idx, 1);
        if (room.players.length === 0) {
          rooms.delete(code);
        } else {
          io.to(code).emit('roomUpdate', sanitizeRoom(room, socket.id));
          emitRoomList();
        }
        break;
      }
    }
  });
});

server.listen(PORT, () => {
  console.log(`SkyJo Prototype running on port ${PORT}`);
});