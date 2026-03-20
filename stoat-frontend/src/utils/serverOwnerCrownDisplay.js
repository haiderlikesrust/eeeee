/**
 * Whether to show the server-owner crown on this member's avatar.
 * Honors `profile.hide_server_owner_crown` on the public user object.
 */
export function showServerOwnerCrownForUser(userObj, serverOwnerId, memberUserId) {
  if (!serverOwnerId || memberUserId == null) return false;
  if (String(memberUserId) !== String(serverOwnerId)) return false;
  const u = typeof userObj === 'object' && userObj ? userObj : null;
  if (u?.profile?.hide_server_owner_crown) return false;
  return true;
}
