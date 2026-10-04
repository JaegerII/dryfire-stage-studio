import type Konva from 'konva';
import { useCallback, useEffect, useMemo, useRef } from 'react';
import { Image as KImage, Layer, Line, Stage as KStage, Text, Transformer } from 'react-konva';
import { ENVIRONMENTS } from '../../assets/environments';
import { useAssetImage } from '../../hooks/useAssetImage';
import type { EnvironmentDef } from '../../assets/environments';
import type { Stage, StageObject as StageObjectData } from '../../types/stage';
import { DEFAULT_AMPLITUDE, DEFAULT_SWING_ANGLE } from '../../utils/motion';
import { drawOrder, elevationPx, objectSize, pxPerMeter } from '../../utils/perspective';
import { viewTransform } from '../../utils/view';
import { type ObjectChange, StageObject } from './StageObject';

interface Props {
  stage: Stage;
  width: number;
  height: number;
  /** Editor mode: selection, drag, transform, grid. */
  interactive?: boolean;
  selectedIds?: string[];
  /** additive = Ctrl/Shift/Cmd held (multi-select). */
  onSelect?: (id: string | null, additive?: boolean) => void;
  onChange?: ObjectChange;
  showLabels?: boolean;
  showGrid?: boolean;
  snap?: number;
  /** Player: receives every object's Konva node (for target motion). */
  registerNode?: (id: string, node: Konva.Group | null) => void;
  /** Player: receives the objects layer to redraw after motion updates. */
  layerRef?: React.RefObject<Konva.Layer | null>;
}

const GRID_STEPS = 20;

/** Editor preview of a swing / bob: translucent copies at both end points + the travel line. */
type LayerView = ReturnType<typeof viewTransform>;

const MotionGhosts = ({ obj, env, width, height, view }: { obj: StageObjectData; env: EnvironmentDef; width: number; height: number; view: LayerView }) => {
  const a = obj.motion?.amplitude ?? DEFAULT_AMPLITUDE;
  const ppm = pxPerMeter(obj, env, height);
  if (obj.motion?.kind === 'swing') {
    // both end tilts + the arc the top of the target travels on
    const angle = obj.motion.angle ?? DEFAULT_SWING_ANGLE;
    const px = obj.x * width;
    const py = obj.y * height - elevationPx(obj, env, height);
    const r = objectSize(obj, env, height).groundOffset * 0.82;
    const arc = Array.from({ length: 25 }, (_, i) => {
      const t = ((-angle + (2 * angle * i) / 24) * Math.PI) / 180;
      return [px + r * Math.sin(t), py - r * Math.cos(t)];
    }).flat();
    return (
      <Layer listening={false} {...view}>
        {[angle, -angle].map((g, i) => (
          <StageObject key={i} obj={{ ...obj, id: `${obj.id}-ghost${i}`, opacity: 0.38 }} env={env} width={width} height={height} interactive={false} showLabel={false} snap={0} swingAngle={g} />
        ))}
        <Line points={arc} stroke="#FF3131" strokeWidth={2} dash={[6, 5]} opacity={0.9} />
      </Layer>
    );
  }
  const horizontal = obj.motion?.kind === 'horizontal';
  const ends = [a, -a].map((d) =>
    horizontal ? { ...obj, x: obj.x + (d * ppm) / width, opacity: 0.38 } : { ...obj, elevation: (obj.elevation ?? 0) + d, opacity: 0.38 },
  );
  const footY = obj.y * height - elevationPx(obj, env, height);
  const line = horizontal
    ? [obj.x * width - a * ppm, footY, obj.x * width + a * ppm, footY]
    : [obj.x * width, footY - a * ppm, obj.x * width, footY + a * ppm];
  return (
    <Layer listening={false} {...view}>
      {ends.map((g, i) => (
        <StageObject key={i} obj={{ ...g, id: `${obj.id}-ghost${i}` }} env={env} width={width} height={height} interactive={false} showLabel={false} snap={0} />
      ))}
      <Line points={line} stroke="#FF3131" strokeWidth={2} dash={[6, 5]} opacity={0.9} />
    </Layer>
  );
};

/**
 * The one stage renderer used by both the editor and the player:
 * environment plate + shared assets in perspective, back to front.
 */
export const StageCanvas = ({
  stage,
  width,
  height,
  interactive = false,
  selectedIds = [],
  onSelect,
  onChange,
  showLabels = false,
  showGrid = false,
  snap = 0,
  registerNode,
  layerRef,
}: Props) => {
  const env = ENVIRONMENTS[stage.environment];
  const bg = useAssetImage(env.src);
  const nodes = useRef(new Map<string, Konva.Group>());
  const tr = useRef<Konva.Transformer>(null);
  const ordered = useMemo(() => drawOrder(stage.objects), [stage.objects]);
  const selectedObjs = stage.objects.filter((o) => selectedIds.includes(o.id));
  const selected = selectedObjs.length === 1 ? selectedObjs[0] : undefined;
  const selKey = selectedIds.join(',');
  const view = viewTransform(stage, env, width, height);

  const register = useCallback(
    (id: string, node: Konva.Group | null) => {
      if (node) nodes.current.set(id, node);
      else nodes.current.delete(id);
      registerNode?.(id, node);
    },
    [registerNode],
  );

  // attach the transformer to the selection (locked objects only when they are the sole selection)
  const allLocked = selectedObjs.length > 0 && selectedObjs.every((o) => o.locked);
  useEffect(() => {
    const t = tr.current;
    if (!t) return;
    const ids = selectedObjs.filter((o) => !o.locked || selectedObjs.length === 1).map((o) => o.id);
    t.nodes(ids.map((id) => nodes.current.get(id)).filter((n): n is Konva.Group => !!n));
    t.getLayer()?.batchDraw();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selKey, stage.objects]);

  const onTransformEnd = () => {
    for (const obj of selectedObjs) {
      const node = nodes.current.get(obj.id);
      if (!node || (obj.locked && selectedObjs.length > 1)) continue;
      const factor = node.scaleX();
      node.scale({ x: 1, y: 1 });
      onChange?.(obj.id, {
        scale: Math.max(0.05, +(obj.scale * factor).toFixed(3)),
        rotation: +node.rotation().toFixed(1),
        x: node.x() / width,
        y: (node.y() + elevationPx(obj, env, height)) / height,
      });
    }
  };

  if (width <= 0 || height <= 0) return null;

  return (
    <KStage width={width} height={height}>
      <Layer listening={interactive} {...view}>
        <KImage image={bg} width={width} height={height} onMouseDown={(e) => onSelect?.(null, e.evt.ctrlKey || e.evt.metaKey || e.evt.shiftKey)} onTouchStart={() => onSelect?.(null)} />
        {interactive && showGrid && (
          <>
            {Array.from({ length: GRID_STEPS - 1 }, (_, i) => (
              <Line key={`v${i}`} points={[((i + 1) * width) / GRID_STEPS, 0, ((i + 1) * width) / GRID_STEPS, height]} stroke="rgba(255,255,255,0.08)" strokeWidth={1} listening={false} />
            ))}
            {Array.from({ length: GRID_STEPS - 1 }, (_, i) => (
              <Line key={`h${i}`} points={[0, ((i + 1) * height) / GRID_STEPS, width, ((i + 1) * height) / GRID_STEPS]} stroke="rgba(255,255,255,0.08)" strokeWidth={1} listening={false} />
            ))}
          </>
        )}
        {interactive && (
          <>
            <Line points={[0, env.horizon * height, width, env.horizon * height]} stroke="rgba(255,49,49,0.55)" strokeWidth={1} dash={[8, 6]} listening={false} />
            <Text x={8} y={env.horizon * height - 16} text="HORIZON" fontFamily="Montserrat" fontStyle="700" fontSize={10} letterSpacing={2} fill="rgba(255,49,49,0.8)" listening={false} />
          </>
        )}
      </Layer>
      <Layer ref={layerRef} listening={interactive} {...view}>
        {ordered.map((obj) => (
          <StageObject
            key={obj.id}
            obj={obj}
            env={env}
            width={width}
            height={height}
            interactive={interactive}
            showLabel={showLabels}
            snap={snap}
            onSelect={onSelect ?? undefined}
            onChange={onChange}
            registerNode={register}
          />
        ))}
      </Layer>
      {interactive && selected && (selected.motion?.kind === 'swing' || selected.motion?.kind === 'horizontal' || selected.motion?.kind === 'vertical') && (
        <MotionGhosts obj={selected} env={env} width={width} height={height} view={view} />
      )}
      {interactive && (
        <Layer>
          <Transformer
            ref={tr}
            keepRatio
            rotateEnabled={!allLocked}
            resizeEnabled={!allLocked}
            enabledAnchors={['top-left', 'top-right', 'bottom-left', 'bottom-right']}
            borderStroke={allLocked ? '#949888' : '#FF3131'}
            borderDash={allLocked ? [4, 4] : undefined}
            anchorStroke="#FF3131"
            anchorFill="#0F1010"
            anchorSize={9}
            rotateAnchorOffset={24}
            boundBoxFunc={(oldBox, newBox) => (newBox.width < 8 || newBox.height < 8 ? oldBox : newBox)}
            onTransformEnd={onTransformEnd}
          />
        </Layer>
      )}
    </KStage>
  );
};
