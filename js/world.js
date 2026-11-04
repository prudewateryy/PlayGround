import * as THREE from '../vendor/three.module.min.js';
import { mulberry32, fbm, smoothstep, clamp } from './noise.js';
import { makeGroundMaps, makePathTexture, makeBarkTexture, makeSoftDotTexture } from './textures.js';
import { buildTrees } from './trees.js';
import { buildUnderstory } from './understory.js';

/* ============================================================
   Silverpine Wilds — world assembly
   ============================================================ */

const WORLD_SIZE = 260;
const PLAY_RADIUS = 102;
const CELL = 8;

const TRAIL_POINTS = [
  [0.4, 18], [0.2, 9], [0.8, 0], [1.8, -9], [3.2, -19],
  [-0.8, -30], [-2.8, -41], [1.8, -52], [-4.2, -63],
  [-10.8, -73], [-10.6, -84], [-13.8, -95], [-21.5, -108],
];

const SUN_DIR = new THREE.Vector3(0.46, 0.34, -0.56).normalize();

export function createWorld(scene, renderer) {
  const rng = mulberry32(20261104);
  const wind = { value: 0 };

  /* ---------- trail polyline ---------- */
  const trailCurve = new THREE.CatmullRomCurve3(
    TRAIL_POINTS.map(([x, z]) => new THREE.Vector3(x, 0, z)),
    false,
    'catmullrom',
    0.5
  );
  const trailSamples = trailCurve.getPoints(210);

  function pathDistance(x, z) {
    let best = Infinity;
    for (let i = 0; i < trailSamples.length - 1; i++) {
      const a = trailSamples[i];
      const b = trailSamples[i + 1];
      const dx = b.x - a.x;
      const dz = b.z - a.z;
      const len2 = dx * dx + dz * dz;
      let t = 0;
      if (len2 > 0) t = clamp(((x - a.x) * dx + (z - a.z) * dz) / len2, 0, 1);
      const px = a.x + dx * t - x;
      const pz = a.z + dz * t - z;
      const d2 = px * px + pz * pz;
      if (d2 < best) best = d2;
    }
    return Math.sqrt(best);
  }

  /* ---------- terrain height ---------- */
  function heightAt(x, z) {
    const radius = Math.hypot(x, z);
    let h = (fbm(x * 0.0115 + 4.3, z * 0.0115 - 2.1, 5) - 0.5) * 15;
    h += (fbm(x * 0.032 - 7.2, z * 0.032 + 3.4, 4) - 0.5) * 3.6;
    h += (fbm(x * 0.086 + 1.2, z * 0.086 + 8.9, 2) - 0.5) * 0.55;
    // A wide, quiet bowl around the starting glade.
    h *= smoothstep(10, 42, radius);
    // Forested rim that keeps the horizon closed.
    const edge = smoothstep(88, 128, radius);
    h += edge * edge * 17 + edge * (fbm(x * 0.021 + 9, z * 0.021 - 4, 3) - 0.34) * 8;
    return h;
  }

  const spawn = new THREE.Vector3(0.4, 0, 8.5);
  spawn.y = heightAt(spawn.x, spawn.z);

  /* ---------- renderer basics ---------- */
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.2;
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  scene.background = new THREE.Color(0x9fb1a6);
  scene.fog = new THREE.FogExp2(0x9fb1a6, 0.0092);

  /* ---------- sky ---------- */
  const skyUniforms = {
    uTop: { value: new THREE.Color(0x4b7b97) },
    uHorizon: { value: new THREE.Color(0xe9d3aa) },
    uSunColor: { value: new THREE.Color(0xffd9a0) },
    uSun: { value: SUN_DIR.clone() },
    uTime: { value: 0 },
    uCloud: { value: 1 },
  };
  const skyGeometry = new THREE.SphereGeometry(430, 32, 18);
  const skyMaterial = new THREE.ShaderMaterial({
    uniforms: skyUniforms,
    side: THREE.BackSide,
    depthWrite: false,
    fog: false,
    toneMapped: false,
    vertexShader: `
      varying vec3 vWorldPosition;
      void main() {
        vWorldPosition = (modelMatrix * vec4(position, 1.0)).xyz;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }
    `,
    fragmentShader: `
      uniform vec3 uTop;
      uniform vec3 uHorizon;
      uniform vec3 uSunColor;
      uniform vec3 uSun;
      uniform float uTime;
      uniform float uCloud;
      varying vec3 vWorldPosition;

      float hash21(vec2 p) {
        p = fract(p * vec2(123.34, 456.21));
        p += dot(p, p + 45.32);
        return fract(p.x * p.y);
      }
      float vnoise(vec2 p) {
        vec2 i = floor(p);
        vec2 f = fract(p);
        f = f * f * (3.0 - 2.0 * f);
        float a = hash21(i);
        float b = hash21(i + vec2(1.0, 0.0));
        float c = hash21(i + vec2(0.0, 1.0));
        float d = hash21(i + vec2(1.0, 1.0));
        return mix(mix(a, b, f.x), mix(c, d, f.x), f.y);
      }
      float cloudNoise(vec2 p) {
        float v = 0.0;
        float a = 0.58;
        for (int i = 0; i < 3; i++) {
          v += vnoise(p) * a;
          p = p * 2.03 + vec2(11.1, 6.7);
          a *= 0.5;
        }
        return v;
      }

      void main() {
        vec3 dir = normalize(vWorldPosition - cameraPosition);
        float h = clamp(dir.y, 0.0, 1.0);
        vec3 col = mix(uHorizon, uTop, pow(h, 0.42));

        float sd = max(dot(dir, uSun), 0.0);
        col += uSunColor * (pow(sd, 900.0) * 2.1 + pow(sd, 9.0) * 0.16);
        col += uSunColor * pow(max(1.0 - h, 0.0), 4.0) * 0.045;

        if (dir.y > 0.015) {
          vec2 sp = dir.xz / (dir.y + 0.18);
          vec2 uv = sp * 0.82 + vec2(uTime * 0.0022, uTime * 0.0008);
          float n = cloudNoise(uv * 1.12);
          float cloud = smoothstep(0.54, 0.79, n) * smoothstep(0.0, 0.26, dir.y) * uCloud;
          vec3 cloudCol = mix(vec3(0.67, 0.69, 0.68), vec3(1.0, 0.88, 0.70), pow(sd, 2.0));
          col = mix(col, cloudCol, cloud * 0.38);
        }

        col = mix(col, uHorizon, smoothstep(0.1, -0.05, dir.y) * 0.45);
        gl_FragColor = vec4(col, 1.0);
        #include <colorspace_fragment>
      }
    `,
  });
  const sky = new THREE.Mesh(skyGeometry, skyMaterial);
  sky.frustumCulled = false;
  sky.renderOrder = -10;
  scene.add(sky);

  /* ---------- lights ---------- */
  const sun = new THREE.DirectionalLight(0xffe2b6, 2.35);
  sun.castShadow = true;
  sun.shadow.mapSize.set(1536, 1536);
  sun.shadow.camera.left = -48;
  sun.shadow.camera.right = 48;
  sun.shadow.camera.top = 48;
  sun.shadow.camera.bottom = -48;
  sun.shadow.camera.near = 1;
  sun.shadow.camera.far = 190;
  sun.shadow.bias = -0.00055;
  sun.shadow.normalBias = 0.035;
  scene.add(sun);
  scene.add(sun.target);

  const hemi = new THREE.HemisphereLight(0xd1e2db, 0x5b4d35, 2.25);
  scene.add(hemi);
  const ambient = new THREE.AmbientLight(0x7d9182, 0.78);
  scene.add(ambient);
  const fill = new THREE.DirectionalLight(0xa4c9be, 0.85);
  fill.position.set(-60, 42, 80);
  scene.add(fill);

  /* ---------- terrain ---------- */
  const groundMaps = makeGroundMaps();
  const groundGeometry = new THREE.PlaneGeometry(WORLD_SIZE, WORLD_SIZE, 200, 200);
  groundGeometry.rotateX(-Math.PI / 2);
  const groundPos = groundGeometry.attributes.position;
  const groundColors = new Float32Array(groundPos.count * 3);
  const cDeep = new THREE.Color(0x27331f);
  const cMoss = new THREE.Color(0x45512c);
  const cLoam = new THREE.Color(0x4f3f2a);
  const cDirt = new THREE.Color(0x5e4e39);
  const cStone = new THREE.Color(0x66665a);
  const cFern = new THREE.Color(0x364c26);
  const tmpColor = new THREE.Color();

  for (let i = 0; i < groundPos.count; i++) {
    const x = groundPos.getX(i);
    const z = groundPos.getZ(i);
    const y = heightAt(x, z);
    groundPos.setY(i, y);

    const n1 = fbm(x * 0.07 + 20, z * 0.07 - 13, 3);
    const n2 = fbm(x * 0.29 - 5, z * 0.29 + 8, 2);
    const slope = Math.hypot(heightAt(x + 0.9, z) - heightAt(x - 0.9, z), heightAt(x, z + 0.9) - heightAt(x, z - 0.9)) / 1.8;
    const pd = pathDistance(x, z);

    tmpColor.copy(cDeep);
    tmpColor.lerp(cMoss, smoothstep(0.25, 0.75, n1));
    tmpColor.lerp(cLoam, smoothstep(0.45, 0.9, n2) * 0.55);
    tmpColor.lerp(cFern, smoothstep(0.55, 0.95, fbm(x * 0.14 + 5, z * 0.14 - 2, 2)) * 0.4);
    tmpColor.lerp(cStone, smoothstep(0.7, 1.5, slope) * 0.72);
    tmpColor.lerp(cDirt, smoothstep(4.2, 1.1, pd) * 0.78);
    tmpColor.multiplyScalar(0.85 + n2 * 0.28);

    groundColors[i * 3] = tmpColor.r;
    groundColors[i * 3 + 1] = tmpColor.g;
    groundColors[i * 3 + 2] = tmpColor.b;
  }
  groundGeometry.setAttribute('color', new THREE.BufferAttribute(groundColors, 3));
  groundGeometry.computeVertexNormals();

  const groundMaterial = new THREE.MeshStandardMaterial({
    map: groundMaps.map,
    bumpMap: groundMaps.bump,
    bumpScale: 0.32,
    vertexColors: true,
    roughness: 0.985,
    metalness: 0,
  });
  const terrain = new THREE.Mesh(groundGeometry, groundMaterial);
  terrain.receiveShadow = true;
  scene.add(terrain);

  /* ---------- trail ribbon ---------- */
  {
    const ribbonSamples = trailCurve.getPoints(300);
    const vertices = [];
    const uvs = [];
    const indices = [];
    let distance = 0;
    for (let i = 0; i < ribbonSamples.length; i++) {
      const p = ribbonSamples[i];
      const prev = ribbonSamples[Math.max(0, i - 1)];
      const next = ribbonSamples[Math.min(ribbonSamples.length - 1, i + 1)];
      const tx = next.x - prev.x;
      const tz = next.z - prev.z;
      const tl = Math.hypot(tx, tz) || 1;
      const nx = -tz / tl;
      const nz = tx / tl;
      if (i > 0) distance += Math.hypot(p.x - ribbonSamples[i - 1].x, p.z - ribbonSamples[i - 1].z);
      const width = 0.94 + Math.sin(i * 0.21) * 0.08;
      const lx = p.x + nx * width;
      const lz = p.z + nz * width;
      const rx = p.x - nx * width;
      const rz = p.z - nz * width;
      vertices.push(lx, heightAt(lx, lz) + 0.045, lz);
      vertices.push(rx, heightAt(rx, rz) + 0.045, rz);
      uvs.push(0, distance * 0.22, 1, distance * 0.22);
      if (i < ribbonSamples.length - 1) {
        const a = i * 2;
        indices.push(a, a + 2, a + 1, a + 1, a + 2, a + 3);
      }
    }
    const ribbonGeometry = new THREE.BufferGeometry();
    ribbonGeometry.setAttribute('position', new THREE.Float32BufferAttribute(vertices, 3));
    ribbonGeometry.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
    ribbonGeometry.setIndex(indices);
    ribbonGeometry.computeVertexNormals();
    const ribbonMaterial = new THREE.MeshStandardMaterial({
      map: makePathTexture(),
      transparent: true,
      alphaTest: 0.08,
      roughness: 1,
      metalness: 0,
      polygonOffset: true,
      polygonOffsetFactor: -2,
      polygonOffsetUnits: -2,
    });
    const ribbon = new THREE.Mesh(ribbonGeometry, ribbonMaterial);
    ribbon.receiveShadow = true;
    scene.add(ribbon);
  }

  /* ---------- collision grid ---------- */
  const colliderGrid = new Map();
  function addCollider(x, z, r) {
    const cx = Math.floor(x / CELL);
    const cz = Math.floor(z / CELL);
    const key = `${cx},${cz}`;
    if (!colliderGrid.has(key)) colliderGrid.set(key, []);
    colliderGrid.get(key).push({ x, z, r });
  }

  function resolveCollision(x, z, radius) {
    let px = x;
    let pz = z;
    for (let pass = 0; pass < 2; pass++) {
      const cx = Math.floor(px / CELL);
      const cz = Math.floor(pz / CELL);
      for (let gx = cx - 1; gx <= cx + 1; gx++) {
        for (let gz = cz - 1; gz <= cz + 1; gz++) {
          const list = colliderGrid.get(`${gx},${gz}`);
          if (!list) continue;
          for (let i = 0; i < list.length; i++) {
            const c = list[i];
            let dx = px - c.x;
            let dz = pz - c.z;
            const min = c.r + radius;
            const d2 = dx * dx + dz * dz;
            if (d2 < min * min) {
              let d = Math.sqrt(d2);
              if (d < 0.0001) { dx = 1; dz = 0; d = 1; }
              px = c.x + (dx / d) * min;
              pz = c.z + (dz / d) * min;
            }
          }
        }
      }
    }
    // The forest edge keeps its own counsel.
    const r = Math.hypot(px, pz);
    if (r > PLAY_RADIUS) {
      px = (px / r) * PLAY_RADIUS;
      pz = (pz / r) * PLAY_RADIUS;
    }
    return { x: px, z: pz };
  }

  /* ---------- vegetation ---------- */
  const barkTexture = makeBarkTexture();
  const trees = buildTrees({
    scene,
    heightAt,
    pathDistance,
    addCollider,
    barkTexture,
    seed: 1337,
  });

  const understory = buildUnderstory({
    scene,
    heightAt,
    pathDistance,
    addCollider,
    wind,
    seed: 5521,
    trailSamples,
  });

  /* ---------- drifting mist ---------- */
  const softDot = makeSoftDotTexture();
  const mistCount = 170;
  const mistPositions = new Float32Array(mistCount * 3);
  const mistBaseY = new Float32Array(mistCount);
  const mistPhase = new Float32Array(mistCount);
  for (let i = 0; i < mistCount; i++) {
    const x = (rng() * 2 - 1) * 118;
    const z = (rng() * 2 - 1) * 118;
    const y = heightAt(x, z) + 0.8 + rng() * 4.2;
    mistPositions[i * 3] = x;
    mistPositions[i * 3 + 1] = y;
    mistPositions[i * 3 + 2] = z;
    mistBaseY[i] = y;
    mistPhase[i] = rng() * Math.PI * 2;
  }
  const mistGeometry = new THREE.BufferGeometry();
  mistGeometry.setAttribute('position', new THREE.BufferAttribute(mistPositions, 3));
  const mistMaterial = new THREE.PointsMaterial({
    size: 18,
    map: softDot,
    transparent: true,
    opacity: 0.055,
    depthWrite: false,
    color: 0xdfe7d6,
    sizeAttenuation: true,
    fog: true,
  });
  const mist = new THREE.Points(mistGeometry, mistMaterial);
  mist.frustumCulled = false;
  scene.add(mist);

  /* ---------- floating pollen ---------- */
  const moteCount = 420;
  const motePositions = new Float32Array(moteCount * 3);
  const moteBase = new Float32Array(moteCount * 3);
  const motePhase = new Float32Array(moteCount);
  for (let i = 0; i < moteCount; i++) {
    const x = (rng() * 2 - 1) * 96;
    const z = (rng() * 2 - 1) * 96;
    const y = heightAt(x, z) + 0.4 + rng() * 4.5;
    motePositions[i * 3] = x;
    motePositions[i * 3 + 1] = y;
    motePositions[i * 3 + 2] = z;
    moteBase[i * 3] = x;
    moteBase[i * 3 + 1] = y;
    moteBase[i * 3 + 2] = z;
    motePhase[i] = rng() * Math.PI * 2;
  }
  const moteGeometry = new THREE.BufferGeometry();
  moteGeometry.setAttribute('position', new THREE.BufferAttribute(motePositions, 3));
  const moteMaterial = new THREE.PointsMaterial({
    size: 0.075,
    map: softDot,
    transparent: true,
    opacity: 0.62,
    depthWrite: false,
    color: 0xffe4b0,
    blending: THREE.AdditiveBlending,
    sizeAttenuation: true,
    fog: true,
  });
  const motes = new THREE.Points(moteGeometry, moteMaterial);
  motes.frustumCulled = false;
  scene.add(motes);

  /* ---------- god rays ---------- */
  const shaftGroup = new THREE.Group();
  const shaftGeometry = new THREE.ConeGeometry(1, 1, 12, 1, true);
  const shaftMaterial = new THREE.MeshBasicMaterial({
    color: 0xffe9bd,
    transparent: true,
    opacity: 0.022,
    depthWrite: false,
    side: THREE.DoubleSide,
    blending: THREE.AdditiveBlending,
    fog: true,
  });
  const raySpots = [
    [-8, -6], [12, -18], [-18, -32], [24, -38], [-2, -52], [34, -8], [-38, 10], [16, 22],
  ];
  for (let i = 0; i < raySpots.length; i++) {
    const [x, z] = raySpots[i];
    const width = 3.4 + rng() * 4.5;
    const height = 34 + rng() * 16;
    const mesh = new THREE.Mesh(shaftGeometry, shaftMaterial.clone());
    mesh.scale.set(width, height, width);
    const groundY = heightAt(x, z);
    mesh.position.set(x, groundY, z).addScaledVector(SUN_DIR, height * 0.5);
    mesh.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), SUN_DIR);
    mesh.frustumCulled = false;
    mesh.renderOrder = 3;
    mesh.material.opacity = 0.012 + rng() * 0.02;
    shaftGroup.add(mesh);
  }
  scene.add(shaftGroup);

  /* ---------- landmarks ---------- */
  const landmarks = [
    { name: 'The Clearing', x: 0, z: 8, r: 18 },
    { name: 'The Elder Pine', x: 27, z: -45, r: 23 },
    { name: 'Fern Gully', x: -66, z: -12, r: 42 },
    { name: 'The Long Hollow', x: -13, z: -84, r: 35 },
    { name: 'Mossbank', x: 14, z: 41, r: 28 },
    { name: 'Sunken Pines', x: 68, z: -58, r: 45 },
    { name: 'The Stone Ring', x: 14, z: 41, r: 11 },
    { name: 'Split Boulder', x: -33, z: -19, r: 15 },
  ];

  /* ---------- quality ---------- */
  let potato = false;
  function setPotato(on) {
    potato = on;
    understory.setPotato(on);
    renderer.shadowMap.enabled = !on;
    sun.castShadow = !on;
    skyUniforms.uCloud.value = on ? 0.22 : 1;
    mist.visible = !on;
    motes.visible = !on;
    shaftGroup.visible = !on;
    scene.fog.density = on ? 0.0135 : 0.0092;
    renderer.shadowMap.needsUpdate = true;
  }

  /* ---------- per-frame atmosphere ---------- */
  function update(time, dt, cameraPos) {
    wind.value = time;
    skyUniforms.uTime.value = time;
    sky.position.copy(cameraPos);

    sun.position.set(
      cameraPos.x + SUN_DIR.x * 85,
      cameraPos.y + SUN_DIR.y * 85,
      cameraPos.z + SUN_DIR.z * 85
    );
    sun.target.position.set(cameraPos.x, heightAt(cameraPos.x, cameraPos.z), cameraPos.z);
    sun.target.updateMatrixWorld();

    if (!potato) {
      const mistPos = mistGeometry.attributes.position;
      for (let i = 0; i < mistCount; i++) {
        const speed = 0.24 + (i % 7) * 0.035;
        let x = mistPos.getX(i) + speed * dt;
        if (x > 124) x -= 248;
        mistPos.setX(i, x);
        mistPos.setY(i, mistBaseY[i] + Math.sin(time * 0.19 + mistPhase[i]) * 0.24);
      }
      mistPos.needsUpdate = true;

      const motePos = moteGeometry.attributes.position;
      for (let i = 0; i < moteCount; i++) {
        const ph = motePhase[i];
        motePos.setX(i, moteBase[i * 3] + Math.sin(time * 0.24 + ph) * 1.15);
        motePos.setY(i, moteBase[i * 3 + 1] + Math.sin(time * 0.5 + ph * 1.7) * 0.34);
        motePos.setZ(i, moteBase[i * 3 + 2] + Math.cos(time * 0.21 + ph) * 1.0);
      }
      motePos.needsUpdate = true;

      for (let i = 0; i < shaftGroup.children.length; i++) {
        const shaft = shaftGroup.children[i];
        shaft.material.opacity = (0.012 + (i % 4) * 0.004) + Math.sin(time * 0.24 + i) * 0.006;
      }
    }
  }

  return {
    heightAt,
    pathDistance,
    resolveCollision,
    spawn,
    landmarks,
    setPotato,
    update,
    sun,
    sky,
    trees,
    understory,
    playRadius: PLAY_RADIUS,
  };
}
