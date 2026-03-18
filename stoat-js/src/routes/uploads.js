import { Router } from 'express';
import multer from 'multer';
import path from 'path';
import fs from 'fs';
import { ulid } from 'ulid';
import { authMiddleware } from '../middleware/auth.js';

const router = Router();

const UPLOAD_DIR = path.join(process.cwd(), 'uploads');
if (!fs.existsSync(UPLOAD_DIR)) fs.mkdirSync(UPLOAD_DIR, { recursive: true });

const MIME_MAP = {
  '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.png': 'image/png', '.gif': 'image/gif',
  '.webp': 'image/webp', '.svg': 'image/svg+xml', '.mp4': 'video/mp4', '.webm': 'video/webm',
  '.mp3': 'audio/mpeg', '.ogg': 'audio/ogg', '.wav': 'audio/wav', '.pdf': 'application/pdf',
  '.txt': 'text/plain', '.json': 'application/json', '.zip': 'application/zip',
  '.html': 'text/html', '.css': 'text/css', '.js': 'text/javascript', '.md': 'text/markdown',
};

const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, UPLOAD_DIR),
  filename: (req, file, cb) => {
    const id = ulid();
    const ext = path.extname(file.originalname) || '';
    cb(null, `${id}${ext}`);
  },
});

const upload = multer({
  storage,
  limits: { fileSize: 20 * 1024 * 1024 },
});

// POST /attachments - upload a file, returns file metadata
router.post('/', authMiddleware(), upload.single('file'), (req, res) => {
  if (!req.file) return res.status(400).json({ type: 'InvalidBody', error: 'No file provided' });

  const file = req.file;
  const id = path.basename(file.filename, path.extname(file.filename));

  const metadata = {
    type: file.mimetype.startsWith('image/') ? 'Image' : file.mimetype.startsWith('video/') ? 'Video' : file.mimetype.startsWith('audio/') ? 'Audio' : 'File',
  };

  if (file.mimetype.startsWith('image/')) {
    metadata.width = 0;
    metadata.height = 0;
  }

  const result = {
    _id: id,
    tag: 'attachments',
    filename: file.originalname,
    content_type: file.mimetype,
    size: file.size,
    metadata,
    url: `/attachments/${file.filename}`,
  };

  res.json(result);
});

function serveFile(filePath, originalFilename, res) {
  const ext = path.extname(filePath).toLowerCase();
  const mime = MIME_MAP[ext] || 'application/octet-stream';
  res.setHeader('Content-Type', mime);
  res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
  if (!mime.startsWith('image/') && !mime.startsWith('video/') && !mime.startsWith('audio/')) {
    res.setHeader('Content-Disposition', `attachment; filename="${originalFilename || path.basename(filePath)}"`);
  }
  return res.sendFile(filePath);
}

// GET /attachments/:filename - serve the file
router.get('/:filename', (req, res) => {
  const filename = req.params.filename;
  const filePath = path.join(UPLOAD_DIR, filename);

  if (fs.existsSync(filePath)) {
    return serveFile(filePath, filename, res);
  }

  // If no extension, try to find a file that starts with this ID
  if (!path.extname(filename)) {
    const files = fs.readdirSync(UPLOAD_DIR);
    const match = files.find((f) => f.startsWith(filename + '.') || f === filename);
    if (match) {
      return serveFile(path.join(UPLOAD_DIR, match), match, res);
    }
  }

  res.status(404).json({ type: 'NotFound', error: 'File not found' });
});

export default router;
