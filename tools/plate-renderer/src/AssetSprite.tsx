import { useThree } from '@react-three/fiber';
import { ThreeCanvas } from '@remotion/three';
import React, { useLayoutEffect } from 'react';
import { useVideoConfig } from 'remotion';
import * as THREE from 'three';
import { EnvLighting, PBRProvider } from './scene/pbr';
import { MeshWall, PaperTarget, SteelPopper } from './scene/props';

/**
 * Asset sprites for Stage Studio: one object, straight-on orthographic view,
 * transparent background. The frame matches the registry geometry exactly:
 * viewW × viewH cm, ground line groundY cm from the top.
 */
export const SPRITE_PX_PER_CM = 8;

export const SPRITES = {
  paper_full: { viewW: 54, viewH: 147, groundY: 143, model: PaperTarget },
  steel_popper: { viewW: 54, viewH: 103, groundY: 99, model: SteelPopper },
  mesh_wall: { viewW: 220, viewH: 189, groundY: 185, model: () => <MeshWall width={180} /> },
} satisfies Record<string, { viewW: number; viewH: number; groundY: number; model: React.FC }>;

export type SpriteId = keyof typeof SPRITES;

/** Distance (m) the sprite camera looks from — a typical target distance on a stage. */
const VIEW_DISTANCE = 8;
const EYE = 1.5;

/**
 * Level camera at eye height (like the plate camera), with an off-axis frustum that
 * frames exactly viewW × viewH cm in the object's plane: bases are seen slightly from
 * above and real shadows land on the floor, so sprites sit in the plates naturally.
 */
const EyeRig: React.FC<{ id: SpriteId }> = ({ id }) => {
  const { camera, invalidate } = useThree();
  const s = SPRITES[id];
  useLayoutEffect(() => {
    const cam = camera as THREE.PerspectiveCamera & { manual?: boolean };
    cam.manual = true;
    const near = 0.5;
    const k = near / VIEW_DISTANCE;
    cam.position.set(0, EYE, VIEW_DISTANCE);
    cam.lookAt(0, EYE, 0);
    cam.updateMatrixWorld();
    cam.projectionMatrix.makePerspective(
      (-s.viewW / 200) * k,
      (s.viewW / 200) * k,
      (s.groundY / 100 - EYE) * k,
      (-(s.viewH - s.groundY) / 100 - EYE) * k,
      near,
      40,
    );
    cam.projectionMatrixInverse.copy(cam.projectionMatrix).invert();
    invalidate();
  }, [camera, s, invalidate]);
  return null;
};

/** Invisible floor that only shows the shadows falling on it. */
const ShadowCatcher: React.FC = () => (
  <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0, 0]} receiveShadow>
    <planeGeometry args={[20, 20]} />
    <shadowMaterial opacity={0.42} />
  </mesh>
);

/** Key light from the upper left front, like the high-bay lights of the indoor ranges. */
const SpriteLights: React.FC = () => (
  <>
    <EnvLighting intensity={0.4} rotation={1.2} />
    <ambientLight intensity={0.15} />
    <directionalLight
      position={[-0.6, 7, 4.5]}
      intensity={1.6}
      color="#fff6ea"
      castShadow
      shadow-mapSize-width={2048}
      shadow-mapSize-height={2048}
      shadow-camera-left={-2.5}
      shadow-camera-right={2.5}
      shadow-camera-top={2.5}
      shadow-camera-bottom={-2.5}
      shadow-bias={-0.0003}
      shadow-radius={6}
    />
    <directionalLight position={[3, 2, 4]} intensity={0.35} color="#dfe8ff" />
    {/* nearby high-bay light: gives the soft top-to-bottom falloff of a real range */}
    <pointLight position={[-0.6, 3.2, 1.6]} intensity={6} distance={0} decay={2} color="#fff3e2" />
  </>
);

export const AssetSprite: React.FC<{ id: SpriteId }> = ({ id }) => {
  const { width, height } = useVideoConfig();
  const Model = SPRITES[id].model;
  return (
    <ThreeCanvas
      width={width}
      height={height}
      shadows="soft"
      gl={{ antialias: true, preserveDrawingBuffer: true, alpha: true }}
      dpr={1}
      style={{ background: 'transparent' }}
      // same tone mapping as the realistic plates
      onCreated={({ gl }) => {
        gl.toneMapping = THREE.NeutralToneMapping;
      }}
    >
      <EyeRig id={id} />
      <PBRProvider>
        <SpriteLights />
        <ShadowCatcher />
        <Model />
      </PBRProvider>
    </ThreeCanvas>
  );
};
