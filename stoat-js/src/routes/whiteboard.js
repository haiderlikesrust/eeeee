import { Router } from 'express';
import { ulid } from 'ulid';
import { Message, Member, WhiteboardSession, Channel, User } from '../db/models/index.js';
import { authMiddleware } from '../middleware/auth.js';
import { broadcastToChannel, GatewayIntents } from '../events.js';
import { getOfficialClawUserId } from '../officialClaw.js';
import { deleteRoom } from '../whiteboardRooms.js';
import { notifyPushForNewMessage } from '../pushNotify.js';
import { messageToJson } from './channels.js';

const router = Router();

router.post('/:sessionId/close', authMiddleware(), async (req, res) => {
  try {
    const sessionId = req.params.sessionId;
    const session = await WhiteboardSession.findById(sessionId);
    if (!session || session.status !== 'open') {
      return res.status(404).json({ type: 'NotFound', error: 'Whiteboard session not found or already closed' });
    }
    if (String(session.owner) !== String(req.userId)) {
      return res.status(403).json({ type: 'Forbidden', error: 'Only the session owner can close the whiteboard' });
    }
    const member = await Member.findOne({ server: session.server, user: req.userId }).lean();
    if (!member) {
      return res.status(403).json({ type: 'Forbidden', error: 'Not a member of this server' });
    }
    const body = req.body || {};
    const att = body.attachment
      || (Array.isArray(body.attachments) && body.attachments[0]);
    if (!att || typeof att !== 'object') {
      return res.status(400).json({ type: 'InvalidPayload', error: 'attachment required (upload via POST /attachments first)' });
    }

    session.status = 'closed';
    session.closed_at = new Date();
    await session.save();
    deleteRoom(sessionId);

    const clawId = getOfficialClawUserId();
    const clawUser = await User.findById(clawId)
      .select('_id username discriminator display_name avatar badges system_badges status profile flags privileged bot relations')
      .lean();

    const channelLean = await Channel.findById(session.channel).lean();
    const ownerUser = await User.findById(session.owner).select('display_name username').lean();
    const ownerName = ownerUser?.display_name || ownerUser?.username || 'Someone';

    const inviteMsgId = session.invite_message_id;
    if (inviteMsgId) {
      const inviteDoc = await Message.findById(inviteMsgId);
      if (inviteDoc) {
        const embeds = (inviteDoc.embeds || []).map((e) => {
          if (e?.type === 'whiteboard_invite' && String(e.session_id) === String(sessionId)) {
            return { ...e, session_status: 'closed' };
          }
          return e;
        });
        inviteDoc.content = `**Whiteboard session ended.** Started by **${ownerName}**.`;
        inviteDoc.embeds = embeds;
        await inviteDoc.save();
        const invitePlain = typeof inviteDoc.toObject === 'function' ? inviteDoc.toObject() : inviteDoc;
        const invitePayload = messageToJson(invitePlain, { [clawId]: clawUser }, null);
        void broadcastToChannel(session.channel, { type: 'MESSAGE_UPDATE', d: invitePayload }, {
          eventIntent: GatewayIntents.GUILD_MESSAGES,
        }).catch(() => {});
      }
    }

    const clawMsgId = ulid();
    const clawMsg = await Message.create({
      _id: clawMsgId,
      channel: session.channel,
      author: clawId,
      content: `**${ownerName}**'s whiteboard — snapshot below.`,
      attachments: [att],
      embeds: [],
      mentions: [],
      replies: [],
    });
    const clawPlain = typeof clawMsg.toObject === 'function' ? clawMsg.toObject() : clawMsg;
    if (channelLean) {
      await Channel.updateOne({ _id: session.channel }, { $set: { last_message_id: clawMsgId } });
    }

    void broadcastToChannel(session.channel, {
      type: 'WhiteboardSessionClosed',
      d: { session_id: sessionId, channel_id: session.channel },
    }).catch(() => {});

    const clawPayload = messageToJson(clawPlain, { [clawId]: clawUser }, null);
    void broadcastToChannel(session.channel, { type: 'MESSAGE_CREATE', d: clawPayload }, {
      eventIntent: GatewayIntents.GUILD_MESSAGES,
    }).catch(() => {});
    if (channelLean) notifyPushForNewMessage(channelLean, clawId, clawPayload);

    return res.status(200).json({ ok: true, message: clawPayload });
  } catch (err) {
    const msg = err?.message || 'Close failed';
    return res.status(500).json({ type: 'InternalError', error: msg });
  }
});

export default router;
