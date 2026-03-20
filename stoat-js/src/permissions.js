/**
 * Discord-style bitfield permission system.
 *
 * Permission calculation:
 * 1. Server owner bypasses everything.
 * 2. Start with @everyone (server.default_permissions).
 * 3. OR in all role permissions the member has.
 * 4. If ADMINISTRATOR is set, grant all permissions.
 * 5. For channels, apply overrides: deny always wins over allow.
 */

export const Permissions = {
  MANAGE_CHANNELS:   1 << 0,
  MANAGE_SERVER:     1 << 1,
  MANAGE_ROLES:      1 << 2,
  KICK_MEMBERS:      1 << 3,
  BAN_MEMBERS:       1 << 4,
  SEND_MESSAGES:     1 << 5,
  MANAGE_MESSAGES:   1 << 6,
  READ_MESSAGES:     1 << 7,
  MANAGE_NICKNAMES:  1 << 8,
  CHANGE_NICKNAME:   1 << 9,
  ADMINISTRATOR:     1 << 10,
  CREATE_INVITES:    1 << 11,
  ATTACH_FILES:      1 << 12,
  ADD_REACTIONS:     1 << 13,
  CONNECT_VOICE:     1 << 14,
  SPEAK_VOICE:       1 << 15,
  MUTE_MEMBERS:      1 << 16,
  DEAFEN_MEMBERS:    1 << 17,
};

export const ALL_PERMISSIONS = Object.values(Permissions).reduce((a, b) => a | b, 0);

/** Compare user/server ids that may be ObjectId vs string. */
export function sameId(a, b) {
  if (a == null && b == null) return true;
  if (a == null || b == null) return false;
  return String(a) === String(b);
}

export const DEFAULT_EVERYONE_PERMS =
  Permissions.SEND_MESSAGES |
  Permissions.READ_MESSAGES |
  Permissions.CHANGE_NICKNAME |
  Permissions.CREATE_INVITES |
  Permissions.ATTACH_FILES |
  Permissions.ADD_REACTIONS |
  Permissions.CONNECT_VOICE |
  Permissions.SPEAK_VOICE;

/**
 * Compute a member's server-level permissions.
 */
export function computeServerPermissions(server, member) {
  if (!server || !member) return 0;
  if (sameId(server.owner, member.user)) return ALL_PERMISSIONS;

  let perms = server.default_permissions ?? DEFAULT_EVERYONE_PERMS;

  const roles = server.roles || {};
  for (const roleId of (member.roles || [])) {
    const role = roles[roleId];
    if (role && typeof role.permissions === 'number') {
      perms |= role.permissions;
    }
  }

  if (perms & Permissions.ADMINISTRATOR) return ALL_PERMISSIONS;
  return perms;
}

/**
 * Compute a member's permissions for a specific channel, including overrides.
 * Channel overrides are stored as: { role_permissions: { roleId: { allow: N, deny: N } } }
 * Also supports default_permissions on the channel (for @everyone override).
 */
export function computeChannelPermissions(server, member, channel) {
  if (!server || !member || !channel) return 0;
  if (sameId(server.owner, member.user)) return ALL_PERMISSIONS;

  let perms = computeServerPermissions(server, member);
  if (perms & Permissions.ADMINISTRATOR) return ALL_PERMISSIONS;

  // Apply @everyone channel override (stored as channel.default_permissions)
  const everyoneOverride = channel.default_permissions;
  if (everyoneOverride && typeof everyoneOverride === 'object') {
    if (everyoneOverride.deny) perms &= ~everyoneOverride.deny;
    if (everyoneOverride.allow) perms |= everyoneOverride.allow;
  }

  // Apply per-role channel overrides
  const roleOverrides = channel.role_permissions;
  if (roleOverrides) {
    const overrideMap = roleOverrides instanceof Map
      ? Object.fromEntries(roleOverrides)
      : (typeof roleOverrides === 'object' ? roleOverrides : {});

    let allow = 0;
    let deny = 0;
    for (const roleId of (member.roles || [])) {
      const override = overrideMap[roleId];
      if (override && typeof override === 'object') {
        allow |= (override.allow || 0);
        deny |= (override.deny || 0);
      }
    }
    // Deny always wins
    perms = (perms & ~deny) | allow;
    perms &= ~deny;
  }

  return perms;
}

/**
 * Check if a member's highest role outranks another member's highest role.
 */
export function outranks(server, actorMember, targetMember) {
  if (sameId(server.owner, actorMember.user)) return true;
  if (sameId(server.owner, targetMember.user)) return false;

  const roles = server.roles || {};
  const getHighestRank = (m) => {
    let max = -Infinity;
    for (const rId of (m.roles || [])) {
      if (roles[rId] && (roles[rId].rank ?? 0) > max) max = roles[rId].rank ?? 0;
    }
    return max;
  };

  return getHighestRank(actorMember) > getHighestRank(targetMember);
}

/**
 * Check if a member can manage a specific role (their highest role must be above it).
 */
export function canManageRole(server, member, roleId) {
  if (sameId(server.owner, member.user)) return true;
  const roles = server.roles || {};
  const targetRole = roles[roleId];
  if (!targetRole) return false;
  const targetRank = targetRole.rank ?? 0;

  let highestRank = -Infinity;
  for (const rId of (member.roles || [])) {
    if (roles[rId] && (roles[rId].rank ?? 0) > highestRank) highestRank = roles[rId].rank ?? 0;
  }

  return highestRank > targetRank;
}

export function hasPermission(perms, perm) {
  return (perms & perm) === perm;
}
