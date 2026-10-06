/**
 * Signals for the training programs: start beep, end signal, countdown ticks.
 * Uses the app's own beep files; cues are scheduled on the audio clock so they are
 * sample-accurate. Pausing cancels everything scheduled; resuming schedules again.
 */
import parBeep from '../assets/audio/par_beep.wav';
import startBeep from '../assets/audio/start_beep.wav';
import type { Cue, Sound } from './TrainingSequence';

export class AudioController {
  readonly ctx = new AudioContext({ latencyHint: 'interactive' });
  private gain = this.ctx.createGain();
  private buffers = new Map<Sound, AudioBuffer>();
  private live = new Set<AudioScheduledSourceNode>();
  private _muted = false;

  constructor() {
    this.gain.connect(this.ctx.destination);
  }

  async load() {
    const load = async (sound: Sound, url: string) => {
      if (this.buffers.has(sound)) return;
      const data = await fetch(url).then((r) => r.arrayBuffer());
      this.buffers.set(sound, await this.ctx.decodeAudioData(data));
    };
    await Promise.all([load('start', startBeep), load('end', parBeep)]);
    if (this.ctx.state === 'suspended') await this.ctx.resume();
  }

  get now() {
    return this.ctx.currentTime;
  }

  get muted() {
    return this._muted;
  }

  set muted(m: boolean) {
    this._muted = m;
    this.gain.gain.setTargetAtTime(m ? 0 : 1, this.ctx.currentTime, 0.01);
  }

  /** Schedule the cues of a series: `elapsed` = where the series is now (seconds). */
  schedule(cues: Cue[], elapsed: number) {
    const base = this.ctx.currentTime - elapsed;
    for (const c of cues) if (c.at >= elapsed - 0.005) this.play(c.sound, base + c.at);
  }

  private play(sound: Sound, when: number) {
    let node: AudioScheduledSourceNode;
    if (sound === 'tick') {
      // short, soft click for 3…2…1
      const osc = this.ctx.createOscillator();
      const env = this.ctx.createGain();
      osc.frequency.value = 1150;
      env.gain.setValueAtTime(0, when);
      env.gain.linearRampToValueAtTime(0.25, when + 0.004);
      env.gain.exponentialRampToValueAtTime(0.001, when + 0.09);
      osc.connect(env).connect(this.gain);
      osc.start(when);
      osc.stop(when + 0.1);
      node = osc;
    } else {
      const buffer = this.buffers.get(sound);
      if (!buffer) return;
      const src = this.ctx.createBufferSource();
      src.buffer = buffer;
      src.connect(this.gain);
      src.start(Math.max(when, this.ctx.currentTime));
      node = src;
    }
    this.live.add(node);
    node.onended = () => this.live.delete(node);
  }

  /** Cancel everything that is scheduled or playing. */
  stopAll() {
    for (const n of this.live) {
      try {
        n.stop();
      } catch {
        /* already stopped */
      }
    }
    this.live.clear();
  }

  close() {
    this.stopAll();
    void this.ctx.close();
  }
}
