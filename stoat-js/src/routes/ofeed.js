import { Router } from 'express';
import { ulid } from 'ulid';
import { OfeedPost, User } from '../db/models/index.js';
import { authMiddleware } from '../middleware/auth.js';
import { toPublicUser } from '../publicUser.js';
import { isUserOnlineDisplay } from '../events.js';

const router = Router();
const MAX_LEN = 280;

function serializeAuthor(u) {
  return u ? toPublicUser(u, { online: isUserOnlineDisplay(u._id, u) }) : null;
}

function serializePostDoc(doc, authorMap, viewerId, embedMap) {
  const likes = doc.likes || [];
  const uid = viewerId != null ? String(viewerId) : null;
  const out = {
    _id: doc._id,
    content: doc.content ?? '',
    created_at: doc.created_at,
    author: serializeAuthor(authorMap.get(String(doc.author))),
    like_count: likes.length,
    liked: uid ? likes.some((x) => String(x) === uid) : false,
    repost_of: doc.repost_of || null,
    repost_count: doc.repost_count ?? 0,
  };
  if (doc.repost_of && embedMap) {
    const emb = embedMap.get(String(doc.repost_of));
    out.embedded = emb || null;
  }
  return out;
}

async function buildEmbedMap(docs) {
  const ids = [...new Set(docs.map((d) => d.repost_of).filter(Boolean).map(String))];
  if (ids.length === 0) return new Map();
  const originals = await OfeedPost.find({ _id: { $in: ids } }).lean();
  const authorIds = [...new Set(originals.map((o) => String(o.author)))];
  const users = await User.find({ _id: { $in: authorIds } }).lean();
  const authorMap = new Map(users.map((u) => [String(u._id), u]));
  const map = new Map();
  for (const o of originals) {
    map.set(String(o._id), {
      _id: o._id,
      content: o.content ?? '',
      created_at: o.created_at,
      author: serializeAuthor(authorMap.get(String(o.author))),
      repost_count: o.repost_count ?? 0,
    });
  }
  return map;
}

/** GET /ofeed/posts — global feed, public. */
router.get('/posts', authMiddleware(true), async (req, res) => {
  try {
    const limit = Math.min(100, Math.max(1, parseInt(req.query.limit, 10) || 40));
    const before = req.query.before;
    const q = {};
    if (before && typeof before === 'string') {
      const anchor = await OfeedPost.findById(before).select('created_at').lean();
      if (anchor) q.created_at = { $lt: anchor.created_at };
    }
    const docs = await OfeedPost.find(q).sort({ created_at: -1 }).limit(limit).lean();
    const authorIds = [...new Set(docs.map((d) => String(d.author)))];
    const users = await User.find({ _id: { $in: authorIds } }).lean();
    const authorMap = new Map(users.map((u) => [String(u._id), u]));
    const embedMap = await buildEmbedMap(docs);
    const viewerId = req.userId;
    const posts = docs.map((d) => serializePostDoc(d, authorMap, viewerId, embedMap));
    res.json({ posts });
  } catch (e) {
    res.status(500).json({ type: 'InternalError', error: e.message });
  }
});

/** GET /ofeed/posts/:id — single post (global share / deep link). */
router.get('/posts/:id', authMiddleware(true), async (req, res) => {
  try {
    const doc = await OfeedPost.findById(req.params.id).lean();
    if (!doc) return res.status(404).json({ type: 'NotFound', error: 'Post not found' });
    const authorIds = [String(doc.author)];
    const users = await User.find({ _id: { $in: authorIds } }).lean();
    const authorMap = new Map(users.map((u) => [String(u._id), u]));
    const embedMap = await buildEmbedMap([doc]);
    const viewerId = req.userId;
    const post = serializePostDoc(doc, authorMap, viewerId, embedMap);
    res.json({ post });
  } catch (e) {
    res.status(500).json({ type: 'InternalError', error: e.message });
  }
});

/** POST /ofeed/posts — create or quote-repost */
router.post('/posts', authMiddleware(), async (req, res) => {
  try {
    const repostOf = req.body?.repost_of ? String(req.body.repost_of) : null;
    const content = String(req.body?.content ?? '').trim().slice(0, MAX_LEN);

    if (repostOf) {
      const orig = await OfeedPost.findById(repostOf).lean();
      if (!orig) return res.status(404).json({ type: 'NotFound', error: 'Original post not found' });
      const dup = await OfeedPost.findOne({ author: req.userId, repost_of: repostOf }).lean();
      if (dup) {
        return res.status(409).json({ type: 'AlreadyReposted', error: 'You already reposted this' });
      }
      const id = ulid();
      await OfeedPost.create({
        _id: id,
        author: req.userId,
        content,
        repost_of: repostOf,
        created_at: new Date(),
        likes: [],
      });
      await OfeedPost.updateOne({ _id: repostOf }, { $inc: { repost_count: 1 } });
      const doc = await OfeedPost.findById(id).lean();
      const author = await User.findById(req.userId).lean();
      const authorMap = new Map([[String(author._id), author]]);
      const embedMap = await buildEmbedMap([doc]);
      const post = serializePostDoc(doc, authorMap, req.userId, embedMap);
      return res.status(201).json(post);
    }

    if (!content) {
      return res.status(400).json({ type: 'InvalidBody', error: 'content required' });
    }
    const id = ulid();
    const doc = await OfeedPost.create({
      _id: id,
      author: req.userId,
      content,
      created_at: new Date(),
      likes: [],
    });
    const author = await User.findById(req.userId).lean();
    const authorMap = new Map([[String(author._id), author]]);
    const post = serializePostDoc(doc, authorMap, req.userId, new Map());
    res.status(201).json(post);
  } catch (e) {
    res.status(500).json({ type: 'InternalError', error: e.message });
  }
});

/** POST /ofeed/posts/:id/like — toggle like */
router.post('/posts/:id/like', authMiddleware(), async (req, res) => {
  try {
    const doc = await OfeedPost.findById(req.params.id).lean();
    if (!doc) return res.status(404).json({ type: 'NotFound', error: 'Post not found' });
    const uid = String(req.userId);
    const likes = [...(doc.likes || [])];
    const i = likes.findIndex((x) => String(x) === uid);
    if (i >= 0) likes.splice(i, 1);
    else likes.push(uid);
    await OfeedPost.updateOne({ _id: doc._id }, { $set: { likes } });
    res.json({ like_count: likes.length, liked: i < 0 });
  } catch (e) {
    res.status(500).json({ type: 'InternalError', error: e.message });
  }
});

/** DELETE /ofeed/posts/:id — author only; decrements repost_count on original if repost */
router.delete('/posts/:id', authMiddleware(), async (req, res) => {
  try {
    const doc = await OfeedPost.findById(req.params.id).lean();
    if (!doc) return res.status(404).json({ type: 'NotFound', error: 'Post not found' });
    if (String(doc.author) !== String(req.userId)) {
      return res.status(403).json({ type: 'Forbidden', error: 'Not your post' });
    }
    if (doc.repost_of) {
      await OfeedPost.updateOne({ _id: doc.repost_of }, { $inc: { repost_count: -1 } }).catch(() => {});
      await OfeedPost.updateOne({ _id: doc.repost_of, repost_count: { $lt: 0 } }, { $set: { repost_count: 0 } }).catch(() => {});
    }
    await OfeedPost.deleteOne({ _id: doc._id });
    res.status(204).send();
  } catch (e) {
    res.status(500).json({ type: 'InternalError', error: e.message });
  }
});

export default router;
