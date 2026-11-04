import * as THREE from '../vendor/three.module.min.js';

/* ------------------------------------------------------------------
   Verdant Hollow — a small first-person forest walk.
   Everything (terrain, trees, rocks, water, sky, audio) is generated
   procedurally so the world stays self-contained and lightweight.
------------------------------------------------------------------- */

const $ = (id) => document.getElementById(id);
const TAU = Math.PI * 2;
const clamp = (v, min, max) => Math.min(max, Math.max(min, v));
const lerp = (a, b, t) => a + (b - a) * t;
const smoothstep = (a, b, v) => {
  const t = clamp((v - a) / (b - a), 0, 1);
  return t * t * (3 - 2 * t);
};
const damp = (current, target, lambda, dt) => lerp(current, target, 1 - Math.exp(-lambda * dt));

const isTouch = window.matchMedia('(pointer: coarse)').matches
  || navigator.maxTouchPoints > 0
  || window.innerWidth <= 820;
document.body.classList.toggle('is-touch', isTouch);

/* ---------------------------- Noise ---------------------------- */

const fract = (x) => x - Math.floor(x);
const hash = (x, z) => fract(Math.sin(x * 127.1 + z * 311.7) * 43758.5453123);

function valueNoise(x, z) {
  const xi = Math.floor(x), zi = Math.floor(z);
  const xf = x - xi, zf = z - zi;
  const u = xf * xf * (3 - 2 * xf);
  const v = zf * zf * (3 - 2 * zf);
  const a = hash(xi, zi), b = hash(xi + 1, zi);
  const c = hash(xi, zi + 1), d = hash(xi + 1, zi + 1);
  return lerp(lerp(a, b, u), lerp(c, d, u), v);
}

function fbm(x, z, octaves = 4) {
  let sum = 0, amp = 0.5, freq = 1;
  for (let i = 0; i < octaves; i++) {
    sum += valueNoise(x * freq, z * freq) * amp;
    freq *= 2.03;
    amp *= 0.5;
  }
  return sum;
}

function mulberry32(seed) {
  let a = seed >>> 0;
  return function () {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/* --------------------------- Terrain --------------------------- */

const WORLD_RADIUS = 148;
const TERRAIN_SIZE = 344;
const WATER_LEVEL = -2.52;
const GIANT_TREE = { x: -44, z: -42 };
const SPAWN = { x: 1, z: 68 };
const RIVER_HALF_WIDTH = 3.9;

/* Four connected basins and one long river make the hollow feel like a
   landscape rather than a clearing. Their water shares one shader family. */
const POND = { x: -38, z: 12, r: 15.5, depth: 7.2, basin: 11.0 };
const LAKES = [
  POND,
  { x: 66, z: -64, r: 19.5, depth: 8.4, basin: 13.4 },
  { x: -91, z: 60, r: 16.5, depth: 7.8, basin: 11.7 },
  { x: -119, z: -113, r: 21.0, depth: 9.0, basin: 14.5 }
];

const riverPoints = [
  [-139, 136], [-128, 118], [-121, 98], [-114, 78], [-110, 58],
  [-112, 38], [-106, 18], [-99, -2], [-96, -24], [-100, -46],
  [-108, -68], [-114, -88], [-119, -94]
].map(([x, z]) => new THREE.Vector3(x, 0, z));
const riverCurve = new THREE.CatmullRomCurve3(riverPoints, false, 'catmullrom', 0.35);

function sampleCurve(curve, count) {
  const points = [];
  for (let i = 0; i <= count; i++) points.push(curve.getPointAt(i / count));
  return points;
}

const riverSamples = sampleCurve(riverCurve, 96);

function distanceToRiver(x, z) {
  let best = Infinity;
  for (let i = 0; i < riverSamples.length; i++) {
    const p = riverSamples[i];
    const dx = x - p.x, dz = z - p.z;
    const d = dx * dx + dz * dz;
    if (d < best) best = d;
  }
  return Math.sqrt(best);
}

function lakeClearance(x, z) {
  let best = Infinity;
  for (const body of LAKES) {
    const clearance = Math.hypot(x - body.x, z - body.z) - body.r;
    if (clearance < best) best = clearance;
  }
  return best;
}

function terrainHeight(x, z) {
  let h = (fbm(x * 0.017 + 10, z * 0.017 - 4) - 0.5) * 9.2;
  h += (fbm(x * 0.065 - 3, z * 0.065 + 8) - 0.5) * 2.15;
  h += (fbm(x * 0.22, z * 0.22) - 0.5) * 0.42;
  const rim = Math.hypot(x, z);
  h += Math.max(0, rim - 108) * 0.18;

  for (const body of LAKES) {
    const dx = x - body.x, dz = z - body.z;
    h -= Math.exp(-(dx * dx + dz * dz) / (2 * body.basin * body.basin)) * body.depth;
  }

  const riverDist = distanceToRiver(x, z);
  h -= (1 - smoothstep(RIVER_HALF_WIDTH + 0.7, RIVER_HALF_WIDTH + 9.5, riverDist)) * 7.1;

  const elderDist = Math.hypot(x - GIANT_TREE.x, z - GIANT_TREE.z);
  h += Math.exp(-(elderDist * elderDist) / (2 * 15 * 15)) * 0.7;
  return h;
}

const mainPathPoints = [
  [0, 126], [0.5, 112], [0, 98], [0.5, 84], [0.5, 73], [-1, 62], [1.4, 52], [-2.2, 41], [0.8, 31],
  [-2.8, 22], [1.2, 14], [6.2, 5], [7.1, -5], [2.4, -15], [-4.8, -25],
  [-8.6, -36], [-3.6, -48], [3.4, -58], [8.2, -69], [4.1, -82], [0, -91],
  [-3.2, -105], [1.4, -119], [-1.8, -134]
].map(([x, z]) => new THREE.Vector3(x, 0, z));

const sidePathPoints = [
  [-2.4, 22.5], [-9, 21.8], [-16, 20.2], [-20.2, 19.1], [-23, 17.5],
  [-32, 18], [-42, 22], [-52, 28], [-62, 34], [-73, 42]
].map(([x, z]) => new THREE.Vector3(x, 0, z));

const eastPathPoints = [
  [-4.8, -25], [8, -28], [21, -35], [33, -44], [43, -51], [51, -55]
].map(([x, z]) => new THREE.Vector3(x, 0, z));

const mainPathCurve = new THREE.CatmullRomCurve3(mainPathPoints, false, 'catmullrom', 0.45);
const sidePathCurve = new THREE.CatmullRomCurve3(sidePathPoints, false, 'catmullrom', 0.4);
const eastPathCurve = new THREE.CatmullRomCurve3(eastPathPoints, false, 'catmullrom', 0.4);

const mainPathSamples = sampleCurve(mainPathCurve, 390);
const sidePathSamples = sampleCurve(sidePathCurve, 105);
const eastPathSamples = sampleCurve(eastPathCurve, 90);
const allPathSamples = [...mainPathSamples, ...sidePathSamples, ...eastPathSamples];

function distanceToPath(x, z) {
  let best = Infinity;
  for (let i = 0; i < allPathSamples.length; i++) {
    const p = allPathSamples[i];
    const dx = x - p.x, dz = z - p.z;
    const d = dx * dx + dz * dz;
    if (d < best) best = d;
  }
  return Math.sqrt(best);
}

function distanceToPond(x, z) {
  return Math.hypot(x - POND.x, z - POND.z);
}

function isWaterAt(x, z, ground = terrainHeight(x, z)) {
  if (ground > WATER_LEVEL - 0.15) return false;
  if (lakeClearance(x, z) < 1.2) return true;
  return distanceToRiver(x, z) < RIVER_HALF_WIDTH + 1.6;
}

/* ---------------------------- DOM ------------------------------ */

const canvas = $('scene');
const startScreen = $('startScreen');
const settingsPanel = $('settingsPanel');
const warningCard = $('warningModal');
const qualityState = $('qualityState');
const qualityButtons = [...document.querySelectorAll('.quality-option')];
const soundToggle = $('soundToggle');
const sensitivityInput = $('sensitivity');
const sensitivityValue = $('sensitivityValue');
const toastEl = $('toast');
const regionBanner = $('regionBanner');
const regionName = $('regionName');
const compassTicks = $('compassTicks');
const compassLetter = $('compassLetter');
const compassDeg = $('compassDeg');
const itemSlot = $('blunderbussSlot');
const itemState = $('itemState');
const itemSwitch = $('itemSwitch');
const itemProgress = $('itemProgress');
const fireBtn = $('fireBtn');

/* --------------------------- Renderer -------------------------- */

let renderer;
try {
  renderer = new THREE.WebGLRenderer({
    canvas,
    antialias: true,
    powerPreference: 'high-performance',
    stencil: false
  });
} catch (error) {
  document.body.classList.add('no-webgl');
  throw error;
}

renderer.setSize(window.innerWidth, window.innerHeight);
renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.5));
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.26;
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;

const scene = new THREE.Scene();
scene.background = new THREE.Color(0xc3b596);
scene.fog = new THREE.FogExp2(0xc3b596, 0.0107);

const camera = new THREE.PerspectiveCamera(68, window.innerWidth / window.innerHeight, 0.08, 300);
camera.rotation.order = 'YXZ';
scene.add(camera);

const clock = new THREE.Clock();
const windUniform = { value: 0 };

/* Sun direction points from the world toward the sun. */
const sunDir = new THREE.Vector3(-0.52, 0.47, -0.4).normalize();
const sunColor = new THREE.Color(0xffe0b0);

/* ----------------------------- Sky ----------------------------- */

const skyUniforms = {
  topColor: { value: new THREE.Color(0x4e7396) },
  horizonColor: { value: new THREE.Color(0xf6cd94) },
  sunColor: { value: new THREE.Color(0xffe6b8) },
  sunDir: { value: sunDir.clone() }
};

const sky = new THREE.Mesh(
  new THREE.SphereGeometry(185, 36, 20),
  new THREE.ShaderMaterial({
    uniforms: skyUniforms,
    side: THREE.BackSide,
    depthWrite: false,
    fog: false,
    vertexShader: /* glsl */`
      varying vec3 vDir;
      void main() {
        vDir = normalize(position);
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }
    `,
    fragmentShader: /* glsl */`
      uniform vec3 topColor;
      uniform vec3 horizonColor;
      uniform vec3 sunColor;
      uniform vec3 sunDir;
      varying vec3 vDir;

      void main() {
        vec3 dir = normalize(vDir);
        float h = dir.y;
        vec3 col = mix(horizonColor, topColor, smoothstep(-0.06, 0.66, h));
        float sun = max(dot(dir, normalize(sunDir)), 0.0);
        col += sunColor * pow(sun, 240.0) * 1.9;
        col += sunColor * pow(sun, 7.0) * 0.17;
        col = mix(col, horizonColor, smoothstep(0.28, -0.03, h) * 0.5);

        float bands = sin(dir.x * 7.0 + sin(dir.z * 5.2 + 1.7) * 2.2) * 0.5 + 0.5;
        float clouds = smoothstep(0.74, 0.98, bands)
          * smoothstep(0.01, 0.3, h)
          * (1.0 - smoothstep(0.52, 0.92, h));
        col += vec3(1.0, 0.91, 0.8) * clouds * 0.055;

        gl_FragColor = vec4(col, 1.0);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
      }
    `
  })
);
sky.frustumCulled = false;
sky.renderOrder = -1000;
scene.add(sky);

/* Sun disc + soft bloom */
function radialTexture(size = 256, inner = 'rgba(255,255,255,1)', outer = 'rgba(255,255,255,0)') {
  const c = document.createElement('canvas');
  c.width = c.height = size;
  const ctx = c.getContext('2d');
  const g = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
  g.addColorStop(0, inner);
  g.addColorStop(0.16, 'rgba(255,243,209,0.95)');
  g.addColorStop(0.42, 'rgba(255,219,157,0.28)');
  g.addColorStop(1, outer);
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, size, size);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}
const sunTexture = radialTexture(256);
const sunSprite = new THREE.Sprite(new THREE.SpriteMaterial({
  map: sunTexture,
  color: 0xffdfaa,
  transparent: true,
  opacity: 0.82,
  blending: THREE.AdditiveBlending,
  depthWrite: false,
  fog: false,
  toneMapped: false
}));
sunSprite.scale.setScalar(52);
sunSprite.renderOrder = -900;
scene.add(sunSprite);

/* ---------------------------- Lights --------------------------- */

const hemi = new THREE.HemisphereLight(0xd7e5ec, 0x56623a, 1.08);
scene.add(hemi);

const ambient = new THREE.AmbientLight(0xb2c18c, 0.38);
scene.add(ambient);

const sun = new THREE.DirectionalLight(0xffd9a4, 2.9);
sun.position.copy(sunDir).multiplyScalar(70);
sun.castShadow = true;
sun.shadow.mapSize.set(isTouch ? 1024 : 2048, isTouch ? 1024 : 2048);
sun.shadow.camera.left = -42;
sun.shadow.camera.right = 42;
sun.shadow.camera.top = 42;
sun.shadow.camera.bottom = -42;
sun.shadow.camera.near = 2;
sun.shadow.camera.far = 155;
sun.shadow.bias = -0.00045;
sun.shadow.normalBias = 0.035;
scene.add(sun);
scene.add(sun.target);

/* --------------------------- Materials ------------------------- */

const terrainMaterial = new THREE.MeshStandardMaterial({
  vertexColors: true,
  roughness: 0.97,
  metalness: 0,
  dithering: true
});

const barkMaterial = new THREE.MeshStandardMaterial({
  color: 0xffffff,
  roughness: 0.94,
  metalness: 0,
  flatShading: true
});

const leafMaterial = new THREE.MeshStandardMaterial({
  color: 0xffffff,
  roughness: 0.88,
  metalness: 0,
  flatShading: true
});

const pineMaterial = new THREE.MeshStandardMaterial({
  color: 0xffffff,
  roughness: 0.9,
  metalness: 0,
  flatShading: true,
  side: THREE.DoubleSide
});

const rockMaterial = new THREE.MeshStandardMaterial({
  color: 0xffffff,
  roughness: 0.96,
  metalness: 0.01,
  flatShading: true
});

/* --------------------------- Terrain --------------------------- */

function buildTerrain() {
  const segments = isTouch ? 160 : 204;
  const geometry = new THREE.PlaneGeometry(TERRAIN_SIZE, TERRAIN_SIZE, segments, segments);
  geometry.rotateX(-Math.PI / 2);
  const pos = geometry.attributes.position;
  const colors = new Float32Array(pos.count * 3);

  const mossA = new THREE.Color(0x4c6c34);
  const mossB = new THREE.Color(0x5d7e40);
  const mossC = new THREE.Color(0x749553);
  const dirt = new THREE.Color(0x8a6c47);
  const dirtDark = new THREE.Color(0x725637);
  const sand = new THREE.Color(0x97845c);
  const wet = new THREE.Color(0x465c45);
  const color = new THREE.Color();

  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i);
    const z = pos.getZ(i);
    const y = terrainHeight(x, z);
    pos.setY(i, y);

    const n = fbm(x * 0.12 + 4, z * 0.12 - 7, 3);
    const fine = fbm(x * 0.62 - 2, z * 0.62 + 3, 2);
    color.copy(mossA).lerp(mossB, n).lerp(mossC, Math.max(0, fine - 0.52) * 0.9);

    const pathDist = distanceToPath(x, z);
    if (pathDist < 5.2) {
      const blend = 1 - smoothstep(2.0, 5.2, pathDist);
      color.lerp(hash(x * 3.1, z * 2.7) > 0.55 ? dirt : dirtDark, blend * 0.92);
    }

    let shore = 0;
    let wetness = 0;
    for (const body of LAKES) {
      const d = Math.hypot(x - body.x, z - body.z);
      shore = Math.max(shore, 1 - smoothstep(body.r - 1.2, body.r + 8.5, d));
      wetness = Math.max(wetness, 1 - smoothstep(body.r - 1.6, body.r + 1.5, d));
    }
    const riverDist = distanceToRiver(x, z);
    shore = Math.max(shore, 1 - smoothstep(RIVER_HALF_WIDTH, RIVER_HALF_WIDTH + 7.5, riverDist));
    wetness = Math.max(wetness, 1 - smoothstep(RIVER_HALF_WIDTH - 0.8, RIVER_HALF_WIDTH + 1.5, riverDist));
    color.lerp(sand, shore * 0.56);
    if (wetness > 0) color.lerp(wet, wetness * 0.48);

    if (y > 4.2) {
      const rocky = smoothstep(4.2, 8.5, y);
      color.lerp(new THREE.Color(0x6d6c58), rocky * 0.36);
    }

    color.offsetHSL(0, 0, (hash(x * 1.9, z * 1.7) - 0.5) * 0.032);
    colors[i * 3] = color.r;
    colors[i * 3 + 1] = color.g;
    colors[i * 3 + 2] = color.b;
  }

  geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  geometry.computeVertexNormals();

  const mesh = new THREE.Mesh(geometry, terrainMaterial);
  mesh.receiveShadow = true;
  scene.add(mesh);
  return mesh;
}

const terrain = buildTerrain();

/* ------------------------- Path ribbons ------------------------ */

function buildPathRibbon(curve, options) {
  const { width = 2.1, segments = 260, baseColor = 0x876641, edgeColor = 0x6d5236 } = options;
  const positions = [];
  const colors = [];
  const uvs = [];
  const indices = [];
  const color = new THREE.Color();
  const cA = new THREE.Color(baseColor);
  const cB = new THREE.Color(edgeColor);

  for (let i = 0; i <= segments; i++) {
    const t = i / segments;
    const p = curve.getPointAt(t);
    const tangent = curve.getTangentAt(t);
    const nx = -tangent.z;
    const nz = tangent.x;
    const wobble = Math.sin(t * 41.3) * 0.18 + Math.sin(t * 13.7 + 1.4) * 0.22;
    const w = width * (0.9 + wobble);
    const lx = p.x + nx * w, lz = p.z + nz * w;
    const rx = p.x - nx * w, rz = p.z - nz * w;
    const ly = terrainHeight(lx, lz) + 0.035;
    const ry = terrainHeight(rx, rz) + 0.035;

    positions.push(lx, ly, lz, rx, ry, rz);
    uvs.push(0, t * 22, 1, t * 22);

    color.copy(cA).lerp(cB, 0.25 + hash(i * 0.73, 2.2) * 0.5);
    colors.push(color.r, color.g, color.b);
    color.copy(cA).lerp(cB, 0.35 + hash(i * 0.41, 8.2) * 0.5);
    colors.push(color.r, color.g, color.b);

    if (i < segments) {
      const a = i * 2, b = i * 2 + 1, c = i * 2 + 2, d = i * 2 + 3;
      indices.push(a, c, b, b, c, d);
    }
  }

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
  geometry.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  geometry.setIndex(indices);
  geometry.computeVertexNormals();

  const material = new THREE.MeshStandardMaterial({
    vertexColors: true,
    roughness: 1,
    metalness: 0,
    polygonOffset: true,
    polygonOffsetFactor: -1.5,
    polygonOffsetUnits: -1.5
  });
  const mesh = new THREE.Mesh(geometry, material);
  mesh.receiveShadow = true;
  scene.add(mesh);
  return mesh;
}

buildPathRibbon(mainPathCurve, { width: 2.15, segments: 380 });
buildPathRibbon(sidePathCurve, { width: 1.15, segments: 110, baseColor: 0x7d603e });
buildPathRibbon(eastPathCurve, { width: 1.08, segments: 95, baseColor: 0x7b5e3d });

/* --------------------------- Water ----------------------------- */

const lakeVertexShader = /* glsl */`
  #include <common>
  #include <fog_pars_vertex>
  varying vec3 vWorld;
  void main() {
    vec4 worldPosition = modelMatrix * vec4(position, 1.0);
    vWorld = worldPosition.xyz;
    vec4 mvPosition = viewMatrix * worldPosition;
    gl_Position = projectionMatrix * mvPosition;
    #include <fog_vertex>
  }
`;

const lakeFragmentShader = /* glsl */`
  #include <common>
  #include <fog_pars_fragment>
  uniform float uTime;
  uniform vec2 uCenter;
  uniform float uRadius;
  uniform vec3 uSunDir;
  uniform vec3 uDeep;
  uniform vec3 uShallow;
  uniform vec3 uSky;
  uniform vec3 uSunColor;
  varying vec3 vWorld;

  void main() {
    vec2 p = vWorld.xz;
    float ripple =
      sin(p.x * 1.35 + uTime * 0.8) * 0.5 +
      sin(p.y * 1.9 - uTime * 0.62) * 0.36 +
      sin((p.x + p.y) * 0.7 + uTime * 0.34) * 0.24;
    float ripple2 = cos(p.x * 2.8 - uTime * 0.9) * sin(p.y * 2.1 + uTime * 0.7);

    vec3 n = normalize(vec3(ripple * 0.026 + ripple2 * 0.012, 1.0, ripple * 0.022));
    vec3 viewDir = normalize(cameraPosition - vWorld);
    float fres = pow(1.0 - clamp(dot(n, viewDir), 0.0, 1.0), 3.2);

    float d = distance(p, uCenter);
    float depthMix = smoothstep(0.0, uRadius * 0.86, d);
    vec3 col = mix(uDeep, uShallow, depthMix * 0.7 + 0.18);
    col = mix(col, uSky, fres * 0.58);

    float spec = pow(max(dot(reflect(normalize(-uSunDir), n), viewDir), 0.0), 110.0);
    col += uSunColor * spec * 1.35;

    float shoreFoam = smoothstep(uRadius * 0.91, uRadius * 1.01, d);
    col += vec3(0.28, 0.3, 0.24) * shoreFoam * 0.22;

    gl_FragColor = vec4(col, 0.88);
    #include <tonemapping_fragment>
    #include <colorspace_fragment>
    #include <fog_fragment>
  }
`;

const riverFragmentShader = /* glsl */`
  #include <common>
  #include <fog_pars_fragment>
  uniform float uTime;
  uniform vec3 uSunDir;
  uniform vec3 uDeep;
  uniform vec3 uShallow;
  uniform vec3 uSky;
  uniform vec3 uSunColor;
  varying vec3 vWorld;
  varying vec2 vUv;

  void main() {
    vec2 p = vWorld.xz;
    float edge = abs(vUv.x - 0.5) * 2.0;
    float flow = sin(vUv.y * 37.0 - uTime * 2.15 + sin(vUv.x * 9.0 + uTime * 0.4) * 1.4);
    float flow2 = cos(vUv.y * 17.0 - uTime * 1.35 + vUv.x * 5.0);
    float ripple = sin(p.x * 2.4 + uTime) * 0.5 + sin(p.y * 3.8 - uTime * 0.8) * 0.35;

    vec3 n = normalize(vec3(ripple * 0.018 + flow * 0.012, 1.0, ripple * 0.016 + flow2 * 0.01));
    vec3 viewDir = normalize(cameraPosition - vWorld);
    float fres = pow(1.0 - clamp(dot(n, viewDir), 0.0, 1.0), 3.0);

    vec3 col = mix(uDeep, uShallow, 0.3 + (1.0 - edge) * 0.36);
    col = mix(col, uSky, fres * 0.54);

    float spec = pow(max(dot(reflect(normalize(-uSunDir), n), viewDir), 0.0), 95.0);
    col += uSunColor * spec * 1.25;

    float bankFoam = smoothstep(0.78, 1.0, edge);
    col += vec3(0.3, 0.32, 0.26) * bankFoam * (0.2 + 0.1 * flow);

    gl_FragColor = vec4(col, 0.9);
    #include <tonemapping_fragment>
    #include <colorspace_fragment>
    #include <fog_fragment>
  }
`;

function buildWaterBody(body) {
  const uniforms = THREE.UniformsUtils.merge([
    THREE.UniformsLib.fog,
    {
      uTime: { value: 0 },
      uCenter: { value: new THREE.Vector2(body.x, body.z) },
      uRadius: { value: body.r },
      uSunDir: { value: sunDir.clone() },
      uDeep: { value: new THREE.Color(0x214a3c) },
      uShallow: { value: new THREE.Color(0x4c7057) },
      uSky: { value: new THREE.Color(0xc7b38d) },
      uSunColor: { value: new THREE.Color(0xffe0a7) }
    }
  ]);

  const material = new THREE.ShaderMaterial({
    uniforms,
    transparent: true,
    fog: true,
    depthWrite: true,
    side: THREE.DoubleSide,
    vertexShader: lakeVertexShader,
    fragmentShader: lakeFragmentShader
  });

  const mesh = new THREE.Mesh(new THREE.CircleGeometry(body.r - 0.08, isTouch ? 54 : 82), material);
  mesh.rotation.x = -Math.PI / 2;
  mesh.position.set(body.x, WATER_LEVEL, body.z);
  mesh.renderOrder = 2;
  scene.add(mesh);

  return { mesh, uniforms };
}

function buildRiverWater() {
  const uniforms = THREE.UniformsUtils.merge([
    THREE.UniformsLib.fog,
    {
      uTime: { value: 0 },
      uSunDir: { value: sunDir.clone() },
      uDeep: { value: new THREE.Color(0x1c4034) },
      uShallow: { value: new THREE.Color(0x54755a) },
      uSky: { value: new THREE.Color(0xc7b38d) },
      uSunColor: { value: new THREE.Color(0xffe0a7) }
    }
  ]);

  const material = new THREE.ShaderMaterial({
    uniforms,
    transparent: true,
    fog: true,
    depthWrite: true,
    side: THREE.DoubleSide,
    vertexShader: /* glsl */`
      #include <common>
      #include <fog_pars_vertex>
      varying vec3 vWorld;
      varying vec2 vUv;
      void main() {
        vUv = uv;
        vec4 worldPosition = modelMatrix * vec4(position, 1.0);
        vWorld = worldPosition.xyz;
        vec4 mvPosition = viewMatrix * worldPosition;
        gl_Position = projectionMatrix * mvPosition;
        #include <fog_vertex>
      }
    `,
    fragmentShader: riverFragmentShader
  });

  const segments = 250;
  const positions = [];
  const uvs = [];
  const indices = [];
  for (let i = 0; i <= segments; i++) {
    const t = i / segments;
    const p = riverCurve.getPointAt(t);
    const tangent = riverCurve.getTangentAt(t);
    const nx = -tangent.z;
    const nz = tangent.x;
    const wobble = 1 + Math.sin(t * 35.0) * 0.08 + Math.sin(t * 13.0 + 2.0) * 0.06;
    const half = RIVER_HALF_WIDTH * wobble;
    positions.push(
      p.x + nx * half, WATER_LEVEL + 0.018, p.z + nz * half,
      p.x - nx * half, WATER_LEVEL + 0.018, p.z - nz * half
    );
    uvs.push(0, t * 56, 1, t * 56);
    if (i < segments) {
      const a = i * 2;
      indices.push(a, a + 2, a + 1, a + 1, a + 2, a + 3);
    }
  }

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  geometry.setIndex(indices);
  const mesh = new THREE.Mesh(geometry, material);
  mesh.renderOrder = 3;
  scene.add(mesh);
  return { mesh, uniforms };
}

const lakeWaters = LAKES.map(buildWaterBody);
const riverWater = buildRiverWater();
const waterSurfaces = [...lakeWaters, riverWater];

/* Lily pads */
function buildLilyPads() {
  const rng = mulberry32(2391);
  const geometry = new THREE.CircleGeometry(0.46, 9);
  geometry.rotateX(-Math.PI / 2);
  const material = new THREE.MeshStandardMaterial({ color: 0x4e6d3a, roughness: 0.8, side: THREE.DoubleSide });
  const count = isTouch ? 30 : 48;
  const mesh = new THREE.InstancedMesh(geometry, material, count);
  const matrix = new THREE.Matrix4();
  const quat = new THREE.Quaternion();
  const scale = new THREE.Vector3();
  const pos = new THREE.Vector3();
  const color = new THREE.Color();
  for (let i = 0; i < count; i++) {
    const body = LAKES[Math.floor(rng() * LAKES.length)];
    const a = rng() * TAU;
    const r = 2 + rng() * Math.max(1, body.r - 3.4);
    pos.set(body.x + Math.cos(a) * r, WATER_LEVEL + 0.035, body.z + Math.sin(a) * r);
    quat.setFromAxisAngle(new THREE.Vector3(0, 1, 0), rng() * TAU);
    const s = 0.55 + rng() * 0.8;
    scale.set(s, 1, s);
    matrix.compose(pos, quat, scale);
    mesh.setMatrixAt(i, matrix);
    color.setHSL(0.24 + rng() * 0.06, 0.35, 0.28 + rng() * 0.1);
    mesh.setColorAt(i, color);
  }
  mesh.instanceMatrix.needsUpdate = true;
  scene.add(mesh);
  return mesh;
}
const lilyPads = buildLilyPads();

/* --------------------------- Trees ----------------------------- */

const treeColliders = [];
const treeGrid = new Map();
const TREE_CELL = 4.6;

function gridKey(x, z) {
  return `${Math.floor(x / TREE_CELL)},${Math.floor(z / TREE_CELL)}`;
}

function canPlaceTree(x, z) {
  if (Math.hypot(x, z) > WORLD_RADIUS + 4) return false;
  if (distanceToPath(x, z) < 5.2) return false;
  if (lakeClearance(x, z) < 2.6) return false;
  if (distanceToRiver(x, z) < RIVER_HALF_WIDTH + 2.8) return false;
  if (Math.hypot(x - GIANT_TREE.x, z - GIANT_TREE.z) < 14.5) return false;
  if (Math.hypot(x - SPAWN.x, z - SPAWN.z) < 8.5) return false;
  const cx = Math.floor(x / TREE_CELL), cz = Math.floor(z / TREE_CELL);
  for (let ox = -1; ox <= 1; ox++) {
    for (let oz = -1; oz <= 1; oz++) {
      const cell = treeGrid.get(`${cx + ox},${cz + oz}`);
      if (!cell) continue;
      for (const tree of cell) {
        const dx = x - tree.x, dz = z - tree.z;
        if (dx * dx + dz * dz < 7.0) return false;
      }
    }
  }
  return true;
}

function addTreeToGrid(tree) {
  const key = gridKey(tree.x, tree.z);
  if (!treeGrid.has(key)) treeGrid.set(key, []);
  treeGrid.get(key).push(tree);
}

const treePalettes = [
  [0x577a44, 0x66894d, 0x769a57, 0x4c6d3d],
  [0x608747, 0x719751, 0x82a85e, 0x537541],
  [0x4d7442, 0x5c8249, 0x6b9155, 0x43663c]
];
const autumnPalette = [0xa78643, 0xb9974f, 0x8c7238, 0xc3a35b];

function buildForest() {
  const rng = mulberry32(41723);
  const trees = [];
  let attempts = 0;
  const targetTrees = isTouch ? 760 : 1180;

  while (trees.length < targetTrees && attempts < 26000) {
    attempts++;
    const a = rng() * TAU;
    const r = Math.sqrt(rng()) * (WORLD_RADIUS + 3);
    const x = Math.cos(a) * r;
    const z = Math.sin(a) * r;
    if (!canPlaceTree(x, z)) continue;

    const roll = rng();
    const type = roll < 0.69 ? 'broadleaf' : (roll < 0.9 ? 'pine' : 'birch');
    const scale = 0.82 + rng() * 0.5;
    const height = (type === 'pine' ? 10.5 + rng() * 6 : 8.4 + rng() * 5.2) * scale;
    const trunkRadius = (type === 'pine' ? 0.26 : type === 'birch' ? 0.17 : 0.24) * scale;

    const palette = rng() < 0.11 ? autumnPalette : treePalettes[Math.floor(rng() * treePalettes.length)];
    const color = new THREE.Color(palette[Math.floor(rng() * palette.length)]);
    color.offsetHSL((rng() - 0.5) * 0.025, (rng() - 0.5) * 0.06, (rng() - 0.5) * 0.06);

    const tree = {
      x, z, type, height, trunkRadius,
      ground: terrainHeight(x, z),
      yaw: rng() * TAU,
      color,
      canopyScale: 0.8 + rng() * 0.45,
      leanX: (rng() - 0.5) * 0.035,
      leanZ: (rng() - 0.5) * 0.035,
      rngSeed: rng() * 100
    };

    trees.push(tree);
    addTreeToGrid(tree);
    treeColliders.push({ x, z, r: trunkRadius + 0.36 });
  }

  /* Force a few reassuringly big trees near the start of the path. */
  const heroes = [
    [11.2, 45, 'broadleaf', 1.18], [-11.4, 41, 'broadleaf', 1.1],
    [10.4, 27, 'pine', 1.06], [-14.2, 22, 'birch', 1.04]
  ];
  for (const [x, z, type, scale] of heroes) {
    if (trees.some(t => Math.hypot(t.x - x, t.z - z) < 4)) continue;
    const palette = treePalettes[1];
    const tree = {
      x, z, type,
      height: (type === 'pine' ? 13.5 : 11.2) * scale,
      trunkRadius: (type === 'pine' ? 0.32 : type === 'birch' ? 0.2 : 0.3) * scale,
      ground: terrainHeight(x, z),
      yaw: rng() * TAU,
      color: new THREE.Color(palette[Math.floor(rng() * palette.length)]),
      canopyScale: 1.05 * scale,
      leanX: (rng() - 0.5) * 0.02,
      leanZ: (rng() - 0.5) * 0.02,
      rngSeed: rng() * 100
    };
    trees.push(tree);
    addTreeToGrid(tree);
    treeColliders.push({ x, z, r: tree.trunkRadius + 0.38 });
  }

  const trunkGeo = new THREE.CylinderGeometry(0.62, 1, 1, 7, 1);
  trunkGeo.translate(0, 0.5, 0);
  const blobGeo = new THREE.DodecahedronGeometry(1, 0);
  const coneGeo = new THREE.ConeGeometry(1, 1, 8, 1);
  coneGeo.translate(0, 0.5, 0);

  const trunkMatrices = [], trunkColors = [];
  const blobMatrices = [], blobColors = [];
  const coneMatrices = [], coneColors = [];

  const matrix = new THREE.Matrix4();
  const quat = new THREE.Quaternion();
  const euler = new THREE.Euler();
  const pos = new THREE.Vector3();
  const scl = new THREE.Vector3();
  const tint = new THREE.Color();

  const pushInstance = (arrM, arrC, position, quaternion, scale, color) => {
    matrix.compose(position, quaternion, scale);
    arrM.push(matrix.clone());
    arrC.push(color.clone());
  };

  for (const tree of trees) {
    const { x, z, ground, height, trunkRadius } = tree;

    euler.set(tree.leanX, tree.yaw, tree.leanZ, 'YXZ');
    quat.setFromEuler(euler);
    pos.set(x, ground - 0.12, z);
    scl.set(trunkRadius, height, trunkRadius);
    if (tree.type === 'birch') tint.set(0xd8d5c4).offsetHSL(0, 0, (hash(x, z) - 0.5) * 0.08);
    else if (tree.type === 'pine') tint.set(0x4d3a28).offsetHSL(0, 0, (hash(x, z) - 0.5) * 0.08);
    else tint.set(0x624a32).offsetHSL(0, 0, (hash(x, z) - 0.5) * 0.09);
    pushInstance(trunkMatrices, trunkColors, pos, quat, scl, tint);

    if (tree.type === 'pine') {
      const layers = 4;
      for (let i = 0; i < layers; i++) {
        const t = i / (layers - 1);
        const baseY = ground + height * (0.17 + t * 0.245);
        const layerH = height * (0.35 - t * 0.045);
        const radius = height * (0.295 - t * 0.058) * tree.canopyScale;
        euler.set(0, tree.yaw + i * 0.9, 0, 'YXZ');
        quat.setFromEuler(euler);
        pos.set(x, baseY, z);
        scl.set(radius, layerH, radius);
        tint.copy(tree.color).offsetHSL(0, 0, t * 0.06 + (hash(x + i, z) - 0.5) * 0.08);
        pushInstance(coneMatrices, coneColors, pos, quat, scl, tint);
      }
    } else {
      const blobs = 6 + (hash(x * 0.7, z * 1.3) > 0.35 ? 1 : 0);
      const canopyRadius = height * 0.285 * tree.canopyScale;
      for (let i = 0; i < blobs; i++) {
        const a = (i / blobs) * TAU + tree.rngSeed;
        const spread = i === 0 ? 0 : canopyRadius * (0.3 + hash(i, tree.rngSeed) * 0.66);
        const bx = x + Math.cos(a) * spread;
        const bz = z + Math.sin(a) * spread;
        const by = ground + height * (0.62 + (i === 0 ? 0.3 : hash(i + 4, tree.rngSeed) * 0.34));
        const s = canopyRadius * (i === 0 ? 0.94 : 0.54 + hash(i + 8, tree.rngSeed) * 0.42);
        euler.set(hash(i, 2.1) * 0.45, hash(i, 4.2) * TAU, hash(i, 6.3) * 0.4, 'YXZ');
        quat.setFromEuler(euler);
        pos.set(bx, by, bz);
        scl.set(s, s * (0.78 + hash(i, 8.4) * 0.42), s);
        tint.copy(tree.color).offsetHSL(
          (hash(i, 1.7) - 0.5) * 0.02,
          (hash(i, 3.1) - 0.5) * 0.06,
          (hash(i, 5.9) - 0.5) * 0.08
        );
        pushInstance(blobMatrices, blobColors, pos, quat, scl, tint);
      }
    }
  }

  const makeInstanced = (geometry, material, matrices, colors, shadows = true) => {
    const mesh = new THREE.InstancedMesh(geometry, material, matrices.length);
    for (let i = 0; i < matrices.length; i++) {
      mesh.setMatrixAt(i, matrices[i]);
      mesh.setColorAt(i, colors[i]);
    }
    mesh.instanceMatrix.needsUpdate = true;
    if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
    mesh.castShadow = shadows;
    mesh.receiveShadow = true;
    mesh.frustumCulled = false;
    scene.add(mesh);
    return mesh;
  };

  const trunks = makeInstanced(trunkGeo, barkMaterial, trunkMatrices, trunkColors, true);
  const blobs = makeInstanced(blobGeo, leafMaterial, blobMatrices, blobColors, true);
  const cones = makeInstanced(coneGeo, pineMaterial, coneMatrices, coneColors, true);

  return { trees, trunks, blobs, cones };
}

const forest = buildForest();
const leafMeshes = [forest.trunks, forest.blobs, forest.cones];

/* -------------------------- Giant tree ------------------------- */

function buildGiantTree() {
  const group = new THREE.Group();
  const ground = terrainHeight(GIANT_TREE.x, GIANT_TREE.z);
  group.position.set(GIANT_TREE.x, ground, GIANT_TREE.z);

  const bark = new THREE.MeshStandardMaterial({ color: 0x503b28, roughness: 0.98, flatShading: true });
  const moss = new THREE.MeshStandardMaterial({ color: 0x4f6839, roughness: 0.96, flatShading: true });
  const leaf = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.88, flatShading: true });

  const trunkGeo = new THREE.CylinderGeometry(1.8, 3.4, 21, 11, 2);
  trunkGeo.translate(0, 10.5, 0);
  const trunk = new THREE.Mesh(trunkGeo, bark);
  trunk.castShadow = true;
  trunk.receiveShadow = true;
  group.add(trunk);

  const rootGeo = new THREE.CylinderGeometry(0.42, 1.1, 9, 6, 1);
  rootGeo.translate(0, 4.5, 0);
  for (let i = 0; i < 8; i++) {
    const a = (i / 8) * TAU + 0.25;
    const root = new THREE.Mesh(rootGeo, i % 3 === 0 ? moss : bark);
    root.position.set(Math.cos(a) * 3.1, 0.4, Math.sin(a) * 3.1);
    root.rotation.order = 'YXZ';
    root.rotation.y = -a;
    root.rotation.z = 1.18;
    root.rotation.x = (hash(i, 3.2) - 0.5) * 0.25;
    root.scale.set(0.8 + hash(i, 1.4) * 0.5, 0.8 + hash(i, 5.1) * 0.4, 0.8);
    root.castShadow = true;
    group.add(root);
  }

  const blobGeo = new THREE.DodecahedronGeometry(1, 1);
  const rng = mulberry32(887);
  for (let i = 0; i < 9; i++) {
    const a = (i / 9) * TAU + 0.4;
    const r = i === 0 ? 0 : 3.4 + rng() * 5.2;
    const blob = new THREE.Mesh(blobGeo, leaf);
    blob.material = leaf.clone();
    blob.material.color.setHSL(0.25 + rng() * 0.025, 0.34 + rng() * 0.12, 0.24 + rng() * 0.11);
    blob.position.set(Math.cos(a) * r, 17.5 + rng() * 7.2, Math.sin(a) * r);
    const s = 4.8 + rng() * 4.6;
    blob.scale.set(s, s * (0.72 + rng() * 0.4), s);
    blob.rotation.set(rng() * 0.5, rng() * TAU, rng() * 0.5);
    blob.castShadow = true;
    blob.receiveShadow = true;
    group.add(blob);
  }

  /* A loose ring of mossy stones. */
  const stoneGeo = new THREE.DodecahedronGeometry(1, 0);
  for (let i = 0; i < 9; i++) {
    const a = (i / 9) * TAU + 0.15;
    const stone = new THREE.Mesh(stoneGeo, i % 2 ? moss : rockMaterial);
    const r = 7.5 + hash(i, 2.8) * 3.2;
    stone.position.set(Math.cos(a) * r, 0.3 + hash(i, 4.1) * 0.3, Math.sin(a) * r);
    const s = 0.7 + hash(i, 6.2) * 1.3;
    stone.scale.set(s * 1.2, s * 0.62, s);
    stone.rotation.set(hash(i, 7.2) * 0.4, hash(i, 8.2) * TAU, hash(i, 9.2) * 0.4);
    stone.castShadow = true;
    stone.receiveShadow = true;
    group.add(stone);
  }

  scene.add(group);
  treeColliders.push({ x: GIANT_TREE.x, z: GIANT_TREE.z, r: 4.1 });
  return group;
}
const giantTree = buildGiantTree();

/* --------------------------- Rocks ----------------------------- */

function buildRocks() {
  const rng = mulberry32(55219);
  const geometry = new THREE.DodecahedronGeometry(1, 0);
  const matrices = [];
  const colors = [];
  const matrix = new THREE.Matrix4();
  const quat = new THREE.Quaternion();
  const euler = new THREE.Euler();
  const pos = new THREE.Vector3();
  const scl = new THREE.Vector3();
  const color = new THREE.Color();
  const grays = [0x6f7166, 0x7b7969, 0x646b5e, 0x85806e, 0x5e665b];
  const mossy = 0x687454;

  let count = 0;
  let attempts = 0;
  while (count < 190 && attempts < 5000) {
    attempts++;
    const a = rng() * TAU;
    const r = Math.sqrt(rng()) * (WORLD_RADIUS + 2);
    const x = Math.cos(a) * r;
    const z = Math.sin(a) * r;
    if (distanceToPath(x, z) < 2.8) continue;
    if (lakeClearance(x, z) < 2.2) continue;
    if (distanceToRiver(x, z) < RIVER_HALF_WIDTH + 2.0) continue;
    if (Math.hypot(x - SPAWN.x, z - SPAWN.z) < 2.5) continue;

    const sx = 0.35 + rng() * 1.85;
    const sy = 0.25 + rng() * 1.15;
    const sz = 0.35 + rng() * 1.85;
    const y = terrainHeight(x, z) + sy * 0.35;
    euler.set(rng() * 0.5, rng() * TAU, rng() * 0.5, 'YXZ');
    quat.setFromEuler(euler);
    pos.set(x, y, z);
    scl.set(sx, sy, sz);
    matrix.compose(pos, quat, scl);
    matrices.push(matrix.clone());
    color.set(rng() < 0.35 ? mossy : grays[Math.floor(rng() * grays.length)]);
    color.offsetHSL(0, (rng() - 0.5) * 0.05, (rng() - 0.5) * 0.06);
    colors.push(color.clone());

    if (sx > 1.05) treeColliders.push({ x, z, r: Math.max(sx, sz) * 0.72 });
    count++;
  }

  const addShoreStone = (x, z, size = 1) => {
    const sx = (0.55 + rng() * 1.4) * size;
    const sy = (0.3 + rng() * 0.8) * size;
    const sz = (0.55 + rng() * 1.4) * size;
    euler.set(rng() * 0.5, rng() * TAU, rng() * 0.5, 'YXZ');
    quat.setFromEuler(euler);
    pos.set(x, terrainHeight(x, z) + sy * 0.25, z);
    scl.set(sx, sy, sz);
    matrix.compose(pos, quat, scl);
    matrices.push(matrix.clone());
    color.set(rng() < 0.5 ? mossy : grays[Math.floor(rng() * grays.length)]);
    colors.push(color.clone());
    if (sx > 1.1) treeColliders.push({ x, z, r: sx * 0.7 });
  };

  /* Shoreline stones for every basin. */
  for (const body of LAKES) {
    const stones = Math.round(body.r * 1.25);
    for (let i = 0; i < stones; i++) {
      const a = (i / stones) * TAU + rng() * 0.2;
      const rr = body.r + 0.1 + rng() * 2.4;
      addShoreStone(body.x + Math.cos(a) * rr, body.z + Math.sin(a) * rr);
    }
  }

  /* A broken line of stones along the riverbank. */
  for (let i = 6; i < riverSamples.length - 6; i += 4) {
    const p = riverSamples[i];
    const tangent = riverCurve.getTangentAt(i / (riverSamples.length - 1));
    const side = (i % 8 === 0 ? 1 : -1);
    const rr = RIVER_HALF_WIDTH + 1.2 + rng() * 2.8;
    addShoreStone(p.x - tangent.z * rr * side, p.z + tangent.x * rr * side, 0.72 + rng() * 0.35);
  }

  const mesh = new THREE.InstancedMesh(geometry, rockMaterial, matrices.length);
  for (let i = 0; i < matrices.length; i++) {
    mesh.setMatrixAt(i, matrices[i]);
    mesh.setColorAt(i, colors[i]);
  }
  mesh.instanceMatrix.needsUpdate = true;
  if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  mesh.frustumCulled = false;
  scene.add(mesh);
  return mesh;
}
const rocks = buildRocks();

/* ------------------------- Fallen logs ------------------------- */

function buildLogs() {
  const rng = mulberry32(6619);
  const group = new THREE.Group();
  const bark = new THREE.MeshStandardMaterial({ color: 0x5a432c, roughness: 0.98, flatShading: true });
  const moss = new THREE.MeshStandardMaterial({ color: 0x526b3a, roughness: 1, flatShading: true });
  const geometry = new THREE.CylinderGeometry(0.36, 0.48, 1, 7, 1);
  geometry.rotateZ(Math.PI / 2);
  const spots = [
    [12, 47], [-15, 33], [18, 8], [-13, -8], [20, -34], [-22, -52], [30, -52], [-9, 70],
    [52, -104], [102, 18], [-58, 92], [-28, -108], [96, -28], [-64, -74]
  ];
  for (const [x, z] of spots) {
    const length = 4 + rng() * 5.5;
    const mesh = new THREE.Mesh(geometry, rng() < 0.35 ? moss : bark);
    const ground = terrainHeight(x, z);
    mesh.position.set(x, ground + 0.38, z);
    mesh.rotation.y = rng() * TAU;
    mesh.scale.set(length, 0.8 + rng() * 0.7, 0.8 + rng() * 0.5);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    group.add(mesh);

    const dx = Math.cos(mesh.rotation.y), dz = -Math.sin(mesh.rotation.y);
    for (let i = -1; i <= 1; i++) {
      treeColliders.push({ x: x + dx * i * length * 0.3, z: z + dz * i * length * 0.3, r: 0.5 });
    }
  }
  scene.add(group);
  return group;
}
const logs = buildLogs();

/* ---------------------- Ground detail -------------------------- */

function makeCanvasTexture(w, h, draw) {
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  const ctx = c.getContext('2d');
  draw(ctx, w, h);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = Math.min(8, renderer.capabilities.getMaxAnisotropy());
  return tex;
}

const grassTexture = makeCanvasTexture(64, 128, (ctx, w, h) => {
  ctx.clearRect(0, 0, w, h);
  const rng = mulberry32(9923);
  for (let i = 0; i < 11; i++) {
    const baseX = 5 + rng() * (w - 10);
    const tipX = baseX + (rng() - 0.5) * 34;
    const tipY = 8 + rng() * 42;
    const width = 1.2 + rng() * 2.4;
    const grad = ctx.createLinearGradient(0, h, 0, tipY);
    grad.addColorStop(0, 'rgba(138,150,112,0.9)');
    grad.addColorStop(0.5, 'rgba(224,236,196,0.96)');
    grad.addColorStop(1, 'rgba(255,255,255,0.92)');
    ctx.strokeStyle = grad;
    ctx.lineWidth = width;
    ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.moveTo(baseX, h);
    ctx.quadraticCurveTo(baseX + (tipX - baseX) * 0.2, h * 0.55, tipX, tipY);
    ctx.stroke();
  }
});

const fernTexture = makeCanvasTexture(128, 128, (ctx, w, h) => {
  ctx.clearRect(0, 0, w, h);
  const rng = mulberry32(5117);
  ctx.translate(w / 2, h - 4);
  for (let f = 0; f < 7; f++) {
    const ang = -Math.PI / 2 + (f - 3) * 0.34 + (rng() - 0.5) * 0.12;
    const len = 48 + rng() * 50;
    ctx.save();
    ctx.rotate(ang + Math.PI / 2);
    const grad = ctx.createLinearGradient(0, 0, 0, -len);
    grad.addColorStop(0, 'rgba(120,146,91,0.8)');
    grad.addColorStop(0.7, 'rgba(218,238,186,0.96)');
    grad.addColorStop(1, 'rgba(255,255,255,0.9)');
    ctx.strokeStyle = grad;
    ctx.lineWidth = 1.8;
    ctx.beginPath();
    ctx.moveTo(0, 0);
    ctx.quadraticCurveTo(4, -len * 0.5, 0, -len);
    ctx.stroke();
    ctx.fillStyle = grad;
    for (let i = 2; i < 12; i++) {
      const t = i / 12;
      const y = -len * t;
      const spread = Math.sin(t * Math.PI) * 14;
      for (const side of [-1, 1]) {
        ctx.save();
        ctx.translate(0, y);
        ctx.rotate(side * 1.0);
        ctx.beginPath();
        ctx.ellipse(spread * 0.5, 0, 4.2, 1.5, 0, 0, TAU);
        ctx.fill();
        ctx.restore();
      }
    }
    ctx.restore();
  }
});

function crossedPlaneGeometry(width, height) {
  const w = width / 2;
  const positions = [
    -w, 0, 0, w, 0, 0, w, height, 0, -w, height, 0,
    0, 0, -w, 0, 0, w, 0, height, w, 0, height, -w
  ];
  const uvs = [
    0, 0, 1, 0, 1, 1, 0, 1,
    0, 0, 1, 0, 1, 1, 0, 1
  ];
  const indices = [0, 1, 2, 0, 2, 3, 4, 5, 6, 4, 6, 7];
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geo.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  geo.setIndex(indices);
  geo.computeVertexNormals();
  return geo;
}

function makeSwayMaterial(map, color, alphaTest = 0.42) {
  const material = new THREE.MeshStandardMaterial({
    map,
    color,
    alphaTest,
    side: THREE.DoubleSide,
    roughness: 0.96,
    metalness: 0
  });
  material.onBeforeCompile = (shader) => {
    shader.uniforms.uTime = windUniform;
    shader.vertexShader = 'uniform float uTime;\n' + shader.vertexShader;
    shader.vertexShader = shader.vertexShader.replace(
      '#include <begin_vertex>',
      /* glsl */`
        #include <begin_vertex>
        #ifdef USE_INSTANCING
          vec2 iPos = vec2(instanceMatrix[3][0], instanceMatrix[3][2]);
        #else
          vec2 iPos = vec2(0.0);
        #endif
        float sway = sin(uTime * 1.35 + iPos.x * 0.31 + iPos.y * 0.22) * 0.055
                   + sin(uTime * 2.2 + iPos.x * 0.63) * 0.018;
        transformed.x += sway * max(position.y, 0.0);
        transformed.z += sway * 0.35 * max(position.y, 0.0);
      `
    );
  };
  return material;
}

function buildGroundCover() {
  const grassGeo = crossedPlaneGeometry(0.95, 0.82);
  const grassMat = makeSwayMaterial(grassTexture, 0xffffff, 0.36);
  const fernGeo = crossedPlaneGeometry(1.55, 1.15);
  const fernMat = makeSwayMaterial(fernTexture, 0xffffff, 0.38);

  const rng = mulberry32(30017);
  const matrix = new THREE.Matrix4();
  const quat = new THREE.Quaternion();
  const pos = new THREE.Vector3();
  const scl = new THREE.Vector3();
  const color = new THREE.Color();

  const grassCount = isTouch ? 4300 : 7200;
  const grass = new THREE.InstancedMesh(grassGeo, grassMat, grassCount);
  let placed = 0, attempts = 0;
  while (placed < grassCount && attempts < grassCount * 6) {
    attempts++;
    const a = rng() * TAU;
    const r = Math.sqrt(rng()) * (WORLD_RADIUS + 1);
    const x = Math.cos(a) * r;
    const z = Math.sin(a) * r;
    if (distanceToPath(x, z) < 2.55) continue;
    if (lakeClearance(x, z) < 1.6) continue;
    if (distanceToRiver(x, z) < RIVER_HALF_WIDTH + 1.2) continue;
    const y = terrainHeight(x, z);
    pos.set(x, y + 0.01, z);
    quat.setFromAxisAngle(new THREE.Vector3(0, 1, 0), rng() * TAU);
    const s = 0.62 + rng() * 1.0;
    scl.set(s, s * (0.55 + rng() * 0.55), s);
    matrix.compose(pos, quat, scl);
    grass.setMatrixAt(placed, matrix);
    color.setHSL(0.22 + rng() * 0.05, 0.24 + rng() * 0.16, 0.16 + rng() * 0.1);
    grass.setColorAt(placed, color);
    placed++;
  }
  grass.instanceMatrix.needsUpdate = true;
  if (grass.instanceColor) grass.instanceColor.needsUpdate = true;
  grass.frustumCulled = false;
  scene.add(grass);

  const fernCount = isTouch ? 420 : 880;
  const ferns = new THREE.InstancedMesh(fernGeo, fernMat, fernCount);
  placed = 0; attempts = 0;
  while (placed < fernCount && attempts < fernCount * 8) {
    attempts++;
    const a = rng() * TAU;
    const r = Math.sqrt(rng()) * (WORLD_RADIUS + 1);
    const x = Math.cos(a) * r;
    const z = Math.sin(a) * r;
    if (distanceToPath(x, z) < 3.1) continue;
    if (lakeClearance(x, z) < 1.5) continue;
    if (distanceToRiver(x, z) < RIVER_HALF_WIDTH + 1.0) continue;
    if (hash(x * 2.1, z * 1.9) < 0.35) continue;
    const y = terrainHeight(x, z);
    pos.set(x, y + 0.01, z);
    quat.setFromAxisAngle(new THREE.Vector3(0, 1, 0), rng() * TAU);
    const s = 0.65 + rng() * 0.9;
    scl.set(s, s * (0.8 + rng() * 0.5), s);
    matrix.compose(pos, quat, scl);
    ferns.setMatrixAt(placed, matrix);
    color.setHSL(0.24 + rng() * 0.04, 0.26 + rng() * 0.14, 0.14 + rng() * 0.08);
    ferns.setColorAt(placed, color);
    placed++;
  }
  ferns.instanceMatrix.needsUpdate = true;
  if (ferns.instanceColor) ferns.instanceColor.needsUpdate = true;
  ferns.frustumCulled = false;
  scene.add(ferns);

  return { grass, ferns };
}

const groundCover = buildGroundCover();

/* Fallen leaves */
function buildLeafLitter() {
  const rng = mulberry32(4771);
  const geo = new THREE.PlaneGeometry(0.24, 0.15);
  geo.rotateX(-Math.PI / 2);
  const mat = new THREE.MeshStandardMaterial({ side: THREE.DoubleSide, roughness: 1, metalness: 0 });
  const count = isTouch ? 1000 : 2100;
  const mesh = new THREE.InstancedMesh(geo, mat, count);
  const matrix = new THREE.Matrix4();
  const quat = new THREE.Quaternion();
  const pos = new THREE.Vector3();
  const scl = new THREE.Vector3();
  const color = new THREE.Color();
  const palette = [0x7d5a2f, 0x946c32, 0xa98a4b, 0x6d4f2d, 0x8d6235, 0xb08a4a];
  let placed = 0, attempts = 0;
  while (placed < count && attempts < count * 5) {
    attempts++;
    const a = rng() * TAU;
    const r = Math.sqrt(rng()) * (WORLD_RADIUS + 1);
    const x = Math.cos(a) * r;
    const z = Math.sin(a) * r;
    if (lakeClearance(x, z) < 1.4) continue;
    if (distanceToRiver(x, z) < RIVER_HALF_WIDTH + 1.0) continue;
    pos.set(x, terrainHeight(x, z) + 0.025, z);
    quat.setFromAxisAngle(new THREE.Vector3(0, 1, 0), rng() * TAU);
    const s = 0.7 + rng() * 1.3;
    scl.set(s, 1, s);
    matrix.compose(pos, quat, scl);
    mesh.setMatrixAt(placed, matrix);
    color.set(palette[Math.floor(rng() * palette.length)]);
    color.offsetHSL(0, 0, (rng() - 0.5) * 0.06);
    mesh.setColorAt(placed, color);
    placed++;
  }
  mesh.instanceMatrix.needsUpdate = true;
  if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
  mesh.frustumCulled = false;
  scene.add(mesh);
  return mesh;
}
const leafLitter = buildLeafLitter();

/* ------------------------- God rays ---------------------------- */

const rayTexture = makeCanvasTexture(128, 512, (ctx, w, h) => {
  ctx.clearRect(0, 0, w, h);
  const v = ctx.createLinearGradient(0, 0, 0, h);
  v.addColorStop(0, 'rgba(255,255,255,0.0)');
  v.addColorStop(0.16, 'rgba(255,255,255,0.72)');
  v.addColorStop(0.68, 'rgba(255,255,255,0.2)');
  v.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = v;
  ctx.fillRect(0, 0, w, h);
  ctx.globalCompositeOperation = 'destination-in';
  const hgrad = ctx.createLinearGradient(0, 0, w, 0);
  hgrad.addColorStop(0, 'rgba(0,0,0,0)');
  hgrad.addColorStop(0.45, 'rgba(0,0,0,0.95)');
  hgrad.addColorStop(0.55, 'rgba(0,0,0,0.95)');
  hgrad.addColorStop(1, 'rgba(0,0,0,0)');
  ctx.fillStyle = hgrad;
  ctx.fillRect(0, 0, w, h);
});

function buildRays() {
  const group = new THREE.Group();
  const rng = mulberry32(9001);
  const material = new THREE.MeshBasicMaterial({
    map: rayTexture,
    color: 0xffd9a2,
    transparent: true,
    opacity: 0.085,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
    side: THREE.DoubleSide,
    fog: false,
    toneMapped: false
  });
  const geo = new THREE.PlaneGeometry(13, 46);
  const spots = [
    [4, 48], [-8, 37], [10, 24], [-14, 10], [3, -4], [-18, -20],
    [16, -36], [-30, -48], [-31, 15], [24, 4], [34, -58]
  ];
  for (let i = 0; i < spots.length; i++) {
    const [x, z] = spots[i];
    const mesh = new THREE.Mesh(geo, material.clone());
    mesh.material.opacity = 0.05 + rng() * 0.07;
    mesh.position.set(x, terrainHeight(x, z) + 23, z);
    mesh.rotation.y = rng() * TAU;
    mesh.rotation.z = -0.11 + rng() * 0.22;
    mesh.renderOrder = 5;
    group.add(mesh);
  }
  scene.add(group);
  return group;
}
const rays = buildRays();

/* ------------------------- Particles --------------------------- */

function buildParticles(options) {
  const {
    count, origin, spread, height, colorA, colorB, sizeMin, sizeMax,
    opacity, drift = 1, seed = 1
  } = options;
  const rng = mulberry32(seed);
  const positions = new Float32Array(count * 3);
  const colors = new Float32Array(count * 3);
  const sizes = new Float32Array(count);
  const phases = new Float32Array(count);
  const cA = new THREE.Color(colorA);
  const cB = new THREE.Color(colorB);
  const color = new THREE.Color();

  for (let i = 0; i < count; i++) {
    const a = rng() * TAU;
    const r = Math.sqrt(rng()) * spread;
    const x = origin.x + Math.cos(a) * r;
    const z = origin.z + Math.sin(a) * r;
    const ground = Math.max(terrainHeight(x, z), WATER_LEVEL);
    positions[i * 3] = x;
    positions[i * 3 + 1] = ground + origin.y + rng() * height;
    positions[i * 3 + 2] = z;
    color.copy(cA).lerp(cB, rng());
    colors[i * 3] = color.r;
    colors[i * 3 + 1] = color.g;
    colors[i * 3 + 2] = color.b;
    sizes[i] = sizeMin + rng() * (sizeMax - sizeMin);
    phases[i] = rng();
  }

  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  geo.setAttribute('aColor', new THREE.BufferAttribute(colors, 3));
  geo.setAttribute('aSize', new THREE.BufferAttribute(sizes, 1));
  geo.setAttribute('aPhase', new THREE.BufferAttribute(phases, 1));

  const material = new THREE.ShaderMaterial({
    uniforms: {
      uTime: { value: 0 },
      uScale: { value: 700 },
      uOpacity: { value: opacity },
      uDrift: { value: drift }
    },
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    vertexShader: /* glsl */`
      uniform float uTime;
      uniform float uScale;
      uniform float uOpacity;
      uniform float uDrift;
      attribute vec3 aColor;
      attribute float aSize;
      attribute float aPhase;
      varying vec3 vColor;
      varying float vAlpha;
      void main() {
        vec3 p = position;
        float phase = aPhase * 6.28318;
        p.x += cos(uTime * 0.18 + phase) * 0.75 * uDrift;
        p.z += sin(uTime * 0.15 + phase * 1.3) * 0.75 * uDrift;
        p.y += sin(uTime * 0.3 + phase * 1.7) * 0.65 * uDrift;
        vec4 mv = modelViewMatrix * vec4(p, 1.0);
        gl_PointSize = aSize * uScale / max(1.0, -mv.z);
        gl_Position = projectionMatrix * mv;
        vColor = aColor;
        float twinkle = 0.55 + 0.45 * sin(uTime * (0.7 + aPhase * 1.6) + phase * 4.0);
        vAlpha = twinkle * uOpacity * (1.0 - smoothstep(36.0, 95.0, -mv.z));
      }
    `,
    fragmentShader: /* glsl */`
      varying vec3 vColor;
      varying float vAlpha;
      void main() {
        vec2 p = gl_PointCoord - 0.5;
        float d = length(p);
        if (d > 0.5) discard;
        float a = smoothstep(0.5, 0.0, d);
        a = pow(a, 1.8);
        gl_FragColor = vec4(vColor, a * vAlpha);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
      }
    `
  });

  const points = new THREE.Points(geo, material);
  points.frustumCulled = false;
  points.renderOrder = 8;
  scene.add(points);
  return points;
}

const dust = buildParticles({
  count: isTouch ? 380 : 880,
  origin: { x: 0, y: 0.5, z: 0 },
  spread: 132,
  height: 14,
  colorA: 0xfff1cf,
  colorB: 0xffd99b,
  sizeMin: 0.015,
  sizeMax: 0.05,
  opacity: 0.5,
  drift: 0.8,
  seed: 309
});

const fireflies = buildParticles({
  count: isTouch ? 70 : 140,
  origin: { x: POND.x, y: 0.4, z: POND.z },
  spread: 24,
  height: 4.5,
  colorA: 0xe7f59a,
  colorB: 0xffe58d,
  sizeMin: 0.08,
  sizeMax: 0.19,
  opacity: 0.92,
  drift: 1.3,
  seed: 812
});
/* A second firefly cluster along the path. */
const pathFireflies = buildParticles({
  count: isTouch ? 25 : 55,
  origin: { x: 0, y: 0.4, z: 28 },
  spread: 38,
  height: 3.5,
  colorA: 0xdff38e,
  colorB: 0xffe7a0,
  sizeMin: 0.07,
  sizeMax: 0.15,
  opacity: 0.8,
  drift: 1.2,
  seed: 921
});

/* --------------------------- Regions --------------------------- */

const regions = [
  { name: 'The Lantern Path', x: 0, z: 52, r: 40 },
  { name: 'Northreach Trail', x: 0, z: 108, r: 31 },
  { name: 'The Sunken Pool', x: POND.x, z: POND.z, r: 25 },
  { name: 'The Elder', x: GIANT_TREE.x, z: GIANT_TREE.z, r: 20 },
  { name: 'Mosslight Glade', x: 30, z: -10, r: 24 },
  { name: 'Whispering Ridge', x: 18, z: -66, r: 27 },
  { name: 'The Western Reach', x: -68, z: -18, r: 25 },
  { name: 'Mirror Lake', x: LAKES[1].x, z: LAKES[1].z, r: 30 },
  { name: 'Larkspur Lake', x: LAKES[2].x, z: LAKES[2].z, r: 28 },
  { name: 'Blackwater Fen', x: LAKES[3].x, z: LAKES[3].z, r: 34 },
  { name: 'The Long River', x: -108, z: 10, r: 27 },
  { name: 'Southwatch', x: 0, z: -126, r: 31 }
];

let currentRegionName = '';

/* --------------------------- Audio ----------------------------- */

const audio = {
  ctx: null,
  master: null,
  wind: null,
  muted: false,
  footsteps: 0,
  birdTimer: null
};

function createNoiseBuffer(ctx, seconds = 3) {
  const buffer = ctx.createBuffer(1, Math.floor(ctx.sampleRate * seconds), ctx.sampleRate);
  const data = buffer.getChannelData(0);
  let last = 0;
  for (let i = 0; i < data.length; i++) {
    const white = Math.random() * 2 - 1;
    last = last * 0.985 + white * 0.015;
    data[i] = last * 4.2;
  }
  return buffer;
}

function initAudio() {
  if (audio.ctx) {
    if (audio.ctx.state === 'suspended') audio.ctx.resume();
    return;
  }
  const AudioCtx = window.AudioContext || window.webkitAudioContext;
  if (!AudioCtx) return;
  const ctx = new AudioCtx();
  audio.ctx = ctx;
  const master = ctx.createGain();
  master.gain.value = audio.muted ? 0 : 0.55;
  master.connect(ctx.destination);
  audio.master = master;

  const noise = createNoiseBuffer(ctx, 4);
  const wind = ctx.createBufferSource();
  wind.buffer = noise;
  wind.loop = true;
  const windFilter = ctx.createBiquadFilter();
  windFilter.type = 'lowpass';
  windFilter.frequency.value = 430;
  windFilter.Q.value = 0.4;
  const windGain = ctx.createGain();
  windGain.gain.value = 0.2;
  wind.connect(windFilter).connect(windGain).connect(master);
  wind.start();

  const lfo = ctx.createOscillator();
  lfo.frequency.value = 0.065;
  const lfoGain = ctx.createGain();
  lfoGain.gain.value = 150;
  lfo.connect(lfoGain).connect(windFilter.frequency);
  lfo.start();

  const leaves = ctx.createBufferSource();
  leaves.buffer = noise;
  leaves.loop = true;
  const leafFilter = ctx.createBiquadFilter();
  leafFilter.type = 'highpass';
  leafFilter.frequency.value = 2600;
  const leafGain = ctx.createGain();
  leafGain.gain.value = 0.035;
  const leafLfo = ctx.createOscillator();
  leafLfo.frequency.value = 0.11;
  const leafLfoGain = ctx.createGain();
  leafLfoGain.gain.value = 0.02;
  leafLfo.connect(leafLfoGain).connect(leafGain.gain);
  leafLfo.start();
  leaves.connect(leafFilter).connect(leafGain).connect(master);
  leaves.start();

  audio.noiseBuffer = noise;
  scheduleBirdChirp();
}

function scheduleBirdChirp() {
  if (!audio.ctx) return;
  clearTimeout(audio.birdTimer);
  const delay = 3800 + Math.random() * 9000;
  audio.birdTimer = setTimeout(() => {
    playBirdChirp();
    scheduleBirdChirp();
  }, delay);
}

function playBirdChirp() {
  if (!audio.ctx || audio.muted || document.hidden) return;
  const ctx = audio.ctx;
  const now = ctx.currentTime;
  const notes = 2 + Math.floor(Math.random() * 3);
  const base = 1800 + Math.random() * 1600;
  for (let i = 0; i < notes; i++) {
    const t = now + i * (0.08 + Math.random() * 0.1);
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = Math.random() < 0.5 ? 'sine' : 'triangle';
    const f = base * (0.9 + Math.random() * 0.35);
    osc.frequency.setValueAtTime(f, t);
    osc.frequency.exponentialRampToValueAtTime(f * (0.55 + Math.random() * 0.3), t + 0.07);
    gain.gain.setValueAtTime(0, t);
    gain.gain.linearRampToValueAtTime(0.024, t + 0.012);
    gain.gain.exponentialRampToValueAtTime(0.0001, t + 0.16);
    osc.connect(gain).connect(audio.master);
    osc.start(t);
    osc.stop(t + 0.2);
  }
}

function playFootstep(wading = false) {
  if (!audio.ctx || audio.muted) return;
  const ctx = audio.ctx;
  const src = ctx.createBufferSource();
  src.buffer = audio.noiseBuffer;
  src.playbackRate.value = 0.9 + Math.random() * 0.25;
  const filter = ctx.createBiquadFilter();
  filter.type = 'bandpass';
  filter.frequency.value = wading ? 420 : 210 + Math.random() * 80;
  filter.Q.value = wading ? 0.7 : 1.15;
  const gain = ctx.createGain();
  const t = ctx.currentTime;
  gain.gain.setValueAtTime(0.0001, t);
  gain.gain.linearRampToValueAtTime(wading ? 0.035 : 0.045, t + 0.012);
  gain.gain.exponentialRampToValueAtTime(0.0001, t + (wading ? 0.28 : 0.16));
  src.connect(filter).connect(gain).connect(audio.master);
  src.start(t, Math.random() * 2, 0.35);
}

function setMuted(muted) {
  audio.muted = muted;
  if (!audio.ctx) {
    if (!muted) initAudio();
    return;
  }
  const t = audio.ctx.currentTime;
  audio.master.gain.cancelScheduledValues(t);
  audio.master.gain.setTargetAtTime(muted ? 0 : 0.55, t, 0.08);
}

/* ------------------------ Blunderbuss -------------------------- */

const weapon = {
  equipped: true,
  loaded: true,
  reloading: false,
  firing: false,
  reloadTime: 0,
  reloadDuration: 2.55,
  fireTime: 0,
  recoil: 0,
  cameraKick: 0,
  flashTime: 0,
  equipBlend: 0
};

const weaponRig = new THREE.Group();
weaponRig.visible = false;
weaponRig.position.set(0.36, -0.35, -0.68);
weaponRig.rotation.set(0.015, 0.13, -0.025);
camera.add(weaponRig);

const gun = new THREE.Group();
weaponRig.add(gun);

const gunWood = new THREE.MeshStandardMaterial({
  color: 0x62391e, roughness: 0.72, metalness: 0.02, flatShading: true,
  emissive: 0x160b04, emissiveIntensity: 0.35
});
const gunWoodDark = new THREE.MeshStandardMaterial({
  color: 0x3c2414, roughness: 0.8, metalness: 0.01, flatShading: true,
  emissive: 0x0d0602, emissiveIntensity: 0.3
});
const gunMetal = new THREE.MeshStandardMaterial({
  color: 0x3b4240, roughness: 0.4, metalness: 0.72, flatShading: true,
  emissive: 0x090c0b, emissiveIntensity: 0.25
});
const gunBrass = new THREE.MeshStandardMaterial({
  color: 0xa97739, roughness: 0.38, metalness: 0.72, flatShading: true,
  emissive: 0x1b1004, emissiveIntensity: 0.3
});
const skin = new THREE.MeshStandardMaterial({
  color: 0xb97952, roughness: 0.82, metalness: 0, flatShading: true,
  emissive: 0x1d0e08, emissiveIntensity: 0.22
});
const sleeve = new THREE.MeshStandardMaterial({
  color: 0x3c4e33, roughness: 0.94, metalness: 0, flatShading: true,
  emissive: 0x090d07, emissiveIntensity: 0.22
});
const cuff = new THREE.MeshStandardMaterial({
  color: 0x2a3726, roughness: 0.96, metalness: 0, flatShading: true
});

function gunBox(w, h, d, material, x, y, z, rx = 0, ry = 0, rz = 0, parent = gun) {
  const mesh = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), material);
  mesh.position.set(x, y, z);
  mesh.rotation.set(rx, ry, rz);
  parent.add(mesh);
  return mesh;
}

function gunCylinder(radiusTop, radiusBottom, length, material, x, y, z, parent = gun) {
  const mesh = new THREE.Mesh(new THREE.CylinderGeometry(radiusTop, radiusBottom, length, 8, 1), material);
  mesh.rotation.x = -Math.PI / 2;
  mesh.position.set(x, y, z);
  parent.add(mesh);
  return mesh;
}

/* Blocky stock, receiver, flared barrel and brass furniture. */
gunBox(0.17, 0.15, 0.24, gunMetal, 0, 0, -0.07);
gunBox(0.15, 0.15, 0.32, gunWood, 0, -0.03, 0.16, -0.08);
gunBox(0.2, 0.24, 0.37, gunWoodDark, 0, -0.085, 0.39, -0.19);
gunBox(0.205, 0.05, 0.31, gunWood, 0, -0.19, 0.34, -0.19);
gunBox(0.03, 0.13, 0.08, gunMetal, 0.015, 0.08, 0.13, 0, 0, 0.36);
gunBox(0.03, 0.09, 0.03, gunMetal, 0.015, -0.11, 0.05, 0.25);
gunBox(0.018, 0.018, 0.16, gunMetal, 0, -0.155, 0.01);
gunBox(0.012, 0.015, 0.14, gunBrass, 0.092, -0.015, 0.0);
gunCylinder(0.09, 0.06, 0.82, gunMetal, 0, 0.04, -0.58);
gunCylinder(0.13, 0.088, 0.19, gunMetal, 0, 0.04, -1.075);
gunCylinder(0.072, 0.072, 0.035, gunBrass, 0, 0.04, -0.31);
gunCylinder(0.077, 0.077, 0.035, gunBrass, 0, 0.04, -0.75);
gunCylinder(0.098, 0.098, 0.03, gunBrass, 0, 0.04, -0.99);
gunCylinder(0.012, 0.012, 0.67, gunMetal, 0, -0.015, -0.52);
gunBox(0.02, 0.016, 0.24, gunMetal, 0, 0.128, -0.54);

const muzzle = new THREE.Object3D();
muzzle.position.set(0, 0.04, -1.18);
gun.add(muzzle);

const flashMaterial = new THREE.SpriteMaterial({
  map: sunTexture,
  color: 0xffb15e,
  transparent: true,
  opacity: 0.95,
  blending: THREE.AdditiveBlending,
  depthWrite: false,
  depthTest: false,
  fog: false,
  toneMapped: false
});
const muzzleFlash = new THREE.Sprite(flashMaterial);
muzzleFlash.scale.set(0.62, 0.62, 1);
muzzleFlash.visible = false;
muzzleFlash.renderOrder = 40;
muzzle.add(muzzleFlash);

const muzzleLight = new THREE.PointLight(0xffb064, 0, 5, 2);
muzzle.add(muzzleLight);

/* Blocky hands and arms. */
function makeHand(flip = 1) {
  const hand = new THREE.Group();
  gunBox(0.11, 0.075, 0.15, skin, 0, 0, 0, 0, 0, 0, hand);
  for (let i = 0; i < 3; i++) {
    gunBox(0.026, 0.05, 0.11, skin, (-0.038 + i * 0.038) * flip, 0.045, -0.045, 0.2, 0, 0, hand);
  }
  gunBox(0.032, 0.045, 0.08, skin, 0.065 * flip, 0.024, -0.015, 0, 0, -0.55 * flip, hand);
  return hand;
}

const leftHand = makeHand(1);
leftHand.position.set(-0.035, -0.11, -0.48);
leftHand.rotation.set(-0.25, 0.18, -0.18);
weaponRig.add(leftHand);

const rightHand = makeHand(-1);
rightHand.position.set(0.035, -0.12, 0.12);
rightHand.rotation.set(-0.12, -0.1, 0.65);
weaponRig.add(rightHand);

const armGeoWidth = 0.13;
const leftUpperArm = new THREE.Mesh(new THREE.BoxGeometry(0.15, 0.15, 1), sleeve);
const rightUpperArm = new THREE.Mesh(new THREE.BoxGeometry(0.15, 0.15, 1), sleeve);
const leftForearm = new THREE.Mesh(new THREE.BoxGeometry(0.11, 0.11, 1), skin);
const rightForearm = new THREE.Mesh(new THREE.BoxGeometry(0.11, 0.11, 1), skin);
weaponRig.add(leftUpperArm, rightUpperArm, leftForearm, rightForearm);

const leftCuff = new THREE.Mesh(new THREE.BoxGeometry(0.145, 0.145, 0.11), cuff);
const rightCuff = new THREE.Mesh(new THREE.BoxGeometry(0.145, 0.145, 0.11), cuff);
weaponRig.add(leftCuff, rightCuff);

const leftShoulder = new THREE.Vector3(-0.52, -0.72, 0.26);
const leftElbow = new THREE.Vector3(-0.29, -0.37, -0.07);
const rightShoulder = new THREE.Vector3(0.66, -0.76, 0.36);
const rightElbow = new THREE.Vector3(0.32, -0.39, 0.13);
const rightGrip = new THREE.Vector3(0.035, -0.12, 0.12);
const leftIdle = new THREE.Vector3(-0.035, -0.11, -0.48);
const leftReloadReach = new THREE.Vector3(-0.015, 0.035, -0.92);

function poseLimb(mesh, from, to) {
  const direction = to.clone().sub(from);
  const length = direction.length();
  mesh.position.copy(from).add(to).multiplyScalar(0.5);
  mesh.scale.z = length;
  mesh.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, 1), direction.normalize());
}

function poseCuff(mesh, from, to, offset = 0.72) {
  mesh.position.copy(from).lerp(to, offset);
  mesh.quaternion.copy(mesh.quaternion.identity());
}

poseLimb(leftUpperArm, leftShoulder, leftElbow);
poseLimb(rightUpperArm, rightShoulder, rightElbow);
poseLimb(rightForearm, rightElbow, rightGrip);
poseLimb(leftForearm, leftElbow, leftIdle);
poseCuff(leftCuff, leftElbow, leftIdle);
poseCuff(rightCuff, rightElbow, rightGrip);

/* Soft smoke billboards for the muzzle. */
const smokeTexture = makeCanvasTexture(128, 128, (ctx, w, h) => {
  const g = ctx.createRadialGradient(w * 0.5, h * 0.5, 0, w * 0.5, h * 0.5, w * 0.5);
  g.addColorStop(0, 'rgba(236,226,204,0.62)');
  g.addColorStop(0.42, 'rgba(208,199,179,0.32)');
  g.addColorStop(1, 'rgba(188,181,163,0)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, w, h);
});
const smokePuffs = [];
for (let i = 0; i < 9; i++) {
  const sprite = new THREE.Sprite(new THREE.SpriteMaterial({
    map: smokeTexture,
    color: 0xd6cdb8,
    transparent: true,
    opacity: 0,
    depthWrite: false,
    fog: false,
    toneMapped: false
  }));
  sprite.visible = false;
  sprite.scale.setScalar(0.08);
  camera.add(sprite);
  smokePuffs.push({ sprite, life: 0, maxLife: 1, velocity: new THREE.Vector3() });
}
let smokeCursor = 0;
const muzzleLocal = new THREE.Vector3();
const smokeSpawn = new THREE.Vector3();

function spawnSmoke() {
  muzzle.getWorldPosition(muzzleLocal);
  camera.worldToLocal(muzzleLocal);
  for (let i = 0; i < 4; i++) {
    const puff = smokePuffs[smokeCursor++ % smokePuffs.length];
    puff.sprite.position.copy(muzzleLocal).add(new THREE.Vector3(
      (Math.random() - 0.5) * 0.035,
      (Math.random() - 0.5) * 0.035,
      (Math.random() - 0.5) * 0.035
    ));
    puff.sprite.scale.setScalar(0.045 + Math.random() * 0.045);
    puff.sprite.material.opacity = 0.48;
    puff.sprite.visible = true;
    puff.life = puff.maxLife = 0.75 + Math.random() * 0.55;
    puff.velocity.set(
      (Math.random() - 0.35) * 0.09,
      0.05 + Math.random() * 0.06,
      -0.16 - Math.random() * 0.18
    );
  }
}

function updateSmoke(dt) {
  for (const puff of smokePuffs) {
    if (!puff.sprite.visible) continue;
    puff.life -= dt;
    if (puff.life <= 0) {
      puff.sprite.visible = false;
      continue;
    }
    const t = puff.life / puff.maxLife;
    puff.sprite.position.addScaledVector(puff.velocity, dt);
    puff.velocity.y += 0.035 * dt;
    puff.velocity.multiplyScalar(1 - dt * 0.9);
    puff.sprite.scale.addScalar(dt * 0.13);
    puff.sprite.material.opacity = 0.45 * t * t;
    puff.sprite.material.rotation += dt * 0.35;
  }
}

/* Shot and reload audio, synthesized so the build stays asset-free. */
function playBlunderbussShot() {
  if (!audio.ctx || audio.muted) return;
  const ctx = audio.ctx;
  const t = ctx.currentTime;
  const src = ctx.createBufferSource();
  src.buffer = audio.noiseBuffer;
  src.playbackRate.value = 0.62;
  const filter = ctx.createBiquadFilter();
  filter.type = 'lowpass';
  filter.frequency.setValueAtTime(1550, t);
  filter.frequency.exponentialRampToValueAtTime(180, t + 0.55);
  const gain = ctx.createGain();
  gain.gain.setValueAtTime(0.0001, t);
  gain.gain.linearRampToValueAtTime(0.58, t + 0.012);
  gain.gain.exponentialRampToValueAtTime(0.0001, t + 0.62);
  src.connect(filter).connect(gain).connect(audio.master);
  src.start(t, Math.random() * 2.4, 0.7);

  const thump = ctx.createOscillator();
  const thumpGain = ctx.createGain();
  thump.type = 'sine';
  thump.frequency.setValueAtTime(105, t);
  thump.frequency.exponentialRampToValueAtTime(33, t + 0.34);
  thumpGain.gain.setValueAtTime(0.0001, t);
  thumpGain.gain.linearRampToValueAtTime(0.32, t + 0.012);
  thumpGain.gain.exponentialRampToValueAtTime(0.0001, t + 0.4);
  thump.connect(thumpGain).connect(audio.master);
  thump.start(t);
  thump.stop(t + 0.44);
}

function playReloadClick(delay = 0) {
  if (!audio.ctx || audio.muted) return;
  const ctx = audio.ctx;
  const t = ctx.currentTime + delay;
  const src = ctx.createBufferSource();
  src.buffer = audio.noiseBuffer;
  src.playbackRate.value = 1.2;
  const filter = ctx.createBiquadFilter();
  filter.type = 'bandpass';
  filter.frequency.value = 1800 + Math.random() * 900;
  filter.Q.value = 2.4;
  const gain = ctx.createGain();
  gain.gain.setValueAtTime(0.0001, t);
  gain.gain.linearRampToValueAtTime(0.085, t + 0.006);
  gain.gain.exponentialRampToValueAtTime(0.0001, t + 0.09);
  src.connect(filter).connect(gain).connect(audio.master);
  src.start(t, Math.random() * 2.4, 0.12);
}

function updateWeaponUI() {
  const stowed = !weapon.equipped;
  itemSlot.classList.toggle('is-stowed', stowed);
  itemSlot.setAttribute('aria-pressed', String(weapon.equipped));
  itemSlot.setAttribute('aria-label', stowed
    ? 'Blunderbuss stowed. Click to equip.'
    : 'Blunderbuss equipped. Click to stow.');
  itemState.textContent = stowed ? 'Stowed' : (weapon.reloading ? 'Reloading' : (weapon.loaded ? 'Equipped' : 'Empty'));
  itemSwitch.textContent = stowed ? 'Equip' : 'Stow';
  document.body.classList.toggle('weapon-stowed', stowed);
  document.body.classList.toggle('weapon-reloading', weapon.reloading);
  document.body.classList.toggle('weapon-empty', weapon.equipped && !weapon.loaded && !weapon.reloading);
}

function setBlunderbussEquipped(equipped) {
  if (weapon.equipped === equipped) return;
  weapon.equipped = equipped;
  if (!equipped) {
    weapon.reloading = false;
    weapon.firing = false;
    weapon.flashTime = 0;
    muzzleFlash.visible = false;
    muzzleLight.intensity = 0;
    itemProgress.style.width = '0%';
  }
  updateWeaponUI();
  showToast(equipped ? 'Blunderbuss equipped.' : 'Blunderbuss stowed.', 1700);
}

function startReload() {
  if (!started || settingsOpen || !weapon.equipped || weapon.reloading) return;
  weapon.reloading = true;
  weapon.reloadTime = 0;
  weapon.loaded = false;
  weapon.firing = false;
  weapon.recoil = 0;
  weapon.flashTime = 0;
  muzzleFlash.visible = false;
  muzzleLight.intensity = 0;
  playReloadClick(0.16);
  playReloadClick(0.98);
  playReloadClick(1.86);
  updateWeaponUI();
}

function fireBlunderbuss() {
  if (!started || settingsOpen || !weapon.equipped || !weapon.loaded || weapon.reloading || weapon.firing) return;
  weapon.loaded = false;
  weapon.firing = true;
  weapon.fireTime = 0;
  weapon.recoil = 1;
  weapon.cameraKick = 1;
  weapon.flashTime = 0.095;
  muzzleFlash.visible = true;
  muzzleFlash.material.rotation = Math.random() * TAU;
  muzzleFlash.scale.setScalar(0.58 + Math.random() * 0.18);
  muzzleLight.intensity = 28;
  spawnSmoke();
  playBlunderbussShot();
  updateWeaponUI();
}

function updateWeapon(dt, time) {
  if (!started) {
    weaponRig.visible = false;
    return;
  }

  weapon.equipBlend = damp(weapon.equipBlend, weapon.equipped ? 1 : 0, 11, dt);
  weaponRig.visible = weapon.equipBlend > 0.015;
  if (!weaponRig.visible) {
    updateSmoke(dt);
    return;
  }
  if (settingsOpen) {
    muzzleFlash.visible = false;
    muzzleLight.intensity = 0;
    return;
  }

  weapon.cameraKick = damp(weapon.cameraKick, 0, 8.5, dt);
  weapon.recoil = damp(weapon.recoil, 0, 11, dt);

  if (weapon.firing) {
    weapon.fireTime += dt;
    if (weapon.fireTime > 0.4) {
      weapon.firing = false;
      if (!weapon.loaded) startReload();
    }
  }

  let reloadT = 0;
  if (weapon.reloading) {
    weapon.reloadTime += dt;
    reloadT = clamp(weapon.reloadTime / weapon.reloadDuration, 0, 1);
    itemProgress.style.width = `${reloadT * 100}%`;
    if (reloadT >= 1) {
      weapon.reloading = false;
      weapon.loaded = true;
      weapon.reloadTime = 0;
      itemProgress.style.width = '0%';
      updateWeaponUI();
    }
  } else {
    itemProgress.style.width = '0%';
  }

  if (!weapon.loaded && !weapon.reloading && !weapon.firing && weapon.equipBlend > 0.88) {
    startReload();
  }

  const draw = 1 - weapon.equipBlend;
  const bob = Math.sin(player.bobPhase * 2) * player.bobAmount * 0.55;
  const sway = Math.cos(player.bobPhase) * player.bobAmount * 0.45;
  const breathe = Math.sin(time * 1.3) * 0.004;

  weaponRig.position.set(
    0.36 + sway,
    -0.35 + bob + breathe - draw * 0.48,
    -0.68 + weapon.recoil * 0.13
  );
  weaponRig.rotation.set(
    0.015 - weapon.recoil * 0.16 + draw * 0.35,
    0.13,
    -0.025 + weapon.recoil * 0.035
  );

  const reloadArc = weapon.reloading ? Math.sin(reloadT * Math.PI) : 0;
  gun.rotation.x = reloadArc * 0.24;
  gun.rotation.z = reloadArc * 0.16;
  gun.position.y = reloadArc * 0.035;
  gun.position.z = reloadArc * 0.025;

  const handTarget = leftIdle.clone();
  if (weapon.reloading) {
    const reach = smoothstep(0.06, 0.34, reloadT) * (1 - smoothstep(0.68, 0.94, reloadT));
    handTarget.lerp(leftReloadReach, reach * 0.92);
    handTarget.y += Math.sin(reloadT * Math.PI * 9) * 0.026 * reach;
    handTarget.z += Math.sin(reloadT * Math.PI * 7) * 0.03 * reach;
  }
  leftHand.position.copy(handTarget);
  leftHand.rotation.set(-0.25 + reloadArc * 0.4, 0.18, -0.18 - reloadArc * 0.3);
  leftForearm.scale.z = Math.max(0.08, leftElbow.distanceTo(handTarget));
  poseLimb(leftForearm, leftElbow, handTarget);
  poseCuff(leftCuff, leftElbow, handTarget);

  const flashOn = weapon.flashTime > 0;
  if (flashOn) {
    weapon.flashTime = Math.max(0, weapon.flashTime - dt);
    const f = weapon.flashTime / 0.095;
    muzzleFlash.visible = true;
    muzzleFlash.material.opacity = 0.95 * f;
    muzzleFlash.scale.setScalar(0.58 + (1 - f) * 0.7);
    muzzleLight.intensity = 28 * f;
  } else {
    muzzleFlash.visible = false;
    muzzleLight.intensity = 0;
  }

  updateSmoke(dt);
}

/* --------------------------- Player ---------------------------- */

const player = {
  x: SPAWN.x,
  z: SPAWN.z,
  feetY: terrainHeight(SPAWN.x, SPAWN.z),
  vy: 0,
  onGround: true,
  vx: 0,
  vz: 0,
  yaw: 0.06,
  pitch: -0.015,
  eye: 1.67,
  bobPhase: 0,
  bobAmount: 0,
  stepDistance: 0,
  wading: false,
  jumpQueued: false
};

let started = false;
let settingsOpen = false;
let pointerLocked = false;
let mouseDragging = false;
let lookPointerId = null;
let lastLookX = 0;
let lastLookY = 0;
let currentQuality = 'high';
let sensitivity = 1;
let toastTimer = 0;
let regionTimer = 0;
let lastRegionCheck = 0;
let compassAccum = 0;
let fpsAvg = 60;
let fpsTime = 0;
let frameCount = 0;
let slowWarningShown = false;

const keys = new Set();

/* ------------------------- Compass UI -------------------------- */

const compassParts = [];
function buildCompass() {
  const labels = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'];
  for (let deg = 0; deg < 360; deg += 15) {
    const tick = document.createElement('span');
    tick.className = 'compass-tick' + (deg % 45 === 0 ? ' major' : '');
    compassTicks.appendChild(tick);
    let label = null;
    if (deg % 45 === 0) {
      label = document.createElement('span');
      label.className = 'compass-label';
      label.textContent = labels[deg / 45];
      compassTicks.appendChild(label);
    }
    compassParts.push({ deg, tick, label });
  }
}
buildCompass();

function updateCompass() {
  let heading = (-player.yaw * 180 / Math.PI) % 360;
  if (heading < 0) heading += 360;
  const cardinal = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'];
  compassLetter.textContent = cardinal[Math.round(heading / 45) % 8];
  compassDeg.textContent = `${Math.round(heading).toString().padStart(3, '0')}°`;

  for (const part of compassParts) {
    let rel = ((part.deg - heading + 540) % 360) - 180;
    const x = rel * 2.15;
    part.tick.style.transform = `translate3d(${x}px, 0, 0) translateX(-50%)`;
    part.tick.style.opacity = String(clamp(1 - Math.abs(rel) / 75, 0, 1));
    if (part.label) {
      part.label.style.transform = `translate3d(${x}px, 0, 0) translateX(-50%)`;
      part.label.style.opacity = String(clamp(1 - Math.abs(rel) / 70, 0, 1));
    }
  }
}

/* --------------------------- UI logic -------------------------- */

function showToast(message, duration = 2800) {
  toastEl.textContent = message;
  toastEl.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => toastEl.classList.remove('show'), duration);
}

function showRegion(name, force = false) {
  if (!started) return;
  if (!force && currentRegionName === name) return;
  currentRegionName = name;
  regionName.textContent = name;
  regionBanner.classList.add('show');
  clearTimeout(regionTimer);
  regionTimer = setTimeout(() => regionBanner.classList.remove('show'), 3600);
}

function checkRegions() {
  let best = null;
  let bestScore = Infinity;
  for (const region of regions) {
    const d = Math.hypot(player.x - region.x, player.z - region.z);
    if (d < region.r) {
      const score = d / region.r;
      if (score < bestScore) { bestScore = score; best = region; }
    }
  }
  if (best && best.name !== currentRegionName) showRegion(best.name);
  else if (!best) currentRegionName = '';
  if (best && currentRegionName === '') showRegion(best.name);
}

function updateQualityUI() {
  for (const button of qualityButtons) {
    button.classList.toggle('is-active', button.dataset.quality === currentQuality);
    button.setAttribute('aria-pressed', String(button.dataset.quality === currentQuality));
  }
  qualityState.textContent = currentQuality === 'potato' ? 'Potato Mode' : 'High';
}

let staticFrame = 0;

function renderStaticFrame() {
  if (started) return;
  updateCamera(0, 0);
  updateWorld(0, 0);
  updateCompass();
  renderer.render(scene, camera);
}

function scheduleStaticFrame() {
  if (started) return;
  cancelAnimationFrame(staticFrame);
  staticFrame = requestAnimationFrame(renderStaticFrame);
}

function resize() {
  const width = window.innerWidth;
  const height = window.innerHeight;
  camera.aspect = width / height;
  camera.updateProjectionMatrix();
  renderer.setPixelRatio(currentQuality === 'potato'
    ? Math.min(window.devicePixelRatio || 1, 0.78)
    : Math.min(window.devicePixelRatio || 1, 1.5));
  renderer.setSize(width, height);

  const drawing = renderer.getDrawingBufferSize(new THREE.Vector2());
  const scale = drawing.y / (2 * Math.tan(THREE.MathUtils.degToRad(camera.fov) / 2));
  dust.material.uniforms.uScale.value = scale;
  fireflies.material.uniforms.uScale.value = scale;
  pathFireflies.material.uniforms.uScale.value = scale;
  scheduleStaticFrame();
}

function applyQuality(mode, announce = false) {
  const potato = mode === 'potato';
  currentQuality = mode;
  document.body.classList.toggle('potato', potato);

  renderer.shadowMap.enabled = !potato;
  sun.castShadow = !potato;
  scene.fog.density = potato ? 0.022 : 0.0107;
  camera.far = potato ? 185 : 300;
  renderer.toneMappingExposure = potato ? 1.3 : 1.26;
  camera.updateProjectionMatrix();

  for (const mesh of leafMeshes) {
    mesh.castShadow = !potato;
    mesh.receiveShadow = true;
  }
  rocks.castShadow = !potato;
  giantTree.traverse((obj) => {
    if (obj.isMesh) obj.castShadow = !potato;
  });

  groundCover.grass.visible = !potato;
  groundCover.ferns.visible = !potato;
  leafLitter.visible = !potato;
  rays.visible = !potato;
  dust.visible = !potato;
  liliesVisible(!potato);

  scene.traverse((obj) => {
    if (obj.isMesh && obj.material) {
      const materials = Array.isArray(obj.material) ? obj.material : [obj.material];
      for (const mat of materials) {
        if (mat.isMeshStandardMaterial) mat.needsUpdate = true;
      }
    }
  });

  resize();
  updateQualityUI();
  if (announce) {
    showToast(potato ? 'Potato Mode on — the forest runs lighter now.' : 'High graphics on — shadows and foliage restored.', 3000);
  }
}

function liliesVisible(visible) {
  lilyPads.visible = visible;
}

function updateBodyState() {
  document.body.classList.toggle('needs-lock', started && !isTouch && !pointerLocked && !settingsOpen);
}

function requestPointerLock() {
  if (isTouch || !started || settingsOpen) return;
  if (document.pointerLockElement === canvas) return;
  try {
    const result = canvas.requestPointerLock();
    if (result && typeof result.catch === 'function') result.catch(() => {});
  } catch (error) {
    /* The drag-look fallback still works. */
  }
  updateBodyState();
}

function openSettings() {
  if (settingsOpen) return;
  settingsOpen = true;
  keys.clear();
  resetJoystick();
  lookPointerId = null;
  mouseDragging = false;
  settingsPanel.classList.add('is-open');
  settingsPanel.setAttribute('aria-hidden', 'false');
  document.body.classList.add('settings-open');
  weapon.cameraKick = 0;
  weapon.flashTime = 0;
  muzzleFlash.visible = false;
  muzzleLight.intensity = 0;
  if (document.pointerLockElement) document.exitPointerLock();
  $('resumeBtn').textContent = started ? 'Resume exploring' : 'Back to the trailhead';
  updateBodyState();
  setTimeout(() => $('closeSettingsBtn').focus({ preventScroll: true }), 80);
}

function closeSettings() {
  if (!settingsOpen) return;
  settingsOpen = false;
  settingsPanel.classList.remove('is-open');
  settingsPanel.setAttribute('aria-hidden', 'true');
  document.body.classList.remove('settings-open');
  updateBodyState();
  if (started && !isTouch) requestPointerLock();
}

function toggleSettings() {
  if (settingsOpen) closeSettings();
  else openSettings();
}

function startRun(mode) {
  if (started) return;
  applyQuality(mode, false);
  started = true;
  document.body.classList.add('started', 'playing');
  startScreen.setAttribute('aria-hidden', 'true');
  document.activeElement?.blur?.();
  clock.getDelta();
  weapon.equipBlend = 0;
  updateWeaponUI();
  renderer.setAnimationLoop(animate);
  initAudio();
  setMuted(audio.muted);
  showToast(mode === 'potato'
    ? 'Potato Mode enabled. Take the easy path.'
    : 'High graphics enabled. Mind the golden light.', 3000);

  if (!isTouch) requestPointerLock();
  updateBodyState();

  setTimeout(() => {
    if (!started) return;
    checkRegions();
    if (currentRegionName === '') showRegion('The Lantern Path', true);
  }, 1900);
}

/* --------------------------- Input ----------------------------- */

document.addEventListener('keydown', (event) => {
  if (event.code === 'Escape') {
    event.preventDefault();
    toggleSettings();
    return;
  }

  if (!started || settingsOpen) return;

  if (event.code === 'Space') {
    event.preventDefault();
    if (!event.repeat) player.jumpQueued = true;
  }
  if (event.code === 'KeyP') {
    applyQuality(currentQuality === 'potato' ? 'high' : 'potato', true);
  }
  if (event.code === 'Digit1' || event.code === 'KeyF') {
    event.preventDefault();
    if (!event.repeat) setBlunderbussEquipped(!weapon.equipped);
    return;
  }
  if (event.code === 'KeyR') {
    event.preventDefault();
    if (!event.repeat && !weapon.loaded) startReload();
    return;
  }
  keys.add(event.code);
});

document.addEventListener('keyup', (event) => {
  keys.delete(event.code);
});

window.addEventListener('blur', () => {
  keys.clear();
  resetJoystick();
  mouseDragging = false;
  lookPointerId = null;
});

document.addEventListener('mousemove', (event) => {
  if (!started || settingsOpen || isTouch) return;
  if (document.pointerLockElement === canvas || mouseDragging) {
    const scale = 0.00215 * sensitivity;
    player.yaw -= event.movementX * scale;
    player.pitch = clamp(player.pitch - event.movementY * scale, -1.45, 1.45);
  }
});

canvas.addEventListener('pointerdown', (event) => {
  if (!started || settingsOpen) return;

  if (event.pointerType === 'touch' || isTouch) {
    if (lookPointerId !== null) return;
    lookPointerId = event.pointerId;
    lastLookX = event.clientX;
    lastLookY = event.clientY;
    canvas.setPointerCapture?.(event.pointerId);
    return;
  }

  if (event.button !== 0) return;
  if (document.pointerLockElement === canvas) {
    fireBlunderbuss();
    return;
  }
  mouseDragging = true;
  requestPointerLock();
});

canvas.addEventListener('pointermove', (event) => {
  if (event.pointerType !== 'touch' && !isTouch) return;
  if (event.pointerId !== lookPointerId || !started || settingsOpen) return;
  const dx = event.clientX - lastLookX;
  const dy = event.clientY - lastLookY;
  lastLookX = event.clientX;
  lastLookY = event.clientY;
  const scale = 0.0042 * sensitivity;
  player.yaw -= dx * scale;
  player.pitch = clamp(player.pitch - dy * scale, -1.45, 1.45);
});

function releaseLook(event) {
  if (event.pointerId === lookPointerId) {
    lookPointerId = null;
  }
}
canvas.addEventListener('pointerup', releaseLook);
canvas.addEventListener('pointercancel', releaseLook);

document.addEventListener('pointerup', (event) => {
  if (event.pointerType !== 'touch') mouseDragging = false;
});
document.addEventListener('pointercancel', () => { mouseDragging = false; });

canvas.addEventListener('contextmenu', (event) => event.preventDefault());

document.addEventListener('pointerlockchange', () => {
  pointerLocked = document.pointerLockElement === canvas;
  document.body.classList.toggle('locked', pointerLocked);
  if (!pointerLocked && started && !settingsOpen && !isTouch && document.hasFocus()) {
    openSettings();
  }
  updateBodyState();
});

document.addEventListener('pointerlockerror', () => {
  updateBodyState();
});

/* On desktop, clicking the canvas again re-locks without opening settings. */
canvas.addEventListener('click', () => {
  if (started && !settingsOpen && !isTouch && !pointerLocked) requestPointerLock();
});

/* ------------------------ Touch controls ----------------------- */

const joystick = $('joystick');
const knob = $('joystickKnob');
const jumpBtn = $('jumpBtn');
const joystickState = { active: false, pointerId: null, x: 0, y: 0 };

function setKnob(x, y) {
  knob.style.transform = `translate3d(${x * 38}px, ${y * 38}px, 0)`;
}

function updateJoystickFromEvent(event) {
  const rect = joystick.getBoundingClientRect();
  const cx = rect.left + rect.width / 2;
  const cy = rect.top + rect.height / 2;
  let dx = event.clientX - cx;
  let dy = event.clientY - cy;
  const radius = rect.width * 0.34;
  const length = Math.hypot(dx, dy);
  if (length > radius) {
    dx = (dx / length) * radius;
    dy = (dy / length) * radius;
  }
  joystickState.x = dx / radius;
  joystickState.y = dy / radius;
  setKnob(joystickState.x, joystickState.y);
}

function resetJoystick() {
  joystickState.active = false;
  joystickState.pointerId = null;
  joystickState.x = 0;
  joystickState.y = 0;
  setKnob(0, 0);
}

joystick.addEventListener('pointerdown', (event) => {
  if (!started || settingsOpen) return;
  event.preventDefault();
  event.stopPropagation();
  joystickState.active = true;
  joystickState.pointerId = event.pointerId;
  joystick.setPointerCapture?.(event.pointerId);
  updateJoystickFromEvent(event);
});

joystick.addEventListener('pointermove', (event) => {
  if (!joystickState.active || event.pointerId !== joystickState.pointerId) return;
  event.preventDefault();
  updateJoystickFromEvent(event);
});

function endJoystick(event) {
  if (joystickState.pointerId !== null && event.pointerId !== joystickState.pointerId) return;
  resetJoystick();
}
joystick.addEventListener('pointerup', endJoystick);
joystick.addEventListener('pointercancel', endJoystick);
joystick.addEventListener('lostpointercapture', endJoystick);

function triggerJump() {
  if (!started || settingsOpen) return;
  player.jumpQueued = true;
}
jumpBtn.addEventListener('pointerdown', (event) => {
  event.preventDefault();
  event.stopPropagation();
  jumpBtn.classList.add('is-pressed');
  triggerJump();
});
function releaseJump() { jumpBtn.classList.remove('is-pressed'); }
jumpBtn.addEventListener('pointerup', releaseJump);
jumpBtn.addEventListener('pointercancel', releaseJump);
jumpBtn.addEventListener('pointerleave', releaseJump);

fireBtn.addEventListener('pointerdown', (event) => {
  event.preventDefault();
  event.stopPropagation();
  fireBtn.classList.add('is-pressed');
  fireBlunderbuss();
});
function releaseFire() { fireBtn.classList.remove('is-pressed'); }
fireBtn.addEventListener('pointerup', releaseFire);
fireBtn.addEventListener('pointercancel', releaseFire);
fireBtn.addEventListener('pointerleave', releaseFire);

/* ------------------------- UI bindings ------------------------- */

$('potatoBtn').addEventListener('click', () => startRun('potato'));
$('highBtn').addEventListener('click', () => startRun('high'));
itemSlot.addEventListener('click', () => setBlunderbussEquipped(!weapon.equipped));
$('settingsBtn').addEventListener('click', openSettings);
$('closeSettingsBtn').addEventListener('click', closeSettings);
$('resumeBtn').addEventListener('click', closeSettings);
document.querySelectorAll('[data-close-settings]').forEach((el) => {
  el.addEventListener('click', closeSettings);
});

for (const button of qualityButtons) {
  button.addEventListener('click', () => {
    const mode = button.dataset.quality;
    if (mode === currentQuality) return;
    applyQuality(mode, true);
  });
}

soundToggle.addEventListener('click', () => {
  const nextMuted = soundToggle.classList.contains('is-on');
  soundToggle.classList.toggle('is-on', !nextMuted);
  soundToggle.setAttribute('aria-checked', String(!nextMuted));
  setMuted(nextMuted);
  try { localStorage.setItem('vh_sound', nextMuted ? 'off' : 'on'); } catch (e) { /* ignore */ }
});

sensitivityInput.addEventListener('input', () => {
  sensitivity = Number(sensitivityInput.value);
  sensitivityValue.textContent = `${sensitivity.toFixed(1)}×`;
  try { localStorage.setItem('vh_sensitivity', String(sensitivity)); } catch (e) { /* ignore */ }
});

/* Restore small preferences (the graphics prompt always appears fresh). */
try {
  const savedSensitivity = Number(localStorage.getItem('vh_sensitivity'));
  if (Number.isFinite(savedSensitivity) && savedSensitivity >= 0.4 && savedSensitivity <= 2) {
    sensitivity = savedSensitivity;
    sensitivityInput.value = String(sensitivity);
    sensitivityValue.textContent = `${sensitivity.toFixed(1)}×`;
  }
  if (localStorage.getItem('vh_sound') === 'off') {
    audio.muted = true;
    soundToggle.classList.remove('is-on');
    soundToggle.setAttribute('aria-checked', 'false');
  }
} catch (e) { /* ignore */ }

window.addEventListener('resize', resize);

document.addEventListener('visibilitychange', () => {
  if (document.hidden) {
    keys.clear();
    resetJoystick();
    clock.getDelta();
  }
});

/* --------------------------- Player ---------------------------- */

function resolveCollisions() {
  const playerRadius = 0.33;
  for (let i = 0; i < treeColliders.length; i++) {
    const collider = treeColliders[i];
    const dx = player.x - collider.x;
    const dz = player.z - collider.z;
    const minDist = collider.r + playerRadius;
    const distSq = dx * dx + dz * dz;
    if (distSq < minDist * minDist && distSq > 0.00001) {
      const dist = Math.sqrt(distSq);
      const push = (minDist - dist) / dist;
      player.x += dx * push;
      player.z += dz * push;
    }
  }

  const radius = Math.hypot(player.x, player.z);
  if (radius > WORLD_RADIUS) {
    const scale = WORLD_RADIUS / radius;
    player.x *= scale;
    player.z *= scale;
  }
}

function updatePlayer(dt) {
  if (!started || settingsOpen) {
    player.vx = damp(player.vx, 0, 10, dt);
    player.vz = damp(player.vz, 0, 10, dt);
    return;
  }

  let forward = 0;
  let strafe = 0;

  if (isTouch) {
    forward = -joystickState.y;
    strafe = joystickState.x;
  } else {
    if (keys.has('KeyW') || keys.has('ArrowUp')) forward += 1;
    if (keys.has('KeyS') || keys.has('ArrowDown')) forward -= 1;
    if (keys.has('KeyD') || keys.has('ArrowRight')) strafe += 1;
    if (keys.has('KeyA') || keys.has('ArrowLeft')) strafe -= 1;
  }

  const inputLength = Math.hypot(forward, strafe);
  if (inputLength > 1) {
    forward /= inputLength;
    strafe /= inputLength;
  }

  const sprint = !isTouch && (keys.has('ShiftLeft') || keys.has('ShiftRight'));
  let speed = sprint ? 7.2 : 4.3;
  if (player.wading) speed *= 0.56;
  if (!player.onGround) speed *= 0.88;

  const sin = Math.sin(player.yaw);
  const cos = Math.cos(player.yaw);
  const targetVx = (-sin * forward + cos * strafe) * speed;
  const targetVz = (-cos * forward - sin * strafe) * speed;

  const accel = player.onGround ? 11 : 3.4;
  player.vx = damp(player.vx, targetVx, accel, dt);
  player.vz = damp(player.vz, targetVz, accel, dt);

  player.x += player.vx * dt;
  player.z += player.vz * dt;
  resolveCollisions();

  const terrainY = terrainHeight(player.x, player.z);
  const inWater = isWaterAt(player.x, player.z, terrainY);
  player.wading = inWater;

  if (player.jumpQueued) {
    if (player.onGround) {
      player.vy = 6.6;
      player.onGround = false;
      player.feetY += 0.05;
    }
    player.jumpQueued = false;
  }

  if (player.onGround) {
    const support = inWater ? Math.max(terrainY, WATER_LEVEL - 1.12) : terrainY;
    if (player.feetY > support + 0.55) {
      player.onGround = false;
    } else {
      player.feetY = damp(player.feetY, support, 22, dt);
    }
  }

  if (!player.onGround) {
    player.vy -= 19.5 * dt;
    player.feetY += player.vy * dt;
    const support = inWater ? Math.max(terrainY, WATER_LEVEL - 1.12) : terrainY;
    if (player.feetY <= support) {
      player.feetY = support;
      player.vy = 0;
      player.onGround = true;
    }
  }

  const horizontalSpeed = Math.hypot(player.vx, player.vz);
  const moving = horizontalSpeed > 0.35;

  if (moving && player.onGround) {
    player.stepDistance += horizontalSpeed * dt;
    const stride = sprint ? 2.65 : 2.15;
    if (player.stepDistance > stride) {
      player.stepDistance = 0;
      playFootstep(player.wading);
    }
    player.bobPhase += dt * (sprint ? 10.2 : 7.4) * clamp(horizontalSpeed / 4.3, 0.4, 1.4);
  } else {
    player.stepDistance = damp(player.stepDistance, 0, 4, dt);
    player.bobPhase += dt * 1.3;
  }

  const bobTarget = (moving && player.onGround) ? (sprint ? 0.048 : 0.031) : 0.002;
  player.bobAmount = damp(player.bobAmount, bobTarget, 7, dt);
}

function updateCamera(time, dt) {
  let yaw = player.yaw;
  let pitch = player.pitch;
  let x = player.x;
  let z = player.z;

  if (!started) {
    const introTime = time * 0.1;
    yaw = 0.1 + Math.sin(introTime) * 0.07;
    pitch = -0.01 + Math.sin(introTime * 0.7) * 0.012;
    x = SPAWN.x + Math.sin(introTime * 0.8) * 0.06;
    z = SPAWN.z;
  }

  const horizontalSpeed = Math.hypot(player.vx, player.vz);
  const bob = Math.sin(player.bobPhase * 2) * player.bobAmount;
  const sway = Math.cos(player.bobPhase) * player.bobAmount * 0.65;
  const breathe = started ? Math.sin(time * 1.1) * 0.006 : Math.sin(time * 0.8) * 0.004;

  camera.position.set(
    x + sway * Math.cos(yaw) * 0.35,
    player.feetY + player.eye + bob + breathe,
    z - sway * Math.sin(yaw) * 0.35
  );
  camera.rotation.y = yaw;
  camera.rotation.x = pitch + weapon.cameraKick * 0.018;
  camera.rotation.z = damp(
    camera.rotation.z,
    -player.vx * 0.0016 * Math.cos(yaw) + Math.sin(player.bobPhase) * player.bobAmount * 0.09,
    8,
    dt
  ) + weapon.cameraKick * 0.008 * Math.sin(time * 53);

  const sprinting = started && !isTouch && keys.has('ShiftLeft') && horizontalSpeed > 3.5;
  const targetFov = sprinting ? 71.5 : 68;
  if (Math.abs(camera.fov - targetFov) > 0.01) {
    camera.fov = damp(camera.fov, targetFov, 5, dt);
    camera.updateProjectionMatrix();
    resizeParticleScale();
  }
}

function resizeParticleScale() {
  const drawing = renderer.getDrawingBufferSize(new THREE.Vector2());
  const scale = drawing.y / (2 * Math.tan(THREE.MathUtils.degToRad(camera.fov) / 2));
  dust.material.uniforms.uScale.value = scale;
  fireflies.material.uniforms.uScale.value = scale;
  pathFireflies.material.uniforms.uScale.value = scale;
}

/* --------------------------- World anim ------------------------ */

const windSound = { value: 0 };

function updateWorld(time, dt) {
  windUniform.value = time;
  for (const surface of waterSurfaces) surface.uniforms.uTime.value = time;
  dust.material.uniforms.uTime.value = time;
  fireflies.material.uniforms.uTime.value = time;
  pathFireflies.material.uniforms.uTime.value = time;

  sky.position.copy(camera.position);
  sunSprite.position.copy(camera.position).addScaledVector(sunDir, 168);

  const shadowCenterX = Math.round(camera.position.x / 2) * 2;
  const shadowCenterZ = Math.round(camera.position.z / 2) * 2;
  const shadowCenterY = Math.round(player.feetY / 2) * 2;
  sun.position.set(
    shadowCenterX + sunDir.x * 68,
    shadowCenterY + sunDir.y * 68,
    shadowCenterZ + sunDir.z * 68
  );
  sun.target.position.set(shadowCenterX, shadowCenterY, shadowCenterZ);
  sun.target.updateMatrixWorld();

  if (rays.visible) {
    for (const ray of rays.children) {
      const dx = camera.position.x - ray.position.x;
      const dz = camera.position.z - ray.position.z;
      ray.rotation.y = Math.atan2(dx, dz);
    }
  }

  /* Keep fireflies near the ground rather than in the treetops. */
  if (fireflies.visible) {
    fireflies.position.y = 0;
  }
}

/* ---------------------------- Loop ----------------------------- */

function animate() {
  const dt = Math.min(clock.getDelta(), 0.05);
  const time = clock.elapsedTime;

  updatePlayer(dt);
  updateCamera(time, dt);
  updateWeapon(dt, time);
  updateWorld(time, dt);

  compassAccum += dt;
  if (compassAccum > 0.05) {
    compassAccum = 0;
    updateCompass();
  }

  if (started && !settingsOpen && time - lastRegionCheck > 0.35) {
    lastRegionCheck = time;
    checkRegions();
  }

  frameCount++;
  fpsTime += dt;
  if (fpsTime > 1.5) {
    fpsAvg = frameCount / fpsTime;
    frameCount = 0;
    fpsTime = 0;
    if (!slowWarningShown && started && !settingsOpen && currentQuality === 'high' && fpsAvg < 24 && time > 12) {
      slowWarningShown = true;
      showToast('The forest is running heavy. Potato Mode is in Settings, or press P.', 4200);
    }
  }

  renderer.render(scene, camera);
}

/* --------------------------- Boot ------------------------------ */

applyQuality('high', false);
resize();
updateCompass();
updateBodyState();
updateCamera(0, 0);
updateWorld(0, 0);
renderer.render(scene, camera);

/* A tiny safety net for automated preview tools. */
window.__verdantHollow = {
  get started() { return started; },
  start(mode = 'high') { startRun(mode); },
  setQuality: applyQuality,
  player
};
