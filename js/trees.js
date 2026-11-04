import * as THREE from '../vendor/three.module.min.js';
import { mulberry32, fbm } from './noise.js';
import { makeNeedleTexture, makeCanopyTexture, makeCanopyCardTexture, makeNeedleCardTexture } from './textures.js';

/* ============================================================
   Trees, fallen logs and stumps
   ============================================================ */

const PINE_GREENS = [0x315735, 0x39623b, 0x416b40, 0x4a7546, 0x54804c, 0x5d8a53, 0x37603a];
const LEAF_GREENS = [0x3f6836, 0x48723c, 0x527d42, 0x5c8748, 0x679150, 0x729b58];
const AUTUMN = [0x9b9148, 0xb09b51, 0xc0a55a, 0x948648];


function pick(rng, arr) { return arr[Math.floor(rng() * arr.length)]; }

function vary(rng, hexA, hexB, t) {
  const a = new THREE.Color(hexA);
  const b = new THREE.Color(hexB);
  return a.lerp(b, t);
}

function createInstanced(scene, geometry, material, items, castShadow = true) {
  if (!items.length) return null;
  const mesh = new THREE.InstancedMesh(geometry, material, items.length);
  for (let i = 0; i < items.length; i++) {
    mesh.setMatrixAt(i, items[i].matrix);
    if (items[i].color) mesh.setColorAt(i, items[i].color);
  }
  mesh.instanceMatrix.needsUpdate = true;
  if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
  mesh.castShadow = castShadow;
  mesh.receiveShadow = true;
  mesh.frustumCulled = false;
  scene.add(mesh);
  return mesh;
}

function deformGeometry(geometry, amount, seed) {
  const pos = geometry.attributes.position;
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i);
    const y = pos.getY(i);
    const z = pos.getZ(i);
    const len = Math.sqrt(x * x + y * y + z * z) || 1;
    const n = fbm(x * 2.3 + seed * 0.11, (z + y * 0.62) * 2.3 + seed * 0.07, 3);
    const k = 1 + (n - 0.5) * amount * 2;
    pos.setXYZ(i, (x / len) * k, (y / len) * k, (z / len) * k);
  }
  geometry.computeVertexNormals();
  return geometry;
}

// Three intersecting quads make a cheap, volumetric-looking foliage card.
function makeCrossCardGeometry(planes = 3) {
  const positions = [];
  const normals = [];
  const uvs = [];
  const colors = [];
  const indices = [];
  const corners = [
    [-0.5, -0.5, 0], [0.5, -0.5, 0], [0.5, 0.5, 0], [-0.5, 0.5, 0],
  ];
  for (let p = 0; p < planes; p++) {
    const a = (p / planes) * Math.PI;
    const ca = Math.cos(a);
    const sa = Math.sin(a);
    const base = p * 4;
    for (const [x, y] of corners) {
      const px = x * ca;
      const pz = x * sa;
      positions.push(px, y, pz);
      normals.push(-sa, 0, ca);
      uvs.push(x + 0.5, y + 0.5);
      // Gentle shading gradient so cards do not read as flat cutouts.
      const shade = 0.72 + (y + 0.5) * 0.4;
      colors.push(shade, shade, shade);
    }
    indices.push(base, base + 1, base + 2, base, base + 2, base + 3);
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.setAttribute('normal', new THREE.Float32BufferAttribute(normals, 3));
  geometry.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  geometry.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
  geometry.setIndex(indices);
  return geometry;
}

// A pine tier with a scalloped, drooping hem instead of a clean cone edge.
function makePineTierGeometry() {
  const rings = [
    { y: -0.06, r: 1.16 },
    { y: 0.02, r: 1.0 },
    { y: 0.3, r: 0.67 },
    { y: 0.64, r: 0.34 },
    { y: 1.0, r: 0.015 },
  ];
  const segments = 14;
  const positions = [];
  const uvs = [];
  const indices = [];
  for (let r = 0; r < rings.length; r++) {
    const ring = rings[r];
    for (let i = 0; i < segments; i++) {
      const a = (i / segments) * Math.PI * 2;
      const jag = r === 0
        ? (i % 3 === 0 ? 0.16 : i % 2 === 0 ? -0.08 : 0.04)
        : Math.sin(i * 2.7 + r * 1.9) * 0.035 + Math.cos(i * 4.1 + r) * 0.02;
      const rr = ring.r * (1 + jag) * (r === 0 ? 1 : 1);
      const yy = ring.y + (r === 0 && i % 3 === 0 ? -0.05 : 0);
      positions.push(Math.cos(a) * rr, yy, Math.sin(a) * rr);
      uvs.push((i / segments) * 2.4, r / (rings.length - 1));
    }
  }
  for (let r = 0; r < rings.length - 1; r++) {
    for (let i = 0; i < segments; i++) {
      const n = (i + 1) % segments;
      const a = r * segments + i;
      const b = r * segments + n;
      const c = (r + 1) * segments + i;
      const d = (r + 1) * segments + n;
      indices.push(a, c, b, b, c, d);
    }
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  geometry.setIndex(indices);
  geometry.computeVertexNormals();
  return geometry;
}


export function buildTrees({
  scene,
  heightAt,
  pathDistance,
  addCollider,
  barkTexture,
  seed = 1337,
}) {
  const rng = mulberry32(seed);
  const placed = [];

  const trunkGeometry = new THREE.CylinderGeometry(0.72, 1, 1, 7, 1);
  const pineGeometry = makePineTierGeometry();
  const leafGeometry = deformGeometry(new THREE.IcosahedronGeometry(1, 1), 0.28, 44);
  const leafDetailGeometry = deformGeometry(new THREE.IcosahedronGeometry(1, 2), 0.22, 51);
  const branchGeometry = new THREE.CylinderGeometry(0.55, 1, 1, 5, 1);

  const barkMaterial = new THREE.MeshStandardMaterial({
    map: barkTexture,
    color: 0xffffff,
    roughness: 0.97,
    metalness: 0,
  });
  const needleTexture = makeNeedleTexture();
  const canopyTexture = makeCanopyTexture();
  const cardGeometry = makeCrossCardGeometry(3);
  const canopyCardMaterial = new THREE.MeshStandardMaterial({
    map: makeCanopyCardTexture(),
    alphaTest: 0.38,
    side: THREE.DoubleSide,
    vertexColors: true,
    color: 0xffffff,
    roughness: 0.95,
    metalness: 0,
  });
  const needleCardMaterial = new THREE.MeshStandardMaterial({
    map: makeNeedleCardTexture(),
    alphaTest: 0.32,
    side: THREE.DoubleSide,
    vertexColors: true,
    color: 0xffffff,
    roughness: 0.94,
    metalness: 0,
  });
  const pineMaterial = new THREE.MeshStandardMaterial({
    map: needleTexture,
    bumpMap: needleTexture,
    bumpScale: 0.22,
    color: 0xffffff,
    roughness: 0.9,
    metalness: 0,
    flatShading: false,
  });
  const leafMaterial = new THREE.MeshStandardMaterial({
    map: canopyTexture,
    bumpMap: canopyTexture,
    bumpScale: 0.2,
    color: 0xffffff,
    roughness: 0.92,
    metalness: 0,
    flatShading: false,
  });
  const branchMaterial = new THREE.MeshStandardMaterial({
    map: barkTexture,
    color: 0x6e6658,
    roughness: 1,
  });

  const trunks = [];
  const pines = [];
  const pineCards = [];
  const leafCards = [];
  const leaves = [];
  const leavesDetail = [];
  const branches = [];
  const stumps = [];
  const stumpTops = [];


  const tmpPos = new THREE.Vector3();
  const tmpQuat = new THREE.Quaternion();
  const tmpScale = new THREE.Vector3();
  const tmpMatrix = new THREE.Matrix4();
  const up = new THREE.Vector3(0, 1, 0);
  const dir = new THREE.Vector3();

  function matrixAt(x, y, z, sx, sy, sz, rotY = 0, quat = null) {
    tmpPos.set(x, y, z);
    if (quat) tmpQuat.copy(quat);
    else tmpQuat.setFromAxisAngle(up, rotY);
    tmpScale.set(sx, sy, sz);
    return new THREE.Matrix4().compose(tmpPos, tmpQuat, tmpScale);
  }

  function addTree(x, z, kind, scale = 1, elder = false) {
    const y = heightAt(x, z);
    const rotY = rng() * Math.PI * 2;

    if (kind === 'pine') {
      const h = (7 + rng() * 9) * scale * (elder ? 2.1 : 1);
      const radius = (0.2 + h * 0.019) * (elder ? 1.35 : 1);
      const baseR = (elder ? h * 0.19 : h * (0.145 + rng() * 0.04));
      const trunkColor = vary(rng, 0x5b4e3e, 0x83705a, rng()).multiplyScalar(0.88 + rng() * 0.22);
      trunks.push({
        matrix: matrixAt(x, y + h / 2, z, radius, h, radius, rotY),
        color: trunkColor,
      });

      // Layered crown gives the pine mass; the cards beneath break its edge.
      const layers = elder ? 10 : 8;
      for (let i = 0; i < layers; i++) {
        const t = i / (layers - 1);
        const layerBase = h * (0.14 + t * 0.66);
        const layerHeight = h * (0.32 - t * 0.06);
        const layerRadius = baseR * 0.92 * (1 - t * 0.8) * (0.9 + rng() * 0.16);
        const color = vary(rng, pick(rng, PINE_GREENS), pick(rng, PINE_GREENS), rng());
        color.multiplyScalar(0.92 + rng() * 0.18);
        pines.push({
          matrix: matrixAt(x, y + layerBase, z, layerRadius, layerHeight, layerRadius, rotY + i * 0.55),
          color,
        });
      }

      // Feathery needle boughs around the crown: the real silhouette.
      const tiers = elder ? 10 : 8;
      for (let i = 0; i < tiers; i++) {
        const t = i / (tiers - 1);
        const layerY = y + h * (0.2 + t * 0.68);
        const tierR = baseR * (1 - t * 0.8);
        const count = elder ? 5 : 3;
        for (let j = 0; j < count; j++) {
          const a = (j / count) * Math.PI * 2 + rotY + i * 0.8 + rng() * 0.4;
          const spread = tierR * (0.25 + rng() * 0.35);
          const w = tierR * (1.55 + rng() * 0.55);
          const hh = h * (0.11 + rng() * 0.05) * (1 - t * 0.24);
          const color = vary(rng, 0xa9c09b, 0xe4efd4, rng()).multiplyScalar(0.86 + rng() * 0.22);
          pineCards.push({
            matrix: matrixAt(
              x + Math.cos(a) * spread,
              layerY + hh * 0.08 + rng() * 0.15,
              z + Math.sin(a) * spread,
              w, hh, w, a
            ),
            color,
          });
        }
      }

      if (elder) addCollider(x, z, radius + 0.8);
      else if (Math.hypot(x, z) < 106) addCollider(x, z, radius + 0.32);
    } else if (kind === 'broadleaf') {
      const birch = rng() < 0.2;
      const h = (6.2 + rng() * 7.4) * scale;
      const radius = 0.18 + h * 0.018;
      const trunkColor = birch
        ? vary(rng, 0xbdb9a2, 0xdedac4, rng())
        : vary(rng, 0x514335, 0x7b684e, rng()).multiplyScalar(0.86 + rng() * 0.22);
      trunks.push({
        matrix: matrixAt(x, y + h / 2, z, radius, h, radius, rotY),
        color: trunkColor,
      });

      const autumn = rng() < 0.12;
      const centralColor = autumn
        ? vary(rng, pick(rng, AUTUMN), pick(rng, AUTUMN), rng())
        : vary(rng, pick(rng, LEAF_GREENS), pick(rng, LEAF_GREENS), rng());
      centralColor.multiplyScalar(0.9 + rng() * 0.14);
      const centralSize = h * (0.19 + rng() * 0.045);
      leavesDetail.push({
        matrix: matrixAt(x, y + h * 0.85, z, centralSize, centralSize * (0.86 + rng() * 0.16), centralSize, rng() * 6),
        color: centralColor,
      });

      // Open out the crown into smaller clustered masses.
      const blobs = 8 + Math.floor(rng() * 5);
      for (let i = 0; i < blobs; i++) {
        const a = (i / blobs) * Math.PI * 2 + rng() * 0.9;
        const spread = h * (0.12 + rng() * 0.19);
        const bx = x + Math.cos(a) * spread;
        const bz = z + Math.sin(a) * spread;
        const by = y + h * (0.74 + rng() * 0.3);
        const s = h * (0.085 + rng() * 0.06);
        const color = autumn
          ? vary(rng, pick(rng, AUTUMN), pick(rng, AUTUMN), rng())
          : vary(rng, pick(rng, LEAF_GREENS), pick(rng, LEAF_GREENS), rng());
        color.multiplyScalar(0.9 + rng() * 0.16);
        leaves.push({
          matrix: matrixAt(bx, by, bz, s * (0.85 + rng() * 0.4), s * (0.8 + rng() * 0.35), s, rng() * 6),
          color,
        });
      }

      // Leafy sprays soften the silhouette and catch the low sun.
      const cards = 22 + Math.floor(rng() * 8);
      for (let i = 0; i < cards; i++) {
        const a = (i / cards) * Math.PI * 2 + rng() * 0.8;
        const spread = h * (0.12 + rng() * 0.26);
        const s = h * (0.18 + rng() * 0.12);
        const color = autumn
          ? vary(rng, 0xb7a05c, 0xe7d08c, rng())
          : vary(rng, 0x9cb58e, 0xd7e6c4, rng());
        color.multiplyScalar(0.86 + rng() * 0.2);
        leafCards.push({
          matrix: matrixAt(
            x + Math.cos(a) * spread,
            y + h * (0.66 + rng() * 0.42),
            z + Math.sin(a) * spread,
            s * (1.0 + rng() * 0.5), s * (0.85 + rng() * 0.4), s * (1.0 + rng() * 0.5),
            rng() * 6
          ),
          color,
        });
      }

      // A lower skirt of shade leaves.
      const skirt = 3 + Math.floor(rng() * 3);
      for (let i = 0; i < skirt; i++) {
        const a = rng() * Math.PI * 2;
        const spread = h * (0.18 + rng() * 0.14);
        const s = h * (0.08 + rng() * 0.05);
        leaves.push({
          matrix: matrixAt(x + Math.cos(a) * spread, y + h * (0.54 + rng() * 0.14), z + Math.sin(a) * spread, s, s * 0.72, s, rng() * 6),
          color: vary(rng, 0x2f4d2a, 0x4a6b36, rng()),
        });
      }

      // Visible forking limbs beneath the crown.
      const limbs = 3 + Math.floor(rng() * 3);
      for (let i = 0; i < limbs; i++) {
        const a = rotY + (i / limbs) * Math.PI * 2 + rng() * 0.5;
        const from = y + h * (0.4 + rng() * 0.2);
        const len = h * (0.2 + rng() * 0.16);
        const rise = 0.55 + rng() * 0.5;
        dir.set(Math.cos(a), rise, Math.sin(a)).normalize();
        const bq = new THREE.Quaternion().setFromUnitVectors(up, dir);
        branches.push({
          matrix: matrixAt(x + dir.x * len * 0.5, from + dir.y * len * 0.5, z + dir.z * len * 0.5, radius * 0.42, len, radius * 0.42, 0, bq),
          color: trunkColor,
        });
      }

      if (Math.hypot(x, z) < 106) addCollider(x, z, radius + 0.3);
    } else {
      // A leaning, weathered dead tree.
      const h = (5 + rng() * 8) * scale;
      const radius = 0.16 + rng() * 0.14;
      const trunkColor = vary(rng, 0x6b6557, 0x8b8473, rng());
      const leanX = (rng() - 0.5) * 0.7;
      const leanZ = (rng() - 0.5) * 0.7;
      const q = new THREE.Quaternion().setFromEuler(new THREE.Euler(leanX, rotY, leanZ));
      trunks.push({
        matrix: matrixAt(x, y + h / 2, z, radius, h, radius, 0, q),
        color: trunkColor,
      });

      const branchCount = 2 + Math.floor(rng() * 3);
      for (let i = 0; i < branchCount; i++) {
        const by = y + h * (0.35 + rng() * 0.5);
        const a = rng() * Math.PI * 2;
        const len = 1.2 + rng() * 2.4;
        dir.set(Math.cos(a), 0.15 + rng() * 0.6, Math.sin(a)).normalize();
        const bq = new THREE.Quaternion().setFromUnitVectors(up, dir);
        branches.push({
          matrix: matrixAt(x + dir.x * len * 0.45, by + dir.y * len * 0.45, z + dir.z * len * 0.45, radius * 0.42, len, radius * 0.42, 0, bq),
          color: trunkColor,
        });
      }
      if (Math.hypot(x, z) < 106) addCollider(x, z, radius + 0.28);
    }

    placed.push({ x, z, r: 3.1 * scale });
  }

  /* ---------- main forest ---------- */
  const targetTrees = 790;
  let guard = 0;
  while (placed.length < targetTrees && guard < 16000) {
    guard++;
    const x = (rng() * 2 - 1) * 122;
    const z = (rng() * 2 - 1) * 122;
    const radius = Math.hypot(x, z);
    if (radius > 123) continue;
    if (radius < 13.5) continue;
    if (pathDistance(x, z) < 4.2) continue;
    if (rng() < 0.1 && pathDistance(x, z) < 8) continue;

    const dx = heightAt(x + 0.7, z) - heightAt(x - 0.7, z);
    const dz = heightAt(x, z + 0.7) - heightAt(x, z - 0.7);
    if (Math.hypot(dx, dz) / 1.4 > 0.95) continue;

    let crowded = false;
    for (let i = 0; i < placed.length; i++) {
      const p = placed[i];
      const ddx = p.x - x;
      const ddz = p.z - z;
      if (ddx * ddx + ddz * ddz < p.r * p.r) { crowded = true; break; }
    }
    if (crowded) continue;

    const roll = rng();
    const kind = roll < 0.54 ? 'pine' : roll < 0.9 ? 'broadleaf' : 'dead';
    addTree(x, z, kind, 0.8 + rng() * 0.5);
  }

  /* ---------- the elder pine ---------- */
  addTree(27, -45, 'pine', 1.15, true);

  /* ---------- dense edge wall ---------- */
  for (let i = 0; i < 170; i++) {
    const a = rng() * Math.PI * 2;
    const radius = 108 + rng() * 18;
    const x = Math.cos(a) * radius;
    const z = Math.sin(a) * radius;
    addTree(x, z, rng() < 0.82 ? 'pine' : 'broadleaf', 0.9 + rng() * 0.5);
  }

  const trunkMesh = createInstanced(scene, trunkGeometry, barkMaterial, trunks);
  const pineMesh = createInstanced(scene, pineGeometry, pineMaterial, pines);
  const pineCardMesh = createInstanced(scene, cardGeometry, needleCardMaterial, pineCards, false);
  const leafMesh = createInstanced(scene, leafGeometry, leafMaterial, leaves);
  const leafDetailMesh = createInstanced(scene, leafDetailGeometry, leafMaterial, leavesDetail);
  const leafCardMesh = createInstanced(scene, cardGeometry, canopyCardMaterial, leafCards, false);
  const branchMesh = createInstanced(scene, branchGeometry, branchMaterial, branches, false);
  if (branchMesh) branchMesh.castShadow = true;
  if (pineCardMesh) pineCardMesh.receiveShadow = true;
  if (leafCardMesh) leafCardMesh.receiveShadow = true;

  /* ---------- fallen logs ---------- */
  const logMaterials = [
    new THREE.MeshStandardMaterial({ map: barkTexture, color: 0x9b8568, roughness: 1 }),
    new THREE.MeshStandardMaterial({ map: barkTexture, color: 0x7f725d, roughness: 1 }),
    new THREE.MeshStandardMaterial({ map: barkTexture, color: 0x8c7a5d, roughness: 1 }),
  ];
  const logGeometry = new THREE.CylinderGeometry(0.82, 1, 1, 9, 1);
  const logGroup = new THREE.Group();
  for (let i = 0; i < 19; i++) {
    let x = 0;
    let z = 0;
    let ok = false;
    for (let tries = 0; tries < 40; tries++) {
      x = (rng() * 2 - 1) * 102;
      z = (rng() * 2 - 1) * 102;
      if (Math.hypot(x, z) < 16) continue;
      if (pathDistance(x, z) < 5) continue;
      ok = true;
      break;
    }
    if (!ok) continue;

    const length = 3.2 + rng() * 5.2;
    const radius = 0.24 + rng() * 0.27;
    const angle = rng() * Math.PI * 2;
    const mesh = new THREE.Mesh(logGeometry, logMaterials[i % logMaterials.length]);
    const d = new THREE.Vector3(Math.cos(angle), 0, Math.sin(angle));
    mesh.quaternion.setFromUnitVectors(up, d);
    mesh.scale.set(radius, length, radius);
    mesh.position.set(x, heightAt(x, z) + radius * 0.92, z);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    logGroup.add(mesh);

    if (Math.hypot(x, z) < 104) {
      for (const t of [-0.32, 0, 0.32]) {
        addCollider(x + d.x * length * t, z + d.z * length * t, radius + 0.25);
      }
    }
  }
  scene.add(logGroup);

  /* ---------- stumps ---------- */
  const stumpGeometry = new THREE.CylinderGeometry(0.9, 1, 1, 8, 1);
  const stumpCapGeometry = new THREE.CircleGeometry(1, 12);
  stumpCapGeometry.rotateX(-Math.PI / 2);
  const capMaterial = new THREE.MeshStandardMaterial({ color: 0xac8e60, roughness: 0.86 });
  for (let i = 0; i < 23; i++) {
    let x = 0;
    let z = 0;
    for (let tries = 0; tries < 30; tries++) {
      x = (rng() * 2 - 1) * 104;
      z = (rng() * 2 - 1) * 104;
      if (Math.hypot(x, z) < 14) continue;
      if (pathDistance(x, z) < 3.8) continue;
      break;
    }
    const h = 0.35 + rng() * 0.9;
    const r = 0.38 + rng() * 0.35;
    const y = heightAt(x, z);
    stumps.push({
      matrix: matrixAt(x, y + h / 2, z, r, h, r, rng() * 6),
      color: vary(rng, 0x66553f, 0x8b7557, rng()),
    });
    stumpTops.push({
      matrix: matrixAt(x, y + h + 0.008, z, r * 0.98, 1, r * 0.98, rng() * 6),
      color: vary(rng, 0xad8d5d, 0xc9aa79, rng()),
    });
    if (Math.hypot(x, z) < 104) addCollider(x, z, r + 0.2);
  }
  createInstanced(scene, stumpGeometry, barkMaterial, stumps);
  const capMesh = createInstanced(scene, stumpCapGeometry, capMaterial, stumpTops, false);
  if (capMesh) capMesh.castShadow = false;

  return {
    trunkMesh,
    pineMesh,
    pineCardMesh,
    leafMesh,
    leafDetailMesh,
    leafCardMesh,
    branchMesh,
    logGroup,
    counts: {
      trunks: trunks.length,
      pines: pines.length,
      cards: pineCards.length + leafCards.length,
      leaves: leaves.length + leavesDetail.length,
    },
    elderPine: new THREE.Vector3(27, heightAt(27, -45), -45),
  };
}
