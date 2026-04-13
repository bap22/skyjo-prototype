const socket = io({transports: ['polling']});

let currentRoomCode = null;
let playerId = null;
let playerName = '';
let drawnValue = null;
let discardMode = false; // true = waiting to flip a card after discard


document.addEventListener('DOMContentLoaded', () => {
  const playerNameInput = document.getElementById('playerName');
  const createBtn = document.getElementById('createBtn');
  const joinBtn = document.getElementById('joinBtn');
  const roomCodeInput = document.getElementById('roomCode');
  const roomCodeDiv = document.getElementById('roomCodeInput');
  const roomInfo = document.getElementById('roomInfo');
  const roomCodeDisp = document.getElementById('roomCodeDisp');
  const playersList = document.getElementById('playersList');
  const startBtn = document.getElementById('startBtn');
  const roomListEl = document.getElementById('roomList');

  playerNameInput.value = localStorage.getItem('skyjoName') || '';

  createBtn.onclick = () => createRoom();
  joinBtn.onclick = () => {
    roomCodeDiv.style.display = 'block';
    roomCodeInput.focus();
  };
  roomCodeInput.onkeypress = (e) => {
    if (e.key === 'Enter') joinRoom();
  };

  function createRoom() {
    playerName = playerNameInput.value || 'Anonymous';
    localStorage.setItem('skyjoName', playerName);
    socket.emit('createRoom', playerName);
  }

  function joinRoom() {
    playerName = playerNameInput.value || 'Anonymous';
    localStorage.setItem('skyjoName', playerName);
    const code = roomCodeInput.value.toUpperCase().trim();
    if (code.length !== 4) return alert('Code must be 4 letters');
    socket.emit('joinRoom', { code, name: playerName });
  }

  socket.on('roomCreated', (data) => {
    currentRoomCode = data.code;
    roomCodeDisp.textContent = data.code;
    playerId = socket.id;
    showRoomInfo();
  });

  socket.on('roomJoined', (room) => {
    currentRoomCode = room.code;
    roomCodeDisp.textContent = room.code;
    playerId = socket.id;
    updateRoom(room);
    showRoomInfo();
  });

  socket.on('roomUpdate', updateRoom);

  function showRoomInfo() {
    document.getElementById('nameInput').style.display = 'none';
    roomCodeDiv.style.display = 'none';
    roomInfo.style.display = 'block';
  }

  function updateRoom(room) {
    playersList.innerHTML = '';
    room.players.forEach((p, idx) => {
      const div = document.createElement('div');
      div.className = 'player';
      div.innerHTML = `<span>${p.name} (${p.revealedCount || 0}/12 revealed, score: ${p.score || 0})</span>`;
      playersList.appendChild(div);
    });
    const isHost = room.hostId === socket.id;
    startBtn.style.display = isHost && !room.started && room.players.length >= 2 ? 'inline' : 'none';
  }

  startBtn.onclick = () => {
    socket.emit('startGame', currentRoomCode);
  };

  // Game
  const gameDiv = document.getElementById('game');
  const lobbyDiv = document.getElementById('lobby');
  const gameRoomCode = document.getElementById('gameRoomCode');
  const currentTurnEl = document.getElementById('currentTurn');
  const deckSizeEl = document.getElementById('deckSize');
  const discardTopEl = document.getElementById('discardTop');
  const drawnCardEl = document.getElementById('drawnCard');
  const drawButtons = document.getElementById('drawButtons');
  const gridsEl = document.getElementById('grids');
  const roundEndScreen = document.getElementById('roundEndScreen');
  const endScreen = document.getElementById('endScreen');
  const winnerEl = document.getElementById('winner');
  const finalScoresEl = document.getElementById('finalScores');
  const finalScoresGameEl = document.getElementById('finalScoresGame');
  const finalRoundFinisherEl = document.getElementById('finalRoundFinisher');
  const nextRoundBtn = document.getElementById('nextRoundBtn');
  const newGameBtn = document.getElementById('newGameBtn');
  const actionButtons = document.getElementById('actionButtons');
  const discardBtn = document.getElementById('discardBtn');

  socket.on('gameStarted', (room) => {
    lobbyDiv.style.display = 'none';
    gameDiv.style.display = 'block';
    gameRoomCode.textContent = room.code;
    updateGame(room);
    drawButtons.style.display = 'block';
  });

  socket.on('gameUpdate', updateGame);

  socket.on('cardDrawn', (data) => {
    drawnValue = data.value;
    drawnCardEl.textContent = data.value;
    drawnCardEl.style.display = 'block';
    drawnCardEl.classList.add('drawn');
    drawButtons.style.display = 'none';
    // Show discard button option
    actionButtons.style.display = 'block';
    discardMode = false;
    // Highlight own grid for swap
    const ownGrid = document.querySelector('.player-grid.own .grid');
    if (ownGrid) {
      Array.from(ownGrid.children).forEach((card, i) => {
        card.style.borderColor = '#007bff';
        card.onclick = () => swapCard(i);
      });
    }
  });

  function updateGame(room) {
    currentTurnEl.textContent = `Turn: ${room.players[room.currentTurn]?.name || '?'} (${room.players[room.currentTurn]?.revealedCount}/12)`;
    deckSizeEl.textContent = room.deckSize;
    discardTopEl.textContent = room.discardTop !== null ? room.discardTop : '?';
    gridsEl.innerHTML = '';
    room.players.forEach((player, idx) => {
      const playerDiv = document.createElement('div');
      playerDiv.className = 'player-grid' + (player.id === socket.id ? ' own' : '');
      playerDiv.innerHTML = `
        <div class="player-name">${player.name} (Score: ${player.score})</div>
        <div class="score">${player.score}</div>
        <div class="grid" id="grid-${idx}"></div>
      `;
      const gridEl = playerDiv.querySelector('.grid');
      player.grid.forEach((card, pos) => {
        const cardEl = document.createElement('div');
        cardEl.className = `card ${card.revealed ? 'revealed' : 'hidden'}`;
        cardEl.textContent = card.revealed ? card.value : '?';
        cardEl.dataset.pos = pos;
        gridEl.appendChild(cardEl);
      });
      gridsEl.appendChild(playerDiv);
    });

    const myTurn = room.players[room.currentTurn]?.id === socket.id;
    const hasDrawn = drawnValue !== null;
    drawButtons.style.display = (myTurn && !hasDrawn && !room.ended) ? 'block' : 'none';

    if (!(myTurn && hasDrawn)) {
      clearDrawn();
    }

    // Check if round end (final round triggered, waiting for everyone)
    if (room.triggeredFinalRound && !room.ended) {
      roundEndScreen.style.display = 'block';
      finalRoundFinisherEl.textContent = room.finalRoundFinisher || '?';
      finalScoresEl.innerHTML = room.players.map(p => `<p><strong>${p.name}</strong>: ${p.score} (${p.grid.filter(c => c.revealed).length}/12 revealed)</p>`).join('');
      gridsEl.style.display = 'block';
      endScreen.style.display = 'none';
    } else if (room.ended) {
      roundEndScreen.style.display = 'none';
      endScreen.style.display = 'block';
      winnerEl.textContent = room.winner;
      finalScoresGameEl.innerHTML = room.players.map(p => `<p><strong>${p.name}</strong>: ${p.finalScore}</p>`).join('');
      gridsEl.style.display = 'block';
    } else {
      roundEndScreen.style.display = 'none';
      endScreen.style.display = 'none';
      gridsEl.style.display = 'block';
    }
  }

  function clearDrawn() {
    drawnValue = null;
    drawnCardEl.style.display = 'none';
    drawnCardEl.classList.remove('drawn');
    actionButtons.style.display = 'none';
    discardMode = false;
    // Clear highlights
    document.querySelectorAll('.card').forEach(c => {
      c.style.borderColor = '';
      c.onclick = null;
    });
    drawButtons.style.display = 'none';
  }



  function swapCard(pos) {
    socket.emit('swapCard', { code: currentRoomCode, pos, drawnValue });
    clearDrawn();
  }

  discardBtn.onclick = () => {
    discardMode = true;
    actionButtons.style.display = 'none';
    // Now highlight cards to flip
    const ownGrid = document.querySelector('.player-grid.own .grid');
    if (ownGrid) {
      Array.from(ownGrid.children).forEach((card, i) => {
        card.style.borderColor = '#dc3545';
        card.onclick = () => {
          socket.emit('discardCard', { code: currentRoomCode, flipPos: i });
          clearDrawn();
        };
      });
    }
  };

  document.getElementById('drawDeckBtn').onclick = () => {
    socket.emit('drawDeck', currentRoomCode);
  };

  document.getElementById('drawDiscardBtn').onclick = () => {
    socket.emit('drawDiscard', currentRoomCode);
  };

  nextRoundBtn.onclick = () => {
    socket.emit('newRound', currentRoomCode);
  };

  newGameBtn.onclick = () => {
    socket.emit('newGame', currentRoomCode);
  };

  socket.on('roomList', (list) => {
    roomListEl.innerHTML = '';
    list.forEach(room => {
      const li = document.createElement('li');
      li.innerHTML = `<strong>${room.code}</strong> (${room.playerCount}/4): ${room.players.join(', ')}`;
      li.style.cursor = 'pointer';
      li.style.color = 'blue';
      li.onclick = () => {
        roomCodeInput.value = room.code;
        joinRoom();
      };
      roomListEl.appendChild(li);
    });
  });

  socket.on('error', (msg) => {
    alert(msg);
  });
});