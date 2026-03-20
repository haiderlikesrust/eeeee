import { ulid } from 'ulid';
import { Channel, Message, User } from './db/models/index.js';
import { messageToJson, fetchReplyContext } from './routes/channels.js';
import { broadcastToChannel, GatewayIntents } from './events.js';
import { notifyPushForNewMessage } from './pushNotify.js';
import { fetchLinkPreviewsForContent } from './linkPreview.js';
import { getOfficialClawUserId } from './officialClaw.js';

const AUTHOR_SELECT =
  '_id username discriminator display_name avatar badges system_badges status profile flags privileged bot relations';

/**
 * Post a text message as the official Claw user in any server text channel or thread (no guild membership required).
 */
export async function postOfficialClawChannelMessage(channelId, content) {
  const clawId = getOfficialClawUserId();
  const ch = await Channel.findById(channelId);
  if (!ch) {
    const err = new Error('Channel not found');
    err.code = 'NotFound';
    throw err;
  }
  if (!ch.server) {
    const err = new Error('Only server channels are supported');
    err.code = 'InvalidChannel';
    throw err;
  }
  if (ch.channel_type !== 'TextChannel' && ch.channel_type !== 'Thread') {
    const err = new Error('Channel must be a text channel or thread');
    err.code = 'InvalidChannel';
    throw err;
  }

  const text = String(content ?? '').slice(0, 2000);
  const msgId = ulid();
  const msg = await Message.create({
    _id: msgId,
    channel: ch._id,
    author: clawId,
    content: text,
    attachments: [],
    embeds: [],
    mentions: [],
    replies: [],
  });
  ch.last_message_id = msgId;
  await ch.save();

  const author = await User.findById(clawId).select(AUTHOR_SELECT).lean();
  const authorMap = { [clawId]: author };
  const replyContext = await fetchReplyContext([], authorMap);
  const payload = messageToJson(msg, authorMap, replyContext);

  void broadcastToChannel(ch._id, { type: 'MESSAGE_CREATE', d: payload }, {
    eventIntent: GatewayIntents.GUILD_MESSAGES,
  }).catch(() => {});
  notifyPushForNewMessage(ch, clawId, payload);

  if (text && /https?:\/\//i.test(text)) {
    fetchLinkPreviewsForContent(text, 2)
      .then((linkPreviews) => {
        if (linkPreviews.length > 0) {
          return Message.updateOne({ _id: msgId }, { $set: { link_previews: linkPreviews } });
        }
      })
      .catch(() => {});
  }

  return payload;
}
