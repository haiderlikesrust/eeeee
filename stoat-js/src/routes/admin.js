import { Router } from 'express';
import crypto from 'crypto';
import multer from 'multer';
import path from 'path';
import fs from 'fs';
import { ulid } from 'ulid';
import { User, GlobalBadge } from '../db/models/index.js';

const ADMIN_EMAIL = 'admin@admin.com';
const ADMIN_PASSWORD = 'admin123';
const SESSION_TTL_MS = 1000 * 60 * 60 * 24; // 24h
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

router.post('/login', (req, res) => {
  const { email, password } = req.body || {};
  if (email !== ADMIN_EMAIL || password !== ADMIN_PASSWORD) {
    return res.status(401).json({ type: 'Unauthorized', error: 'Invalid admin credentials' });
  }
  const token = crypto.randomBytes(32).toString('hex');
  sessions.set(token, { email, expires_at: Date.now() + SESSION_TTL_MS });
  res.json({
    token,
    admin: { email },
    expires_in_ms: SESSION_TTL_MS,
  });
});

router.post('/logout', adminAuth, (req, res) => {
  sessions.delete(req.adminToken);
  res.status(204).send();
});

router.get('/me', adminAuth, (req, res) => {
  res.json({ email: req.admin.email });
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
  if (label !== undefined) badge.label = String(label || '').trim().slice(0, 50);
  if (description !== undefined) badge.description = String(description || '').trim().slice(0, 200);
  if (icon !== undefined) badge.icon = icon || null;
  if (active !== undefined) badge.active = !!active;
  await badge.save();
  res.json(serializeBadge(badge));
});

router.delete('/badges/:id', adminAuth, async (req, res) => {
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
    .select('_id username discriminator display_name system_badges')
    .limit(30)
    .lean();
  res.json(users || []);
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
