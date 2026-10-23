/**
 * Live 3D preview of a driven hunt in three.js — the maps, trees and boars exported from the same
 * Blender scenes (hunt.py export3d → public/3d/hunt/<map>), seen through the chosen stand's camera.
 * Imperative and frame-exact like StageScene3D: show(scenario, t) + render(). The final video still
 * comes from Blender.
 *
 * Lane coordinates (x right, y down the lane, z up) → three.js: (x, z, −y).
 */
import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { type MapId, standView } from './maps';
import { type AnimalTrack, poseAt, scenarioTracks } from './motion';
import { HFOV } from './rules';
import type { GameClass, HuntFormat, HuntScenario } from './types';

const url = (file: string) => new URL(`3d/hunt/${file}`, document.baseURI).href;
const loader = new GLTFLoader();
const glbs = new Map<string, Promise<THREE.Group>>();
const glb = (file: string) => {
  if (!glbs.has(file)) glbs.set(file, loader.loadAsync(url(file)).then((g) => g.scene));
  return glbs.get(file)!;
};
const tex = (file: string) =>
  new THREE.TextureLoader().loadAsync(url(file)).then((t) => {
    t.colorSpace = THREE.SRGBColorSpace;
    return t;
  });

/** Lane point → three.js. */
const v3 = (x: number, y: number, z: number) => new THREE.Vector3(x, z, -y);

/** Per map: haze, light and how the baked ground reads under the live light (matched by eye to the renders). */
const LOOK: Record<MapId, { fog: string; density: number; sky: string; ground: string; hemi: number; tint: string; exposure: number }> = {
  buche_herbst: { fog: '#9a9c94', density: 0.0042, sky: '#d7dbdc', ground: '#4f4436', hemi: 1.5, tint: '#d9cfc6', exposure: 1.15 },
  buche_winter: { fog: '#c2c6c8', density: 0.0058, sky: '#e4e8ec', ground: '#9a9890', hemi: 1.35, tint: '#e6e8ea', exposure: 1.05 },
  fichte: { fog: '#8d928a', density: 0.0048, sky: '#cfd5d6', ground: '#3e3a30', hemi: 1.6, tint: '#d6d0c8', exposure: 1.3 },
};

interface MapScene {
  group: THREE.Group;
  ground: THREE.Mesh | null;
  sky: THREE.Texture;
}

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
  private maps = new Map<MapId, Promise<MapScene>>();
  private loadedMaps = new Map<MapId, MapScene>();
  private hemi = new THREE.HemisphereLight();
  private fog = new THREE.FogExp2('#9a9c94', 0.004);
  /** Animals per scenario (index into the list given to setScenarios). */
  private herds: { group: THREE.Group; animals: Animal[]; scenario: HuntScenario }[] = [];
  private rail: THREE.Mesh;
  private format: HuntFormat = '16x9';
  private ray = new THREE.Raycaster();
  private current: MapId | null = null;

  constructor(canvas: HTMLCanvasElement) {
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true, preserveDrawingBuffer: true });
    this.renderer.toneMapping = THREE.NeutralToneMapping;
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.scene.fog = this.fog;
    const sun = new THREE.DirectionalLight('#fff4e6', 0.6);
    sun.position.set(-20, 40, 10);
    this.scene.add(this.hemi, sun, this.camera);
    // the stand's shooting rail along the bottom of the frame (camera space, like hunt.py stand())
    this.rail = new THREE.Mesh(new THREE.BoxGeometry(2.6, 0.04, 0.14), new THREE.MeshLambertMaterial({ color: '#6c655a' }));
    this.camera.add(this.rail);
  }

  /** A map's lane, trees and sky (loaded once, kept). */
  loadMap(map: MapId) {
    if (!this.maps.has(map))
      this.maps.set(
        map,
        (async () => {
          const [lane, groundTex, trees, layout, sky] = await Promise.all([
            glb(`${map}/lane.glb`),
            tex(`${map}/ground.jpg`),
            glb(`${map}/trees.glb`),
            fetch(url(`${map}/trees.json`)).then((r) => r.json() as Promise<{ instances: [string, number, number, number, number, number, number][] }>),
            tex(`${map}/sky.jpg`),
          ]);
          const group = new THREE.Group();
          groundTex.flipY = false;
          groundTex.anisotropy = 8;
          let ground: THREE.Mesh | null = null;
          const laneCopy = lane.clone(true);
          laneCopy.traverse((o) => {
            if ((o as THREE.Mesh).isMesh) {
              ground = o as THREE.Mesh;
              ground.material = new THREE.MeshLambertMaterial({ map: groundTex, color: LOOK[map].tint });
            }
          });
          group.add(laneCopy);
          sky.mapping = THREE.EquirectangularReflectionMapping;
          // trees: one InstancedMesh per variant mesh
          const wood = new THREE.MeshLambertMaterial({ color: map === 'fichte' ? '#6e5d50' : '#8b877d' });
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
            const list = byVariant.get(mesh.name.replace(/_(wood|leaves)$/, ''));
            if (!list) return;
            const inst = new THREE.InstancedMesh(mesh.geometry, mesh.name.endsWith('_leaves') ? leaves : wood, list.length);
            list.forEach((m, j) => inst.setMatrixAt(j, m));
            inst.frustumCulled = false;
            group.add(inst);
          });
          group.visible = false;
          this.scene.add(group);
          const ms = { group, ground, sky };
          this.loadedMaps.set(map, ms);
          return ms;
        })(),
      );
    return this.maps.get(map)!;
  }

  setSize(w: number, h: number) {
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / h;
    this.format = w >= h ? '16x9' : '9x16';
    const hfov = (HFOV[this.format] * Math.PI) / 180;
    this.camera.fov = (2 * Math.atan(Math.tan(hfov / 2) / this.camera.aspect) * 180) / Math.PI;
    this.camera.updateProjectionMatrix();
    this.rail.position.set(0, -0.95 * Math.tan((this.camera.fov * Math.PI) / 360), -0.95);
  }

  /** Builds every scenario's animals (and loads their maps; boar models on first use). */
  async setScenarios(list: HuntScenario[]) {
    await Promise.all([...new Set(list.map((s) => s.map))].map((m) => this.loadMap(m)));
    const kinds = [...new Set(list.flatMap((s) => s.crossings.flatMap((c) => c.animals)))];
    const models = new Map<GameClass, THREE.Group>(await Promise.all(kinds.map(async (k) => [k, await glb(`boar_${k}.glb`)] as const)));
    for (const h of this.herds) this.scene.remove(h.group);
    this.herds = list.map((scenario) => {
      const group = new THREE.Group();
      const animals = scenarioTracks(scenario, this.format).map((track): Animal => {
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
        group.add(root);
        return { track, root: boarNode, body, tail: node(root, 'tail'), legs, bodyY: body.position.y, ground: new Map() };
      });
      group.visible = false;
      this.scene.add(group);
      return { group, animals, scenario };
    });
  }

  /** Map, stand and animals of scenario `index` at its drive time t. */
  show(index: number, t: number) {
    const herd = this.herds[index];
    if (!herd) return;
    const { map, stand } = herd.scenario;
    const ms = this.loadedMaps.get(map);
    if (this.current !== map && ms) {
      for (const [id, m] of this.loadedMaps) m.group.visible = id === map;
      this.scene.background = ms.sky;
      this.scene.backgroundIntensity = 0.75;
      const look = LOOK[map];
      this.fog.color.set(look.fog);
      this.fog.density = look.density;
      this.hemi.color.set(look.sky);
      this.hemi.groundColor.set(look.ground);
      this.hemi.intensity = look.hemi;
      this.renderer.toneMappingExposure = look.exposure;
      this.current = map;
    }
    const st = standView(map, stand);
    this.camera.position.copy(v3(st.x, st.y, st.eye));
    this.camera.lookAt(v3(st.aim[0], st.aim[1], st.aim[2]));
    for (const h of this.herds) h.group.visible = h === herd;
    for (const a of herd.animals) {
      const p = poseAt(a.track, t);
      a.root.visible = p.visible;
      if (!p.visible) continue;
      a.root.position.copy(v3(p.x, p.y, this.groundAt(a, ms?.ground ?? null, p.x, p.y)));
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

  private groundAt(a: Animal, ground: THREE.Mesh | null, x: number, y: number) {
    const key = Math.round(x * 4);
    let z = a.ground.get(key);
    if (z === undefined) {
      z = 0;
      if (ground) {
        this.ray.set(v3(x, y, 50), new THREE.Vector3(0, -1, 0));
        const hit = this.ray.intersectObject(ground, false)[0];
        if (hit) z = hit.point.y;
      }
      a.ground.set(key, z);
    }
    return z;
  }

  render() {
    this.renderer.render(this.scene, this.camera);
  }

  dispose() {
    this.renderer.dispose();
  }
}
