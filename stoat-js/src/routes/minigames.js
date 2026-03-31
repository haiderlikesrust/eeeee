import { Router } from 'express';
import { MinigameSession, Message, User } from '../db/models/index.js';
import { authMiddleware } from '../middleware/auth.js';
import { broadcastToChannel, GatewayIntents } from '../events.js';
import { messageToJson } from './channels.js';
import { getOfficialClawUserId } from '../officialClaw.js';
import LOCATIONS from '../minigames/locations.js';
import config from '../../config.js';

const router = Router();
router.use(authMiddleware());

/** In-memory round timers keyed by session _id */
const roundTimers = new Map();

function haversineKm(lat1, lng1, lat2, lng2) {
  const R = 6371;
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLng = (lng2 - lng1) * Math.PI / 180;
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
    Math.sin(dLng / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function scoreFromDistance(km) {
  return Math.round(5000 * Math.exp(-km / 2000));
}

function pickRandomLocations(count) {
  const indices = [];
  const pool = [...Array(LOCATIONS.length).keys()];
  for (let i = 0; i < Math.min(count, pool.length); i++) {
    const pick = Math.floor(Math.random() * pool.length);
    indices.push(pool[pick]);
    pool.splice(pick, 1);
  }
  return indices;
}

function randomViewParams() {
  return {
    heading: Math.floor(Math.random() * 360),
    pitch: Math.floor(Math.random() * 41) - 20, // -20..20
    fov: 90,
  };
}

async function fetchStreetViewPanoId(lat, lng) {
  if (!config.googleMapsApiKey) return '';
  try {
    const params = new URLSearchParams({
      location: `${lat},${lng}`,
      source: 'outdoor',
      key: config.googleMapsApiKey,
    });
    const url = `https://maps.googleapis.com/maps/api/streetview/metadata?${params.toString()}`;
    const rsp = await fetch(url);
    if (!rsp.ok) return '';
    const meta = await rsp.json();
    if (meta?.status !== 'OK') return '';
    return String(meta.pano_id || '');
  } catch {
    return '';
  }
}

function buildLobbyEmbed(session) {
  return {
    type: 'geoguesser_lobby',
    session_id: session._id,
    host: session.host,
    players: session.players.map((p) => ({ user: p.user, username: p.username })),
    total_rounds: session.total_rounds,
    round_time_sec: session.round_time_sec,
  };
}

function buildStreetViewProxyUrl(sessionId, roundNumber) {
  return `/minigames/${sessionId}/streetview?round=${roundNumber}&t=${Date.now()}`;
}

function buildRoundEmbed(session, showAnswer = false) {
  const round = session.rounds[session.current_round - 1];
  if (!round) return buildLobbyEmbed(session);
  const loc = LOCATIONS[round.location_idx];
  const embed = {
    type: 'geoguesser_round',
    session_id: session._id,
    round_number: session.current_round,
    total_rounds: session.total_rounds,
    street_view_url: config.googleMapsApiKey
      ? buildStreetViewProxyUrl(session._id, session.current_round)
      : null,
    pano_id: round.pano_id || '',
    heading: round.heading ?? 0,
    pitch: round.pitch ?? 0,
    fov: round.fov ?? 90,
    started_at: round.started_at?.toISOString() || null,
    round_time_sec: session.round_time_sec,
    guessed_users: round.guesses.map((g) => g.user),
    total_players: session.players.length,
    host: session.host,
  };
  if (showAnswer) {
    embed.location_lat = loc?.lat;
    embed.location_lng = loc?.lng;
  }
  return embed;
}

function buildResultsEmbed(session) {
  const round = session.rounds[session.current_round - 1];
  if (!round) return buildLobbyEmbed(session);
  const loc = LOCATIONS[round.location_idx];
  return {
    type: 'geoguesser_results',
    session_id: session._id,
    round_number: session.current_round,
    total_rounds: session.total_rounds,
    location_name: loc?.name || 'Unknown',
    location_country: loc?.country || '',
    location_lat: loc?.lat,
    location_lng: loc?.lng,
    guesses: round.guesses.map((g) => {
      const player = session.players.find((p) => p.user === g.user);
      return {
        user: g.user,
        username: player?.username || '',
        lat: g.lat,
        lng: g.lng,
        distance_km: Math.round(g.distance_km),
        score: g.score,
      };
    }),
    standings: session.players
      .map((p) => ({ user: p.user, username: p.username, score: p.score }))
      .sort((a, b) => b.score - a.score),
    host: session.host,
    is_last_round: session.current_round >= session.total_rounds,
  };
}

function buildFinalEmbed(session) {
  return {
    type: 'geoguesser_final',
    session_id: session._id,
    total_rounds: session.total_rounds,
    standings: session.players
      .map((p) => ({ user: p.user, username: p.username, score: p.score }))
      .sort((a, b) => b.score - a.score),
  };
}

async function updateGameMessage(session, embed) {
  const msg = await Message.findById(session.message_id);
  if (!msg) return;
  msg.embeds = [embed];
  msg.markModified('embeds');
  await msg.save();
  const clawId = getOfficialClawUserId();
  const clawUser = await User.findById(clawId)
    .select('_id username discriminator display_name avatar badges system_badges status profile flags privileged bot relations')
    .lean();
  const payload = messageToJson(msg, { [clawId]: clawUser });
  await broadcastToChannel(session.channel, { type: 'MESSAGE_UPDATE', d: payload }, {
    eventIntent: GatewayIntents.GUILD_MESSAGES,
  });
}

async function endRound(sessionId) {
  clearRoundTimer(sessionId);
  const session = await MinigameSession.findById(sessionId);
  if (!session || session.status === 'finished') return;
  const round = session.rounds[session.current_round - 1];
  if (!round || round.ended) return;

  const loc = LOCATIONS[round.location_idx];
  for (const player of session.players) {
    const existing = round.guesses.find((g) => g.user === player.user);
    if (!existing) {
      round.guesses.push({ user: player.user, lat: 0, lng: 0, distance_km: 99999, score: 0 });
    }
  }
  for (const g of round.guesses) {
    if (g.distance_km === 0 && g.lat === 0 && g.lng === 0) {
      g.distance_km = 99999;
      g.score = 0;
    } else if (!g.score) {
      g.distance_km = haversineKm(loc.lat, loc.lng, g.lat, g.lng);
      g.score = scoreFromDistance(g.distance_km);
    }
  }
  for (const player of session.players) {
    let total = 0;
    for (const r of session.rounds) {
      const pg = r.guesses.find((rg) => rg.user === player.user);
      if (pg) total += pg.score;
    }
    player.score = total;
  }
  round.ended = true;
  session.status = 'results';
  session.markModified('rounds');
  session.markModified('players');
  await session.save();
  await updateGameMessage(session, buildResultsEmbed(session));
}

function startRoundTimer(sessionId, seconds) {
  clearRoundTimer(sessionId);
  const timer = setTimeout(() => {
    roundTimers.delete(sessionId);
    endRound(sessionId).catch(() => {});
  }, seconds * 1000);
  roundTimers.set(sessionId, timer);
}

function clearRoundTimer(sessionId) {
  const existing = roundTimers.get(sessionId);
  if (existing) {
    clearTimeout(existing);
    roundTimers.delete(sessionId);
  }
}

// POST /minigames/:id/join
router.post('/:id/join', async (req, res) => {
  try {
    const session = await MinigameSession.findById(req.params.id);
    if (!session) return res.status(404).json({ type: 'NotFound', error: 'Game not found' });
    if (session.status !== 'lobby') return res.status(400).json({ type: 'InvalidState', error: 'Game already started' });
    if (session.players.some((p) => p.user === req.userId)) {
      return res.json({ ok: true, already_joined: true });
    }
    const user = await User.findById(req.userId).select('username display_name').lean();
    session.players.push({
      user: req.userId,
      username: user?.display_name || user?.username || 'Player',
      score: 0,
    });
    await session.save();
    await updateGameMessage(session, buildLobbyEmbed(session));
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ type: 'InternalError', error: err.message });
  }
});

// POST /minigames/:id/start
router.post('/:id/start', async (req, res) => {
  try {
    const session = await MinigameSession.findById(req.params.id);
    if (!session) return res.status(404).json({ type: 'NotFound', error: 'Game not found' });
    if (session.host !== req.userId) return res.status(403).json({ type: 'Forbidden', error: 'Only the host can start' });
    if (session.status !== 'lobby') return res.status(400).json({ type: 'InvalidState', error: 'Game already started' });
    if (session.players.length < 1) return res.status(400).json({ type: 'InvalidState', error: 'Need at least 1 player' });

    const locationIndices = pickRandomLocations(session.total_rounds);
    const rounds = await Promise.all(locationIndices.map(async (idx) => {
      const view = randomViewParams();
      const loc = LOCATIONS[idx];
      const panoId = await fetchStreetViewPanoId(loc?.lat, loc?.lng);
      return {
        location_idx: idx,
        pano_id: panoId,
        heading: view.heading,
        pitch: view.pitch,
        fov: view.fov,
        guesses: [],
        started_at: null,
        ended: false,
      };
    }));
    session.rounds = rounds;
    session.current_round = 1;
    session.status = 'active';
    session.rounds[0].started_at = new Date();
    session.markModified('rounds');
    await session.save();

    startRoundTimer(session._id, session.round_time_sec);
    await updateGameMessage(session, buildRoundEmbed(session));
    res.json({ ok: true, round: 1 });
  } catch (err) {
    res.status(500).json({ type: 'InternalError', error: err.message });
  }
});

// GET /minigames/maps-config
router.get('/maps-config/current', async (req, res) => {
  res.json({
    interactive_street_view: !!config.googleMapsApiKey,
    google_maps_api_key: config.googleMapsApiKey || '',
  });
});

// POST /minigames/:id/guess
router.post('/:id/guess', async (req, res) => {
  try {
    const session = await MinigameSession.findById(req.params.id);
    if (!session) return res.status(404).json({ type: 'NotFound', error: 'Game not found' });
    if (session.status !== 'active') return res.status(400).json({ type: 'InvalidState', error: 'Not in active round' });
    if (!session.players.some((p) => p.user === req.userId)) {
      return res.status(403).json({ type: 'Forbidden', error: 'Not a player in this game' });
    }
    const round = session.rounds[session.current_round - 1];
    if (!round || round.ended) return res.status(400).json({ type: 'InvalidState', error: 'Round already ended' });
    if (round.guesses.some((g) => g.user === req.userId)) {
      return res.status(400).json({ type: 'InvalidState', error: 'Already guessed this round' });
    }

    const { lat, lng } = req.body || {};
    if (typeof lat !== 'number' || typeof lng !== 'number') {
      return res.status(400).json({ type: 'InvalidBody', error: 'lat and lng required' });
    }

    const loc = LOCATIONS[round.location_idx];
    const dist = haversineKm(loc.lat, loc.lng, lat, lng);
    const score = scoreFromDistance(dist);

    round.guesses.push({ user: req.userId, lat, lng, distance_km: dist, score });
    session.markModified('rounds');
    await session.save();

    await updateGameMessage(session, buildRoundEmbed(session));

    if (round.guesses.length >= session.players.length) {
      await endRound(session._id);
    }

    res.json({ ok: true, distance_km: Math.round(dist), score });
  } catch (err) {
    res.status(500).json({ type: 'InternalError', error: err.message });
  }
});

// POST /minigames/:id/next-round
router.post('/:id/next-round', async (req, res) => {
  try {
    const session = await MinigameSession.findById(req.params.id);
    if (!session) return res.status(404).json({ type: 'NotFound', error: 'Game not found' });
    if (session.host !== req.userId) return res.status(403).json({ type: 'Forbidden', error: 'Only the host can advance' });
    if (session.status !== 'results') return res.status(400).json({ type: 'InvalidState', error: 'Not in results phase' });

    if (session.current_round >= session.total_rounds) {
      session.status = 'finished';
      await session.save();
      await updateGameMessage(session, buildFinalEmbed(session));
      return res.json({ ok: true, finished: true });
    }

    session.current_round += 1;
    session.status = 'active';
    session.rounds[session.current_round - 1].started_at = new Date();
    session.markModified('rounds');
    await session.save();

    startRoundTimer(session._id, session.round_time_sec);
    await updateGameMessage(session, buildRoundEmbed(session));
    res.json({ ok: true, round: session.current_round });
  } catch (err) {
    res.status(500).json({ type: 'InternalError', error: err.message });
  }
});

// GET /minigames/:id/streetview
router.get('/:id/streetview', async (req, res) => {
  try {
    if (!config.googleMapsApiKey) {
      return res.status(503).json({ type: 'Unavailable', error: 'GOOGLE_MAPS_API_KEY is not configured' });
    }
    const session = await MinigameSession.findById(req.params.id).lean();
    if (!session) return res.status(404).json({ type: 'NotFound', error: 'Game not found' });
    if (!session.players.some((p) => p.user === req.userId)) {
      return res.status(403).json({ type: 'Forbidden', error: 'Not a player in this game' });
    }
    const maxAllowedRound = session.status === 'finished'
      ? (session.total_rounds || 1)
      : (session.current_round || 1);
    const requestedRound = Math.max(1, Math.min(
      Number(req.query.round) || session.current_round || 1,
      maxAllowedRound,
    ));
    const round = session.rounds?.[requestedRound - 1];
    if (!round) return res.status(404).json({ type: 'NotFound', error: 'Round not found' });
    const loc = LOCATIONS[round.location_idx];
    if (!loc) return res.status(404).json({ type: 'NotFound', error: 'Location not found' });

    const width = 960;
    const height = 540;
    const params = new URLSearchParams({
      size: `${width}x${height}`,
      location: `${loc.lat},${loc.lng}`,
      heading: String(round.heading ?? 0),
      pitch: String(round.pitch ?? 0),
      fov: String(round.fov ?? 90),
      source: 'outdoor',
      key: config.googleMapsApiKey,
    });
    const url = `https://maps.googleapis.com/maps/api/streetview?${params.toString()}`;
    const rsp = await fetch(url);
    if (!rsp.ok) {
      return res.status(502).json({ type: 'UpstreamError', error: 'Failed to fetch Google Street View image' });
    }
    const contentType = rsp.headers.get('content-type') || 'image/jpeg';
    const buffer = Buffer.from(await rsp.arrayBuffer());
    res.setHeader('Content-Type', contentType);
    res.setHeader('Cache-Control', 'private, max-age=60');
    res.send(buffer);
  } catch (err) {
    res.status(500).json({ type: 'InternalError', error: err.message });
  }
});

// GET /minigames/:id
router.get('/:id', async (req, res) => {
  try {
    const session = await MinigameSession.findById(req.params.id).lean();
    if (!session) return res.status(404).json({ type: 'NotFound', error: 'Game not found' });

    const safe = {
      _id: session._id,
      game_type: session.game_type,
      channel: session.channel,
      host: session.host,
      players: session.players,
      status: session.status,
      current_round: session.current_round,
      total_rounds: session.total_rounds,
      round_time_sec: session.round_time_sec,
      created_at: session.created_at,
    };

    if (session.status === 'active' && session.rounds?.length > 0) {
      const round = session.rounds[session.current_round - 1];
      if (round) {
        safe.round_started_at = round.started_at;
        safe.my_guess = round.guesses.find((g) => g.user === req.userId) || null;
        safe.guessed_users = round.guesses.map((g) => g.user);
        safe.street_view_url = buildStreetViewProxyUrl(session._id, session.current_round);
      }
    }

    if (session.status === 'results' && session.rounds?.length > 0) {
      const round = session.rounds[session.current_round - 1];
      if (round) {
        const loc = LOCATIONS[round.location_idx];
        safe.result = {
          location_name: loc?.name || 'Unknown',
          location_country: loc?.country || '',
          location_lat: loc?.lat,
          location_lng: loc?.lng,
          guesses: round.guesses.map((g) => {
            const p = session.players.find((pl) => pl.user === g.user);
            return { user: g.user, username: p?.username || '', lat: g.lat, lng: g.lng, distance_km: Math.round(g.distance_km), score: g.score };
          }),
        };
      }
    }

    res.json(safe);
  } catch (err) {
    res.status(500).json({ type: 'InternalError', error: err.message });
  }
});

export function cleanupMinigameTimers() {
  for (const [, timer] of roundTimers) clearTimeout(timer);
  roundTimers.clear();
}

export default router;
