import { useState, useEffect, useRef, useCallback } from 'react';
import Head from 'next/head';

const POLL_MS = 1800;

// ─── Flip animation styles ───────────────────────────────────────────────────
const flipAnimation = `
  @keyframes cardFlip {
    0% { transform: rotateY(0deg) scale(1); }
    50% { transform: rotateY(90deg) scale(0.95); }
    100% { transform: rotateY(180deg) scale(1); }
  }
  @keyframes cardFlipBack {
    0% { transform: rotateY(180deg) scale(1); }
    50% { transform: rotateY(90deg) scale(0.95); }
    100% { transform: rotateY(0deg) scale(1); }
  }
  @keyframes cardReveal {
    0% { transform: scale(0.8) rotate(-5deg); opacity: 0; }
    50% { transform: scale(1.05) rotate(3deg); opacity: 1; }
    100% { transform: scale(1) rotate(0deg); }
  }
`;

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

// ─── Card color scheme ────────────────────────────────────────────────────────
function getCardColor(val) {
  if (val === -2 || val === -1) return { border: '#1e3a8a', bg: '#dbeafe', text: '#1e3a8a', accent: '#1e3a8a' }; // -2, -1 blue
  if (val === 0) return { border: '#0ea5e9', bg: '#e0f2fe', text: '#0369a1', accent: '#0ea5e9' }; // 0 light blue
  if (val <= 4) return { border: '#65a30d', bg: '#ecfccb', text: '#3f6212', accent: '#65a30d' }; // 1-4 lime green
  if (val <= 6) return { border: '#eab308', bg: '#fef9c3', text: '#854d0e', accent: '#eab308' }; // 5-6 yellow
  if (val <= 9) return { border: '#ea580c', bg: '#ffedd5', text: '#9a3412', accent: '#ea580c' }; // 7-9 orange
  return { border: '#dc2626', bg: '#fee2e2', text: '#991b1b', accent: '#dc2626' }; // 10-12 red
}

// ─── Card component ───────────────────────────────────────────────────────────
function Card({ card, pos, selectable, selected, onClick, size = 'md', isOwn, isFlipping }) {
  const value = card?.value;
  const revealed = card?.revealed;
  const removed = card?.removed;

  const colors = revealed && !removed ? getCardColor(value) : null;

  const sizes = { sm: { w: 40, h: 58, fs: 14, corner: 10 }, md: { w: 56, h: 80, fs: 20, corner: 12 }, lg: { w: 68, h: 96, fs: 26, corner: 16 } };
  const s = sizes[size] || sizes.md;

  if (removed) {
    const cardColors = getCardColor(value);
    return (
      <div style={{
        width: s.w, height: s.h, margin: 3,
        border: '2px dashed #999', borderRadius: 10,
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        color: '#666', fontSize: s.fs - 4, opacity: 0.5,
        background: `radial-gradient(ellipse at center, ${cardColors.bg}40 0%, ${cardColors.bg}20 100%)`,
        position: 'relative',
        fontFamily: 'Georgia, "Times New Roman", serif',
      }}>
        <div style={{
          fontSize: size === 'sm' ? 20 : size === 'md' ? 28 : 34,
          fontWeight: 'bold', color: '#888',
          textDecoration: 'line-through',
        }}>{value}</div>
        <div style={{
          position: 'absolute', bottom: 0, left: 0, right: 0,
          textAlign: 'center', color: '#999', fontSize: 10, paddingBottom: 2,
        }}>✓</div>
      </div>
    );
  }

  // Hidden card - Kaleidoscope pattern
  if (!revealed) {
    return (
      <div onClick={selectable && onClick ? onClick : undefined} style={{
        width: s.w, height: s.h, margin: 2,
        borderRadius: 8,
        border: selected ? '3px solid #facc15' : selectable ? '2px solid #facc15' : '2px solid #475569',
        display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
        cursor: selectable ? 'pointer' : 'default',
        userSelect: 'none',
        boxShadow: selectable ? '0 0 8px #facc1580' : selected ? '0 0 12px #facc15' : '0 2px 8px rgba(0,0,0,0.15)',
        transition: 'transform 0.2s ease, box-shadow 0.2s ease',
        transform: selectable ? 'scale(1.05)' : 'scale(1)',
        // Colorful kaleidoscope + radial gradient mix
        background: 'repeating-radial-gradient(circle at center, #ec4899 0px, #ec4899 3px, #8b5cf6 3px, #8b5cf6 6px, #3b82f6 6px, #3b82f6 9px, #14b8a6 9px, #14b8a6 12px, #22c55e 12px, #22c55e 15px, #eab308 15px, #eab308 18px)',
        backgroundSize: '100% 100%',
        position: 'relative',
        overflow: 'hidden',
      }}>
        {/* Overlay to soften */}
        <div style={{
          position: 'absolute', inset: 0,
          background: 'radial-gradient(ellipse at center, rgba(30,58,95,0.2) 0%, rgba(30,58,95,0.5) 100%)',
        }} />
        <div style={{
          width: s.w - 10, height: s.h - 10,
          border: selectable ? '2px solid #facc15' : '2px solid rgba(255,255,255,0.5)',
          borderRadius: 6,
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          position: 'relative', zIndex: 1,
        }}>
          <span style={{ color: 'rgba(255,255,255,0.95)', fontSize: s.fs - 6, fontWeight: 'bold', textShadow: '0 1px 3px rgba(0,0,0,0.5)' }}>SKYJO</span>
        </div>
      </div>
    );
  }

  // Revealed card - SkyJo style with clean white look
  return (
    <div onClick={selectable && onClick ? onClick : undefined} style={{
      width: s.w, height: s.h, margin: 2,
      // Pronounced honeycomb pattern using CSS gradients
      background: colors.bg,
      backgroundImage: 'linear-gradient(30deg, ' + colors.border + '40 10px, transparent 10.5px), linear-gradient(150deg, ' + colors.border + '40 10px, transparent 10.5px), linear-gradient(90deg, ' + colors.border + '30 14px, transparent 14.5px)',
      backgroundSize: '32px 56px',
      borderRadius: 8,
      border: selected ? '3px solid #facc15' : '2px solid ' + colors.border,
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      cursor: selectable ? 'pointer' : 'default',
      userSelect: 'none',
      boxShadow: selected ? '0 0 12px #facc15' : '0 2px 8px rgba(0,0,0,0.12)',
      transition: 'transform 0.2s ease, box-shadow 0.2s ease',
      transform: selectable ? 'scale(1.05)' : 'scale(1)',
      position: 'relative',
      fontFamily: 'Georgia, "Times New Roman", serif',
      overflow: 'hidden',
    }}>
      {/* Subtle inner border matching card color */}
      <div style={{
        position: 'absolute', inset: 2,
        border: '1px solid ' + colors.border + '40',
        borderRadius: 6,
        pointerEvents: 'none',
      }} />
      {/* Center number - large serif font */}
      <div style={{
        fontSize: size === 'sm' ? 32 : size === 'md' ? 42 : 52,
        fontWeight: 'bold', color: colors.text,
        textShadow: 'none',
        position: 'relative', zIndex: 1,
      }}>{value}</div>
      {/* Color accent bar at bottom */}
      <div style={{
        position: 'absolute', bottom: 0, left: 0, right: 0,
        height: 4, background: colors.accent,
        borderBottomLeftRadius: 6, borderBottomRightRadius: 6,
      }} />
    </div>
  );
}

// 3x4 grid (3 rows, 4 columns)
function PlayerGrid({ player, isOwn, selectable, selectedPos, onCardClick, size = 'md' }) {
  const rows = 3, cols = 4;
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
      if (selectedPos === 'wantIt') {
        // Swap the drawn card with this position
        doSwap(pos);
      } else if (selectedPos === 'dontWantIt') {
        // Discard drawn and flip this card (if hidden)
        const card = me.grid[pos];
        if (card && !card.revealed && !card.removed) {
          doDiscard(pos);
        }
      }
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
      <Head><title>SkyJo – {game.id}</title>
        <style>{flipAnimation}</style>
      </Head>

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
        <div style={{ maxWidth: 1200, margin: '0 auto', padding: '16px 12px' }}>

          {/* Turn banner */}
          <div style={{
            textAlign: 'center', marginBottom: 16, padding: '10px 20px',
            background: isMyTurn ? '#1d4ed820' : '#1e293b',
            borderRadius: 12, border: isMyTurn ? '1px solid #3b82f6' : '1px solid #334155',
          }}>
            {isMyTurn
              ? <span style={{ color: '#60a5fa', fontWeight: 'bold' }}>🎯 Your turn! {needInitialReveal ? 'Select 2 cards to reveal' : phase === 'draw' ? 'Draw a card' : 'Play your drawn card'}</span>
              : <span style={{ color: '#94a3b8' }}>⏳ {currentPlayer?.name}'s turn...</span>
            }
          </div>

          {/* All players - logged in user first, then others */}
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 16, justifyContent: 'center', marginBottom: 16 }}>
            {/* Current player (logged in user) */}
            <div style={{
              background: '#1e293b', borderRadius: 14, padding: 14,
              border: isMyTurn ? '3px solid #3b82f6' : '2px solid #334155',
              minWidth: 200, flex: '1 1 200px', maxWidth: 280,
              boxShadow: isMyTurn ? '0 0 20px #3b82f640' : 'none',
            }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 }}>
                <span style={{ fontWeight: 'bold', fontSize: 15, color: '#60a5fa' }}>
                  👤 {me.name}
                  {isMyTurn && ' 🎯'}
                </span>
                <span style={{ color: me.totalScore >= 80 ? '#f87171' : '#4ade80', fontSize: 13, fontWeight: 'bold' }}>
                  {me.totalScore || 0}pts
                </span>
              </div>
              <PlayerGrid player={me} size="md" isOwn={true} selectable={canPlay && hasDrawnCard} selectedPos={selectedPos} onCardClick={handleCardClick} />
              <div style={{ marginTop: 8, color: '#64748b', fontSize: 12, textAlign: 'right' }}>
                {me.revealedCount}/12 · score {me.score}
              </div>
              {/* Deck + Discard below player */}
              <div style={{ display: 'flex', justifyContent: 'center', gap: 12, marginTop: 12, paddingTop: 12, borderTop: '1px solid #334155' }}>
                <div style={{ textAlign: 'center' }}>
                  <div onClick={canDraw ? () => doDraw('deck') : undefined} style={{
                    width: 52, height: 74, background: canDraw ? '#1d4ed8' : '#334155',
                    borderRadius: 8, display: 'flex', alignItems: 'center', justifyContent: 'center',
                    cursor: canDraw ? 'pointer' : 'default', border: canDraw ? '2px solid #60a5fa' : '2px solid #475569',
                    fontSize: 20, boxShadow: canDraw ? '0 0 10px #3b82f660' : 'none',
                    transition: 'transform 0.15s', transform: canDraw ? 'scale(1.05)' : 'scale(1)',
                  }}>🂠</div>
                  <div style={{ color: '#60a5fa', fontSize: 9, marginTop: 3, fontWeight: 'bold' }}>DECK</div>
                  <div style={{ color: '#64748b', fontSize: 9 }}>{game.deckSize || 0}</div>
                </div>
                <div style={{ textAlign: 'center' }}>
                  <div onClick={canDraw ? () => doDraw('discard') : undefined} style={{
                    width: 52, height: 74,
                    background: discardTop !== null ? getCardColor(discardTop).bg : '#334155',
                    borderRadius: 8, display: 'flex', alignItems: 'center', justifyContent: 'center',
                    cursor: canDraw && discardTop !== null ? 'pointer' : 'default',
                    border: canDraw ? `2px solid ${getCardColor(discardTop || 0).border}` : '2px solid #475569',
                    fontSize: 24, fontWeight: 'bold', color: getCardColor(discardTop || 0).text,
                    fontFamily: 'Georgia, "Times New Roman", serif',
                    boxShadow: canDraw ? `0 0 10px ${getCardColor(discardTop || 0).border}60` : 'none',
                    transition: 'transform 0.15s', transform: canDraw ? 'scale(1.05)' : 'scale(1)',
                  }}>
                    {discardTop !== null ? discardTop : '—'}
                  </div>
                  <div style={{ color: '#facc15', fontSize: 9, marginTop: 3, fontWeight: 'bold' }}>DISCARD</div>
                </div>
              </div>
              {/* Drawn card controls - only show when player has drawn */}
              {canPlay && hasDrawnCard && (
                <div style={{ marginTop: 12, paddingTop: 12, borderTop: '1px solid #334155', textAlign: 'center' }}>
                  <div style={{ color: '#facc15', fontSize: 9, marginBottom: 6, fontWeight: 'bold' }}>DRAWN CARD</div>
                  <div style={{ display: 'flex', gap: 6, justifyContent: 'center', alignItems: 'center' }}>
                    <button onClick={() => setSelectedPos('wantIt')} style={{
                      padding: '6px 12px', borderRadius: 6, border: 'none',
                      background: selectedPos === 'wantIt' ? '#22c55e' : '#475569',
                      color: '#fff', fontSize: 11, fontWeight: 'bold', cursor: 'pointer',
                      flex: 1, maxWidth: 100,
                    }}>🟢 Want</button>
                    <button onClick={() => setSelectedPos('dontWantIt')} style={{
                      padding: '6px 12px', borderRadius: 6, border: 'none',
                      background: selectedPos === 'dontWantIt' ? '#ef4444' : '#475569',
                      color: '#fff', fontSize: 11, fontWeight: 'bold', cursor: 'pointer',
                      flex: 1, maxWidth: 100,
                    }}>🔴 Pass</button>
                  </div>
                  <div style={{ color: '#64748b', fontSize: 9, marginTop: 6 }}>
                    {selectedPos === 'wantIt' ? 'Click grid to swap' : selectedPos === 'dontWantIt' ? 'Click hidden to flip' : 'Choose above'}
                  </div>
                </div>
              )}
            </div>

            {/* Opponents */}
            {opponents.map((opp, i) => {
              const isOppTurn = game.players[game.currentTurn]?.id === opp.id;
              return (
                <div key={opp.id} style={{
                  background: '#1e293b', borderRadius: 14, padding: 12,
                  border: isOppTurn ? '2px solid #fbbf24' : '1px solid #334155',
                  minWidth: 180, flex: '1 1 180px', maxWidth: 240,
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
