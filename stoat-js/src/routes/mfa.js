import { Router } from 'express';
import { authMiddleware } from '../middleware/auth.js';

const router = Router();

// MFA routes - stubs for API compatibility
router.get('/ticket', authMiddleware(), (req, res) => {
  res.json({ ticket: 'mfa-stub', allowed_methods: [] });
});

router.post('/ticket', authMiddleware(), (req, res) => {
  res.json({ ticket: 'mfa-stub', allowed_methods: [] });
});

router.get('/recovery', authMiddleware(), (req, res) => {
  res.json({ recovery_codes: [] });
});

router.put('/recovery', authMiddleware(), (req, res) => {
  res.status(204).send();
});

router.post('/recovery', authMiddleware(), (req, res) => {
  res.status(204).send();
});

router.get('/webauthn', authMiddleware(), (req, res) => {
  res.json({ credentials: [] });
});

router.put('/webauthn', authMiddleware(), (req, res) => {
  res.status(204).send();
});

router.delete('/webauthn/:credential_id', authMiddleware(), (req, res) => {
  res.status(204).send();
});

router.get('/totp', authMiddleware(), (req, res) => {
  res.json({ secret: 'stub', qr_code: 'stub' });
});

router.post('/totp', authMiddleware(), (req, res) => {
  res.status(204).send();
});

router.delete('/totp', authMiddleware(), (req, res) => {
  res.status(204).send();
});

export default router;
