import type Konva from 'konva';
import { memo, useCallback, useMemo } from 'react';
import { Circle, Group, Image as KImage, Text } from 'react-konva';
import type { EnvironmentDef } from '../../assets/environments';
import { ASSETS } from '../../assets/registry';
import { useAssetImage } from '../../hooks/useAssetImage';
import type { StageObject as StageObjectData } from '../../types/stage';
import { elevationPx, objectSize } from '../../utils/perspective';
import { shadowTransform, silhouette } from '../../utils/shadow';

export type ObjectChange = (id: string, patch: Partial<StageObjectData>, opts?: { transient?: boolean }) => void;

interface Props {
  obj: StageObjectData;
  env: EnvironmentDef;
  width: number;
  height: number;
  interactive: boolean;
  showLabel: boolean;
  snap: number; // 0 = off, else grid step in normalised units
  onSelect?: (id: string, additive?: boolean) => void;
  onChange?: ObjectChange;
  registerNode?: (id: string, node: Konva.Group | null) => void;
  /** Extra tilt (deg) around the object's own foot — swing preview. */
  swingAngle?: number;
}

/** The shared asset image, sized by perspective, anchored at its ground point, optionally turned (yaw). */
const AssetImage = ({ obj, env, height }: Pick<Props, 'obj' | 'env' | 'height'>) => {
  const asset = ASSETS[obj.type];
  const img = useAssetImage(asset.src);
  const { w, h, groundOffset } = objectSize(obj, env, height);
  const yaw = ((obj.yaw ?? 0) * Math.PI) / 180;
  const scaleX = Math.max(0.12, Math.cos(yaw)) * (obj.flip ? -1 : 1);
  const sun = asset.banner ? undefined : env.shadow;
  const sil = useMemo(() => (img && sun ? silhouette(img, sun.softness) : null), [img, sun]);
  const cast = sil && sun && img ? shadowTransform(sun, env, obj.y) : null;
  const k = img ? w / img.naturalWidth : 1;
  return (
    <>
      {sil && cast && (
        <KImage
          image={sil.canvas}
          width={sil.canvas.width * k}
          height={sil.canvas.height * k}
          offsetX={sil.pad * k + w / 2}
          offsetY={sil.pad * k + groundOffset}
          scaleX={scaleX}
          scaleY={cast.scaleY}
          skewX={cast.skewX}
          opacity={sun!.opacity}
          listening={false}
          perfectDrawEnabled={false}
        />
      )}
      <KImage
        image={img}
        width={w}
        height={h}
        offsetX={w / 2}
        offsetY={groundOffset}
        scaleX={scaleX}
        skewY={-Math.sin(yaw) * 0.16}
        perfectDrawEnabled={false}
      />
    </>
  );
};

/** Engagement-order badge floating above a target. */
const Badge = ({ text, size, top }: { text: string; size: number; top: number }) => (
  <Group y={top - size * 0.9} listening={false}>
    <Circle radius={size / 2} fill="rgba(15,16,16,0.85)" stroke="#EDEDE6" strokeWidth={Math.max(1.5, size * 0.06)} />
    <Text
      text={text}
      width={size * 2}
      offsetX={size}
      offsetY={size * 0.27}
      align="center"
      fontFamily="Montserrat"
      fontStyle="800"
      fontSize={size * 0.52}
      fill="#EDEDE6"
    />
  </Group>
);

export const TargetObject = ({ obj, env, height, showLabel }: Pick<Props, 'obj' | 'env' | 'height' | 'showLabel'>) => {
  const { groundOffset } = objectSize(obj, env, height);
  const badge = Math.max(18, height * 0.034);
  return (
    <>
      <AssetImage obj={obj} env={env} height={height} />
      {showLabel && obj.label && <Badge text={obj.label} size={badge} top={-groundOffset * 0.97} />}
    </>
  );
};

export const BarrierObject = ({ obj, env, height }: Pick<Props, 'obj' | 'env' | 'height'>) => (
  <AssetImage obj={obj} env={env} height={height} />
);

const snapTo = (v: number, step: number) => (step ? Math.round(v / step) * step : v);

/** One stage object: position, rotation, opacity, drag. Rendering is delegated by category. */
export const StageObject = memo(function StageObject({
  obj,
  env,
  width,
  height,
  interactive,
  showLabel,
  snap,
  onSelect,
  onChange,
  registerNode,
  swingAngle = 0,
}: Props) {
  const asset = ASSETS[obj.type];
  const ref = useCallback((node: Konva.Group | null) => registerNode?.(obj.id, node), [registerNode, obj.id]);
  const draggable = interactive && !obj.locked;

  // the group sits at the object's own foot (lifted by its elevation) so rotate/scale pivot there
  const lift = elevationPx(obj, env, height);
  const toNorm = (node: Konva.Node) => ({ x: snapTo(node.x() / width, snap), y: snapTo((node.y() + lift) / height, snap) });

  return (
    <Group
      ref={ref}
      name={`obj-${obj.id}`}
      x={obj.x * width}
      y={obj.y * height - lift}
      rotation={obj.rotation}
      opacity={obj.opacity ?? 1}
      draggable={draggable}
      listening={interactive}
      onMouseDown={(e) => onSelect?.(obj.id, e.evt.ctrlKey || e.evt.metaKey || e.evt.shiftKey)}
      onTouchStart={() => onSelect?.(obj.id)}
      onDragMove={(e) => {
        const n = toNorm(e.target);
        if (snap) e.target.position({ x: n.x * width, y: n.y * height - lift });
        onChange?.(obj.id, n, { transient: true });
      }}
      onDragEnd={(e) => onChange?.(obj.id, toNorm(e.target))}
    >
      {/* elevation: lifted above its floor point (e.g. standing on a box) */}
      <Group name="motion" rotation={swingAngle}>
        {asset.category === 'target' ? (
          <TargetObject obj={obj} env={env} height={height} showLabel={showLabel} />
        ) : (
          <BarrierObject obj={obj} env={env} height={height} />
        )}
      </Group>
    </Group>
  );
});
