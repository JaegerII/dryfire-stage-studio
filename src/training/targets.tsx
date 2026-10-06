/**
 * Training targets. A design is just an SVG renderer with its aspect ratio — swap or add
 * designs here; the training logic only refers to a design id (TrainingProgram.design).
 *
 * The built-in design is a neutral, original geometric target (nested rounded rectangles
 * with a central aiming area). It is NOT a copy of any association's official target.
 */
import type { ReactNode } from 'react';

export interface TargetDesign {
  id: string;
  name: string;
  /** width / height */
  aspect: number;
  /** SVG content for viewBox "0 0 1000 1000/aspect". */
  render: () => ReactNode;
}

const W = 1000;

const neutral: TargetDesign = {
  id: 'neutral',
  name: 'Neutral geometric',
  aspect: 0.75,
  render: () => {
    const H = W / 0.75;
    const zones = [0, 1, 2, 3, 4].map((i) => {
      const inset = 60 + i * 72;
      return { x: inset, y: inset * 1.15, w: W - inset * 2, h: H - inset * 2.3, r: 90 - i * 12 };
    });
    return (
      <>
        <rect x={0} y={0} width={W} height={H} rx={34} fill="#e8e5dc" />
        <rect x={10} y={10} width={W - 20} height={H - 20} rx={28} fill="none" stroke="#bdb8ab" strokeWidth={6} />
        {zones.map((z, i) => (
          <rect
            key={i}
            x={z.x}
            y={z.y}
            width={z.w}
            height={z.h}
            rx={z.r}
            fill={i === 4 ? '#24262a' : 'none'}
            stroke={i === 4 ? '#24262a' : '#8b8678'}
            strokeWidth={i === 4 ? 0 : 5}
          />
        ))}
        {/* aiming mark inside the dark centre */}
        <rect x={W / 2 - 70} y={H / 2 - 95} width={140} height={190} rx={40} fill="none" stroke="#e8e5dc" strokeWidth={8} />
        {/* edge ticks */}
        {[0.25, 0.5, 0.75].map((k) => (
          <g key={k} stroke="#8b8678" strokeWidth={6}>
            <line x1={W * k} y1={18} x2={W * k} y2={48} />
            <line x1={W * k} y1={H - 18} x2={W * k} y2={H - 48} />
          </g>
        ))}
      </>
    );
  },
};

export const TARGET_DESIGNS: Record<string, TargetDesign> = { neutral };

/** Plain target face. */
export const Target = ({ design }: { design: TargetDesign }) => (
  <svg viewBox={`0 0 ${W} ${W / design.aspect}`} width="100%" height="100%" preserveAspectRatio="xMidYMid meet" aria-hidden="true">
    {design.render()}
  </svg>
);

/**
 * Target on a turning mechanism: `facing` 0 = edge-on (turned away), 1 = facing the shooter.
 * The board rotates about its vertical axis; when turned away only its edge stays visible.
 */
export const TurningTarget = ({
  design,
  facing,
  height,
  label,
  dim,
}: {
  design: TargetDesign;
  facing: number;
  height: number;
  label?: string;
  /** Inactive target of this phase (shown a little darker). */
  dim?: boolean;
}) => {
  const width = height * design.aspect;
  const angle = (1 - Math.min(1, Math.max(0, facing))) * 90;
  return (
    <div className={`turning-target${dim ? ' dim' : ''}`} style={{ width, height: height * 1.22 }}>
      <div className="tt-board" style={{ height, transform: `rotateY(${angle.toFixed(2)}deg)` }}>
        <Target design={design} />
      </div>
      {/* the board's edge, visible when turned away */}
      <div className="tt-edge" style={{ height, opacity: Math.max(0, 1 - facing * 2.5) }} />
      <div className="tt-post" />
      {label && <div className="tt-label">{label}</div>}
    </div>
  );
};
