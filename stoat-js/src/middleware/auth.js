import { User, Session } from '../db/models/index.js';

export function authMiddleware(optional = false) {
  return async (req, res, next) => {
    const token =
      req.headers['x-session-token'] ||
      req.headers['authorization']?.replace(/^Bearer\s+/i, '') ||
      req.query?.token;
    if (!token) {
      if (optional) return next();
      return res.status(401).json({ type: 'Unauthorized', error: 'Invalid session' });
    }
    const session = await Session.findOne({ token }).lean();
    if (!session) {
      if (optional) return next();
      return res.status(401).json({ type: 'Unauthorized', error: 'Invalid session' });
    }
    const user = await User.findById(session.user_id).lean();
    if (!user) {
      if (optional) return next();
      return res.status(401).json({ type: 'Unauthorized', error: 'User not found' });
    }
    req.user = user;
    req.userId = user._id;
    req.session = session;
    next();
  };
}
