"use client";

/**
 * Always-on counter microphone for the Soundbox (works in iPad Safari and desktop Chrome).
 *
 * The page listens continuously and finds sentences on the device (voice activity detection), keeping half a
 * second of audio from before the voice starts so the "Sa" of "Saathi" isn't cut off. Each sentence becomes a
 * 16 kHz mono WAV that the server transcribes with Sarvam; the server decides whether it began with "Saathi".
 * Silence is never uploaded. While the Soundbox itself is speaking the microphone is ignored, so it doesn't
 * hear its own voice.
 */

type Options = {
  onUtterance: (wav: Blob, seconds: number) => void;
  onLevel?: (level: number, speaking: boolean) => void;
};

const TARGET_RATE = 16000;
const FRAME = 2048;
const PRE_ROLL_S = 0.5;
const END_SILENCE_S = 0.8;
const MIN_SPEECH_S = 0.45;
const MAX_UTTERANCE_S = 12;

export class CounterListener {
  readonly ctx: AudioContext;
  private stream: MediaStream | null = null;
  private node: ScriptProcessorNode | null = null;
  private source: MediaStreamAudioSourceNode | null = null;
  private sink: GainNode | null = null;
  private preRoll: Float32Array[] = [];
  private speech: Float32Array[] = [];
  private speaking = false;
  private loudFrames = 0;
  private quietFrames = 0;
  private floor = 0.004;
  private mutedUntil = 0;
  private muted = false;

  constructor(private opts: Options) {
    const Ctor = window.AudioContext ?? (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    this.ctx = new Ctor();
  }

  /** Must run from a tap (browsers allow audio and the microphone only after a user gesture). */
  async start(): Promise<void> {
    if (!navigator.mediaDevices?.getUserMedia) throw new Error("INSECURE");
    await this.ctx.resume();
    this.stream = await navigator.mediaDevices.getUserMedia({
      audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true, channelCount: 1 },
    });
    this.source = this.ctx.createMediaStreamSource(this.stream);
    this.node = this.ctx.createScriptProcessor(FRAME, 1, 1);
    this.sink = this.ctx.createGain();
    this.sink.gain.value = 0; // the processor must reach the output to run (Safari), but silently
    this.node.onaudioprocess = (e) => this.frame(e.inputBuffer.getChannelData(0));
    this.source.connect(this.node);
    this.node.connect(this.sink);
    this.sink.connect(this.ctx.destination);
  }

  stop() {
    this.node?.disconnect();
    this.source?.disconnect();
    this.sink?.disconnect();
    this.stream?.getTracks().forEach((t) => t.stop());
    this.node = this.source = this.sink = null;
    this.stream = null;
    this.reset();
  }

  get running() {
    return this.stream !== null;
  }

  /** Ignore the microphone (e.g. while the Soundbox speaks). `tailMs` keeps ignoring briefly after it ends. */
  mute(on: boolean, tailMs = 350) {
    this.muted = on;
    if (!on) this.mutedUntil = performance.now() + tailMs;
    if (on) this.reset();
  }

  private reset() {
    this.speech = [];
    this.speaking = false;
    this.loudFrames = this.quietFrames = 0;
  }

  private frame(input: Float32Array) {
    const data = new Float32Array(input); // the browser reuses its buffer
    let sum = 0;
    for (let i = 0; i < data.length; i += 1) sum += data[i] * data[i];
    const rms = Math.sqrt(sum / data.length);
    const frameS = data.length / this.ctx.sampleRate;
    if (this.muted || performance.now() < this.mutedUntil) {
      this.opts.onLevel?.(0, false);
      return;
    }
    // Adaptive threshold: follows the shop's background noise, so a fan or traffic doesn't count as speech.
    const threshold = Math.max(0.012, this.floor * 3.2);
    const loud = rms > threshold;
    if (!this.speaking) {
      this.floor = this.floor * 0.97 + Math.min(rms, 0.05) * 0.03;
      this.preRoll.push(data);
      while (this.preRoll.length * frameS > PRE_ROLL_S) this.preRoll.shift();
      this.loudFrames = loud ? this.loudFrames + 1 : 0;
      if (this.loudFrames >= 2) {
        this.speaking = true;
        this.speech = [...this.preRoll];
        this.preRoll = [];
        this.quietFrames = 0;
      }
    } else {
      this.speech.push(data);
      this.quietFrames = loud ? 0 : this.quietFrames + 1;
      const length = this.speech.length * frameS;
      if (this.quietFrames * frameS >= END_SILENCE_S || length >= MAX_UTTERANCE_S) {
        const voiced = length - this.quietFrames * frameS - PRE_ROLL_S;
        const chunks = this.speech;
        this.reset();
        if (voiced >= MIN_SPEECH_S) this.opts.onUtterance(encodeWav(chunks, this.ctx.sampleRate), length);
      }
    }
    this.opts.onLevel?.(Math.min(1, rms / 0.12), this.speaking);
  }
}

function encodeWav(chunks: Float32Array[], rate: number): Blob {
  const total = chunks.reduce((n, c) => n + c.length, 0);
  const merged = new Float32Array(total);
  let offset = 0;
  for (const c of chunks) {
    merged.set(c, offset);
    offset += c.length;
  }
  // Downsample to 16 kHz by averaging (enough for speech-to-text, and 3x smaller to upload).
  const ratio = rate / TARGET_RATE;
  const length = Math.floor(merged.length / ratio);
  const pcm = new Int16Array(length);
  for (let i = 0; i < length; i += 1) {
    const start = Math.floor(i * ratio);
    const end = Math.min(merged.length, Math.floor((i + 1) * ratio));
    let acc = 0;
    for (let j = start; j < end; j += 1) acc += merged[j];
    const v = Math.max(-1, Math.min(1, acc / Math.max(1, end - start)));
    pcm[i] = v < 0 ? v * 0x8000 : v * 0x7fff;
  }
  const buf = new ArrayBuffer(44 + pcm.length * 2);
  const view = new DataView(buf);
  const str = (o: number, s: string) => [...s].forEach((ch, i) => view.setUint8(o + i, ch.charCodeAt(0)));
  str(0, "RIFF");
  view.setUint32(4, 36 + pcm.length * 2, true);
  str(8, "WAVE");
  str(12, "fmt ");
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, 1, true);
  view.setUint32(24, TARGET_RATE, true);
  view.setUint32(28, TARGET_RATE * 2, true);
  view.setUint16(32, 2, true);
  view.setUint16(34, 16, true);
  str(36, "data");
  view.setUint32(40, pcm.length * 2, true);
  new Int16Array(buf, 44).set(pcm);
  return new Blob([buf], { type: "audio/wav" });
}

/** Play base64 MP3 through the page's AudioContext (unlocked by the start tap, so it plays without a new tap). */
export async function playMp3(ctx: AudioContext, b64: string): Promise<void> {
  const bytes = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
  const buffer = await ctx.decodeAudioData(bytes.buffer);
  await new Promise<void>((done) => {
    const src = ctx.createBufferSource();
    src.buffer = buffer;
    src.connect(ctx.destination);
    src.onended = () => done();
    src.start();
  });
}

/** The two-note "ding" a soundbox plays before announcing a payment. */
export async function ding(ctx: AudioContext): Promise<void> {
  const now = ctx.currentTime;
  for (const [i, freq] of [988, 1319].entries()) {
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = "sine";
    osc.frequency.value = freq;
    gain.gain.setValueAtTime(0, now + i * 0.16);
    gain.gain.linearRampToValueAtTime(0.35, now + i * 0.16 + 0.02);
    gain.gain.exponentialRampToValueAtTime(0.001, now + i * 0.16 + 0.45);
    osc.connect(gain).connect(ctx.destination);
    osc.start(now + i * 0.16);
    osc.stop(now + i * 0.16 + 0.5);
  }
  await new Promise((ok) => setTimeout(ok, 650));
}
