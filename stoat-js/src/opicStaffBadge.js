import { GlobalBadge } from './db/models/index.js';

/** Reserved catalog id — do not reuse for custom badges. */
export const OPIC_STAFF_BADGE_ID = 'opic_staff';

export async function ensureOpicStaffBadge() {
  const existing = await GlobalBadge.findById(OPIC_STAFF_BADGE_ID).lean();
  if (existing) return existing;
  const created = await GlobalBadge.create({
    _id: OPIC_STAFF_BADGE_ID,
    label: 'Opic Staff',
    description: 'Platform team member. Assign from Admin → Staff.',
    icon: null,
    active: true,
  });
  return created;
}
