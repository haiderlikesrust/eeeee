/**
 * Resolves a file object (avatar, icon, banner) to a displayable URL.
 * Handles: string URLs, objects with .url, objects with ._id, null/undefined.
 */
export function resolveFileUrl(file) {
  if (!file) return null;
  if (typeof file === 'string') return file;
  if (file.url) return file.url;
  if (file._id) return `/attachments/${file._id}`;
  return null;
}
