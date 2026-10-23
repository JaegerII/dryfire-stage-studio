/**
 * Live 3D preview of a driven hunt in three.js — the lane, trees and boars exported from the same
 * Blender scene (hunt.py export3d → public/3d/hunt), seen through the stand's camera. Imperative and
 * frame-exact like StageScene3D: apply(t) + render(). The final video still comes from Blender.
 *
 * Lane coordinates (x right, y down the lane, z up) → three.js: (x, z, −y).
 */
import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { type AnimalTrack, poseAt, scenarioTracks } from './motion';
import { AIM, HFOV, STAND } from './rules';
import type { GameClass, HuntFormat, HuntScenario } from './types';

const url = (file: string) => new URL(`3d/hunt/${file}`, document.baseURI).href;
const loader = new GLTFLoader();
const glbs = new Map<string, Promise<THREE.Group>>();
const glb = (file: string) => {
  if (!glbs.has(file)) glbs.set(file, loader.loadAsync(url(file)).then((g) => g.scene));
  return glbs.get(file)!;
};
const tex = (file: string, color = true) =>
  new THREE.TextureLoader().loadAsync(url(file)).then((t) => {
    if (color) t.colorSpace = THREE.SRGBColorSpace;
    return t;
  });

/** Lane point → three.js. */
const v3 = (x: number, y: number, z: number) => new THREE.Vector3(x, z, -y);

interface Animal {
  track: AnimalTrack;
  root: THREE.Object3D;
  body: THREE.Object3D;
  tail: THREE.Object3D | null;
  legs: Record<'FL' | 'FR' | 'HL' | 'HR', { up: THREE.Object3D; lo: THREE.Object3D }>;
  bodyY: number;
  /** Ground height cache along the track (x → z). */
  ground: Map<number, number>;
}

/** Nodes of a boar GLB by Blender name (GLTFLoader drops the dot of ".001" suffixes). */
const node = (root: THREE.Object3D, name: string) => {
  let hit: THREE.Object3D | null = null;
  root.traverse((o) => {
    if (!hit && (o.name === name || o.name.startsWith(name))) hit = o;
  });
  return hit as THREE.Object3D | null;
};

export class HuntScene3D {
  readonly renderer: THREE.WebGLRenderer;
  readonly scene = new THREE.Scene();
  readonly camera = new THREE.PerspectiveCamera(30, 16 / 9, 0.1, 2000);
  private groundMesh: THREE.Mesh | null = null;
  private animals: Animal[] = [];
  private animalGroup = new THREE.Group();
  private rail: THREE.Mesh;
  private format: HuntFormat = '16x9';
  private ray = new THREE.Raycaster();
  private loaded: Promise<void> | null = null;

  constructor(canvas: HTMLCanvasElement) {
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true, preserveDrawingBuffer: true });
    this.renderer.toneMapping = THREE.NeutralToneMapping;
    this.renderer.toneMappingExposure = 1.15;
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.scene.fog = new THREE.FogExp2('#9a9c94', 0.0042);
    this.scene.add(new THREE.HemisphereLight('#d7dbdc', '#4f4436', 1.5));
    const sun = new THREE.DirectionalLight('#fff4e6', 0.6);
    sun.position.set(-20, 40, 10);
    this.scene.add(sun, this.animalGroup, this.camera);
    // the stand's shooting rail along the bottom of the frame (camera space, like hunt.py stand())
    this.rail = new THREE.Mesh(new THREE.BoxGeometry(2.6, 0.04, 0.14), new THREE.MeshLambertMaterial({ color: '#6c655a' }));
    this.camera.add(this.rail);
    this.camera.position.copy(v3(STAND.x, STAND.y, STAND.eye));
    this.camera.lookAt(v3(AIM.x, AIM.y, 0.6));
  }

  /** Lane, trees and sky (once). */
  load() {
    this.loaded ??= (async () => {
      const [lane, groundTex, trees, layout, sky] = await Promise.all([
        glb('lane.glb'),
        tex('ground.jpg'),
        glb('trees.glb'),
        fetch(url('trees.json')).then((r) => r.json() as Promise<{ instances: [string, number, number, number, number, number, number][] }>),
        tex('sky.jpg'),
      ]);
      groundTex.flipY = false;
      groundTex.anisotropy = 8;
      lane.traverse((o) => {
        if ((o as THREE.Mesh).isMesh) {
          const m = o as THREE.Mesh;
          m.material = new THREE.MeshLambertMaterial({ map: groundTex, color: '#d9cfc6' });
          this.groundMesh = m;
        }
      });
      this.scene.add(lane);
      sky.mapping = THREE.EquirectangularReflectionMapping;
      this.scene.background = sky;
      this.scene.backgroundIntensity = 0.75;
      // trees: one InstancedMesh per variant mesh
      const wood = new THREE.MeshLambertMaterial({ color: '#8b877d' });
      const leaves = new THREE.MeshLambertMaterial({ vertexColors: true, side: THREE.DoubleSide });
      const byVariant = new Map<string, THREE.Matrix4[]>();
      for (const [kind, i, x, y, z, rot, s] of layout.instances) {
        const m = new THREE.Matrix4().compose(v3(x, y, z), new THREE.Quaternion().setFromEuler(new THREE.Euler(0, rot, 0)), new THREE.Vector3(s, s, s));
        const key = `${kind}_${i}`;
        if (!byVariant.has(key)) byVariant.set(key, []);
        byVariant.get(key)!.push(m);
      }
      trees.traverse((o) => {
        const mesh = o as THREE.Mesh;
        if (!mesh.isMesh) return;
        const key = mesh.name.replace(/_(wood|leaves)$/, '');
        const list = byVariant.get(key);
        if (!list) return;
        const leafy = mesh.name.endsWith('_leaves');
        const inst = new THREE.InstancedMesh(mesh.geometry, leafy ? leaves : wood, list.length);
        list.forEach((m, j) => inst.setMatrixAt(j, m));
        inst.frustumCulled = false;
        this.scene.add(inst);
      });
    })();
    return this.loaded;
  }

  setSize(w: number, h: number) {
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / h;
    this.format = w >= h ? '16x9' : '9x16';
    const hfov = (HFOV[this.format] * Math.PI) / 180;
    this.camera.fov = (2 * Math.atan(Math.tan(hfov / 2) / this.camera.aspect) * 180) / Math.PI;
    this.camera.updateProjectionMatrix();
    const vHalf = (this.camera.fov * Math.PI) / 360;
    this.rail.position.set(0, -0.95 * Math.tan(vHalf), -0.95);
  }

  /** Builds the animals of a scenario (boar models load on first use). */
  async setScenario(s: HuntScenario) {
    await this.load();
    const tracks = scenarioTracks(s, this.format);
    const kinds = [...new Set(tracks.map((t) => t.kind))];
    const models = new Map<GameClass, THREE.Group>(await Promise.all(kinds.map(async (k) => [k, await glb(`boar_${k}.glb`)] as const)));
    this.animalGroup.clear();
    this.animals = tracks.map((track) => {
      const root = models.get(track.kind)!.clone(true);
      root.traverse((o) => {
        const m = o as THREE.Mesh;
        if (m.isMesh && m.geometry.getAttribute('color')) m.material = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.92 });
      });
      // the GLB's root node carries the class scale; the animal's own size on top
      const boarNode = node(root, 'boar') ?? root;
      boarNode.scale.multiplyScalar(track.size);
      const body = node(root, 'boar_body')!;
      const legs = {} as Animal['legs'];
      for (const k of ['FL', 'FR', 'HL', 'HR'] as const) legs[k] = { up: node(root, `leg_${k}`)!, lo: node(root, `shin_${k}`)! };
      this.animalGroup.add(root);
      return { track, root: boarNode, body, tail: node(root, 'tail'), legs, bodyY: body.position.y, ground: new Map() };
    });
  }

  private groundAt(a: Animal, x: number, y: number) {
    const key = Math.round(x * 4);
    let z = a.ground.get(key);
    if (z === undefined) {
      z = 0;
      if (this.groundMesh) {
        this.ray.set(v3(x, y, 50), new THREE.Vector3(0, -1, 0));
        const hit = this.ray.intersectObject(this.groundMesh, false)[0];
        if (hit) z = hit.point.y;
      }
      a.ground.set(key, z);
    }
    return z;
  }

  /** Pose every animal at drive time t (seconds). */
  apply(t: number) {
    for (const a of this.animals) {
      const p = poseAt(a.track, t);
      a.root.visible = p.visible;
      if (!p.visible) continue;
      a.root.position.copy(v3(p.x, p.y, this.groundAt(a, p.x, p.y)));
      a.root.rotation.set(0, a.track.dir > 0 ? 0 : Math.PI, 0);
      // Blender rotation about +Y = three.js rotation about −Z
      a.body.position.y = a.bodyY + p.body.bob;
      a.body.rotation.set(p.body.rx, 0, -p.body.ry);
      if (a.tail) a.tail.rotation.set(p.tail.rx, 0, -p.tail.ry);
      for (const k of ['FL', 'FR', 'HL', 'HR'] as const) {
        a.legs[k].up.rotation.set(0, 0, -p.legs[k].up);
        a.legs[k].lo.rotation.set(0, 0, -p.legs[k].lo);
      }
    }
  }

  render() {
    this.renderer.render(this.scene, this.camera);
  }

  dispose() {
    this.renderer.dispose();
  }
}
