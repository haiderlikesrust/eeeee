export const OPIC_STAFF_BADGE_ID = 'opic_staff';

export function userHasOpicStaff(userOrMemberUser) {
  const u = userOrMemberUser;
  const list = Array.isArray(u?.system_badges) ? u.system_badges : [];
  return list.includes(OPIC_STAFF_BADGE_ID);
}
