import * as THREE from '../vendor/three.module.min.js';
import { mulberry32, fbm } from './noise.js';
import { makeGrassTexture, makeLeafTexture, makeSoftDotTexture } from './textures.js';

/* ============================================================
   Understory: grass, ferns, shrubs, stones, flowers, fungi
   ============================================================ */

const GRASS_COLORS = [0x9cae80, 0x8fa376, 0xa7b689, 0xb3c095, 0x84996e, 0x97aa7d];
const FERN_COLORS = [0x2f512a, 0x3b6030, 0x476d34, 0x537a3b, 0x5f8641];
const ROCK_COLORS = [0x4f5348, 0x5b5c50, 0x474c43, 0x626154, 0x545a4f, 0x6a6558];
const BUSH_COLORS = [0x2e4d29, 0x385a30, 0x426736, 0x4c723b, 0x577d42];


function pick(rng, array) { return array[Math.floor(rng() * array.length)]; }

function buildInstanced(scene, geometry, material, items, { cast = false, receive = true } = {}) {
  if (!items.length) return null;
  const mesh = new THREE.InstancedMesh(geometry, material, items.length);
  for (let i = 0; i < items.length; i++) {
    mesh.setMatrixAt(i, items[i].matrix);
    if (items[i].color) mesh.setColorAt(i, items[i].color);
  }
  mesh.instanceMatrix.needsUpdate = true;
  if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
  mesh.castShadow = cast;
  mesh.receiveShadow = receive;
  mesh.frustumCulled = false;
  scene.add(mesh);
  return mesh;
}

function deform(geometry, amount, seed) {
  const pos = geometry.attributes.position;
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i);
    const y = pos.getY(i);
    const z = pos.getZ(i);
    const len = Math.sqrt(x * x + y * y + z * z) || 1;
    const n = fbm(x * 2.8 + seed * 0.13, (z + y * 0.5) * 2.8 + seed * 0.09, 3);
    const k = 1 + (n - 0.5) * amount * 2;
    pos.setXYZ(i, (x / len) * k, (y / len) * k, (z / len) * k);
  }
  geometry.computeVertexNormals();
  return geometry;
}

function makeWindMaterial(material, windUniform, strength) {
  material.onBeforeCompile = (shader) => {
    shader.uniforms.uWindTime = windUniform;
    shader.vertexShader = 'uniform float uWindTime;\n' + shader.vertexShader;
    shader.vertexShader = shader.vertexShader.replace(
      '#include <begin_vertex>',
      `#include <begin_vertex>
      #ifdef USE_INSTANCING
        vec3 iPos = vec3(instanceMatrix[3][0], instanceMatrix[3][1], instanceMatrix[3][2]);
        float bend = uv.y * uv.y;
        float w = sin(uWindTime * 1.35 + iPos.x * 0.23 + iPos.z * 0.19) * ${strength.toFixed(3)};
        w += sin(uWindTime * 2.7 + iPos.x * 0.61 + iPos.z * 0.17) * ${(strength * 0.28).toFixed(3)};
        transformed.x += w * bend;
        transformed.z += w * 0.55 * bend;
      #endif`
    );
  };
  material.customProgramCacheKey = () => `wind-${strength}`;
  return material;
}

function makeGrassGeometry(segments = 3) {
  const positions = [];
  const uvs = [];
  const indices = [];
  let v = 0;
  for (let plane = 0; plane < 2; plane++) {
    const a = plane * Math.PI * 0.5;
    const ca = Math.cos(a);
    const sa = Math.sin(a);
    const base = v;
    for (let s = 0; s <= segments; s++) {
      const t = s / segments;
      const y = t;
      const x = -0.5;
      const z = 0;
      positions.push(x * ca, y, x * sa);
      positions.push(-x * ca, y, -x * sa);
      uvs.push(0, t, 1, t);
      if (s < segments) {
        const i0 = base + s * 2;
        indices.push(i0, i0 + 1, i0 + 2, i0 + 1, i0 + 3, i0 + 2);
      }
      v += 2;
    }
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  geometry.setIndex(indices);
  geometry.computeVertexNormals();
  return geometry;
}

function makeFernGeometry(seed) {
  const rng = mulberry32(seed);
  const positions = [];
  const uvs = [];
  const indices = [];
  const fronds = 8;
  let v = 0;

  for (let f = 0; f < fronds; f++) {
    const angle = (f / fronds) * Math.PI * 2 + (rng() - 0.5) * 0.5;
    const length = 0.78 + rng() * 0.45;
    const segs = 6;
    const cos = Math.cos(angle);
    const sin = Math.sin(angle);
    const perpX = Math.cos(angle + Math.PI / 2);
    const perpZ = Math.sin(angle + Math.PI / 2);
    const baseIndex = v;

    for (let s = 0; s <= segs; s++) {
      const t = s / segs;
      const dist = t * length;
      const x = cos * dist;
      const z = sin * dist;
      const y = 0.04 + Math.sin(t * Math.PI) * (0.34 + rng() * 0.03) - t * 0.06;
      const width = (1 - t) * 0.115 + 0.006;
      positions.push(x + perpX * width, y, z + perpZ * width);
      uvs.push(0, t);
      positions.push(x - perpX * width, y, z - perpZ * width);
      uvs.push(1, t);
      if (s < segs) {
        const a = baseIndex + s * 2;
        indices.push(a, a + 1, a + 2, a + 1, a + 3, a + 2);
      }
      v += 2;
    }
  }

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  geometry.setIndex(indices);
  geometry.computeVertexNormals();
  return geometry;
}

export function buildUnderstory({
  scene,
  heightAt,
  pathDistance,
  addCollider,
  wind,
  seed = 5521,
}) {
  const rng = mulberry32(seed);
  const up = new THREE.Vector3(0, 1, 0);

  const mat4 = (x, y, z, sx, sy, sz, rot) => {
    const q = new THREE.Quaternion().setFromAxisAngle(up, rot);
    return new THREE.Matrix4().compose(
      new THREE.Vector3(x, y, z),
      q,
      new THREE.Vector3(sx, sy, sz)
    );
  };

  /* ---------------- grass ---------------- */

  const grassTexture = makeGrassTexture();
  const grassGeometry = makeGrassGeometry(2);
  const grassMaterial = makeWindMaterial(
    new THREE.MeshStandardMaterial({
      map: grassTexture,
      alphaTest: 0.32,
      side: THREE.DoubleSide,
      roughness: 1,
      metalness: 0,
      color: 0xffffff,
    }),
    wind,
    0.07
  );

  const grassItems = [];
  const grassTotal = 25000;
  for (let i = 0; i < grassTotal; i++) {
    const x = (rng() * 2 - 1) * 122;
    const z = (rng() * 2 - 1) * 122;
    if (Math.hypot(x, z) > 124) continue;
    if (pathDistance(x, z) < 1.45) continue;
    const scale = 0.34 + rng() * 0.56;
    const y = heightAt(x, z) + 0.01;
    grassItems.push({
      matrix: mat4(x, y, z, scale * (0.62 + rng() * 0.42), scale, scale * (0.62 + rng() * 0.42), rng() * Math.PI * 2),
      color: new THREE.Color(pick(rng, GRASS_COLORS)).multiplyScalar(0.86 + rng() * 0.24),
    });
  }
  // Extra lushness crowding the trail edges.
  for (let i = 0; i < 4800; i++) {
    const angle = rng() * Math.PI * 2;
    const dist = 1.7 + rng() * 7;
    const t = rng();
    // Sample along the trail polyline approximately by picking a random point nearby.
    const bx = Math.sin(t * 18) * 12 + (rng() - 0.5) * 8;
    const bz = 12 - t * 120 + (rng() - 0.5) * 8;
    const x = bx + Math.cos(angle) * dist;
    const z = bz + Math.sin(angle) * dist;
    if (pathDistance(x, z) < 1.55 || Math.hypot(x, z) > 122) continue;
    const scale = 0.38 + rng() * 0.62;
    grassItems.push({
      matrix: mat4(x, heightAt(x, z) + 0.01, z, scale * (0.62 + rng() * 0.42), scale, scale * (0.62 + rng() * 0.42), rng() * Math.PI * 2),
      color: new THREE.Color(pick(rng, GRASS_COLORS)).multiplyScalar(0.88 + rng() * 0.2),
    });
  }
  const grass = buildInstanced(scene, grassGeometry, grassMaterial, grassItems);


  /* ---------------- ferns ---------------- */

  const fernGeometry = makeFernGeometry(118);
  const fernMaterial = makeWindMaterial(
    new THREE.MeshStandardMaterial({
      color: 0xffffff,
      roughness: 0.9,
      metalness: 0,
      side: THREE.DoubleSide,
      flatShading: true,
    }),
    wind,
    0.045
  );
  const fernItems = [];
  for (let i = 0; i < 840; i++) {
    const x = (rng() * 2 - 1) * 112;
    const z = (rng() * 2 - 1) * 112;
    const r = Math.hypot(x, z);
    if (r < 11 || r > 118) continue;
    const pd = pathDistance(x, z);
    if (pd < 2.1) continue;
    if (pd > 10 && rng() > 0.55) continue;
    const scale = 0.65 + rng() * 0.9;
    fernItems.push({
      matrix: mat4(x, heightAt(x, z) + 0.02, z, scale, scale * (0.75 + rng() * 0.4), scale, rng() * Math.PI * 2),
      color: new THREE.Color(pick(rng, FERN_COLORS)).multiplyScalar(0.85 + rng() * 0.25),
    });
  }
  // Ferns gathered around the spawning glade.
  for (let i = 0; i < 240; i++) {
    const a = rng() * Math.PI * 2;
    const r = 12 + rng() * 13;
    const x = Math.cos(a) * r;
    const z = Math.sin(a) * r;
    if (pathDistance(x, z) < 2.2) continue;
    const scale = 0.65 + rng() * 0.95;
    fernItems.push({
      matrix: mat4(x, heightAt(x, z) + 0.02, z, scale, scale, scale, rng() * Math.PI * 2),
      color: new THREE.Color(pick(rng, FERN_COLORS)).multiplyScalar(0.9 + rng() * 0.2),
    });
  }
  const ferns = buildInstanced(scene, fernGeometry, fernMaterial, fernItems);

  /* ---------------- shrubs ---------------- */

  const bushGeometry = deform(new THREE.IcosahedronGeometry(1, 1), 0.35, 97);
  const bushMaterial = new THREE.MeshStandardMaterial({
    color: 0xffffff,
    roughness: 0.94,
    metalness: 0,
    flatShading: false,
  });
  const bushItems = [];
  for (let i = 0; i < 330; i++) {
    const x = (rng() * 2 - 1) * 116;
    const z = (rng() * 2 - 1) * 116;
    const r = Math.hypot(x, z);
    if (r < 10 || r > 122) continue;
    if (pathDistance(x, z) < 2.8) continue;
    const s = 0.45 + rng() * 1.25;
    bushItems.push({
      matrix: mat4(x, heightAt(x, z) + s * 0.28, z, s * (0.9 + rng() * 0.5), s * (0.6 + rng() * 0.45), s, rng() * 6),
      color: new THREE.Color(pick(rng, BUSH_COLORS)).multiplyScalar(0.9 + rng() * 0.2),
    });
  }
  const bushes = buildInstanced(scene, bushGeometry, bushMaterial, bushItems);

  /* ---------------- stones ---------------- */

  const rockGeometry = deform(new THREE.DodecahedronGeometry(1, 0), 0.34, 73);
  const rockMaterial = new THREE.MeshStandardMaterial({
    color: 0xffffff,
    roughness: 0.97,
    metalness: 0,
    flatShading: true,
  });
  const rockItems = [];
  function addRock(x, z, s, yOffset = 0.24) {
    const sy = s * (0.55 + rng() * 0.6);
    rockItems.push({
      matrix: mat4(x, heightAt(x, z) + sy * yOffset, z, s * (0.85 + rng() * 0.45), sy, s * (0.85 + rng() * 0.45), rng() * 6),
      color: new THREE.Color(pick(rng, ROCK_COLORS)).multiplyScalar(0.9 + rng() * 0.2),
    });
  }
  for (let i = 0; i < 250; i++) {
    const x = (rng() * 2 - 1) * 118;
    const z = (rng() * 2 - 1) * 118;
    if (Math.hypot(x, z) > 121) continue;
    if (pathDistance(x, z) < 1.9) continue;
    const big = rng() < 0.08;
    const s = big ? 1.1 + rng() * 1.5 : 0.15 + rng() * 0.55;
    addRock(x, z, s);
    if (big && Math.hypot(x, z) < 105) addCollider(x, z, s * 0.9);
  }
  // Trail-side stepping stones and pebbles.
  for (let i = 0; i < 120; i++) {
    const t = rng();
    const x = Math.sin(t * 18) * 12 + (rng() - 0.5) * 3.6;
    const z = 12 - t * 120;
    if (Math.abs(x) < 1 && rng() < 0.6) continue;
    addRock(x, z, 0.12 + rng() * 0.28, 0.1);
  }
  // A ring of mossy stones on the southern bank.
  for (let i = 0; i < 9; i++) {
    const a = (i / 9) * Math.PI * 2;
    const x = 14 + Math.cos(a) * 6.4;
    const z = 41 + Math.sin(a) * 6.4;
    addRock(x, z, 0.9 + rng() * 0.7, 0.22);
    addCollider(x, z, 0.8);
  }
  // A big split boulder west of the trail.
  addRock(-34, -20, 3.2, 0.18);
  addRock(-30.8, -18.6, 1.7, 0.2);
  addCollider(-34, -20, 2.6);
  addCollider(-30.8, -18.6, 1.4);

  const rocks = buildInstanced(scene, rockGeometry, rockMaterial, rockItems, { cast: true });

  /* ---------------- flowers (points) ---------------- */

  const flowerPositions = [];
  const flowerColors = [];
  const flowerPalette = [0xfff1c4, 0xffe08a, 0xf5f0dd, 0xd8c7f0, 0xf5c7b6, 0xffd7e2];
  for (let i = 0; i < 1200; i++) {
    const x = (rng() * 2 - 1) * 112;
    const z = (rng() * 2 - 1) * 112;
    const r = Math.hypot(x, z);
    if (r < 10 || r > 116) continue;
    const pd = pathDistance(x, z);
    if (pd < 1.3) continue;
    if (pd > 8 && rng() > 0.35) continue;
    flowerPositions.push(x, heightAt(x, z) + 0.14 + rng() * 0.28, z);
    const c = new THREE.Color(pick(rng, flowerPalette));
    flowerColors.push(c.r, c.g, c.b);
  }
  const flowerGeometry = new THREE.BufferGeometry();
  flowerGeometry.setAttribute('position', new THREE.Float32BufferAttribute(flowerPositions, 3));
  flowerGeometry.setAttribute('color', new THREE.Float32BufferAttribute(flowerColors, 3));
  const flowerMaterial = new THREE.PointsMaterial({
    size: 0.13,
    map: makeSoftDotTexture(),
    alphaTest: 0.2,
    transparent: true,
    opacity: 0.9,
    vertexColors: true,
    sizeAttenuation: true,
    depthWrite: true,
  });
  const flowers = new THREE.Points(flowerGeometry, flowerMaterial);
  flowers.frustumCulled = false;
  scene.add(flowers);

  /* ---------------- mushrooms ---------------- */

  const stemGeometry = new THREE.CylinderGeometry(0.07, 0.11, 1, 5);
  stemGeometry.translate(0, 0.5, 0);
  const capGeometry = new THREE.SphereGeometry(1, 8, 4, 0, Math.PI * 2, 0, Math.PI / 2);
  const stemMaterial = new THREE.MeshStandardMaterial({ color: 0xd8cfba, roughness: 0.96 });
  const capMaterial = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.82, flatShading: true });
  const mushroomPalette = [0xa9472e, 0xc2672f, 0xd9a44d, 0x8f6a45, 0xe0d6ba, 0x7d5636];
  const stems = [];
  const caps = [];
  let mushroomGuard = 0;
  while (stems.length < 210 && mushroomGuard < 900) {
    mushroomGuard++;
    const x = (rng() * 2 - 1) * 108;
    const z = (rng() * 2 - 1) * 108;
    const r = Math.hypot(x, z);
    if (r < 12 || r > 114) continue;
    if (pathDistance(x, z) < 2) continue;
    const y = heightAt(x, z);
    const cluster = 1 + Math.floor(rng() * 3);
    for (let c = 0; c < cluster && stems.length < 210; c++) {
      const ox = (rng() - 0.5) * 0.7;
      const oz = (rng() - 0.5) * 0.7;
      const h = 0.11 + rng() * 0.26;
      const capR = 0.08 + rng() * 0.16;
      const rot = rng() * Math.PI * 2;
      stems.push({
        matrix: mat4(x + ox, y, z + oz, 1, h, 1, rot),
      });
      caps.push({
        matrix: mat4(x + ox, y + h, z + oz, capR, capR * (0.45 + rng() * 0.2), capR, rot),
        color: new THREE.Color(pick(rng, mushroomPalette)),
      });
    }
  }
  const stemMesh = buildInstanced(scene, stemGeometry, stemMaterial, stems, { cast: false });
  const capMesh = buildInstanced(scene, capGeometry, capMaterial, caps, { cast: false });

  /* ---------------- leaf litter ---------------- */

  const leafTexture = makeLeafTexture();
  const leafGeometry = new THREE.PlaneGeometry(0.34, 0.2);
  leafGeometry.rotateX(-Math.PI / 2);
  const leafMaterial = new THREE.MeshStandardMaterial({
    map: leafTexture,
    alphaTest: 0.35,
    side: THREE.DoubleSide,
    roughness: 1,
    color: 0xffffff,
  });
  const leafItems = [];
  const leafPalette = [0xb18b4f, 0x9a7442, 0xc3a263, 0x8a6638, 0xb79a5f, 0x7d6239, 0xc4b178];
  for (let i = 0; i < 3200; i++) {
    const x = (rng() * 2 - 1) * 114;
    const z = (rng() * 2 - 1) * 114;
    if (Math.hypot(x, z) > 118) continue;
    if (pathDistance(x, z) < 1.8) continue;
    const s = 0.55 + rng() * 1.15;
    leafItems.push({
      matrix: mat4(x, heightAt(x, z) + 0.012, z, s, 1, s, rng() * Math.PI * 2),
      color: new THREE.Color(pick(rng, leafPalette)).multiplyScalar(0.85 + rng() * 0.25),
    });
  }
  const leafLitter = buildInstanced(scene, leafGeometry, leafMaterial, leafItems, { cast: false, receive: false });

  /* ---------------- potato controls ---------------- */

  const full = {
    grass: grassItems.length,
    ferns: fernItems.length,
    leaves: leafItems.length,
  };

  function setPotato(on) {
    if (grass) grass.count = on ? 900 : full.grass;
    if (ferns) ferns.count = on ? 80 : full.ferns;
    if (leafLitter) leafLitter.count = on ? 0 : full.leaves;
    if (flowers) flowers.visible = !on;
    if (mushroomCap) mushroomCap.visible = !on;
    if (stemMesh) stemMesh.visible = !on;
    if (bushes) bushes.visible = true;
    if (rocks) rocks.visible = true;
  }

  const mushroomCap = capMesh;

  return {
    grass,
    ferns,
    bushes,
    rocks,
    flowers,
    mushrooms: { stems: stemMesh, caps: capMesh },
    leafLitter,
    setPotato,
    counts: full,
  };
}
