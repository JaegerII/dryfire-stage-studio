/**
 * Live 3D preview of a driven hunt in three.js. The camera on a stand never moves, so the background is
 * the lane exactly as Blender renders it: per map, stand and format a photo plate plus its depth
 * (hunt.py previewplates → public/3d/hunt/<map>/plate_<n>_<fmt>.jpg, depth_<n>_<fmt>.png). The plate is
 * drawn with its depth written into the depth buffer, so the live boars (GLBs from the same Blender
 * models, posed per frame) pass behind trunks and bushes as in the render. Imperative and frame-exact like
 * StageScene3D: show(scenario, t) + render(). The final video still comes from Blender.
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
/** Lane point → three.js. */
const v3 = (x: number, y: number, z: number) => new THREE.Vector3(x, z, -y);

/** Per map: haze, light and how the baked ground reads under the live light (matched by eye to the renders). */
const LOOK: Record<MapId, { fog: string; density: number; sky: string; ground: string; hemi: number; tint: string; exposure: number }> = {
  buche_herbst: { fog: '#9a9c94', density: 0.0042, sky: '#c9ced2', ground: '#3b3834', hemi: 1.0, tint: '#d9cfc6', exposure: 0.95 },
  buche_winter: { fog: '#c2c6c8', density: 0.0058, sky: '#dfe4e8', ground: '#8e8e8a', hemi: 0.95, tint: '#e6e8ea', exposure: 0.95 },
  fichte: { fog: '#8d928a', density: 0.0048, sky: '#c4cbcc', ground: '#34322c', hemi: 1.0, tint: '#d6d0c8', exposure: 1.05 },
  buche_hang_schnee: { fog: '#c3c6c6', density: 0.006, sky: '#dfe4e8', ground: '#8e8e8a', hemi: 0.95, tint: '#e6e8ea', exposure: 0.95 },
  kiefer_farn: { fog: '#b2aa9c', density: 0.0045, sky: '#d0ccc2', ground: '#4a3a2c', hemi: 1.0, tint: '#d9cfc6', exposure: 1.0 },
  stangenholz_raureif: { fog: '#b9bcba', density: 0.0065, sky: '#d2d6d6', ground: '#4a4640', hemi: 0.95, tint: '#d6d0c8', exposure: 1.0 },
};

interface MapScene {
  /** The lane's ground, invisible: only for the boars' feet (raycast). */
  ground: THREE.Mesh | null;
}

/** The photo plate drawn as the background, writing the plate's depth (decoded from 16 bit in R + G). */
const plateMaterial = () =>
  new THREE.ShaderMaterial({
    glslVersion: THREE.GLSL3,
    uniforms: { plate: { value: null }, depthTex: { value: null }, near: { value: 0.1 }, far: { value: 2000 } },
    vertexShader: `
      out vec2 vUv;
      void main() { vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }`,
    fragmentShader: `
      uniform sampler2D plate;
      uniform sampler2D depthTex;
      uniform float near;
      uniform float far;
      in vec2 vUv;
      out highp vec4 fragColor;
      void main() {
        vec4 e = texture(depthTex, vUv);
        float m = (floor(e.r * 255.0 + 0.5) * 256.0 + floor(e.g * 255.0 + 0.5)) / 65535.0 * 1000.0;
        float d = clamp(m, near * 1.01, far * 0.999);
        float z = (far + near) / (far - near) - 2.0 * far * near / ((far - near) * d);
        gl_FragDepth = z * 0.5 + 0.5;
        fragColor = vec4(texture(plate, vUv).rgb, 1.0);
      }`,
    depthTest: true,
    depthWrite: true,
    fog: false,
  });

interface Animal {
  track: AnimalTrack;
  root: THREE.Object3D;
  body: THREE.Object3D;
  tail: THREE.Object3D | null;
  neck: THREE.Object3D | null;
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
  private plates = new Map<string, Promise<{ plate: THREE.Texture; depth: THREE.Texture }>>();
  private loadedPlates = new Map<string, { plate: THREE.Texture; depth: THREE.Texture }>();
  private background = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), plateMaterial());
  private hemi = new THREE.HemisphereLight();
  private fog = new THREE.FogExp2('#9a9c94', 0.004);
  /** Animals per scenario (index into the list given to setScenarios). */
  private herds: { group: THREE.Group; animals: Animal[]; scenario: HuntScenario }[] = [];
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
    this.background.frustumCulled = false;
    this.background.renderOrder = -1;
    this.scene.add(this.hemi, sun, this.camera, this.background);
  }

  /** A map's ground (loaded once, kept) — only for where the boars put their feet. */
  loadMap(map: MapId) {
    if (!this.maps.has(map))
      this.maps.set(
        map,
        glb(`${map}/lane.glb`).then((lane) => {
          let ground: THREE.Mesh | null = null;
          lane.traverse((o) => {
            if ((o as THREE.Mesh).isMesh) ground = o as THREE.Mesh;
          });
          const ms = { ground };
          this.loadedMaps.set(map, ms);
          return ms;
        }),
      );
    return this.maps.get(map)!;
  }

  /** Photo plate + depth of one stand in the current format (cached). */
  private plateOf(map: MapId, stand: number) {
    const key = `${map}/${stand + 1}_${this.format}`;
    if (!this.plates.has(key)) {
      const load = (file: string) =>
        new THREE.TextureLoader().loadAsync(url(`${map}/${file}`)).then((t) => {
          t.colorSpace = THREE.NoColorSpace;
          t.generateMipmaps = false;
          t.minFilter = t.magFilter = file.startsWith('depth') ? THREE.NearestFilter : THREE.LinearFilter;
          return t;
        });
      const p = Promise.all([load(`plate_${stand + 1}_${this.format}.jpg`), load(`depth_${stand + 1}_${this.format}.png`)]).then(([plate, depth]) => {
        this.loadedPlates.set(key, { plate, depth });
        return { plate, depth };
      });
      this.plates.set(key, p);
    }
    return this.plates.get(key)!;
  }

  setSize(w: number, h: number) {
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / h;
    this.format = w >= h ? '16x9' : '9x16';
    const hfov = (HFOV[this.format] * Math.PI) / 180;
    this.camera.fov = (2 * Math.atan(Math.tan(hfov / 2) / this.camera.aspect) * 180) / Math.PI;
    this.camera.updateProjectionMatrix();
  }

  /** Builds every scenario's animals (and loads their maps; boar models on first use). */
  async setScenarios(list: HuntScenario[]) {
    await Promise.all([...new Set(list.map((s) => s.map))].map((m) => this.loadMap(m)));
    await Promise.all(list.map((s) => this.plateOf(s.map, s.stand).catch(() => null)));
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
        return { track, root: boarNode, body, tail: node(root, 'tail'), neck: node(root, 'neck'), legs, bodyY: body.position.y, ground: new Map() };
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
    if (this.current !== map) {
      const look = LOOK[map];
      this.fog.color.set(look.fog);
      this.fog.density = look.density;
      this.hemi.color.set(look.sky);
      this.hemi.groundColor.set(look.ground);
      this.hemi.intensity = look.hemi;
      this.renderer.toneMappingExposure = look.exposure;
      this.current = map;
    }
    const plate = this.loadedPlates.get(`${map}/${stand + 1}_${this.format}`);
    const u = (this.background.material as THREE.ShaderMaterial).uniforms;
    this.background.visible = !!plate;
    if (plate) {
      u.plate.value = plate.plate;
      u.depthTex.value = plate.depth;
      u.near.value = this.camera.near;
      u.far.value = this.camera.far;
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
      a.root.rotation.set(0, p.heading, 0);
      // Blender rotation about +Y = three.js rotation about −Z
      a.body.position.y = a.bodyY + p.body.bob;
      a.body.rotation.set(p.body.rx, 0, -p.body.ry);
      if (a.tail) a.tail.rotation.set(p.tail.rx, 0, -p.tail.ry);
      if (a.neck) a.neck.rotation.set(0, 0, -p.neck);
      for (const k of ['FL', 'FR', 'HL', 'HR'] as const) {
        a.legs[k].up.rotation.set(0, 0, -p.legs[k].up);
        a.legs[k].lo.rotation.set(0, 0, -p.legs[k].lo);
      }
    }
  }

  private groundAt(a: Animal, ground: THREE.Mesh | null, x: number, y: number) {
    const key = Math.round(x * 4) * 4096 + Math.round(y * 4);
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
