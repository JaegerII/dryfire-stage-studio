/**
 * Camera access: support / permission checks, device list, start with the
 * requested resolution and frame rate, and an honest report of what the
 * browser actually delivered (getSettings) — the request is only a wish.
 *
 * Nothing leaves the device: the stream is only attached to a local <video>.
 */

export type CameraErrorCode =
  | 'insecure_context'
  | 'unsupported'
  | 'permission_denied'
  | 'not_found'
  | 'in_use'
  | 'constraints'
  | 'unknown';

export class CameraError extends Error {
  constructor(
    readonly code: CameraErrorCode,
    message: string,
  ) {
    super(message);
  }
}

export const CAMERA_ERROR_TEXT: Record<CameraErrorCode, string> = {
  insecure_context: 'Camera needs HTTPS (or localhost). Open the app via the https:// LAN address from `npm run dev:lan`.',
  unsupported: 'This browser has no camera API.',
  permission_denied: 'Camera access was denied. Allow it in the browser / system settings and try again.',
  not_found: 'No camera found.',
  in_use: 'The camera is in use by another app or tab.',
  constraints: 'The camera does not support the requested resolution / frame rate.',
  unknown: 'The camera could not be started.',
};

export type PermissionStateX = PermissionState | 'unknown';

export interface CameraInfo {
  deviceId: string;
  label: string;
  facing?: 'user' | 'environment';
}

export interface CameraRequest {
  deviceId?: string;
  facing?: 'user' | 'environment';
  width: number;
  height: number;
  fps: number;
}

export interface CameraActual {
  deviceId?: string;
  label: string;
  width: number;
  height: number;
  /** Frame rate the browser reports for the track (may be a nominal value). */
  fps?: number;
  facing?: string;
  /** What the device could do, when the browser exposes capabilities. */
  maxFps?: number;
  maxWidth?: number;
  maxHeight?: number;
}

export const cameraSupport = (): CameraErrorCode | null => {
  if (!window.isSecureContext) return 'insecure_context';
  if (!navigator.mediaDevices?.getUserMedia) return 'unsupported';
  return null;
};

/** 'unknown' where the Permissions API cannot query the camera (older Safari, Firefox). */
export const cameraPermission = async (): Promise<PermissionStateX> => {
  try {
    const s = await navigator.permissions.query({ name: 'camera' as PermissionName });
    return s.state;
  } catch {
    return 'unknown';
  }
};

/** Labels are only filled in after permission was granted once. */
export const listCameras = async (): Promise<CameraInfo[]> => {
  if (!navigator.mediaDevices?.enumerateDevices) return [];
  const all = await navigator.mediaDevices.enumerateDevices();
  return all
    .filter((d) => d.kind === 'videoinput')
    .map((d, i) => ({
      deviceId: d.deviceId,
      label: d.label || `Camera ${i + 1}`,
      facing: /back|rear|environment|rück/i.test(d.label) ? 'environment' : /front|user|face/i.test(d.label) ? 'user' : undefined,
    }));
};

const mapError = (e: unknown): CameraError => {
  const name = (e as { name?: string })?.name;
  if (name === 'NotAllowedError' || name === 'SecurityError') return new CameraError('permission_denied', CAMERA_ERROR_TEXT.permission_denied);
  if (name === 'NotFoundError') return new CameraError('not_found', CAMERA_ERROR_TEXT.not_found);
  if (name === 'NotReadableError' || name === 'AbortError') return new CameraError('in_use', CAMERA_ERROR_TEXT.in_use);
  if (name === 'OverconstrainedError') return new CameraError('constraints', CAMERA_ERROR_TEXT.constraints);
  return new CameraError('unknown', `${CAMERA_ERROR_TEXT.unknown} (${name ?? String(e)})`);
};

export const openCamera = async (req: CameraRequest): Promise<{ stream: MediaStream; actual: CameraActual }> => {
  const unsupported = cameraSupport();
  if (unsupported) throw new CameraError(unsupported, CAMERA_ERROR_TEXT[unsupported]);
  // `ideal` everywhere: the browser picks the closest mode instead of failing
  const video: MediaTrackConstraints = {
    width: { ideal: req.width },
    height: { ideal: req.height },
    frameRate: { ideal: req.fps },
    ...(req.deviceId ? { deviceId: { exact: req.deviceId } } : req.facing ? { facingMode: { ideal: req.facing } } : {}),
  };
  let stream: MediaStream;
  try {
    stream = await navigator.mediaDevices.getUserMedia({ video, audio: false });
  } catch (e) {
    // a stored device id may be gone (other phone, unplugged webcam): retry with the default camera
    if (req.deviceId && (e as { name?: string })?.name === 'OverconstrainedError') return openCamera({ ...req, deviceId: undefined });
    throw mapError(e);
  }
  const track = stream.getVideoTracks()[0];
  const s = track.getSettings();
  const caps = (track.getCapabilities?.() ?? {}) as MediaTrackCapabilities;
  return {
    stream,
    actual: {
      deviceId: s.deviceId,
      label: track.label,
      width: s.width ?? 0,
      height: s.height ?? 0,
      fps: s.frameRate,
      facing: s.facingMode,
      maxFps: caps.frameRate?.max,
      maxWidth: caps.width?.max,
      maxHeight: caps.height?.max,
    },
  };
};

export const stopStream = (stream: MediaStream | null | undefined) => stream?.getTracks().forEach((t) => t.stop());
