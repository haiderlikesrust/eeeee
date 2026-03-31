import { useState, useEffect, useRef, useCallback } from 'react';
import { get, post } from '../api';
import WorldMap, { PLAYER_COLORS } from './WorldMap';
import './GeoGuesserEmbed.css';

let googleMapsScriptPromise = null;
function loadGoogleMapsScript(apiKey) {
  if (!apiKey) return Promise.resolve(false);
  if (window.google?.maps) return Promise.resolve(true);
  if (googleMapsScriptPromise) return googleMapsScriptPromise;
  googleMapsScriptPromise = new Promise((resolve) => {
    const existing = document.querySelector('script[data-geo-maps="1"]');
    if (existing) {
      existing.addEventListener('load', () => resolve(!!window.google?.maps), { once: true });
      existing.addEventListener('error', () => resolve(false), { once: true });
      return;
    }
    const script = document.createElement('script');
    script.src = `https://maps.googleapis.com/maps/api/js?key=${encodeURIComponent(apiKey)}`;
    script.async = true;
    script.defer = true;
    script.dataset.geoMaps = '1';
    script.onload = () => resolve(!!window.google?.maps);
    script.onerror = () => resolve(false);
    document.head.appendChild(script);
  });
  return googleMapsScriptPromise;
}

function formatDistance(km) {
  if (km >= 99999) return 'No guess';
  if (km < 1) return `${Math.round(km * 1000)}m`;
  if (km < 100) return `${km.toFixed(1)}km`;
  return `${Math.round(km).toLocaleString()}km`;
}

export default function GeoGuesserEmbed({ embed, userId }) {
  const [game, setGame] = useState(null);
  const [myGuess, setMyGuess] = useState(null);
  const [submitted, setSubmitted] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [joining, setJoining] = useState(false);
  const [starting, setStarting] = useState(false);
  const [advancing, setAdvancing] = useState(false);
  const [timeLeft, setTimeLeft] = useState(null);
  const [mapsCfg, setMapsCfg] = useState(null);
  const [mapsReady, setMapsReady] = useState(false);
  const timerRef = useRef(null);
  const panoRef = useRef(null);
  const guessMapRef = useRef(null);
  const panoInstanceRef = useRef(null);
  const guessMapInstanceRef = useRef(null);
  const guessMarkerRef = useRef(null);
  const sessionId = embed?.session_id;

  const fetchGame = useCallback(async () => {
    if (!sessionId) return;
    try {
      const data = await get(`/minigames/${sessionId}`);
      setGame(data);
      if (data.my_guess) {
        setMyGuess({ lat: data.my_guess.lat, lng: data.my_guess.lng });
        setSubmitted(true);
      }
    } catch {}
  }, [sessionId]);

  useEffect(() => {
    fetchGame();
  }, [fetchGame, embed]);

  useEffect(() => {
    let mounted = true;
    (async () => {
      try {
        const cfg = await get('/minigames/maps-config/current');
        if (!mounted) return;
        setMapsCfg(cfg);
        if (cfg?.interactive_street_view && cfg?.google_maps_api_key) {
          const ok = await loadGoogleMapsScript(cfg.google_maps_api_key);
          if (mounted) setMapsReady(ok);
        }
      } catch {
        if (mounted) setMapsReady(false);
      }
    })();
    return () => { mounted = false; };
  }, []);

  useEffect(() => {
    if (embed?.type === 'geoguesser_round' && embed?.started_at && embed?.round_time_sec) {
      const update = () => {
        const elapsed = (Date.now() - new Date(embed.started_at).getTime()) / 1000;
        const remaining = Math.max(0, embed.round_time_sec - elapsed);
        setTimeLeft(Math.ceil(remaining));
        if (remaining <= 0) clearInterval(timerRef.current);
      };
      update();
      timerRef.current = setInterval(update, 500);
      return () => clearInterval(timerRef.current);
    }
    setTimeLeft(null);
  }, [embed?.type, embed?.started_at, embed?.round_time_sec]);

  useEffect(() => {
    if (embed?.type !== 'geoguesser_round') {
      setMyGuess(null);
      setSubmitted(false);
    }
  }, [embed?.type, embed?.round_number]);

  const handleJoin = async () => {
    setJoining(true);
    try { await post(`/minigames/${sessionId}/join`); await fetchGame(); } catch {}
    setJoining(false);
  };

  const handleStart = async () => {
    setStarting(true);
    try { await post(`/minigames/${sessionId}/start`); } catch {}
    setStarting(false);
  };

  const handleGuess = async () => {
    if (!myGuess || submitted || submitting) return;
    setSubmitting(true);
    try {
      await post(`/minigames/${sessionId}/guess`, { lat: myGuess.lat, lng: myGuess.lng });
      setSubmitted(true);
    } catch {}
    setSubmitting(false);
  };

  const handleNextRound = async () => {
    setAdvancing(true);
    try { await post(`/minigames/${sessionId}/next-round`); } catch {}
    setAdvancing(false);
  };

  const isHost = userId === embed?.host;
  const isPlayer = embed?.players?.some((p) => p.user === userId) || game?.players?.some((p) => p.user === userId);
  const hasGuessed = submitted || embed?.guessed_users?.includes(userId);

  useEffect(() => {
    if (embed?.type !== 'geoguesser_round') return undefined;
    if (!mapsReady || !window.google?.maps) return undefined;
    if (!panoRef.current || !guessMapRef.current) return undefined;

    const mapCenter = { lat: 20, lng: 0 };
    const guessMap = new window.google.maps.Map(guessMapRef.current, {
      center: mapCenter,
      zoom: 2,
      mapTypeControl: true,
      streetViewControl: false,
      fullscreenControl: false,
      gestureHandling: 'greedy',
      clickableIcons: false,
    });
    guessMapInstanceRef.current = guessMap;

    const mapClickListener = guessMap.addListener('click', (e) => {
      if (hasGuessed) return;
      const nextGuess = { lat: e.latLng.lat(), lng: e.latLng.lng() };
      setMyGuess(nextGuess);
      if (!guessMarkerRef.current) {
        guessMarkerRef.current = new window.google.maps.Marker({ map: guessMap, position: nextGuess });
      } else {
        guessMarkerRef.current.setPosition(nextGuess);
      }
    });

    const pano = new window.google.maps.StreetViewPanorama(panoRef.current, {
      addressControl: false,
      linksControl: true,
      panControl: true,
      enableCloseButton: false,
      fullscreenControl: false,
      motionTracking: false,
      pov: {
        heading: Number(embed?.heading ?? 0),
        pitch: Number(embed?.pitch ?? 0),
      },
      zoom: 1,
    });
    panoInstanceRef.current = pano;
    if (embed?.pano_id) {
      pano.setPano(embed.pano_id);
    } else if (embed?.street_view_url) {
      // no-op; fallback image is handled by render path below
    }

    return () => {
      window.google.maps.event.removeListener(mapClickListener);
      if (guessMarkerRef.current) {
        guessMarkerRef.current.setMap(null);
        guessMarkerRef.current = null;
      }
      panoInstanceRef.current = null;
      guessMapInstanceRef.current = null;
    };
  }, [embed?.type, embed?.round_number, embed?.pano_id, embed?.heading, embed?.pitch, embed?.street_view_url, mapsReady, hasGuessed]);

  useEffect(() => {
    if (!mapsReady || !guessMapInstanceRef.current || !window.google?.maps) return;
    if (!myGuess) return;
    const guessMap = guessMapInstanceRef.current;
    if (!guessMarkerRef.current) {
      guessMarkerRef.current = new window.google.maps.Marker({ map: guessMap, position: myGuess });
    } else {
      guessMarkerRef.current.setPosition(myGuess);
    }
    guessMap.panTo(myGuess);
    if (guessMap.getZoom() < 4) guessMap.setZoom(4);
  }, [mapsReady, myGuess]);

  // --- LOBBY ---
  if (embed?.type === 'geoguesser_lobby') {
    const players = embed.players || [];
    return (
      <div className="geo-embed geo-lobby">
        <div className="geo-header">
          <span className="geo-icon">🌍</span>
          <span className="geo-title">GeoGuesser</span>
          <span className="geo-badge">{embed.total_rounds} rounds • {embed.round_time_sec}s each</span>
        </div>
        <div className="geo-lobby-players">
          <div className="geo-lobby-label">Players ({players.length})</div>
          {players.map((p, i) => (
            <div key={p.user} className="geo-lobby-player">
              <span className="geo-lobby-dot" style={{ background: PLAYER_COLORS[i % PLAYER_COLORS.length] }} />
              <span>{p.username}</span>
              {p.user === embed.host && <span className="geo-host-tag">Host</span>}
            </div>
          ))}
        </div>
        <div className="geo-lobby-actions">
          {!isPlayer && (
            <button className="geo-btn geo-btn-primary" onClick={handleJoin} disabled={joining}>
              {joining ? 'Joining...' : 'Join Game'}
            </button>
          )}
          {isHost && (
            <button className="geo-btn geo-btn-success" onClick={handleStart} disabled={starting || players.length < 1}>
              {starting ? 'Starting...' : 'Start Game'}
            </button>
          )}
          {isPlayer && !isHost && <span className="geo-waiting">Waiting for host to start...</span>}
        </div>
      </div>
    );
  }

  // --- ROUND ---
  if (embed?.type === 'geoguesser_round') {
    const guessedCount = embed.guessed_users?.length || 0;
    const totalPlayers = embed.total_players || 0;
    const timerPct = timeLeft != null && embed.round_time_sec ? (timeLeft / embed.round_time_sec) * 100 : 100;
    const streetViewUrl = game?.street_view_url || embed.street_view_url || null;
    const interactiveEnabled = !!(mapsCfg?.interactive_street_view && mapsReady && embed?.pano_id);

    return (
      <div className="geo-embed geo-round">
        <div className="geo-header">
          <span className="geo-icon">🌍</span>
          <span className="geo-title">Round {embed.round_number}/{embed.total_rounds}</span>
          {timeLeft != null && (
            <span className={`geo-timer ${timeLeft <= 10 ? 'geo-timer-warn' : ''} ${timeLeft <= 5 ? 'geo-timer-danger' : ''}`}>
              {timeLeft}s
            </span>
          )}
          <span className="geo-guessed-count">{guessedCount}/{totalPlayers} guessed</span>
        </div>
        <div className="geo-timer-bar">
          <div className="geo-timer-fill" style={{ width: `${timerPct}%` }} />
        </div>

        <div className="geo-round-body">
          <div className="geo-clue-area geo-streetview-wrap">
            {interactiveEnabled ? (
              <div ref={panoRef} className="geo-streetview-pano" />
            ) : streetViewUrl ? (
              <img src={streetViewUrl} alt="Street view challenge" className="geo-streetview-img" />
            ) : (
              <div className="geo-streetview-fallback">Google Street View unavailable</div>
            )}
          </div>

          <div className="geo-map-area">
            <div className="geo-map-label">Click the map to place your guess</div>
            {mapsReady ? (
              <div ref={guessMapRef} className="geo-guess-google-map" />
            ) : (
              <WorldMap
                onClick={(pos) => { if (!hasGuessed) setMyGuess(pos); }}
                myPin={myGuess}
                disabled={hasGuessed}
              />
            )}
            {isPlayer && !hasGuessed && (
              <button
                className="geo-btn geo-btn-primary geo-submit-btn"
                onClick={handleGuess}
                disabled={!myGuess || submitting}
              >
                {submitting ? 'Submitting...' : myGuess ? `Submit Guess (${myGuess.lat}°, ${myGuess.lng}°)` : 'Place a pin first'}
              </button>
            )}
            {hasGuessed && <div className="geo-submitted-msg">Guess submitted! Waiting for others...</div>}
            {!isPlayer && <div className="geo-spectator-msg">You are spectating this game</div>}
          </div>
        </div>
      </div>
    );
  }

  // --- RESULTS ---
  if (embed?.type === 'geoguesser_results') {
    const guesses = embed.guesses || [];
    const standings = embed.standings || [];
    const markers = guesses.map((g, i) => ({
      lat: g.lat,
      lng: g.lng,
      label: g.username || `P${i + 1}`,
      user: g.user,
    }));
    const correctPin = embed.location_lat != null ? {
      lat: embed.location_lat,
      lng: embed.location_lng,
      label: embed.location_name,
    } : null;

    return (
      <div className="geo-embed geo-results">
        <div className="geo-header">
          <span className="geo-icon">📍</span>
          <span className="geo-title">Round {embed.round_number}/{embed.total_rounds} — Results</span>
        </div>
        <div className="geo-results-answer">
          The answer was <strong>{embed.location_name}</strong>, {embed.location_country}
        </div>

        <WorldMap markers={markers} correctPin={correctPin} disabled />

        <div className="geo-results-table">
          <div className="geo-results-row geo-results-header-row">
            <span className="geo-results-cell geo-results-player-col">Player</span>
            <span className="geo-results-cell">Distance</span>
            <span className="geo-results-cell">Points</span>
          </div>
          {guesses.sort((a, b) => b.score - a.score).map((g, i) => (
            <div key={g.user} className={`geo-results-row ${g.user === userId ? 'geo-results-me' : ''}`}>
              <span className="geo-results-cell geo-results-player-col">
                <span className="geo-lobby-dot" style={{ background: PLAYER_COLORS[i % PLAYER_COLORS.length] }} />
                {g.username || 'Player'}
              </span>
              <span className="geo-results-cell">{formatDistance(g.distance_km)}</span>
              <span className="geo-results-cell geo-results-score">+{g.score}</span>
            </div>
          ))}
        </div>

        <div className="geo-standings">
          <div className="geo-standings-title">Standings</div>
          {standings.map((s, i) => (
            <div key={s.user} className={`geo-standings-row ${s.user === userId ? 'geo-results-me' : ''}`}>
              <span className="geo-standings-rank">#{i + 1}</span>
              <span className="geo-standings-name">{s.username}</span>
              <span className="geo-standings-score">{s.score} pts</span>
            </div>
          ))}
        </div>

        {isHost && (
          <button className="geo-btn geo-btn-primary geo-next-btn" onClick={handleNextRound} disabled={advancing}>
            {advancing ? 'Loading...' : embed.is_last_round ? 'Show Final Results' : 'Next Round'}
          </button>
        )}
        {!isHost && <div className="geo-waiting">Waiting for host to continue...</div>}
      </div>
    );
  }

  // --- FINAL ---
  if (embed?.type === 'geoguesser_final') {
    const standings = embed.standings || [];
    const winner = standings[0];
    return (
      <div className="geo-embed geo-final">
        <div className="geo-header">
          <span className="geo-icon">🏆</span>
          <span className="geo-title">Game Over!</span>
        </div>
        {winner && (
          <div className="geo-winner">
            <div className="geo-winner-trophy">🏆</div>
            <div className="geo-winner-name">{winner.username}</div>
            <div className="geo-winner-score">{winner.score} points</div>
          </div>
        )}
        <div className="geo-final-standings">
          {standings.map((s, i) => (
            <div key={s.user} className={`geo-final-row ${s.user === userId ? 'geo-results-me' : ''}`}>
              <span className="geo-final-rank">
                {i === 0 ? '🥇' : i === 1 ? '🥈' : i === 2 ? '🥉' : `#${i + 1}`}
              </span>
              <span className="geo-final-name">{s.username}</span>
              <span className="geo-final-score">{s.score} pts</span>
            </div>
          ))}
        </div>
        <div className="geo-final-footer">{embed.total_rounds} rounds completed</div>
      </div>
    );
  }

  return null;
}
