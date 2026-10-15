/**
 * Applies target motion (swingers, movers, falling steel, activators) to the
 * Konva nodes of a playing stage. Shared by the training player and the TV
 * renderer, so both show exactly the same stage behaviour.
 */
import type Konva from 'konva';
import { ENVIRONMENTS } from '../assets/environments';
import type { Stage, StageObject } from '../types/stage';
import { type FallTimes, fallScale, fallTimes, isMoving, motionAt } from './motion';
import { elevationPx, pxPerMeter } from './perspective';
import type { PlayerSnapshot } from './schedule';

export interface StageMotionData {
  movers: StageObject[];
  falls: FallTimes;
}

export const stageMotionData = (s: Stage): StageMotionData => ({ movers: s.objects.filter((o) => isMoving(o.motion)), falls: fallTimes(s.objects) });

/** Moves / shows / tips every moving object for the rep state `rs`. Returns false when nothing moves. */
export const applyStageMotion = (
  st: Stage,
  { movers, falls }: StageMotionData,
  rs: PlayerSnapshot,
  nodes: Map<string, Konva.Group>,
  box: { width: number; height: number },
) => {
  if (!movers.length) return false;
  const { width, height } = box;
  const env = ENVIRONMENTS[st.environment];
  // keep the shot-at state (fallen steel, activated targets) through the "TIME" second, then reset
  const activeWindow = rs.phase === 'active' || (rs.phase === 'reset' && rs.sinceStart < st.parTime + 1);
  for (const o of movers) {
    const node = nodes.get(o.id);
    if (!node) continue;
    const m = motionAt(o.motion, rs.sinceStart, activeWindow, falls);
    const ppm = pxPerMeter(o, env, height);
    // the object and its floor shadow (drawn in the shadow pass) move together
    for (const n of [node, nodes.get(`${o.id}#shadow`)]) {
      if (!n) continue;
      n.position({ x: o.x * width + m.dx * ppm, y: o.y * height - elevationPx(o, env, height) - m.dy * ppm });
      n.visible(m.visible);
      n.scaleY(fallScale(m.fall));
      n.findOne('.motion')?.rotation(m.rot); // swing pivots at the object's own foot
    }
  }
  return true;
};
