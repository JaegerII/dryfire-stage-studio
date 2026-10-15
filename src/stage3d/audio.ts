/**
 * Sound of a 3D stage video: the same cues as the classic player (spoken
 * "Stand by", start beep, end beep) on the video timeline. Live preview
 * schedules them on the AudioEngine; the MP4 render mixes them offline.
 */
import parBeep from '../assets/audio/par_beep.wav';
import standbyVoice from '../assets/audio/standby.mp3';
import startBeep from '../assets/audio/start_beep.wav';
import type { Cue } from '../utils/audioEngine';
import type { VideoTimeline } from './timeline';

export interface TimedCue {
  cue: Cue;
  /** Seconds from the video start. */
  t: number;
}

export const videoCues = (tl: VideoTimeline, voice: boolean): TimedCue[] =>
  tl.schedule.reps.flatMap((r) => [
    ...(voice ? [{ cue: 'standby' as Cue, t: tl.flyInEnd + r.standbyStart }] : []),
    { cue: 'start' as Cue, t: tl.flyInEnd + r.startBeep },
    { cue: 'par' as Cue, t: tl.flyInEnd + r.endBeep },
  ]);

const SOURCES: Record<Cue, string> = { start: startBeep, par: parBeep, standby: standbyVoice };

/** The whole soundtrack as one AudioBuffer (offline, faster than real time). */
export const renderSoundtrack = async (cues: TimedCue[], duration: number, sampleRate = 48000, volume = 1): Promise<AudioBuffer> => {
  const ctx = new OfflineAudioContext(2, Math.ceil(duration * sampleRate), sampleRate);
  const buffers = new Map<Cue, AudioBuffer>();
  await Promise.all(
    (Object.keys(SOURCES) as Cue[]).map(async (c) => buffers.set(c, await ctx.decodeAudioData(await (await fetch(SOURCES[c])).arrayBuffer()))),
  );
  const gain = ctx.createGain();
  gain.gain.value = volume;
  gain.connect(ctx.destination);
  for (const c of cues) {
    const src = ctx.createBufferSource();
    src.buffer = buffers.get(c.cue)!;
    src.connect(gain);
    src.start(c.t);
  }
  return ctx.startRendering();
};
