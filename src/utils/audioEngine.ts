/**
 * Web Audio engine. Sounds are decoded once; every cue is scheduled on the
 * audio clock, so beeps are sample-accurate regardless of frame rate.
 * The audio clock is also the player's master clock (suspend = pause).
 */
import parBeep from '../assets/audio/par_beep.wav';
import standbyVoice from '../assets/audio/standby.mp3';
import startBeep from '../assets/audio/start_beep.wav';

export type Cue = 'start' | 'par' | 'standby';

const SOURCES: Record<Cue, string> = { start: startBeep, par: parBeep, standby: standbyVoice };

/** Seconds from the start of the standby file until the word has been spoken. */
export const STANDBY_VOICE_LEAD = 0.85;

export class AudioEngine {
  readonly ctx: AudioContext;
  private buffers = new Map<Cue, AudioBuffer>();
  private gain: GainNode;
  private live = new Set<AudioBufferSourceNode>();

  constructor() {
    this.ctx = new AudioContext({ latencyHint: 'interactive' });
    this.gain = this.ctx.createGain();
    this.gain.connect(this.ctx.destination);
  }

  async load() {
    await Promise.all(
      (Object.keys(SOURCES) as Cue[]).map(async (cue) => {
        if (this.buffers.has(cue)) return;
        const data = await fetch(SOURCES[cue]).then((r) => r.arrayBuffer());
        this.buffers.set(cue, await this.ctx.decodeAudioData(data));
      }),
    );
  }

  set volume(v: number) {
    this.gain.gain.value = v;
  }

  get now() {
    return this.ctx.currentTime;
  }

  /** Schedule a cue at an absolute audio-clock time. */
  play(cue: Cue, when: number) {
    const buffer = this.buffers.get(cue);
    if (!buffer) return;
    const src = this.ctx.createBufferSource();
    src.buffer = buffer;
    src.connect(this.gain);
    src.onended = () => this.live.delete(src);
    src.start(Math.max(when, this.ctx.currentTime));
    this.live.add(src);
  }

  stopAll() {
    for (const s of this.live) {
      try {
        s.stop();
      } catch {
        /* already stopped */
      }
    }
    this.live.clear();
  }

  pause() {
    return this.ctx.suspend();
  }

  resume() {
    return this.ctx.resume();
  }

  close() {
    this.stopAll();
    return this.ctx.close();
  }
}
