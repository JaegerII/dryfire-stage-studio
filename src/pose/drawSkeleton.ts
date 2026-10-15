/**
 * Skeleton overlay on a canvas that covers the camera preview. Points below
 * the visibility threshold are drawn hollow and dimmed, so occlusion is
 * visible at a glance instead of being hidden.
 */
import { BODY_GROUPS, type PoseFrame, SKELETON } from './landmarks';
import type { QualityLevel } from './quality';

const COLORS: Record<QualityLevel, string> = { good: '#2bd96b', partial: '#f5b700', poor: '#ff3131', none: '#ff3131' };
const KEY_POINTS: number[] = Object.values(BODY_GROUPS).flat();

export const drawSkeleton = (canvas: HTMLCanvasElement, frame: PoseFrame | null, level: QualityLevel, mirror: boolean, visible = 0.6) => {
  const ctx = canvas.getContext('2d');
  if (!ctx) return;
  const { width: W, height: H } = canvas;
  ctx.clearRect(0, 0, W, H);
  const pts = frame?.points;
  if (!pts) return;
  const X = (x: number) => (mirror ? 1 - x : x) * W;
  const color = COLORS[level];
  const lw = Math.max(2, W / 320);
  ctx.lineCap = 'round';
  for (const [a, b] of SKELETON) {
    const pa = pts[a];
    const pb = pts[b];
    const ok = pa.visibility >= visible && pb.visibility >= visible;
    ctx.strokeStyle = ok ? color : 'rgba(237,237,230,0.25)';
    ctx.lineWidth = ok ? lw : lw * 0.6;
    ctx.setLineDash(ok ? [] : [lw * 2, lw * 2]);
    ctx.beginPath();
    ctx.moveTo(X(pa.x), pa.y * H);
    ctx.lineTo(X(pb.x), pb.y * H);
    ctx.stroke();
  }
  ctx.setLineDash([]);
  for (const i of KEY_POINTS) {
    const p = pts[i];
    const r = lw * 1.8;
    ctx.beginPath();
    ctx.arc(X(p.x), p.y * H, r, 0, Math.PI * 2);
    if (p.visibility >= visible) {
      ctx.fillStyle = '#edede6';
      ctx.fill();
    } else {
      ctx.strokeStyle = 'rgba(255,49,49,0.8)';
      ctx.lineWidth = lw * 0.6;
      ctx.stroke();
    }
  }
};
