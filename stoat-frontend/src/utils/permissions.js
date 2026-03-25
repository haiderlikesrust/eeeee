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
  SEND_VOICE_MESSAGE: 1 << 18,
};

export const ALL_PERMISSIONS = Object.values(Permissions).reduce((a, b) => a | b, 0);

export const DEFAULT_EVERYONE_PERMS =
  Permissions.SEND_MESSAGES |
  Permissions.READ_MESSAGES |
  Permissions.CHANGE_NICKNAME |
  Permissions.CREATE_INVITES |
  Permissions.ATTACH_FILES |
  Permissions.ADD_REACTIONS |
  Permissions.CONNECT_VOICE |
  Permissions.SPEAK_VOICE |
  Permissions.SEND_VOICE_MESSAGE;

export const PERMISSION_INFO = [
  { key: 'ADMINISTRATOR', label: 'Administrator', description: 'Full access to everything. Overrides all other permissions and channel overrides.', dangerous: true },
  { key: 'MANAGE_SERVER', label: 'Manage Server', description: 'Edit server name, icon, and settings.' },
  { key: 'MANAGE_CHANNELS', label: 'Manage Channels', description: 'Create, edit, and delete channels.' },
  { key: 'MANAGE_ROLES', label: 'Manage Roles', description: 'Create, edit, and delete roles below this role.' },
  { key: 'KICK_MEMBERS', label: 'Kick Members', description: 'Remove members from the server.' },
  { key: 'BAN_MEMBERS', label: 'Ban Members', description: 'Permanently ban members from the server.' },
  { key: 'MANAGE_MESSAGES', label: 'Manage Messages', description: 'Delete and pin messages from other members.' },
  { key: 'MANAGE_NICKNAMES', label: 'Manage Nicknames', description: 'Change nicknames of other members.' },
  { key: 'SEND_MESSAGES', label: 'Send Messages', description: 'Send messages in text channels.' },
  { key: 'READ_MESSAGES', label: 'Read Messages', description: 'View messages in text channels.' },
  { key: 'ATTACH_FILES', label: 'Attach Files', description: 'Upload images and files.' },
  { key: 'SEND_VOICE_MESSAGE', label: 'Send Voice Messages', description: 'Record and send voice messages in text channels.' },
  { key: 'ADD_REACTIONS', label: 'Add Reactions', description: 'React to messages.' },
  { key: 'CREATE_INVITES', label: 'Create Invites', description: 'Create invite links to the server.' },
  { key: 'CHANGE_NICKNAME', label: 'Change Nickname', description: 'Change own nickname.' },
  { key: 'CONNECT_VOICE', label: 'Connect to Voice', description: 'Join voice channels.' },
  { key: 'SPEAK_VOICE', label: 'Speak in Voice', description: 'Talk in voice channels.' },
  { key: 'MUTE_MEMBERS', label: 'Mute Members', description: 'Server-mute other members in voice.' },
  { key: 'DEAFEN_MEMBERS', label: 'Deafen Members', description: 'Server-deafen other members in voice.' },
];

export const CHANNEL_PERMISSION_INFO = PERMISSION_INFO.filter(p =>
  ['SEND_MESSAGES', 'READ_MESSAGES', 'ATTACH_FILES', 'SEND_VOICE_MESSAGE', 'ADD_REACTIONS',
   'MANAGE_MESSAGES', 'CONNECT_VOICE', 'SPEAK_VOICE', 'CREATE_INVITES'].includes(p.key)
);

export function hasPermission(perms, perm) {
  return (perms & perm) === perm;
}

/**
 * Server-wide check: Administrator grants every permission (matches backend computeServerPermissions).
 */
export function hasServerPermission(perms, perm) {
  const p = Number(perms) || 0;
  if ((p & Permissions.ADMINISTRATOR) === Permissions.ADMINISTRATOR) return true;
  return hasPermission(p, perm);
}

/**
 * For editing a role or @everyone bitfield: Administrator implies every permission in the UI
 * (matches backend computeServerPermissions).
 */
export function hasEffectiveRolePermission(bitfield, perm) {
  const v = Number(bitfield) || 0;
  if ((v & Permissions.ADMINISTRATOR) === Permissions.ADMINISTRATOR) return true;
  return hasPermission(v, perm);
}

/**
 * Toggle one permission in a role bitfield. If Administrator is set, turning off any other
 * permission clears Administrator and that bit (Discord-style).
 */
function coerceConsistentServerPermissions(raw) {
  let p = Number(raw) || 0;
  if ((p & Permissions.SEND_MESSAGES) === Permissions.SEND_MESSAGES) {
    p |= Permissions.READ_MESSAGES;
  }
  if ((p & Permissions.READ_MESSAGES) === 0) {
    p &= ~Permissions.SEND_MESSAGES;
  }
  return p >>> 0;
}

export { coerceConsistentServerPermissions };

export function toggleRolePermissionBitmask(value, permKey, bit) {
  const v = Number(value) || 0;
  let next;
  if (permKey === 'ADMINISTRATOR') {
    next = (v & bit) === bit ? v & ~bit : v | bit;
  } else if ((v & Permissions.ADMINISTRATOR) === Permissions.ADMINISTRATOR) {
    next = (v & ~Permissions.ADMINISTRATOR) & ~bit;
  } else {
    next = (v & bit) === bit ? v & ~bit : v | bit;
  }
  // Send Messages requires Read Messages (turning Read off also clears Send)
  if (permKey === 'READ_MESSAGES' && (next & Permissions.READ_MESSAGES) === 0) {
    next &= ~Permissions.SEND_MESSAGES;
  }
  if ((next & Permissions.SEND_MESSAGES) === Permissions.SEND_MESSAGES) {
    next |= Permissions.READ_MESSAGES;
  }
  return next >>> 0;
}

export function computeServerPermissions(server, member) {
  if (!server || !member) return 0;
  const userId = typeof member.user === 'object' && member.user != null ? member.user._id : member.user;
  if (String(server.owner) === String(userId)) return ALL_PERMISSIONS;

  let perms = coerceConsistentServerPermissions(server.default_permissions ?? DEFAULT_EVERYONE_PERMS);
  const roles = server.roles || {};
  for (const roleId of (member.roles || [])) {
    const role = roles[roleId];
    if (role && typeof role.permissions === 'number') {
      perms |= coerceConsistentServerPermissions(role.permissions);
    }
  }
  if (perms & Permissions.ADMINISTRATOR) return ALL_PERMISSIONS;
  return perms;
}

export function computeChannelPermissions(server, member, channel) {
  if (!server || !member || !channel) return 0;
  const userId = typeof member.user === 'object' && member.user != null ? member.user._id : member.user;
  if (String(server.owner) === String(userId)) return ALL_PERMISSIONS;

  let perms = computeServerPermissions(server, member);
  if (perms & Permissions.ADMINISTRATOR) return ALL_PERMISSIONS;

  const everyoneOverride = channel.default_permissions;
  if (everyoneOverride && typeof everyoneOverride === 'object') {
    if (everyoneOverride.deny) perms &= ~everyoneOverride.deny;
    if (everyoneOverride.allow) perms |= everyoneOverride.allow;
  }

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
    perms = (perms & ~deny) | allow;
    perms &= ~deny;
  }

  return perms;
}
