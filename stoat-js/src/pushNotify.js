/**
 * Web Push delivery when VAPID keys are configured (see config.js / .env.example).
 */
import webpush from 'web-push';
import config from '../config.js';
import { Member, PushSubscription } from './db/models/index.js';

let vapidConfigured = false;

function ensureVapid() {
  if (vapidConfigured) return true;
  const { vapidPublicKey, vapidPrivateKey, vapidSubject } = config;
  if (!vapidPublicKey || !vapidPrivateKey || !vapidSubject) return false;
  webpush.setVapidDetails(vapidSubject, vapidPublicKey, vapidPrivateKey);
  vapidConfigured = true;
  return true;
}

async function recipientUserIdsForChannel(channel) {
  if (!channel) return [];
  if (channel.server) {
    const members = await Member.find({ server: channel.server }).select('user').lean();
    return members.map((m) => m.user);
  }
  if (channel.channel_type === 'SavedMessages' && channel.user) return [channel.user];
  if (channel.channel_type === 'DirectMessage' || channel.channel_type === 'Group') {
    return channel.recipients || [];
  }
  return [];
}

/**
 * Notify subscribers (except author) of a new message. Fire-and-forget; logs errors only in dev.
 */
export function notifyPushForNewMessage(ch, authorId, payload) {
  if (!ensureVapid()) return;
  if (!ch || !ch._id) return;
  void (async () => {
    try {
      const recipients = (await recipientUserIdsForChannel(ch)).filter(
        (id) => String(id) !== String(authorId),
      );
      if (recipients.length === 0) return;

      const author = typeof payload?.author === 'object' ? payload.author : null;
      const authorName = author?.display_name || author?.username || 'Someone';
      const hasVoice = Array.isArray(payload?.attachments)
        && payload.attachments.some((a) => a?.metadata?.voice === true);
      const preview = (payload?.content || '').slice(0, 120)
        || (hasVoice ? 'Voice message' : '(attachment)');
      const title = authorName;
      const body = preview;
      const data = JSON.stringify({
        type: 'MESSAGE_CREATE',
        channel: String(ch._id),
        message_id: payload?._id,
      });

      for (const uid of recipients) {
        const subs = await PushSubscription.find({ user_id: String(uid) }).lean();
        for (const sub of subs) {
          if (!sub.endpoint) continue;
          const pushSub = {
            endpoint: sub.endpoint,
            keys: {
              p256dh: sub.p256dh || undefined,
              auth: sub.auth || undefined,
            },
          };
          try {
            await webpush.sendNotification(
              pushSub,
              JSON.stringify({ title, body, data }),
              { TTL: 60 },
            );
          } catch (err) {
            const code = err.statusCode;
            if (code === 410 || code === 404) {
              await PushSubscription.deleteOne({ _id: sub._id }).catch(() => {});
            } else if (process.env.NODE_ENV !== 'production') {
              console.warn('[push]', err.message);
            }
          }
        }
      }
    } catch (e) {
      if (process.env.NODE_ENV !== 'production') console.warn('[push]', e.message);
    }
  })();
}
