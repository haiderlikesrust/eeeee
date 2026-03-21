/** Browser-supported MIME for MediaRecorder (voice). */
export function pickVoiceMimeType() {
  if (typeof MediaRecorder === 'undefined') return '';
  const candidates = [
    'audio/webm;codecs=opus',
    'audio/webm',
    'audio/ogg;codecs=opus',
    'audio/mp4',
  ];
  for (const t of candidates) {
    try {
      if (MediaRecorder.isTypeSupported(t)) return t;
    } catch {
      /* Safari can throw for unsupported type strings */
    }
  }
  return '';
}

export function extensionForVoiceMime(mime) {
  const m = (mime || '').toLowerCase();
  if (m.includes('ogg')) return 'ogg';
  if (m.includes('mp4') || m.includes('aac')) return 'm4a';
  return 'webm';
}

export function isVoiceUploadFilename(name) {
  return typeof name === 'string' && name.startsWith('voice-message.');
}

/** Mark attachment so clients render the voice player (stored in message.attachments). */
export function withVoiceMetadata(attachment, file) {
  if (!attachment || !file) return attachment;
  if (!isVoiceUploadFilename(file.name)) return attachment;
  return {
    ...attachment,
    metadata: { ...(attachment.metadata || {}), voice: true },
  };
}

export function isVoiceAttachment(att) {
  return att?.metadata?.voice === true;
}
