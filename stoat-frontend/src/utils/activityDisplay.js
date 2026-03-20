/**
 * Rich presence (Discord-style) formatting for status.activity from the API.
 */

export function formatActivityPrimary(activity) {
  if (!activity?.type || !activity?.name?.trim()) return null;
  const name = activity.name.trim();
  switch (activity.type) {
    case 'Playing':
      return `Playing ${name}`;
    case 'Listening':
      return `Listening to ${name}`;
    case 'Watching':
      return `Watching ${name}`;
    case 'Streaming':
      return `Streaming ${name}`;
    case 'Competing':
      return `Competing in ${name}`;
    default:
      return name;
  }
}

export function formatActivitySecondary(activity) {
  if (!activity) return null;
  const parts = [activity.details, activity.state].filter((x) => x && String(x).trim());
  return parts.length ? parts.map((x) => String(x).trim()).join(' · ') : null;
}

/** Elapsed clock from `activity.started_at` (ISO): `M:SS` under 1h, then `H:MM:SS`, then days. */
export function formatActivityElapsed(startedAtIso) {
  if (!startedAtIso) return null;
  const t = Date.parse(startedAtIso);
  if (!Number.isFinite(t)) return null;
  const sec = Math.floor((Date.now() - t) / 1000);
  if (sec < 0) return null;
  if (sec < 3600) {
    const m = Math.floor(sec / 60);
    const s = sec % 60;
    return `${m}:${String(s).padStart(2, '0')}`;
  }
  if (sec < 86400) {
    const h = Math.floor(sec / 3600);
    const m = Math.floor((sec % 3600) / 60);
    const s = sec % 60;
    return `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
  }
  const d = Math.floor(sec / 86400);
  const h = Math.floor((sec % 86400) / 3600);
  return h ? `${d}d ${h}h` : `${d}d`;
}

export function resolveActivityImageUrl(image) {
  if (!image) return null;
  if (typeof image === 'string') return image;
  if (typeof image === 'object') {
    if (image.url) return image.url;
    if (image._id) return `/attachments/${image._id}`;
  }
  return null;
}

export function activityTypeLabel(type) {
  switch (type) {
    case 'Playing':
      return 'Playing';
    case 'Listening':
      return 'Listening to';
    case 'Watching':
      return 'Watching';
    case 'Streaming':
      return 'Streaming';
    case 'Competing':
      return 'Competing in';
    default:
      return 'Activity';
  }
}
