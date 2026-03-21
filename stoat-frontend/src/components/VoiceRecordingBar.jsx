import './VoiceMessages.css';

export default function VoiceRecordingBar({ seconds, onCancel, onSend }) {
  const mm = String(Math.floor(seconds / 60)).padStart(2, '0');
  const ss = String(seconds % 60).padStart(2, '0');

  return (
    <div className="voice-recording-bar" role="status" aria-live="polite">
      <span className="voice-rec-dot" aria-hidden />
      <span className="voice-rec-time">{mm}:{ss}</span>
      <span className="voice-rec-label">Recording voice message</span>
      <button type="button" className="voice-rec-cancel" onClick={onCancel}>
        Cancel
      </button>
      <button type="button" className="voice-rec-send" onClick={onSend}>
        Send
      </button>
    </div>
  );
}
