/**
 * Procedural thunder crackle (Web Audio, no sound files): a sharp burst of
 * sparse impulses for the crack, then a short low rumble.
 */
let ctx: AudioContext | null = null;
let crackBuf: AudioBuffer | null = null;
let rumbleBuf: AudioBuffer | null = null;
let lastPlayed = 0;

const MIN_GAP_MS = 1400;

/** Call from a user gesture (e.g. turning Thunder on) so playback is allowed. */
export function primeAudio(): void {
  try {
    ctx ??= new AudioContext();
    if (ctx.state === 'suspended') void ctx.resume();
    crackBuf ??= makeCrack(ctx);
    rumbleBuf ??= makeNoise(ctx, 1.2);
  } catch {
    ctx = null;
  }
}

export function playCrackle(): void {
  if (!ctx || !crackBuf || !rumbleBuf || ctx.state !== 'running') return;
  const nowMs = performance.now();
  if (nowMs - lastPlayed < MIN_GAP_MS) return;
  lastPlayed = nowMs;

  const t = ctx.currentTime;
  const master = ctx.createGain();
  master.gain.value = 0.35;
  master.connect(ctx.destination);

  const crack = ctx.createBufferSource();
  crack.buffer = crackBuf;
  crack.playbackRate.value = 0.85 + Math.random() * 0.3;
  const hp = ctx.createBiquadFilter();
  hp.type = 'highpass';
  hp.frequency.value = 900;
  const crackGain = ctx.createGain();
  crackGain.gain.setValueAtTime(0.9, t);
  crackGain.gain.exponentialRampToValueAtTime(0.001, t + 0.35);
  crack.connect(hp).connect(crackGain).connect(master);
  crack.start(t);

  const rumble = ctx.createBufferSource();
  rumble.buffer = rumbleBuf;
  const lp = ctx.createBiquadFilter();
  lp.type = 'lowpass';
  lp.frequency.value = 160;
  const rumbleGain = ctx.createGain();
  rumbleGain.gain.setValueAtTime(0.0001, t);
  rumbleGain.gain.exponentialRampToValueAtTime(1.2, t + 0.04);
  rumbleGain.gain.exponentialRampToValueAtTime(0.001, t + 1.1);
  rumble.connect(lp).connect(rumbleGain).connect(master);
  rumble.start(t);
  rumble.stop(t + 1.2);
}

function makeNoise(ac: AudioContext, seconds: number): AudioBuffer {
  const buf = ac.createBuffer(1, Math.floor(ac.sampleRate * seconds), ac.sampleRate);
  const d = buf.getChannelData(0);
  for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
  return buf;
}

function makeCrack(ac: AudioContext): AudioBuffer {
  const seconds = 0.4;
  const buf = ac.createBuffer(1, Math.floor(ac.sampleRate * seconds), ac.sampleRate);
  const d = buf.getChannelData(0);
  for (let i = 0; i < d.length; i++) {
    const env = 1 - i / d.length;
    // Sparse, loud impulses over a low noise bed read as "crackle".
    d[i] = Math.random() < 0.03 * env ? (Math.random() * 2 - 1) * env : (Math.random() * 2 - 1) * 0.08 * env;
  }
  return buf;
}
