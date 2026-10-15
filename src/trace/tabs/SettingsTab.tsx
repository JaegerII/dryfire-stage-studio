import { useEffect, useState } from 'react';
import { trainingLog } from '../../analytics/trainingLog';
import { type CameraInfo, type PermissionStateX, cameraPermission, listCameras } from '../../capture/camera';
import { cameraRecordingSupported } from '../../capture/videoRecorder';
import { DEFAULT_SETTINGS, type TraceSettings } from '../settings';
import { useTrace } from '../useTrace';

export const SettingsTab = () => {
  const c = useTrace();
  const s = c.settings;
  const [cams, setCams] = useState<CameraInfo[]>([]);
  const [perm, setPerm] = useState<PermissionStateX>('unknown');
  const live = c.pipeline.snap.camera === 'live';

  useEffect(() => {
    void listCameras().then(setCams);
    void cameraPermission().then(setPerm);
  }, [live]);

  const set = (p: Partial<TraceSettings>) => c.updateSettings(p);
  const cameraChanged = (p: Partial<TraceSettings>) => {
    set(p);
    if (live) void c.startCamera(); // apply right away
  };

  return (
    <div className="trace-stack">
      <section className="tcard">
        <h3>Camera</h3>
        <div className="kv"><span>Permission</span><b className={perm === 'granted' ? 'ok' : perm === 'denied' ? 'bad' : ''}>{perm}</b></div>
        <label className="field">
          Camera
          <select value={s.cameraId ?? ''} onChange={(e) => cameraChanged({ cameraId: e.target.value || undefined })}>
            <option value="">Automatic ({s.facing === 'environment' ? 'rear' : 'front'})</option>
            {cams.map((cam) => (
              <option key={cam.deviceId} value={cam.deviceId}>{cam.label}</option>
            ))}
          </select>
        </label>
        {!cams.some((x) => x.label && !x.label.startsWith('Camera ')) && <p className="hint">Camera names appear after camera access was allowed once.</p>}
        <label className="field">
          Side (automatic)
          <select value={s.facing} onChange={(e) => cameraChanged({ facing: e.target.value as TraceSettings['facing'] })}>
            <option value="environment">Rear camera (recommended — better sensor)</option>
            <option value="user">Front camera</option>
          </select>
        </label>
        <label className="field">
          Resolution
          <select value={s.resolution} onChange={(e) => cameraChanged({ resolution: e.target.value as TraceSettings['resolution'] })}>
            <option value="480p">640 × 480 (fastest)</option>
            <option value="720p">1280 × 720 (recommended)</option>
            <option value="1080p">1920 × 1080</option>
          </select>
        </label>
        <label className="field">
          Frame rate
          <select value={s.fps} onChange={(e) => cameraChanged({ fps: Number(e.target.value) as TraceSettings['fps'] })}>
            <option value={30}>30 fps</option>
            <option value={60}>60 fps (if the camera supports it)</option>
          </select>
        </label>
        {c.pipeline.snap.actual && (
          <p className="hint">
            Delivered: {c.pipeline.snap.actual.width}×{c.pipeline.snap.actual.height}
            {c.pipeline.snap.actual.fps ? ` @ ${Math.round(c.pipeline.snap.actual.fps)} fps` : ''}
            {c.pipeline.snap.actual.maxFps ? ` · device max ${Math.round(c.pipeline.snap.actual.maxFps)} fps` : ''}
          </p>
        )}
        <label className="check"><input type="checkbox" checked={s.mirrorPreview} onChange={(e) => set({ mirrorPreview: e.target.checked })} /> Mirror preview</label>
        <label className="check"><input type="checkbox" checked={s.showSkeleton} onChange={(e) => set({ showSkeleton: e.target.checked })} /> Show skeleton</label>
        <label className="check">
          <input type="checkbox" checked={s.recordVideo} disabled={!cameraRecordingSupported()} onChange={(e) => set({ recordVideo: e.target.checked })} /> Record video of each run (kept on this device, download only)
        </label>
      </section>

      <section className="tcard">
        <h3>Tracking</h3>
        <label className="field">
          Pose model
          <select value={s.model} onChange={(e) => cameraChanged({ model: e.target.value as TraceSettings['model'] })}>
            <option value="lite">Lite (fast — phones)</option>
            <option value="full">Full (more accurate, slower)</option>
          </select>
        </label>
        <label className="field">
          Processor
          <select value={s.delegate} onChange={(e) => cameraChanged({ delegate: e.target.value as TraceSettings['delegate'] })}>
            <option value="GPU">GPU (falls back to CPU)</option>
            <option value="CPU">CPU</option>
          </select>
        </label>
        <label className="field">
          Sensitivity <b>{s.sensitivity.toFixed(2)}</b>
          <input type="range" min={0.5} max={2} step={0.05} value={s.sensitivity} onChange={(e) => set({ sensitivity: Number(e.target.value) })} />
        </label>
        <label className="field">
          Still time for “stabilised” <b>{s.stableHoldMs} ms</b>
          <input type="range" min={100} max={600} step={50} value={s.stableHoldMs} onChange={(e) => set({ stableHoldMs: Number(e.target.value) })} />
        </label>
        <label className="check"><input type="checkbox" checked={s.requireTwoHands} onChange={(e) => set({ requireTwoHands: e.target.checked })} /> Presentation requires both hands together</label>
        <label className="check"><input type="checkbox" checked={s.voice} onChange={(e) => set({ voice: e.target.checked })} /> Spoken “Stand by”</label>
        <label className="check"><input type="checkbox" checked={s.showTimerOnTv} onChange={(e) => set({ showTimerOnTv: e.target.checked })} /> Running timer on the TV</label>
        <p className="hint">Movement thresholds never go below 3× the jitter measured during calibration — higher sensitivity cannot make noise count as movement.</p>
      </section>

      <section className="tcard">
        <h3>Privacy & storage</h3>
        <p className="muted small">
          Camera images are processed only on this device. The pose model runs in the browser; no image, video or body data is uploaded. Training results
          and settings are stored in this browser only. A TV connection exchanges stage data, timing and result summaries — never images.
        </p>
        <div className="inline wrap">
          <button
            className="danger"
            onClick={() => {
              if (confirm('Delete all training sessions stored in this browser?')) {
                trainingLog.clear();
                c.bump();
              }
            }}
          >
            Delete training data
          </button>
          <button onClick={() => set({ calibration: undefined })}>Delete calibration</button>
          <button onClick={() => confirm('Reset all tracking settings?') && c.updateSettings({ ...DEFAULT_SETTINGS })}>Reset settings</button>
        </div>
      </section>
    </div>
  );
};
