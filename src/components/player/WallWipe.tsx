import { forwardRef, useImperativeHandle, useRef } from 'react';
import meshWall from '../../assets/realistic/mesh_wall.webp';
import woodWall from '../../assets/realistic/wood_wall.webp';
import type { AreaTransition } from '../../types/stage';

export interface WallWipeHandle {
  /** progress 0..1 of the transition, or null = hidden. */
  update: (progress: number | null) => void;
}

const SRC = { mesh: meshWall, wood: woodWall };

/**
 * Area change: a barrier very close to the camera sweeps across the whole
 * screen, faster than the background pans (parallax), as if the shooter ran
 * past it to the next position. The mesh is see-through: the next area is
 * already visible behind it. Positioned imperatively every frame — no React render.
 */
export const WallWipe = forwardRef<WallWipeHandle, { transition: AreaTransition }>(function WallWipe({ transition }, ref) {
  const root = useRef<HTMLDivElement>(null);
  const strip = useRef<HTMLDivElement>(null);
  const shown = useRef(false);

  useImperativeHandle(ref, () => ({
    update(p) {
      const r = root.current;
      const s = strip.current;
      if (!r || !s) return;
      if (p === null || p <= 0 || p >= 1) {
        if (shown.current) r.style.visibility = 'hidden';
        shown.current = false;
        return;
      }
      if (!shown.current) r.style.visibility = 'visible';
      shown.current = true;
      const W = r.clientWidth;
      const S = s.offsetWidth;
      // mostly constant speed (running past), softened at both ends
      const e = 0.6 * p + 0.4 * (0.5 - Math.cos(Math.PI * p) / 2);
      // ltr: from fully left of the screen (x = −S) to fully right (x = W); covers everything at e = 0.5
      const x = transition.direction === 'ltr' ? -S + e * (S + W) : W - e * (S + W);
      s.style.transform = `translate3d(${x}px,0,0)`;
    },
  }));

  return (
    <div className="wall-wipe" ref={root} style={{ visibility: 'hidden' }}>
      <div className={`wall-strip ${transition.style}`} ref={strip}>
        {/* ~2.2 screen widths for both styles: fully covered for ~40 % of the move */}
        {(transition.style === 'wood' ? [0, 1] : [0, 1, 2]).map((i) => (
          <img key={i} src={SRC[transition.style]} alt="" draggable={false} />
        ))}
      </div>
    </div>
  );
});
