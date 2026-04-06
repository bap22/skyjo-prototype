import { useState, useEffect, useRef, useCallback } from 'react';
import Head from 'next/head';

const POLL_MS = 1800;

// ─── Helpers ─────────────────────────────────────────────────────────────────
function saveLocal(key, val) {
  try { localStorage.setItem(key, typeof val === 'string' ? val : JSON.stringify(val)); } catch {}
}
function loadLocal(key, fallback = null) {
  try {
    const v = localStorage.getItem(key);
    if (!v) return fallback;
    try { return JSON.parse(v); } catch { return v; }
  } catch { return fallback; }
}

async function api(action, body = {}, method = 'POST') {
  const url = method === 'GET'
    ? `/api/game?action=${action}&${new URLSearchParams(body)}`
    : `/api/game?action=${action}`;
  const res = await fetch(url, {
    method,
    headers: method !== 'GET' ? { 'Content-Type': 'application/json' } : {},
    body: method !== 'GET' ? JSON.stringify(body) : undefined,
  });
  return res.json();
}

// ─── Card component ───────────────────────────────────────────────────────────
function Card({ card, pos, selectable, selected, onClick, size = 'md', isOwn }) {
  const value = card?.value;
  const revealed = card?.revealed;
  const removed = card?.removed;

  let bg = '#e8e8e8';
  if (revealed && !removed) {
    if (value < 0) bg = '#4ade80';
    else if (value === 0) bg = '#a3e635';
    else if (value <= 4) bg = '#fef08a';
    else if (value <= 8) bg = '#fb923c';
    else bg = '#f87171';
  }

  const sizes = { sm: { w: 36, h: 52, fs: 13 }, md: { w: 52, h: 72, fs: 18 }, lg: { w: 62, h: 88, fs: 22 } };
  const s = sizes[size] || sizes.md;

  if (removed) {
    return (
      <div style={{
        width: s.w, height: s.h, margin: 3,
        border: '2px dashed #ccc', borderRadius: 8,
        display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
        color: '#bbb', fontSize: s.fs - 4, opacity: 0.4,
      }}>✓</div>
    );
  }

  return (
    <div onClick={selectable && onClick ? onClick : undefined} style={{
      width: s.w, height: s.h, margin: 3,
      background: revealed ? bg : (selectable ? '#5b8ff9' : '#334155'),
      border: selected ? '3px solid #facc15' : selectable ? '2px solid #facc15' : '2px solid #475569',
      borderRadius: 8,
      display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
      cursor: selectable ? 'pointer' : 'default',
      fontSize: s.fs,
      fontWeight: 'bold',
      color: revealed ? '#1e293b' : (selectable ? '#fff' : '#94a3b8'),
      userSelect: 'none',
      boxShadow: selectable ? '0 0 8px #facc1580' : selected ? '0 0 12px #facc15' : '0 1px 3px #0004',
      transition: 'transform 0.1s, box-shadow 0.1s',
      transform: selectable ? 'scale(1.05)' : 'scale(1)',
    }}>
      {revealed ? value : (selectable ? '?' : '?')}
    </div>
  );
}

// 4x3 grid
function PlayerGrid({ player, isOwn, selectable, selectedPos, onCardClick, size = 'md' }) {
  // 4 rows, 3 cols: pos = row*3 + col
  const rows = 4, cols = 3;
  return (
    <div>
      {Array.from({ length: rows }).map((_, row) => (
        <div key={row} style={{ display: 'flex', justifyContent: 'center' }}>
          {Array.from({ length: cols }).map((_, col) => {
            const pos = row * cols + col;
            const card = player.grid[pos];
            if (!card) return <div key={col} style={{ width: size === 'sm' ? 36 : 52, height: size === 'sm' ? 52 : 72, margin: 3 }} />;
            return (
              <Card
                key={col}
                card={card}
                pos={pos}
                size={size}
                selectable={selectable}
                selected={selectedPos === pos}
                onClick={() => onCardClick && onCardClick(pos)}
                isOwn={isOwn}
              />
            );
          })}
        </div>
      ))}
    </div>
  );
}

// ─── Main App ─────────────────────────────────────────────────────────────────
export default function Home() {
  const [screen, setScreen] = useState('lobby'); // lobby | game
  const [openGames, setOpenGames] = useState([]);
  const [activeGames, setActiveGames] = useState([]);
  const [playerName, setPlayerName] = useState('');
  const [maxPlayers, setMaxPlayers] = useState(4);
  const [creating, setCreating] = useState(false);
  const [joining, setJoining] = useState(false);
  const [error, setError] = useState('');
  const [gameId, setGameId] = useState(null);
  const [playerId, setPlayerId] = useState(null);
  const [game, setGame] = useState(null);
  const [selectedPos, setSelectedPos] = useState(null);
  const [initialSelections, setInitialSelections] = useState([]);
  const [renaming, setRenaming] = useState(false);
  const [newName, setNewName] = useState('');
  const [busy, setBusy] = useState(false);
  const [logOpen, setLogOpen] = useState(false);
  const pollRef = useRef(null);
  const lastGameRef = useRef(null);

  // Load saved session
  useEffect(() => {
    const savedName = loadLocal('skyjo_name');
    if (savedName) setPlayerName(savedName);
    const savedSession = loadLocal('skyjo_session');
    if (savedSession?.gameId && savedSession?.playerId) {
      // Try to rejoin
      rejoin(savedSession.gameId, savedSession.playerId);
    } else {
      fetchOpenGames();
    }
  }, []);

  async function rejoin(gId, pId) {
    const data = await api('poll', { gameId: gId, playerId: pId }, 'GET');
    if (data.ok && data.game) {
      const p = data.game.players.find(pl => pl.id === pId);
      if (p) {
        setGameId(gId);
        setPlayerId(pId);
        setGame(data.game);
        setScreen('game');
        startPolling(gId, pId);
        return;
      }
    }
    saveLocal('skyjo_session', null);
    fetchOpenGames();
  }

  async function fetchOpenGames() {
    try {
      const data = await fetch('/api/games').then(r => r.json());
      setOpenGames(data.games || []);
      setActiveGames(data.activeGames || []);
    } catch {}
  }

  function startPolling(gId, pId) {
    if (pollRef.current) clearInterval(pollRef.current);
    pollRef.current = setInterval(async () => {
      try {
        const data = await api('poll', { gameId: gId, playerId: pId }, 'GET');
        if (data.ok && data.game) {
          setGame(g => {
            lastGameRef.current = data.game;
            return data.game;
          });
        }
      } catch {}
    }, POLL_MS);
  }

  function stopPolling() {
    if (pollRef.current) { clearInterval(pollRef.current); pollRef.current = null; }
  }

  async function createGame() {
    if (!playerName.trim()) return setError('Enter your name first');
    setCreating(true); setError('');
    saveLocal('skyjo_name', playerName);
    const data = await api('create', { name: playerName, maxPlayers });
    setCreating(false);
    if (data.ok) {
      setGameId(data.gameId);
      setPlayerId(data.playerId);
      setGame(data.game);
      setScreen('game');
      saveLocal('skyjo_session', { gameId: data.gameId, playerId: data.playerId });
      startPolling(data.gameId, data.playerId);
    } else {
      setError(data.error || 'Failed to create');
    }
  }

  async function joinGame(gId) {
    if (!playerName.trim()) return setError('Enter your name first');
    setJoining(true); setError('');
    saveLocal('skyjo_name', playerName);
    const data = await api('join', { gameId: gId, name: playerName });
    setJoining(false);
    if (data.ok) {
      setGameId(data.gameId);
      setPlayerId(data.playerId);
      setGame(data.game);
      setScreen('game');
      saveLocal('skyjo_session', { gameId: data.gameId, playerId: data.playerId });
      startPolling(data.gameId, data.playerId);
    } else {
      setError(data.error || 'Failed to join');
    }
  }

  async function startGame() {
    setBusy(true);
    const data = await api('start', { gameId, playerId });
    setBusy(false);
    if (data.ok) setGame(data.game);
    else setError(data.error);
  }

  async function doReveal() {
    if (initialSelections.length !== 2) return;
    setBusy(true);
    const data = await api('reveal', { gameId, playerId, positions: initialSelections });
    setBusy(false);
    if (data.ok) { setGame(data.game); setInitialSelections([]); }
    else setError(data.error);
  }

  async function doDraw(from) {
    setBusy(true);
    const data = await api('draw', { gameId, playerId, from });
    setBusy(false);
    if (data.ok) setGame(data.game);
    else setError(data.error);
  }

  async function doSwap(pos) {
    setBusy(true);
    const data = await api('swap', { gameId, playerId, pos });
    setBusy(false);
    if (data.ok) { setGame(data.game); setSelectedPos(null); }
    else setError(data.error);
  }

  async function doDiscard(flipPos) {
    setBusy(true);
    const data = await api('discard', { gameId, playerId, flipPos: flipPos ?? -1 });
    setBusy(false);
    if (data.ok) { setGame(data.game); setSelectedPos(null); }
    else setError(data.error);
  }

  async function doNewRound() {
    setBusy(true);
    const data = await api('newround', { gameId, playerId });
    setBusy(false);
    if (data.ok) setGame(data.game);
    else setError(data.error);
  }

  async function doRename() {
    if (!newName.trim()) return;
    setBusy(true);
    const data = await api('rename', { gameId, playerId, name: newName });
    setBusy(false);
    if (data.ok) { setGame(data.game); setRenaming(false); saveLocal('skyjo_name', newName); }
    else setError(data.error);
  }

  function leaveGame() {
    stopPolling();
    saveLocal('skyjo_session', null);
    setScreen('lobby');
    setGame(null);
    setGameId(null);
    setPlayerId(null);
    setSelectedPos(null);
    setInitialSelections([]);
    setActiveGames([]);
    fetchOpenGames();
  }

  // ── Derived state
  const me = game?.players?.find(p => p.id === playerId);
  const myIdx = game?.players?.findIndex(p => p.id === playerId) ?? -1;
  const isMyTurn = game?.currentTurn === myIdx;
  const phase = game?.phase;
  const needInitialReveal = phase === 'initialReveal' && me && !me.initialRevealed;
  const discardTop = game?.discard?.[game.discard.length - 1] ?? null;

  // What can I do?
  const canDraw = isMyTurn && phase === 'draw' && !busy;
  const canPlay = isMyTurn && phase === 'play' && !busy;
  const hasDrawnCard = me?.drawnCard !== null && me?.drawnCard !== undefined;

  function handleCardClick(pos) {
    if (needInitialReveal) {
      setInitialSelections(prev => {
        if (prev.includes(pos)) return prev.filter(p => p !== pos);
        if (prev.length >= 2) return prev;
        return [...prev, pos];
      });
      return;
    }
    if (canPlay && hasDrawnCard) {
      doSwap(pos);
    }
  }

  // ── Lobby Screen
  if (screen === 'lobby') {
    return (
      <div style={{ minHeight: '100vh', background: 'linear-gradient(135deg, #0f172a 0%, #1e3a5f 100%)', color: '#f1f5f9', fontFamily: 'system-ui, sans-serif' }}>
        <Head><title>SkyJo Online</title></Head>
        <div style={{ maxWidth: 500, margin: '0 auto', padding: '40px 20px' }}>
          <div style={{ textAlign: 'center', marginBottom: 40 }}>
            <h1 style={{ fontSize: 48, margin: 0, background: 'linear-gradient(90deg, #60a5fa, #a78bfa)', WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent' }}>
              SKY<span style={{ fontStyle: 'italic' }}>JO</span>
            </h1>
            <p style={{ color: '#94a3b8', margin: '8px 0 0' }}>Online Multiplayer</p>
          </div>

          {/* Name input */}
          <div style={{ background: '#1e293b', borderRadius: 16, padding: 24, marginBottom: 20 }}>
            <label style={{ color: '#94a3b8', fontSize: 13, display: 'block', marginBottom: 8 }}>YOUR NAME</label>
            <input
              value={playerName}
              onChange={e => setPlayerName(e.target.value)}
              placeholder="Enter your name..."
              maxLength={20}
              style={{
                width: '100%', padding: '10px 14px', borderRadius: 10, border: '1px solid #334155',
                background: '#0f172a', color: '#f1f5f9', fontSize: 16, outline: 'none',
                boxSizing: 'border-box',
              }}
            />
          </div>

          {/* Create Game */}
          <div style={{ background: '#1e293b', borderRadius: 16, padding: 24, marginBottom: 20 }}>
            <h3 style={{ margin: '0 0 16px', color: '#e2e8f0' }}>Create New Game</h3>
            <label style={{ color: '#94a3b8', fontSize: 13 }}>Number of players (AI fills empty slots)</label>
            <div style={{ display: 'flex', gap: 10, margin: '10px 0 16px' }}>
              {[2, 3, 4].map(n => (
                <button key={n} onClick={() => setMaxPlayers(n)} style={{
                  flex: 1, padding: '10px 0', borderRadius: 10,
                  border: maxPlayers === n ? '2px solid #60a5fa' : '2px solid #334155',
                  background: maxPlayers === n ? '#1d4ed8' : '#0f172a',
                  color: '#f1f5f9', cursor: 'pointer', fontSize: 16, fontWeight: 'bold',
                }}>
                  {n} <span style={{ fontSize: 12, opacity: 0.7 }}>players</span>
                </button>
              ))}
            </div>
            <button onClick={createGame} disabled={creating} style={{
              width: '100%', padding: '14px 0', borderRadius: 12, border: 'none',
              background: 'linear-gradient(135deg, #2563eb, #7c3aed)',
              color: '#fff', fontSize: 16, fontWeight: 'bold', cursor: 'pointer',
              opacity: creating ? 0.6 : 1,
            }}>
              {creating ? 'Creating…' : '+ Create Game'}
            </button>
          </div>

          {/* Open Games */}
          <div style={{ background: '#1e293b', borderRadius: 16, padding: 24 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
              <h3 style={{ margin: 0, color: '#e2e8f0' }}>Join a Game</h3>
              <button onClick={fetchOpenGames} style={{ background: 'none', border: 'none', color: '#60a5fa', cursor: 'pointer', fontSize: 13 }}>↻ Refresh</button>
            </div>

            {/* Lobby games */}
            {openGames.length > 0 && (
              <>
                <div style={{ color: '#475569', fontSize: 11, textTransform: 'uppercase', letterSpacing: 1, marginBottom: 8 }}>Waiting to Start</div>
                {openGames.map(g => (
                  <div key={g.id} style={{
                    display: 'flex', justifyContent: 'space-between', alignItems: 'center',
                    padding: '12px 14px', borderRadius: 10, background: '#0f172a',
                    marginBottom: 10, border: '1px solid #334155',
                  }}>
                    <div>
                      <div style={{ fontWeight: 'bold', color: '#e2e8f0' }}>
                        Game {g.id}
                        {g.hasAI && <span style={{ marginLeft: 8, fontSize: 11, color: '#7c3aed', background: '#3b0764', padding: '2px 6px', borderRadius: 4 }}>AI filling slots</span>}
                      </div>
                      <div style={{ color: '#64748b', fontSize: 13, marginTop: 2 }}>
                        {g.players.map((n, i) => <span key={i}>{i > 0 ? ', ' : ''}{n}</span>)} · {g.playerCount}/{g.maxPlayers} players
                      </div>
                    </div>
                    <button onClick={() => joinGame(g.id)} disabled={joining} style={{
                      padding: '8px 18px', borderRadius: 8, border: 'none',
                      background: '#16a34a', color: '#fff', fontWeight: 'bold', cursor: 'pointer',
                      opacity: joining ? 0.6 : 1,
                    }}>Join</button>
                  </div>
                ))}
              </>
            )}

            {/* Active games with AI slots */}
            {activeGames.length > 0 && (
              <>
                <div style={{ color: '#475569', fontSize: 11, textTransform: 'uppercase', letterSpacing: 1, marginBottom: 8, marginTop: openGames.length > 0 ? 16 : 0 }}>In Progress — Take Over AI</div>
                {activeGames.map(g => (
                  <div key={g.id} style={{
                    display: 'flex', justifyContent: 'space-between', alignItems: 'center',
                    padding: '12px 14px', borderRadius: 10, background: '#0f172a',
                    marginBottom: 10, border: '1px solid #7c3aed40',
                  }}>
                    <div>
                      <div style={{ fontWeight: 'bold', color: '#e2e8f0' }}>
                        Game {g.id}
                        <span style={{ marginLeft: 8, fontSize: 11, color: '#f59e0b', background: '#78350f', padding: '2px 6px', borderRadius: 4 }}>Round {g.round}</span>
                      </div>
                      <div style={{ color: '#64748b', fontSize: 13, marginTop: 2 }}>
                        {g.players.map((n, i) => <span key={i}>{i > 0 ? ', ' : ''}{n}</span>)} · {g.aiCount} AI slot{g.aiCount > 1 ? 's' : ''} open
                      </div>
                    </div>
                    <button onClick={() => joinGame(g.id)} disabled={joining} style={{
                      padding: '8px 18px', borderRadius: 8, border: 'none',
                      background: '#7c3aed', color: '#fff', fontWeight: 'bold', cursor: 'pointer',
                      opacity: joining ? 0.6 : 1,
                    }}>Take Over</button>
                  </div>
                ))}
              </>
            )}

            {openGames.length === 0 && activeGames.length === 0 && (
              <p style={{ color: '#475569', textAlign: 'center', margin: 0 }}>No games yet. Create one above!</p>
            )}
          </div>

          {error && <div style={{ marginTop: 16, color: '#f87171', textAlign: 'center' }}>{error}</div>}
        </div>
      </div>
    );
  }

  // ── Game Screen
  if (!game || !me) return (
    <div style={{ minHeight: '100vh', background: '#0f172a', color: '#f1f5f9', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
      Loading...
    </div>
  );

  const opponents = game.players.filter(p => p.id !== playerId);
  const currentPlayer = game.players[game.currentTurn];

  return (
    <div style={{ minHeight: '100vh', background: 'linear-gradient(135deg, #0f172a 0%, #1e293b 100%)', color: '#f1f5f9', fontFamily: 'system-ui, sans-serif', paddingBottom: 40 }}>
      <Head><title>SkyJo – {game.id}</title></Head>

      {/* Header */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '12px 20px', background: '#1e293b', borderBottom: '1px solid #334155' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
          <span style={{ fontSize: 22, fontWeight: 900, color: '#60a5fa' }}>SKYJO</span>
          <span style={{ color: '#475569', fontSize: 13 }}>#{game.id} · Round {game.round || 1}</span>
        </div>
        <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
          <button onClick={() => setLogOpen(l => !l)} style={{ background: '#334155', border: 'none', color: '#94a3b8', padding: '6px 12px', borderRadius: 8, cursor: 'pointer', fontSize: 12 }}>
            {logOpen ? 'Hide Log' : 'Log'}
          </button>
          <button onClick={() => setRenaming(true)} style={{ background: '#334155', border: 'none', color: '#94a3b8', padding: '6px 12px', borderRadius: 8, cursor: 'pointer', fontSize: 12 }}>
            ✏️ Rename
          </button>
          <button onClick={leaveGame} style={{ background: '#334155', border: 'none', color: '#94a3b8', padding: '6px 12px', borderRadius: 8, cursor: 'pointer', fontSize: 12 }}>
            Leave
          </button>
        </div>
      </div>

      {/* Log panel */}
      {logOpen && (
        <div style={{ background: '#0f172a', borderBottom: '1px solid #334155', padding: '10px 20px', maxHeight: 120, overflowY: 'auto' }}>
          {[...(game.log || [])].reverse().map((l, i) => (
            <div key={i} style={{ color: '#64748b', fontSize: 12, marginBottom: 2 }}>{l}</div>
          ))}
        </div>
      )}

      {/* Game ended */}
      {game.ended && (
        <div style={{ maxWidth: 500, margin: '30px auto', background: '#1e293b', borderRadius: 20, padding: 30, textAlign: 'center', border: '2px solid #f59e0b' }}>
          <div style={{ fontSize: 40, marginBottom: 10 }}>🏆</div>
          <h2 style={{ color: '#fbbf24', margin: '0 0 6px' }}>Game Over!</h2>
          <p style={{ color: '#94a3b8', marginBottom: 20 }}>Winner: <strong style={{ color: '#4ade80' }}>{game.winner}</strong></p>
          <div style={{ marginBottom: 20 }}>
            {(game.winnerDetails || []).map((p, i) => (
              <div key={i} style={{ display: 'flex', justifyContent: 'space-between', padding: '8px 16px', background: i === 0 ? '#14532d30' : '#0f172a', borderRadius: 8, marginBottom: 6 }}>
                <span>{i === 0 ? '🥇' : i === 1 ? '🥈' : '🥉'} {p.name}</span>
                <span style={{ color: i === 0 ? '#4ade80' : '#f1f5f9' }}>{p.total} pts</span>
              </div>
            ))}
          </div>
          <button onClick={leaveGame} style={{ padding: '12px 24px', borderRadius: 12, border: 'none', background: '#2563eb', color: '#fff', fontSize: 16, fontWeight: 'bold', cursor: 'pointer' }}>
            Back to Lobby
          </button>
        </div>
      )}

      {/* Round end */}
      {!game.ended && phase === 'roundEnd' && (
        <div style={{ maxWidth: 500, margin: '20px auto', background: '#1e293b', borderRadius: 20, padding: 24, textAlign: 'center', border: '1px solid #475569' }}>
          <h3 style={{ color: '#fbbf24', marginTop: 0 }}>Round {(game.round || 1) - 1} Complete!</h3>
          <div style={{ marginBottom: 16 }}>
            {game.players.map((p, i) => (
              <div key={i} style={{ display: 'flex', justifyContent: 'space-between', padding: '6px 12px', background: '#0f172a', borderRadius: 8, marginBottom: 6 }}>
                <span style={{ color: p.id === playerId ? '#60a5fa' : '#f1f5f9' }}>{p.name}</span>
                <span style={{ color: '#94a3b8' }}>
                  +{p.roundScore} pts → <strong style={{ color: p.totalScore >= 80 ? '#f87171' : '#4ade80' }}>{p.totalScore} total</strong>
                </span>
              </div>
            ))}
          </div>
          {game.playersReady?.[playerId]
            ? <p style={{ color: '#64748b' }}>Waiting for others...</p>
            : <button onClick={doNewRound} disabled={busy} style={{ padding: '12px 32px', borderRadius: 12, border: 'none', background: '#16a34a', color: '#fff', fontSize: 16, fontWeight: 'bold', cursor: 'pointer' }}>
                Next Round →
              </button>
          }
        </div>
      )}

      {/* Lobby waiting */}
      {!game.started && phase === 'lobby' && (
        <div style={{ maxWidth: 500, margin: '40px auto', padding: '0 20px', textAlign: 'center' }}>
          <div style={{ background: '#1e293b', borderRadius: 20, padding: 30 }}>
            <h2 style={{ marginTop: 0, color: '#e2e8f0' }}>Waiting for Players</h2>
            <p style={{ color: '#64748b', fontSize: 13 }}>Others can join from the lobby • Share game code: <strong style={{ color: '#60a5fa', fontSize: 18 }}>{game.id}</strong></p>
            <div style={{ marginBottom: 24 }}>
              {game.players.map((p, i) => (
                <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '10px 16px', background: '#0f172a', borderRadius: 10, marginBottom: 8 }}>
                  <span style={{ fontSize: 20 }}>{p.isAI ? '🤖' : '👤'}</span>
                  <span style={{ color: p.id === playerId ? '#60a5fa' : '#e2e8f0' }}>{p.name}</span>
                  {p.isAI && <span style={{ marginLeft: 'auto', color: '#475569', fontSize: 12 }}>AI (takeable)</span>}
                </div>
              ))}
            </div>
            <button onClick={startGame} disabled={busy} style={{
              width: '100%', padding: '14px 0', borderRadius: 12, border: 'none',
              background: 'linear-gradient(135deg, #16a34a, #15803d)',
              color: '#fff', fontSize: 18, fontWeight: 'bold', cursor: 'pointer',
              opacity: busy ? 0.6 : 1,
            }}>
              ▶ Start Game ({game.players.length}P{game.players.some(p => p.isAI) ? ' + AI' : ''})
            </button>
          </div>
        </div>
      )}

      {/* Main game area */}
      {game.started && phase !== 'lobby' && !game.ended && phase !== 'roundEnd' && (
        <div style={{ maxWidth: 900, margin: '0 auto', padding: '16px 12px' }}>

          {/* Turn banner */}
          <div style={{
            textAlign: 'center', marginBottom: 12, padding: '10px 20px',
            background: isMyTurn ? '#1d4ed820' : '#1e293b',
            borderRadius: 12, border: isMyTurn ? '1px solid #3b82f6' : '1px solid #334155',
          }}>
            {isMyTurn
              ? <span style={{ color: '#60a5fa', fontWeight: 'bold' }}>🎯 Your turn! {needInitialReveal ? 'Select 2 cards to reveal' : phase === 'draw' ? 'Draw a card' : 'Play your drawn card'}</span>
              : <span style={{ color: '#94a3b8' }}>⏳ {currentPlayer?.name}'s turn...</span>
            }
          </div>

          {/* Opponents */}
          {opponents.length > 0 && (
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 12, justifyContent: 'center', marginBottom: 16 }}>
              {opponents.map((opp, i) => {
                const isOppTurn = game.players[game.currentTurn]?.id === opp.id;
                return (
                  <div key={opp.id} style={{
                    background: '#1e293b', borderRadius: 14, padding: 12,
                    border: isOppTurn ? '2px solid #fbbf24' : '1px solid #334155',
                    minWidth: 160, flex: '1 1 160px', maxWidth: 240,
                  }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
                      <span style={{ fontWeight: 'bold', fontSize: 14, color: isOppTurn ? '#fbbf24' : '#e2e8f0' }}>
                        {opp.isAI ? '🤖 ' : '👤 '}{opp.name}
                        {isOppTurn && ' ▶'}
                      </span>
                      <span style={{ color: opp.totalScore >= 80 ? '#f87171' : '#64748b', fontSize: 12 }}>
                        {opp.totalScore || 0}pts
                      </span>
                    </div>
                    <PlayerGrid player={opp} size="sm" />
                    <div style={{ marginTop: 6, color: '#475569', fontSize: 11, textAlign: 'right' }}>
                      {opp.revealedCount}/12 · score {opp.score}
                    </div>
                  </div>
                );
              })}
            </div>
          )}

          {/* Deck + Discard */}
          <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', gap: 20, marginBottom: 16 }}>
            {/* Deck */}
            <div style={{ textAlign: 'center' }}>
              <div onClick={canDraw ? () => doDraw('deck') : undefined} style={{
                width: 62, height: 88, background: canDraw ? '#1d4ed8' : '#334155',
                borderRadius: 10, display: 'flex', alignItems: 'center', justifyContent: 'center',
                cursor: canDraw ? 'pointer' : 'default', border: canDraw ? '2px solid #60a5fa' : '2px solid #475569',
                fontSize: 24, boxShadow: canDraw ? '0 0 12px #3b82f660' : 'none',
                transition: 'transform 0.1s', transform: canDraw ? 'scale(1.05)' : 'scale(1)',
              }}>🂠</div>
              <div style={{ color: '#64748b', fontSize: 11, marginTop: 4 }}>{game.deckSize || 0} left</div>
              <div style={{ color: '#60a5fa', fontSize: 11 }}>DECK</div>
            </div>

            {/* Discard */}
            <div style={{ textAlign: 'center' }}>
              <div onClick={canDraw ? () => doDraw('discard') : undefined} style={{
                width: 62, height: 88,
                background: discardTop !== null ? (discardTop < 0 ? '#4ade80' : discardTop <= 4 ? '#fef08a' : discardTop <= 8 ? '#fb923c' : '#f87171') : '#334155',
                borderRadius: 10, display: 'flex', alignItems: 'center', justifyContent: 'center',
                cursor: canDraw && discardTop !== null ? 'pointer' : 'default',
                border: canDraw ? '2px solid #facc15' : '2px solid #475569',
                fontSize: 24, fontWeight: 'bold', color: '#1e293b',
                boxShadow: canDraw ? '0 0 12px #facc1560' : 'none',
                transition: 'transform 0.1s', transform: canDraw ? 'scale(1.05)' : 'scale(1)',
              }}>
                {discardTop !== null ? discardTop : '—'}
              </div>
              <div style={{ color: '#64748b', fontSize: 11, marginTop: 4 }}>&nbsp;</div>
              <div style={{ color: '#facc15', fontSize: 11 }}>DISCARD</div>
            </div>

            {/* Drawn card */}
            {canPlay && hasDrawnCard && (
              <div style={{ textAlign: 'center' }}>
                <div style={{
                  width: 62, height: 88,
                  background: me.drawnCard < 0 ? '#4ade80' : me.drawnCard <= 4 ? '#fef08a' : me.drawnCard <= 8 ? '#fb923c' : '#f87171',
                  borderRadius: 10, display: 'flex', alignItems: 'center', justifyContent: 'center',
                  border: '3px solid #facc15', fontSize: 28, fontWeight: 'bold', color: '#1e293b',
                  boxShadow: '0 0 16px #facc15',
                }}>{me.drawnCard}</div>
                <div style={{ color: '#facc15', fontSize: 11, marginTop: 4 }}>DRAWN</div>
                <button onClick={() => setSelectedPos(null)} style={{ marginTop: 4, background: 'none', border: 'none', color: '#60a5fa', cursor: 'pointer', fontSize: 11 }}>
                  swap a card ↓
                </button>
              </div>
            )}
          </div>

          {/* Discard drawn card button */}
          {canPlay && hasDrawnCard && (
            <div style={{ textAlign: 'center', marginBottom: 10 }}>
              <span style={{ color: '#64748b', fontSize: 13, marginRight: 8 }}>Or:</span>
              <button onClick={() => {
                // Need to pick a card to flip - we'll let them click a hidden card,
                // or just discard with no flip if all revealed
                const hasHidden = me.grid.some(c => !c.revealed && !c.removed);
                if (hasHidden) {
                  // Show instructions to click a hidden card to flip it
                  setSelectedPos('discardMode');
                } else {
                  doDiscard(-1);
                }
              }} style={{
                padding: '8px 18px', borderRadius: 10, border: 'none',
                background: '#475569', color: '#f1f5f9', cursor: 'pointer', fontSize: 14,
              }}>
                {me.grid.some(c => !c.revealed && !c.removed) ? 'Discard & flip a card' : 'Discard'}
              </button>
            </div>
          )}

          {selectedPos === 'discardMode' && (
            <div style={{ textAlign: 'center', marginBottom: 8 }}>
              <span style={{ color: '#fbbf24', fontSize: 13 }}>Click a hidden card to flip it (or cancel)</span>
              <button onClick={() => setSelectedPos(null)} style={{ marginLeft: 10, background: 'none', border: 'none', color: '#f87171', cursor: 'pointer' }}>✕</button>
            </div>
          )}

          {/* My board */}
          <div style={{ background: '#1e293b', borderRadius: 18, padding: 16, border: `2px solid ${isMyTurn ? '#3b82f6' : '#334155'}` }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
              <div>
                <span style={{ fontWeight: 'bold', fontSize: 16, color: '#60a5fa' }}>👤 {me.name}</span>
                <span style={{ color: '#475569', fontSize: 13, marginLeft: 10 }}>{me.revealedCount}/12 revealed · score {me.score}</span>
              </div>
              <span style={{ color: me.totalScore >= 80 ? '#f87171' : '#64748b', fontWeight: 'bold' }}>Total: {me.totalScore || 0}</span>
            </div>

            {needInitialReveal && (
              <div style={{ textAlign: 'center', marginBottom: 12 }}>
                <p style={{ color: '#fbbf24', margin: '0 0 10px', fontSize: 14 }}>Select 2 cards to reveal ({initialSelections.length}/2)</p>
                {initialSelections.length === 2 && (
                  <button onClick={doReveal} disabled={busy} style={{
                    padding: '10px 24px', borderRadius: 10, border: 'none',
                    background: '#16a34a', color: '#fff', fontWeight: 'bold', cursor: 'pointer',
                  }}>Reveal!</button>
                )}
              </div>
            )}

            <div style={{ display: 'flex', justifyContent: 'center' }}>
              <PlayerGrid
                player={me}
                isOwn
                selectable={needInitialReveal
                  ? true
                  : canPlay && hasDrawnCard
                    ? true
                    : canPlay && selectedPos === 'discardMode'
                      ? true
                      : false}
                selectedPos={typeof selectedPos === 'number' ? selectedPos : null}
                size="lg"
                onCardClick={pos => {
                  if (needInitialReveal) {
                    handleCardClick(pos);
                    return;
                  }
                  if (selectedPos === 'discardMode') {
                    // discard drawn and flip this card
                    doDiscard(pos);
                    setSelectedPos(null);
                    return;
                  }
                  if (canPlay && hasDrawnCard) {
                    doSwap(pos);
                  }
                }}
              />
            </div>

            {needInitialReveal && (
              <div style={{ display: 'flex', justifyContent: 'center', flexWrap: 'wrap', gap: 8, marginTop: 12 }}>
                {initialSelections.map(pos => (
                  <span key={pos} style={{ background: '#1d4ed8', color: '#fff', padding: '4px 10px', borderRadius: 20, fontSize: 12 }}>
                    Card {pos + 1}
                  </span>
                ))}
              </div>
            )}
          </div>

          {error && <div style={{ marginTop: 12, color: '#f87171', textAlign: 'center', fontSize: 14 }}>{error}</div>}

          {/* Scoreboard */}
          <div style={{ marginTop: 16, background: '#1e293b', borderRadius: 14, padding: '12px 16px' }}>
            <div style={{ color: '#475569', fontSize: 12, marginBottom: 8 }}>SCOREBOARD</div>
            <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap' }}>
              {[...game.players].sort((a, b) => a.totalScore - b.totalScore).map((p, i) => (
                <div key={p.id} style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                  <span style={{ color: '#475569', fontSize: 11 }}>#{i + 1}</span>
                  <span style={{ color: p.id === playerId ? '#60a5fa' : '#e2e8f0', fontSize: 13 }}>{p.name}</span>
                  <span style={{ color: p.totalScore >= 80 ? '#f87171' : p.totalScore >= 50 ? '#fb923c' : '#4ade80', fontWeight: 'bold', fontSize: 13 }}>
                    {p.totalScore || 0}
                  </span>
                  {p.totalScore >= 80 && <span style={{ fontSize: 11 }}>⚠️</span>}
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* Rename modal */}
      {renaming && (
        <div style={{
          position: 'fixed', inset: 0, background: '#0009', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 100,
        }}>
          <div style={{ background: '#1e293b', borderRadius: 16, padding: 28, width: 320, boxShadow: '0 20px 40px #0006' }}>
            <h3 style={{ margin: '0 0 16px' }}>Change Your Name</h3>
            <input
              value={newName}
              onChange={e => setNewName(e.target.value)}
              placeholder={me?.name || 'New name'}
              maxLength={20}
              autoFocus
              onKeyDown={e => { if (e.key === 'Enter') doRename(); if (e.key === 'Escape') setRenaming(false); }}
              style={{
                width: '100%', padding: '10px 14px', borderRadius: 10, border: '1px solid #334155',
                background: '#0f172a', color: '#f1f5f9', fontSize: 16, outline: 'none', boxSizing: 'border-box', marginBottom: 16,
              }}
            />
            <div style={{ display: 'flex', gap: 10 }}>
              <button onClick={() => setRenaming(false)} style={{ flex: 1, padding: '10px 0', borderRadius: 10, border: '1px solid #334155', background: 'none', color: '#94a3b8', cursor: 'pointer' }}>Cancel</button>
              <button onClick={doRename} disabled={busy} style={{ flex: 1, padding: '10px 0', borderRadius: 10, border: 'none', background: '#2563eb', color: '#fff', fontWeight: 'bold', cursor: 'pointer' }}>Save</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
