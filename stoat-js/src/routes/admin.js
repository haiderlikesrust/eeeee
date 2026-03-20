import { Router } from 'express';
import crypto from 'crypto';
import multer from 'multer';
import path from 'path';
import fs from 'fs';
import { ulid } from 'ulid';
import {
  User,
  GlobalBadge,
  Server,
  Channel,
  Message,
  Report,
  Member,
  Invite,
  Bot,
  Webhook,
  AuditLog,
  Session,
} from '../db/models/index.js';
import { toPublicUser } from '../publicUser.js';
import {
  ensureOfficialClawUser,
  getOfficialClawUserId,
  isOfficialClawUserId,
} from '../officialClaw.js';
import { postOfficialClawChannelMessage } from '../clawMessaging.js';
import { OPIC_STAFF_BADGE_ID } from '../opicStaffBadge.js';

const ADMIN_EMAIL = process.env.ADMIN_EMAIL || 'admin@admin.com';
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || 'admin123';
const SESSION_TTL_MS = Number(process.env.ADMIN_SESSION_TTL_MS) || 1000 * 60 * 60 * 24; // 24h default
const sessions = new Map();

const router = Router();

function getAdminToken(req) {
  return req.headers['x-admin-token']
    || req.headers['authorization']?.replace(/^Bearer\s+/i, '')
    || null;
}

function adminAuth(req, res, next) {
  const token = getAdminToken(req);
  if (!token) return res.status(401).json({ type: 'Unauthorized', error: 'Missing admin token' });
  const session = sessions.get(token);
  if (!session || session.expires_at < Date.now()) {
    if (session) sessions.delete(token);
    return res.status(401).json({ type: 'Unauthorized', error: 'Invalid admin token' });
  }
  req.admin = { email: session.email };
  req.adminToken = token;
  next();
}

function normalizeBadgeId(value) {
  return String(value || '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_]/g, '_')
    .replace(/_+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 40);
}

const UPLOAD_DIR = path.join(process.cwd(), 'uploads');
if (!fs.existsSync(UPLOAD_DIR)) fs.mkdirSync(UPLOAD_DIR, { recursive: true });

const upload = multer({
  storage: multer.diskStorage({
    destination: (req, file, cb) => cb(null, UPLOAD_DIR),
    filename: (req, file, cb) => {
      const id = ulid();
      const ext = path.extname(file.originalname) || '';
      cb(null, `${id}${ext}`);
    },
  }),
  limits: { fileSize: 5 * 1024 * 1024 },
});

function serializeBadge(b) {
  return {
    id: b._id,
    label: b.label,
    description: b.description || '',
    icon: b.icon || null,
    active: !!b.active,
    created_at: b.createdAt || null,
    updated_at: b.updatedAt || null,
  };
}

function previewReportContent(content, maxLen = 280) {
  let s;
  try {
    s = typeof content === 'string' ? content : JSON.stringify(content ?? null);
  } catch {
    s = String(content);
  }
  if (s.length > maxLen) return `${s.slice(0, maxLen)}…`;
  return s;
}

router.get('/stats', adminAuth, async (req, res) => {
  try {
    const [
      users,
      bot_users,
      servers,
      channels,
      messages,
      reports,
      members,
      invites,
      webhooks,
      bot_apps,
      global_badges,
      active_badges,
    ] = await Promise.all([
      User.countDocuments({}),
      User.countDocuments({ 'bot.owner': { $exists: true, $ne: null } }),
      Server.countDocuments({}),
      Channel.countDocuments({}),
      Message.countDocuments({}),
      Report.countDocuments({}),
      Member.countDocuments({}),
      Invite.countDocuments({}),
      Webhook.countDocuments({}),
      Bot.countDocuments({}),
      GlobalBadge.countDocuments({}),
      GlobalBadge.countDocuments({ active: true }),
    ]);

    const [reportDocs, auditDocs] = await Promise.all([
      Report.find({}).sort({ created_at: -1 }).limit(15).lean(),
      AuditLog.find({}).sort({ created_at: -1 }).limit(10).lean(),
    ]);

    const authorIds = [...new Set((reportDocs || []).map((r) => r.author_id).filter(Boolean))];
    const authors = authorIds.length
      ? await User.find({ _id: { $in: authorIds } }).select('_id username display_name').lean()
      : [];
    const authorMap = new Map((authors || []).map((u) => [u._id, u]));

    const serverIds = [...new Set((auditDocs || []).map((a) => a.server).filter(Boolean))];
    const serverDocs = serverIds.length
      ? await Server.find({ _id: { $in: serverIds } }).select('_id name').lean()
      : [];
    const serverMap = new Map((serverDocs || []).map((s) => [s._id, s.name]));

    const recent_reports = (reportDocs || []).map((r) => {
      const author = authorMap.get(r.author_id);
      return {
        id: r._id,
        author_id: r.author_id,
        author_username: author?.username || null,
        author_display_name: author?.display_name || null,
        reason: r.reason || null,
        content_preview: previewReportContent(r.content),
        created_at: r.created_at || null,
      };
    });

    const recent_audit = (auditDocs || []).map((a) => ({
      id: a._id,
      server_id: a.server,
      server_name: serverMap.get(a.server) || null,
      user: a.user,
      action: a.action,
      target_type: a.target_type || null,
      target_id: a.target_id || null,
      created_at: a.created_at || null,
    }));

    res.json({
      generated_at: new Date().toISOString(),
      counts: {
        users,
        bot_users,
        servers,
        channels,
        messages,
        reports,
        members,
        invites,
        webhooks,
        bot_apps,
        global_badges,
        active_badges,
      },
      recent_reports,
      recent_audit,
    });
  } catch (err) {
    console.error('[admin/stats]', err);
    res.status(500).json({ type: 'InternalError', error: 'Failed to load stats' });
  }
});

router.post('/login', (req, res) => {
  const { email, password } = req.body || {};
  if (email !== ADMIN_EMAIL || password !== ADMIN_PASSWORD) {
    return res.status(401).json({ type: 'Unauthorized', error: 'Invalid admin credentials' });
  }
  const token = crypto.randomBytes(32).toString('hex');
  const expires_at = Date.now() + SESSION_TTL_MS;
  sessions.set(token, { email, expires_at });
  res.json({
    token,
    admin: { email },
    expires_in_ms: SESSION_TTL_MS,
    session_expires_at: new Date(expires_at).toISOString(),
  });
});

router.post('/logout', adminAuth, (req, res) => {
  sessions.delete(req.adminToken);
  res.status(204).send();
});

router.get('/me', adminAuth, (req, res) => {
  const session = sessions.get(req.adminToken);
  res.json({
    email: req.admin.email,
    session_expires_at: session ? new Date(session.expires_at).toISOString() : null,
  });
});

router.get('/reports', adminAuth, async (req, res) => {
  try {
    const limit = Math.min(100, Math.max(1, parseInt(String(req.query.limit || '50'), 10) || 50));
    const skip = Math.max(0, parseInt(String(req.query.skip || '0'), 10) || 0);
    const [total, reportDocs] = await Promise.all([
      Report.countDocuments({}),
      Report.find({}).sort({ created_at: -1 }).skip(skip).limit(limit).lean(),
    ]);
    const authorIds = [...new Set((reportDocs || []).map((r) => r.author_id).filter(Boolean))];
    const authors = authorIds.length
      ? await User.find({ _id: { $in: authorIds } }).select('_id username display_name').lean()
      : [];
    const authorMap = new Map((authors || []).map((u) => [u._id, u]));
    const reports = (reportDocs || []).map((r) => {
      const author = authorMap.get(r.author_id);
      return {
        id: r._id,
        author_id: r.author_id,
        author_username: author?.username || null,
        author_display_name: author?.display_name || null,
        reason: r.reason || null,
        content_preview: previewReportContent(r.content),
        created_at: r.created_at || null,
      };
    });
    res.json({ total, skip, limit, reports });
  } catch (err) {
    console.error('[admin/reports]', err);
    res.status(500).json({ type: 'InternalError', error: 'Failed to load reports' });
  }
});

router.get('/reports/:id', adminAuth, async (req, res) => {
  try {
    const r = await Report.findById(req.params.id).lean();
    if (!r) return res.status(404).json({ type: 'NotFound', error: 'Report not found' });
    const author = r.author_id
      ? await User.findById(r.author_id).select('_id username display_name').lean()
      : null;
    res.json({
      id: r._id,
      author_id: r.author_id,
      author_username: author?.username || null,
      author_display_name: author?.display_name || null,
      reason: r.reason || null,
      content: r.content,
      created_at: r.created_at || null,
    });
  } catch (err) {
    console.error('[admin/reports/:id]', err);
    res.status(500).json({ type: 'InternalError', error: 'Failed to load report' });
  }
});

router.delete('/reports/:id', adminAuth, async (req, res) => {
  const r = await Report.findById(req.params.id);
  if (!r) return res.status(404).json({ type: 'NotFound', error: 'Report not found' });
  await r.deleteOne();
  res.status(204).send();
});

router.get('/badges/public', async (req, res) => {
  const badges = await GlobalBadge.find({ active: true }).sort({ createdAt: 1 }).lean();
  res.json((badges || []).map(serializeBadge));
});

router.get('/badges', adminAuth, async (req, res) => {
  const badges = await GlobalBadge.find({}).sort({ createdAt: 1 }).lean();
  res.json((badges || []).map(serializeBadge));
});

router.post('/upload', adminAuth, upload.single('file'), (req, res) => {
  if (!req.file) return res.status(400).json({ type: 'InvalidBody', error: 'No file provided' });
  const file = req.file;
  const id = path.basename(file.filename, path.extname(file.filename));
  const result = {
    _id: id,
    tag: 'attachments',
    filename: file.originalname,
    content_type: file.mimetype,
    size: file.size,
    metadata: { type: file.mimetype.startsWith('image/') ? 'Image' : 'File' },
    url: `/attachments/${file.filename}`,
  };
  res.json(result);
});

router.post('/badges', adminAuth, async (req, res) => {
  const { id, label, description, icon, active } = req.body || {};
  const badgeId = normalizeBadgeId(id);
  if (!badgeId) return res.status(400).json({ type: 'FailedValidation', error: 'id is required' });
  if (!label || !String(label).trim()) return res.status(400).json({ type: 'FailedValidation', error: 'label is required' });
  const existing = await GlobalBadge.findById(badgeId).lean();
  if (existing) return res.status(409).json({ type: 'Conflict', error: 'Badge id already exists' });
  const created = await GlobalBadge.create({
    _id: badgeId,
    label: String(label).trim().slice(0, 50),
    description: String(description || '').trim().slice(0, 200),
    icon: icon || null,
    active: active !== false,
  });
  res.status(201).json(serializeBadge(created));
});

router.patch('/badges/:id', adminAuth, async (req, res) => {
  const badge = await GlobalBadge.findById(req.params.id);
  if (!badge) return res.status(404).json({ type: 'NotFound', error: 'Badge not found' });
  const { label, description, icon, active } = req.body || {};
  if (req.params.id === OPIC_STAFF_BADGE_ID && active === false) {
    return res.status(400).json({
      type: 'InvalidOperation',
      error: 'The Opic Staff badge cannot be deactivated.',
    });
  }
  if (label !== undefined) badge.label = String(label || '').trim().slice(0, 50);
  if (description !== undefined) badge.description = String(description || '').trim().slice(0, 200);
  if (icon !== undefined) badge.icon = icon || null;
  if (active !== undefined) badge.active = !!active;
  await badge.save();
  res.json(serializeBadge(badge));
});

router.delete('/badges/:id', adminAuth, async (req, res) => {
  if (req.params.id === OPIC_STAFF_BADGE_ID) {
    return res.status(400).json({
      type: 'InvalidOperation',
      error: 'The Opic Staff badge cannot be deleted. Remove it from users in Admin → Staff.',
    });
  }
  const badge = await GlobalBadge.findById(req.params.id);
  if (!badge) return res.status(404).json({ type: 'NotFound', error: 'Badge not found' });
  await badge.deleteOne();
  await User.updateMany({}, { $pull: { system_badges: badge._id } });
  res.status(204).send();
});

router.get('/users', adminAuth, async (req, res) => {
  const q = String(req.query.q || '').trim();
  const query = q
    ? {
      $or: [
        { username: { $regex: q, $options: 'i' } },
        { display_name: { $regex: q, $options: 'i' } },
        { _id: { $regex: q, $options: 'i' } },
      ],
    }
    : {};
  const users = await User.find(query)
    .select('_id username discriminator display_name system_badges privileged disabled disabled_reason')
    .limit(30)
    .lean();
  res.json(users || []);
});

router.get('/claw', adminAuth, async (req, res) => {
  try {
    await ensureOfficialClawUser();
    const claw = await User.findById(getOfficialClawUserId()).lean();
    if (!claw) {
      return res.status(500).json({ type: 'InternalError', error: 'Claw user missing' });
    }
    res.json({
      user: toPublicUser(claw, { relationship: 'None', online: false }),
    });
  } catch (err) {
    console.error('[admin/claw GET]', err);
    res.status(500).json({ type: 'InternalError', error: 'Failed to load Claw' });
  }
});

router.patch('/claw', adminAuth, async (req, res) => {
  try {
    await ensureOfficialClawUser();
    const claw = await User.findById(getOfficialClawUserId());
    if (!claw) {
      return res.status(500).json({ type: 'InternalError', error: 'Claw user missing' });
    }
    const body = req.body || {};
    if (body.display_name !== undefined) {
      const v = body.display_name;
      claw.display_name = v === null || v === ''
        ? undefined
        : String(v).trim().slice(0, 64) || undefined;
    }
    if (body.username !== undefined) {
      const nu = String(body.username || '').toLowerCase().replace(/\s/g, '_').slice(0, 32);
      if (!nu) {
        return res.status(400).json({ type: 'FailedValidation', error: 'Invalid username' });
      }
      const clash = await User.findOne({
        username: nu,
        discriminator: claw.discriminator,
        _id: { $ne: claw._id },
      }).lean();
      if (clash) {
        return res.status(409).json({ type: 'Conflict', error: 'Username#discriminator already taken' });
      }
      claw.username = nu;
    }
    if (body.discriminator !== undefined) {
      const raw = String(body.discriminator || '').replace(/\D/g, '').slice(0, 4);
      const d = (raw.length ? raw : '0').padStart(4, '0').slice(-4);
      const clash = await User.findOne({
        username: claw.username,
        discriminator: d,
        _id: { $ne: claw._id },
      }).lean();
      if (clash) {
        return res.status(409).json({ type: 'Conflict', error: 'Username#discriminator already taken' });
      }
      claw.discriminator = d;
    }
    if (body.avatar !== undefined) {
      claw.avatar = body.avatar || null;
    }
    if (body.profile !== undefined && typeof body.profile === 'object') {
      claw.profile = { ...(claw.profile && typeof claw.profile === 'object' ? claw.profile.toObject?.() || claw.profile : {}), ...body.profile };
    }
    if (body.status !== undefined && typeof body.status === 'object') {
      const cur = claw.status && typeof claw.status === 'object'
        ? (claw.status.toObject?.() || claw.status)
        : {};
      const s = body.status;
      claw.status = {
        ...cur,
        ...(s.text !== undefined ? { text: s.text } : {}),
        ...(s.presence !== undefined ? { presence: s.presence } : {}),
      };
    }
    claw.bot = { owner: 'system', official: true };
    claw.markModified('profile');
    claw.markModified('status');
    await claw.save();
    res.json({ user: toPublicUser(claw, { relationship: 'None', online: false }) });
  } catch (err) {
    console.error('[admin/claw PATCH]', err);
    res.status(500).json({ type: 'InternalError', error: err.message || 'Failed to update Claw' });
  }
});

router.post('/claw/messages', adminAuth, async (req, res) => {
  const { channel_id, content } = req.body || {};
  if (!channel_id || !String(content ?? '').trim()) {
    return res.status(400).json({ type: 'FailedValidation', error: 'channel_id and content required' });
  }
  try {
    const payload = await postOfficialClawChannelMessage(channel_id, content);
    res.status(201).json(payload);
  } catch (e) {
    if (e.code === 'NotFound') {
      return res.status(404).json({ type: 'NotFound', error: e.message });
    }
    if (e.code === 'InvalidChannel') {
      return res.status(400).json({ type: 'FailedValidation', error: e.message });
    }
    console.error('[admin/claw/messages]', e);
    res.status(500).json({ type: 'InternalError', error: e.message || 'Failed to send message' });
  }
});

router.patch('/users/:id', adminAuth, async (req, res) => {
  const { privileged, disabled, disabled_reason } = req.body || {};
  const hasPrivileged = privileged !== undefined;
  const hasDisabled = disabled !== undefined;
  if (!hasPrivileged && !hasDisabled) {
    return res.status(400).json({
      type: 'FailedValidation',
      error: 'Provide privileged and/or disabled',
    });
  }
  const user = await User.findById(req.params.id);
  if (!user) return res.status(404).json({ type: 'NotFound', error: 'User not found' });
  if (isOfficialClawUserId(user._id) && hasDisabled && disabled) {
    return res.status(400).json({
      type: 'InvalidOperation',
      error: 'Cannot disable the official Claw account',
    });
  }
  if (hasPrivileged) user.privileged = !!privileged;
  if (hasDisabled) {
    user.disabled = !!disabled;
    user.disabled_reason = user.disabled && disabled_reason != null
      ? String(disabled_reason).trim().slice(0, 500)
      : null;
    if (!user.disabled) user.disabled_reason = null;
    if (user.disabled) {
      await Session.deleteMany({ user_id: user._id });
    }
  }
  await user.save();
  res.json({
    _id: user._id,
    username: user.username,
    display_name: user.display_name || null,
    discriminator: user.discriminator,
    system_badges: user.system_badges || [],
    privileged: !!user.privileged,
    disabled: !!user.disabled,
    disabled_reason: user.disabled_reason || null,
  });
});

router.patch('/users/:id/badges', adminAuth, async (req, res) => {
  const { badges } = req.body || {};
  if (!Array.isArray(badges)) {
    return res.status(400).json({ type: 'FailedValidation', error: 'badges must be an array' });
  }
  const normalized = [...new Set(badges.map(normalizeBadgeId).filter(Boolean))];
  const existing = await GlobalBadge.find({ _id: { $in: normalized } }).select('_id').lean();
  const existingIds = new Set((existing || []).map((b) => b._id));
  const invalid = normalized.filter((id) => !existingIds.has(id));
  if (invalid.length > 0) {
    return res.status(400).json({ type: 'FailedValidation', error: `Unknown badge ids: ${invalid.join(', ')}` });
  }
  const user = await User.findById(req.params.id);
  if (!user) return res.status(404).json({ type: 'NotFound', error: 'User not found' });
  user.system_badges = normalized;
  await user.save();
  res.json({
    _id: user._id,
    username: user.username,
    display_name: user.display_name || null,
    discriminator: user.discriminator,
    system_badges: user.system_badges || [],
  });
});

export default router;
