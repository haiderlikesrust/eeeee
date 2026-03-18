/**
 * Short sound effects for voice channel join/leave.
 * Uses Web Audio API so no asset files are required.
 */

function playTone(frequency, durationMs, type = 'sine', volume = 0.15) {
  try {
    const ctx = new (window.AudioContext || window.webkitAudioContext)();
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.type = type;
    osc.frequency.setValueAtTime(frequency, ctx.currentTime);
    gain.gain.setValueAtTime(volume, ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + durationMs / 1000);
    osc.start(ctx.currentTime);
    osc.stop(ctx.currentTime + durationMs / 1000);
  } catch {}
}

/** Play when you join a voice channel */
export function playSelfJoin() {
  playTone(523.25, 80, 'sine', 0.12);  // C5
  setTimeout(() => playTone(659.25, 120, 'sine', 0.1), 60);  // E5
}

/** Play when you leave a voice channel */
export function playSelfLeave() {
  playTone(493.88, 100, 'sine', 0.12);  // B4
  setTimeout(() => playTone(392, 140, 'sine', 0.1), 80);  // G4
}

/** Play when someone else joins your voice channel */
export function playOtherJoin() {
  playTone(659.25, 60, 'sine', 0.1);   // E5
  setTimeout(() => playTone(783.99, 90, 'sine', 0.08), 50);  // G5
}

/** Play when someone else leaves the voice channel */
export function playOtherLeave() {
  playTone(392, 70, 'sine', 0.1);      // G4
  setTimeout(() => playTone(329.63, 100, 'sine', 0.08), 55);  // E4
}
