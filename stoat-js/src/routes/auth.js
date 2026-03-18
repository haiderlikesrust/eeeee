import { Router } from 'express';
import bcrypt from 'bcryptjs';
import { ulid } from 'ulid';
import { User, Account, Session } from '../db/models/index.js';
import { authMiddleware } from '../middleware/auth.js';

const router = Router();

function randomToken() {
  return ulid() + ulid() + ulid();
}

function pickDiscriminator() {
  return String(Math.floor(Math.random() * 10000)).padStart(4, '0');
}

async function handleRegister(req, res) {
  try {
    const body = req.body || {};
    const email = body.email ?? body.email_address ?? body.Email;
    const password = body.password ?? body.Password;
    const invite = body.invite;
    if (!email || !password) {
      if (process.env.NODE_ENV !== 'production') {
        console.warn('[auth] register missing email/password:', { contentType: req.headers['content-type'], bodyKeys: Object.keys(body), body: Object.keys(body).length ? '[present]' : '[empty]' });
      }
      return res.status(400).json({ type: 'InvalidCredentials', error: 'Email and password required' });
    }
    const existing = await Account.findOne({ email: email.toLowerCase() });
    if (existing) {
      return res.status(400).json({ type: 'EmailInUse', error: 'Email already registered' });
    }
    const userId = ulid();
    const username = (body.username || 'user').toLowerCase().replace(/\s/g, '_').slice(0, 32) || 'user';
    let discriminator = pickDiscriminator();
    let exists = await User.findOne({ username, discriminator });
    while (exists) {
      discriminator = pickDiscriminator();
      exists = await User.findOne({ username, discriminator });
    }
    const user = await User.create({
      _id: userId,
      username,
      discriminator,
      last_acknowledged_policy_change: new Date(0),
    });
    await Account.create({
      _id: ulid(),
      user_id: userId,
      email: email.toLowerCase(),
      password,
      verified: true,
    });
    const sessionId = ulid();
    const token = randomToken();
    await Session.create({
      _id: sessionId,
      user_id: userId,
      token,
      name: 'Session',
    });
    const userObj = user.toObject();
    res.status(201).json({
      _id: userId,
      user_id: userId,
      session_id: sessionId,
      token,
      name: 'Session',
      user: {
        ...userObj,
        relationship: 'None',
        online: false,
      },
    });
  } catch (e) {
    res.status(500).json({ type: 'InternalError', error: e.message });
  }
}

// POST /auth/account/register - Create account
router.post('/account/register', handleRegister);
// POST /auth/account/create - Alias for Stoat/Revolt frontend
router.post('/account/create', handleRegister);

// POST /auth/account/verify/:token - No-op (email verification disabled); keeps old links from 404ing
router.post('/account/verify/:token', (req, res) => res.json({}));

// POST /auth/session/login - Login
router.post('/session/login', async (req, res) => {
  try {
    const { email, password } = req.body || {};
    if (!email || !password) {
      return res.status(400).json({ type: 'InvalidCredentials', error: 'Email and password required' });
    }
    const account = await Account.findOne({ email: email.toLowerCase() });
    if (!account) {
      return res.status(400).json({ type: 'InvalidCredentials', error: 'Invalid credentials' });
    }
    const ok = await bcrypt.compare(password, account.password);
    if (!ok) {
      return res.status(400).json({ type: 'InvalidCredentials', error: 'Invalid credentials' });
    }
    const user = await User.findById(account.user_id).lean();
    if (!user) return res.status(500).json({ type: 'InternalError', error: 'User not found' });
    const sessionId = ulid();
    const token = randomToken();
    await Session.create({
      _id: sessionId,
      user_id: account.user_id,
      token,
      name: req.body.friendly_name || 'Session',
    });
    res.json({
      _id: sessionId,
      user_id: account.user_id,
      session_id: sessionId,
      token,
      name: req.body.friendly_name || 'Session',
      user: {
        ...user,
        relationship: 'User',
        online: false,
      },
    });
  } catch (e) {
    res.status(500).json({ type: 'InternalError', error: e.message });
  }
});

// GET /auth/session - List sessions (requires auth)
router.get('/session', authMiddleware(), async (req, res) => {
  const sessions = await Session.find({ user_id: req.userId }).lean();
  res.json(sessions.map((s) => ({ _id: s._id, user_id: s.user_id, name: s.name, created_at: s.created_at })));
});

// DELETE /auth/session/:id - Logout
router.delete('/session/:id', authMiddleware(), async (req, res) => {
  await Session.deleteOne({ _id: req.params.id, user_id: req.userId });
  res.status(204).send();
});

// PATCH /auth/account - Change password (requires auth)
router.patch('/account', authMiddleware(), async (req, res) => {
  const { password, current_password } = req.body || {};
  if (!password) return res.status(400).json({ type: 'InvalidCredentials', error: 'New password required' });
  const account = await Account.findOne({ user_id: req.userId });
  if (!account) return res.status(500).json({ type: 'InternalError', error: 'Account not found' });
  if (current_password && !(await bcrypt.compare(current_password, account.password))) {
    return res.status(400).json({ type: 'InvalidCredentials', error: 'Current password wrong' });
  }
  account.password = password;
  await account.save();
  res.status(204).send();
});

export default router;
