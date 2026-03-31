import { Router } from 'express';
import multer from 'multer';
import path from 'path';
import fs from 'fs';
import { ulid } from 'ulid';
import { authMiddleware } from '../middleware/auth.js';
import config from '../../config.js';
import { User, CloudFile } from '../db/models/index.js';
import { effectiveCloudQuotaBytes, formatCloudBytes } from '../lib/cloudStorage.js';

const router = Router();

const useS3 = config.uploadStorage === 's3' && config.s3.bucket && config.s3.region && config.s3.publicBaseUrl;

const UPLOAD_DIR = config.uploadDir;
if (!useS3 && !fs.existsSync(UPLOAD_DIR)) fs.mkdirSync(UPLOAD_DIR, { recursive: true });

const MIME_MAP = {
  '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.png': 'image/png', '.gif': 'image/gif',
  '.webp': 'image/webp', '.svg': 'image/svg+xml', '.mp4': 'video/mp4', '.webm': 'video/webm',
  '.mp3': 'audio/mpeg', '.ogg': 'audio/ogg', '.wav': 'audio/wav', '.pdf': 'application/pdf',
  '.txt': 'text/plain', '.json': 'application/json', '.zip': 'application/zip',
  '.html': 'text/html', '.css': 'text/css', '.js': 'text/javascript', '.md': 'text/markdown',
};

const diskStorage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, UPLOAD_DIR),
  filename: (req, file, cb) => {
    const id = ulid();
    const ext = path.extname(file.originalname) || '';
    cb(null, `${id}${ext}`);
  },
});

const upload = multer({
  storage: useS3 ? multer.memoryStorage() : diskStorage,
  limits: { fileSize: 20 * 1024 * 1024 },
});

async function putS3Object(key, body, contentType) {
  const { S3Client, PutObjectCommand } = await import('@aws-sdk/client-s3');
  const client = new S3Client({
    region: config.s3.region,
    credentials: config.s3.accessKeyId && config.s3.secretAccessKey
      ? { accessKeyId: config.s3.accessKeyId, secretAccessKey: config.s3.secretAccessKey }
      : undefined,
  });
  await client.send(new PutObjectCommand({
    Bucket: config.s3.bucket,
    Key: key,
    Body: body,
    ContentType: contentType,
  }));
}

function buildMetadata(mimetype) {
  const metadata = {
    type: mimetype.startsWith('image/') ? 'Image' : mimetype.startsWith('video/') ? 'Video' : mimetype.startsWith('audio/') ? 'Audio' : 'File',
  };
  if (mimetype.startsWith('image/')) {
    metadata.width = 0;
    metadata.height = 0;
  }
  return metadata;
}

// POST /attachments - upload a file, returns file metadata
router.post('/', authMiddleware(), upload.single('file'), async (req, res) => {
  if (!req.file) return res.status(400).json({ type: 'InvalidBody', error: 'No file provided' });

  const file = req.file;
  const userId = req.userId;

  const owner = await User.findById(userId).select('cloud_bytes_used cloud_quota_bytes').lean();
  const quota = effectiveCloudQuotaBytes(owner);
  const used = owner?.cloud_bytes_used || 0;
  if (used + file.size > quota) {
    if (!useS3 && file.filename) {
      try { fs.unlinkSync(path.join(UPLOAD_DIR, file.filename)); } catch {}
    }
    if (useS3 && file.buffer) {
      /* multer memory: nothing written to S3 yet for quota fail before put — OK */
    }
    return res.status(413).json({
      type: 'QuotaExceeded',
      error: `Storage quota exceeded. You have used ${formatCloudBytes(used)} of ${formatCloudBytes(quota)}.`,
      used_bytes: used,
      quota_bytes: quota,
    });
  }

  const metadata = buildMetadata(file.mimetype);
  let result;

  if (useS3) {
    const ext = path.extname(file.originalname || '') || '';
    const finalId = ulid();
    const key = `attachments/${finalId}${ext}`;
    try {
      await putS3Object(key, file.buffer, file.mimetype);
    } catch (e) {
      return res.status(500).json({ type: 'UploadError', error: e.message || 'S3 upload failed' });
    }
    const publicUrl = `${config.s3.publicBaseUrl}/${key}`;
    result = {
      _id: finalId,
      tag: 'attachments',
      filename: file.originalname,
      content_type: file.mimetype,
      size: file.size,
      metadata,
      url: publicUrl,
    };
  } else {
    const idLocal = path.basename(file.filename, path.extname(file.filename));
    result = {
      _id: idLocal,
      tag: 'attachments',
      filename: file.originalname,
      content_type: file.mimetype,
      size: file.size,
      metadata,
      url: `/attachments/${file.filename}`,
    };
    try {
      const sidecar = path.join(UPLOAD_DIR, `${idLocal}.ctype.json`);
      fs.writeFileSync(sidecar, JSON.stringify({ contentType: file.mimetype }), 'utf8');
    } catch {
      /* non-fatal */
    }
  }

  try {
    await CloudFile.create({
      _id: result._id,
      owner: userId,
      filename: file.originalname,
      content_type: file.mimetype,
      size: file.size,
      url: result.url,
      metadata,
    });
    await User.updateOne({ _id: userId }, { $inc: { cloud_bytes_used: file.size } });
  } catch {
    /* ledger write non-fatal — file is already stored, don't fail the upload */
  }

  res.json(result);
});

function serveFile(filePath, originalFilename, res) {
  const ext = path.extname(filePath).toLowerCase();
  const base = path.basename(filePath, ext);
  const sidecar = path.join(path.dirname(filePath), `${base}.ctype.json`);
  let mime = MIME_MAP[ext] || 'application/octet-stream';
  if (fs.existsSync(sidecar)) {
    try {
      const raw = fs.readFileSync(sidecar, 'utf8');
      const j = JSON.parse(raw);
      if (j?.contentType && typeof j.contentType === 'string') mime = j.contentType;
    } catch {
      /* ignore */
    }
  }
  res.setHeader('Content-Type', mime);
  res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
  if (!mime.startsWith('image/') && !mime.startsWith('video/') && !mime.startsWith('audio/')) {
    res.setHeader('Content-Disposition', `attachment; filename="${originalFilename || path.basename(filePath)}"`);
  }
  return res.sendFile(filePath);
}

// GET /attachments/:filename - serve the file (local) or redirect to public URL (S3)
router.get('/:filename', (req, res) => {
  const filename = req.params.filename;

  if (useS3) {
    const key = filename.includes('/') ? filename : `attachments/${filename}`;
    const url = `${config.s3.publicBaseUrl}/${key}`;
    return res.redirect(302, url);
  }

  const filePath = path.join(UPLOAD_DIR, filename);

  if (fs.existsSync(filePath)) {
    return serveFile(filePath, filename, res);
  }

  if (!path.extname(filename)) {
    const files = fs.readdirSync(UPLOAD_DIR);
    const match = files.find((f) => f.startsWith(`${filename}.`) || f === filename);
    if (match) {
      return serveFile(path.join(UPLOAD_DIR, match), match, res);
    }
  }

  res.status(404).json({ type: 'NotFound', error: 'File not found' });
});

export default router;
