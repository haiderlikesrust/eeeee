import { Router } from 'express';
import { authMiddleware } from '../middleware/auth.js';
import { User, CloudFile, Message } from '../db/models/index.js';
import { effectiveCloudQuotaBytes, deleteStoredBlob } from '../lib/cloudStorage.js';

const router = Router();

function escapeRegex(s) {
  return String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function typeFilterToQuery(type) {
  switch (String(type || '').toLowerCase()) {
    case 'image': return { content_type: { $regex: /^image\// } };
    case 'video': return { content_type: { $regex: /^video\// } };
    case 'audio': return { content_type: { $regex: /^audio\// } };
    case 'document':
      return {
        $or: [
          { content_type: 'application/pdf' },
          { content_type: 'application/zip' },
          { content_type: { $regex: /^text\// } },
        ],
      };
    case 'other':
      return {
        content_type: {
          $not: { $regex: /^(image|video|audio)\// },
          $nin: ['application/pdf', 'application/zip'],
        },
      };
    default:
      return null;
  }
}

// GET /cloud/stats — lightweight usage for composer hints
router.get('/stats', authMiddleware(), async (req, res) => {
  try {
    const owner = await User.findById(req.userId).select('cloud_bytes_used cloud_quota_bytes').lean();
    res.json({
      used_bytes: owner?.cloud_bytes_used || 0,
      quota_bytes: effectiveCloudQuotaBytes(owner),
    });
  } catch (err) {
    res.status(500).json({ type: 'InternalError', error: err.message || 'Failed to load cloud stats' });
  }
});

// GET /cloud — list files with filters / sort / pagination
router.get('/', authMiddleware(), async (req, res) => {
  const userId = req.userId;
  const limit = Math.min(Math.max(parseInt(req.query.limit, 10) || 50, 1), 100);
  const skip = Math.min(Math.max(parseInt(req.query.skip, 10) || 0, 0), 10000);
  const q = (req.query.q || '').trim();
  const type = (req.query.type || '').trim();
  const sortMode = (req.query.sort || 'newest').toLowerCase();
  const fromDate = req.query.from ? new Date(req.query.from) : null;
  const toDate = req.query.to ? new Date(req.query.to) : null;

  const match = { owner: userId };
  if (q) {
    match.filename = { $regex: escapeRegex(q), $options: 'i' };
  }
  const tf = typeFilterToQuery(type);
  if (tf) {
    if (tf.$or) {
      match.$and = [...(match.$and || []), { $or: tf.$or }];
    } else {
      Object.assign(match, tf);
    }
  }
  if (fromDate && !Number.isNaN(fromDate.getTime())) {
    match.created_at = { ...(match.created_at || {}), $gte: fromDate };
  }
  if (toDate && !Number.isNaN(toDate.getTime())) {
    match.created_at = { ...(match.created_at || {}), $lte: toDate };
  }

  let sort = { created_at: -1 };
  if (sortMode === 'oldest') sort = { created_at: 1 };
  else if (sortMode === 'size_desc') sort = { size: -1, created_at: -1 };
  else if (sortMode === 'size_asc') sort = { size: 1, created_at: -1 };
  else if (sortMode === 'name') sort = { filename: 1, created_at: -1 };

  try {
    const owner = await User.findById(userId).select('cloud_bytes_used cloud_quota_bytes').lean();
    const quota = effectiveCloudQuotaBytes(owner);

    const files = await CloudFile.find(match).sort(sort).skip(skip).limit(limit + 1).lean();
    const hasMore = files.length > limit;
    if (hasMore) files.pop();

    res.json({
      files,
      has_more: hasMore,
      used_bytes: owner?.cloud_bytes_used || 0,
      quota_bytes: quota,
    });
  } catch (err) {
    res.status(500).json({ type: 'InternalError', error: err.message || 'Failed to load cloud files' });
  }
});

async function deleteOneCloudFile(userId, fileId) {
  const cf = await CloudFile.findOne({ _id: fileId, owner: userId }).lean();
  if (!cf) return { ok: false, status: 404, body: { type: 'NotFound', error: 'File not found' } };

  await Message.updateMany(
    { 'attachments._id': fileId },
    { $pull: { attachments: { _id: fileId } } },
  );

  await deleteStoredBlob(cf);
  await CloudFile.deleteOne({ _id: fileId, owner: userId });

  const dec = Math.max(0, Number(cf.size) || 0);
  const u = await User.findById(userId).select('cloud_bytes_used').lean();
  const nextUsed = Math.max(0, (u?.cloud_bytes_used || 0) - dec);
  await User.updateOne({ _id: userId }, { $set: { cloud_bytes_used: nextUsed } });

  return { ok: true };
}

// POST /cloud/bulk-delete  { ids: string[] } — register before /:fileId
router.post('/bulk-delete', authMiddleware(), async (req, res) => {
  const ids = Array.isArray(req.body?.ids) ? req.body.ids.filter((x) => typeof x === 'string' && x.length > 0) : [];
  if (ids.length === 0) {
    return res.status(400).json({ type: 'InvalidBody', error: 'ids array required' });
  }
  const unique = [...new Set(ids)].slice(0, 100);
  const deleted = [];
  const errors = [];
  try {
    for (const id of unique) {
      const result = await deleteOneCloudFile(req.userId, id);
      if (result.ok) deleted.push(id);
      else errors.push({ id, ...(result.body || {}) });
    }
    res.json({ deleted, errors });
  } catch (err) {
    res.status(500).json({ type: 'InternalError', error: err.message || 'Bulk delete failed' });
  }
});

// DELETE /cloud/:fileId
router.delete('/:fileId', authMiddleware(), async (req, res) => {
  const fileId = req.params.fileId;
  if (!fileId || fileId === 'stats' || fileId === 'bulk-delete') {
    return res.status(400).json({ type: 'InvalidParams', error: 'Invalid file id' });
  }
  try {
    const result = await deleteOneCloudFile(req.userId, fileId);
    if (!result.ok) return res.status(result.status).json(result.body);
    res.status(204).end();
  } catch (err) {
    res.status(500).json({ type: 'InternalError', error: err.message || 'Failed to delete file' });
  }
});

export default router;
