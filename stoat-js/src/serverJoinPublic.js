import { ulid } from 'ulid';
import { Channel, Member, User } from './db/models/index.js';
import { toPublicUser } from './publicUser.js';
import { recordServerEvent } from './analytics/service.js';
import { pickDefaultJoinChannelId } from './publicServer.js';

/**
 * @param {string} userId
 * @param {object} server lean
 * @returns {Promise<{ ok: true, channel: object } | { ok: false, status: number, type: string, error: string }>}
 */
export async function joinUserToServerForPublicInvite(userId, server) {
  const { broadcastToServer, isUserOnlineDisplay } = await import('./events.js');
  const serverId = String(server._id);
  if (server.locked) {
    return { ok: false, status: 403, type: 'ServerLocked', error: 'Server is locked; no new members can join' };
  }
  const existing = await Member.findOne({ server: serverId, user: userId }).lean();
  if (existing) {
    return { ok: false, status: 400, type: 'AlreadyInServer', error: 'Already a member' };
  }
  const newMember = await Member.create({
    _id: ulid(),
    server: serverId,
    user: userId,
    roles: [],
  });
  const joinedUser = await User.findById(userId).lean();
  broadcastToServer(serverId, {
    type: 'ServerMemberJoin',
    data: {
      serverId,
      member: {
        ...newMember.toObject(),
        user: toPublicUser(joinedUser, { relationship: 'None', online: isUserOnlineDisplay(userId, joinedUser) }),
      },
    },
  });
  void recordServerEvent({
    userId,
    event: 'invite.accepted',
    props: { server_id: serverId, invite_type: 'Server', via: 'public_slug' },
  });
  const channelId = await pickDefaultJoinChannelId(server);
  if (!channelId) {
    return { ok: false, status: 500, type: 'InternalError', error: 'Server has no channels' };
  }
  const channel = await Channel.findById(channelId).lean();
  if (!channel) {
    return { ok: false, status: 500, type: 'InternalError', error: 'Channel not found' };
  }
  return { ok: true, channel };
}
