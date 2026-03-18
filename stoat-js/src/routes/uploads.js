import { Router } from 'express';
import multer from 'multer';
import path from 'path';
import fs from 'fs';
import { ulid } from 'ulid';
import { authMiddleware } from '../middleware/auth.js';

const router = Router();

const UPLOAD_DIR = path.join(process.cwd(), 'uploads');
if (!fs.existsSync(UPLOAD_DIR)) fs.mkdirSync(UPLOAD_DIR, { recursive: true });

const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, UPLOAD_DIR),
  filename: (req, file, cb) => {
    const id = ulid();
    const ext = path.extname(file.originalname) || '';
    cb(null, `${id}${ext}`);
  },
});

const fileFilter = (req, file, cb) => {
  const allowed = /\.(jpg|jpeg|png|gif|webp|svg|mp4|webm|mp3|ogg|wav|pdf|txt|zip|tar|gz|json|js|css|html|md)$/i;
  if (allowed.test(path.extname(file.originalname)) || file.mimetype.startsWith('image/') || file.mimetype.startsWith('video/') || file.mimetype.startsWith('audio/')) {
    cb(null, true);
  } else {
    cb(null, true);
  }
};

const upload = multer({
  storage,
  limits: { fileSize: 20 * 1024 * 1024 },
  fileFilter,
});

// POST /attachments - upload a file, returns file metadata
router.post('/', authMiddleware(), upload.single('file'), (req, res) => {
  if (!req.file) return res.status(400).json({ type: 'InvalidBody', error: 'No file provided' });

  const file = req.file;
  const id = path.basename(file.filename, path.extname(file.filename));

  const metadata = {
    type: file.mimetype.startsWith('image/') ? 'Image' : file.mimetype.startsWith('video/') ? 'Video' : 'File',
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

// GET /attachments/:filename - serve the file
router.get('/:filename', (req, res) => {
  const filename = req.params.filename;
  const filePath = path.join(UPLOAD_DIR, filename);

  if (fs.existsSync(filePath)) {
    return res.sendFile(filePath);
  }

  // If no extension, try to find a file that starts with this ID
  if (!path.extname(filename)) {
    const files = fs.readdirSync(UPLOAD_DIR);
    const match = files.find((f) => f.startsWith(filename + '.') || f === filename);
    if (match) {
      return res.sendFile(path.join(UPLOAD_DIR, match));
    }
  }

  res.status(404).json({ type: 'NotFound', error: 'File not found' });
});

export default router;
