/**
 * Remote control for the batch render (scripts/render-videos.mjs, `npm run render`): the
 * script opens the app at #/render in a headless Chrome and drives it through
 * `window.__dryfire`. Every video is the same frame-by-frame render as the player's
 * "Render MP4" button (same program, same seed → same reps); the file is streamed to the
 * script while it renders, so length and resolution do not matter.
 */
import { matchRepository } from '../data/matchRepository';
import { STANDBY_VOICE_LEAD } from '../utils/audioEngine';
import { readImportFile, saveImportedMatch } from '../utils/matchIO';
import { matchStages } from '../utils/matchUtils';
import { renderMp4 } from './exportVideo';
import { buildProgram } from './program';
import { stage3dRepository } from './repository';

export interface RenderJob {
  kind: 'stage' | 'match';
  id: string;
  width: number;
  height: number;
  fps: number;
  voice: boolean;
  showTimer: boolean;
  /** Key of the file the script opened for this video. */
  file: string;
}

declare global {
  interface Window {
    __dryfire?: typeof api;
    /** Provided by the script: progress of the running video. */
    __renderProgress?: (done: number, total: number) => void;
  }
}

/** Sends the MP4 to the script in chunks, each at its byte position. */
const fileStream = (file: string) =>
  new WritableStream<{ type: 'write'; data: Uint8Array; position: number }>({
    async write(chunk) {
      const r = await fetch(`/__render/write?file=${encodeURIComponent(file)}&pos=${chunk.position}`, { method: 'POST', body: chunk.data as BodyInit });
      if (!r.ok) throw new Error(`writing the video failed (${r.status})`);
    },
  });

const api = {
  list: () => ({
    stages: stage3dRepository.list().map((s) => ({ id: s.id, name: s.name })),
    matches: matchRepository.list().map((m) => ({ id: m.id, name: m.name, stages: m.stageIds.length, archived: !!m.archived })),
  }),

  /** A stage file or a match bundle (as exported from the studio): available by its id afterwards. */
  importJson: async (text: string, name: string) => {
    const r = await readImportFile(new File([text], name, { type: 'application/json' }));
    if (r.kind === 'stage') {
      stage3dRepository.save(r.stage);
      return { kind: 'stage' as const, id: r.stage.id, name: r.stage.name };
    }
    saveImportedMatch(r.match, r.stages);
    return { kind: 'match' as const, id: r.match.id, name: r.match.name };
  },

  render: async (job: RenderJob) => {
    const match = job.kind === 'match' ? matchRepository.get(job.id) : undefined;
    const stages = match ? matchStages(match) : [stage3dRepository.get(job.id)].filter((s) => !!s);
    if (!stages.length) throw new Error(`${job.kind} "${job.id}" not found (or it has no stages)`);
    // exactly what the player builds for this stage / match
    const program = buildProgram(stages, {
      seed: stages.map((s) => s.id).join('+'),
      voiceLead: job.voice ? STANDBY_VOICE_LEAD : 0,
      ...(match ? { matchName: match.name, settings: { ...match.settings, intro: match.settings?.intro ?? true } } : {}),
    });
    const r = await renderMp4(program, {
      width: job.width,
      height: job.height,
      fps: job.fps,
      voice: job.voice,
      showTimer: job.showTimer,
      stream: fileStream(job.file),
      onProgress: (done, total) => window.__renderProgress?.(done, total),
    });
    return { codec: r.codec, audio: r.audio, seconds: program.end };
  },
};

export const installBatchRender = async () => {
  // the canvas text of the HUD and the screens
  await Promise.all([500, 600, 700, 800, 900].map((w) => document.fonts.load(`${w} 40px Montserrat`)));
  window.__dryfire = api;
  document.body.textContent = 'FORTH TRACE · batch render (npm run render)';
};
