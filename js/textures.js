import * as THREE from '../vendor/three.module.min.js';
import { mulberry32, makeCanvas } from './noise.js';

/* ---------- ground ---------- */

export function makeGroundMaps() {
  const rng = mulberry32(9417);
  const size = 512;
  const canvas = makeCanvas(size);
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = '#c9c3ae';
  ctx.fillRect(0, 0, size, size);

  for (let i = 0; i < 90; i++) {
    const r = 8 + rng() * 46;
    ctx.fillStyle = rng() > 0.5
      ? `rgba(112, 101, 79, ${0.04 + rng() * 0.07})`
      : `rgba(226, 219, 196, ${0.04 + rng() * 0.06})`;
    ctx.beginPath();
    ctx.arc(rng() * size, rng() * size, r, 0, Math.PI * 2);
    ctx.fill();
  }

  // Soil grain
  for (let i = 0; i < 26000; i++) {
    const x = rng() * size;
    const y = rng() * size;
    const s = 0.4 + rng() * 1.5;
    const tone = rng();
    ctx.fillStyle = tone > 0.72
      ? `rgba(238, 231, 209, ${0.08 + rng() * 0.2})`
      : `rgba(74, 65, 49, ${0.05 + rng() * 0.23})`;
    ctx.fillRect(x, y, s, s * (0.6 + rng()));
  }

  // Twigs and pine needles
  for (let i = 0; i < 420; i++) {
    const x = rng() * size;
    const y = rng() * size;
    const a = rng() * Math.PI * 2;
    const len = 3 + rng() * 16;
    ctx.strokeStyle = rng() > 0.5
      ? `rgba(74, 58, 38, ${0.14 + rng() * 0.2})`
      : `rgba(174, 143, 86, ${0.1 + rng() * 0.17})`;
    ctx.lineWidth = 0.5 + rng();
    ctx.beginPath();
    ctx.moveTo(x, y);
    ctx.lineTo(x + Math.cos(a) * len, y + Math.sin(a) * len);
    ctx.stroke();
  }

  // Tiny moss flecks
  for (let i = 0; i < 700; i++) {
    const x = rng() * size;
    const y = rng() * size;
    const r = 1 + rng() * 5;
    ctx.fillStyle = `rgba(${60 + rng() * 30}, ${74 + rng() * 35}, ${38 + rng() * 20}, ${0.05 + rng() * 0.12})`;
    ctx.beginPath();
    ctx.arc(x, y, r, 0, Math.PI * 2);
    ctx.fill();
  }

  const map = new THREE.CanvasTexture(canvas);
  map.wrapS = map.wrapT = THREE.RepeatWrapping;
  map.repeat.set(52, 52);
  map.colorSpace = THREE.SRGBColorSpace;
  map.anisotropy = 8;

  // A soft, grayscale height field for the bump map.
  const bumpCanvas = makeCanvas(256);
  const bctx = bumpCanvas.getContext('2d');
  const bimg = bctx.createImageData(256, 256);
  for (let i = 0; i < 256 * 256; i++) {
    const v = 108 + rng() * 70;
    bimg.data[i * 4] = v;
    bimg.data[i * 4 + 1] = v;
    bimg.data[i * 4 + 2] = v;
    bimg.data[i * 4 + 3] = 255;
  }
  bctx.putImageData(bimg, 0, 0);
  for (let i = 0; i < 2400; i++) {
    const x = rng() * 256;
    const y = rng() * 256;
    bctx.fillStyle = `rgba(40, 40, 40, ${0.08 + rng() * 0.25})`;
    bctx.fillRect(x, y, 1 + rng() * 2, 1 + rng() * 2);
  }
  const bump = new THREE.CanvasTexture(bumpCanvas);
  bump.wrapS = bump.wrapT = THREE.RepeatWrapping;
  bump.repeat.set(52, 52);

  return { map, bump };
}

/* ---------- trail ---------- */

export function makePathTexture() {
  const rng = mulberry32(7223);
  const size = 512;
  const canvas = makeCanvas(size);
  const ctx = canvas.getContext('2d');

  const grad = ctx.createLinearGradient(0, 0, size, 0);
  grad.addColorStop(0, 'rgba(58, 53, 43, 0)');
  grad.addColorStop(0.12, 'rgba(58, 53, 43, 0.72)');
  grad.addColorStop(0.24, 'rgba(66, 59, 47, 0.98)');
  grad.addColorStop(0.76, 'rgba(64, 57, 46, 0.98)');
  grad.addColorStop(0.88, 'rgba(58, 53, 43, 0.7)');
  grad.addColorStop(1, 'rgba(58, 53, 43, 0)');
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, size, size);

  // Uneven, scuffed edges.
  ctx.globalCompositeOperation = 'destination-out';
  for (let y = 0; y < size; y += 3) {
    const left = 34 + Math.sin(y * 0.05) * 8 + rng() * 18;
    const right = 478 - Math.sin(y * 0.043 + 2) * 9 - rng() * 18;
    ctx.beginPath();
    ctx.arc(left, y, 4 + rng() * 10, 0, Math.PI * 2);
    ctx.arc(right, y, 4 + rng() * 10, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.globalCompositeOperation = 'source-over';

  // Dirt mottling.
  for (let i = 0; i < 5200; i++) {
    const x = 50 + rng() * 412;
    const y = rng() * size;
    const s = 0.7 + rng() * 3.4;
    const dark = rng() > 0.48;
    ctx.fillStyle = dark
      ? `rgba(${52 + rng() * 26}, ${43 + rng() * 22}, ${28 + rng() * 18}, ${0.08 + rng() * 0.24})`
      : `rgba(${190 + rng() * 40}, ${173 + rng() * 35}, ${137 + rng() * 30}, ${0.08 + rng() * 0.2})`;
    ctx.beginPath();
    ctx.ellipse(x, y, s, s * (0.5 + rng()), rng() * Math.PI, 0, Math.PI * 2);
    ctx.fill();
  }

  // Small stones in the track.
  for (let i = 0; i < 110; i++) {
    const x = 80 + rng() * 352;
    const y = rng() * size;
    const r = 1.5 + rng() * 5;
    const tone = 66 + rng() * 26;
    ctx.fillStyle = `rgba(${tone}, ${tone - 5}, ${tone - 13}, ${0.16 + rng() * 0.26})`;
    ctx.beginPath();
    ctx.ellipse(x, y, r, r * 0.72, rng() * Math.PI, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = 'rgba(172, 163, 140, 0.08)';
    ctx.beginPath();
    ctx.ellipse(x - r * 0.2, y - r * 0.25, r * 0.48, r * 0.3, rng() * Math.PI, 0, Math.PI * 2);
    ctx.fill();
  }

  // Moss creeping in from the edges.
  for (let i = 0; i < 340; i++) {
    const side = rng() > 0.5;
    const x = side ? 30 + rng() * 52 : 430 + rng() * 55;
    const y = rng() * size;
    ctx.fillStyle = `rgba(${47 + rng() * 26}, ${67 + rng() * 28}, ${34 + rng() * 20}, ${0.1 + rng() * 0.2})`;
    ctx.beginPath();
    ctx.arc(x, y, 2 + rng() * 9, 0, Math.PI * 2);
    ctx.fill();
  }

  const map = new THREE.CanvasTexture(canvas);
  map.wrapS = THREE.ClampToEdgeWrapping;
  map.wrapT = THREE.RepeatWrapping;
  map.colorSpace = THREE.SRGBColorSpace;
  map.anisotropy = 8;
  return map;
}

/* ---------- bark ---------- */

export function makeBarkTexture() {
  const rng = mulberry32(3389);
  const w = 256;
  const h = 256;
  const canvas = makeCanvas(w, h);
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = '#7d6c54';
  ctx.fillRect(0, 0, w, h);

  for (let i = 0; i < 130; i++) {
    const x = rng() * w;
    const width = 1 + rng() * 9;
    ctx.strokeStyle = rng() > 0.5
      ? `rgba(${42 + rng() * 24}, ${35 + rng() * 20}, ${24 + rng() * 16}, ${0.16 + rng() * 0.34})`
      : `rgba(${160 + rng() * 45}, ${144 + rng() * 36}, ${115 + rng() * 30}, ${0.08 + rng() * 0.22})`;
    ctx.lineWidth = width;
    ctx.beginPath();
    let y = -10;
    let cx = x;
    ctx.moveTo(cx, y);
    while (y < h + 10) {
      y += 8 + rng() * 15;
      cx += (rng() - 0.5) * 6;
      ctx.lineTo(cx, y);
    }
    ctx.stroke();
  }

  // Knots
  for (let i = 0; i < 22; i++) {
    const x = rng() * w;
    const y = rng() * h;
    const r = 2 + rng() * 8;
    ctx.strokeStyle = `rgba(40, 32, 22, ${0.25 + rng() * 0.3})`;
    ctx.lineWidth = 1 + rng() * 1.6;
    ctx.beginPath();
    ctx.ellipse(x, y, r, r * 0.45, 0, 0, Math.PI * 2);
    ctx.stroke();
    ctx.fillStyle = `rgba(42, 34, 23, ${0.18 + rng() * 0.2})`;
    ctx.beginPath();
    ctx.ellipse(x, y, r * 0.55, r * 0.24, 0, 0, Math.PI * 2);
    ctx.fill();
  }

  // Moss on the weather side.
  for (let i = 0; i < 260; i++) {
    const x = rng() * w;
    const y = rng() * h;
    ctx.fillStyle = `rgba(${58 + rng() * 32}, ${79 + rng() * 30}, ${40 + rng() * 22}, ${0.05 + rng() * 0.18})`;
    ctx.beginPath();
    ctx.arc(x, y, 1 + rng() * 5, 0, Math.PI * 2);
    ctx.fill();
  }

  const map = new THREE.CanvasTexture(canvas);
  map.wrapS = map.wrapT = THREE.RepeatWrapping;
  map.repeat.set(2, 3);
  map.colorSpace = THREE.SRGBColorSpace;
  map.anisotropy = 4;
  return map;
}

/* ---------- needle and canopy detail ---------- */

export function makeNeedleTexture() {
  const rng = mulberry32(551);
  const size = 256;
  const canvas = makeCanvas(size);
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = '#d6d6c8';
  ctx.fillRect(0, 0, size, size);
  for (let i = 0; i < 1400; i++) {
    const x = rng() * size;
    const y = rng() * size;
    const len = 5 + rng() * 24;
    ctx.strokeStyle = rng() > 0.55
      ? `rgba(58, 72, 46, ${0.05 + rng() * 0.18})`
      : `rgba(255, 255, 238, ${0.05 + rng() * 0.16})`;
    ctx.lineWidth = 0.5 + rng() * 1.2;
    ctx.beginPath();
    ctx.moveTo(x, y);
    ctx.lineTo(x + (rng() - 0.5) * 4, y + len);
    ctx.stroke();
  }
  for (let i = 0; i < 260; i++) {
    const x = rng() * size;
    const y = rng() * size;
    ctx.fillStyle = `rgba(42, 54, 33, ${0.04 + rng() * 0.13})`;
    ctx.beginPath();
    ctx.arc(x, y, 0.8 + rng() * 2, 0, Math.PI * 2);
    ctx.fill();
  }
  const map = new THREE.CanvasTexture(canvas);
  map.wrapS = map.wrapT = THREE.RepeatWrapping;
  map.repeat.set(3, 2);
  map.colorSpace = THREE.SRGBColorSpace;
  map.anisotropy = 4;
  return map;
}

export function makeCanopyTexture() {
  const rng = mulberry32(991);
  const size = 256;
  const canvas = makeCanvas(size);
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = '#cdcec1';
  ctx.fillRect(0, 0, size, size);
  for (let i = 0; i < 280; i++) {
    const x = rng() * size;
    const y = rng() * size;
    const r = 3 + rng() * 16;
    const dark = rng() > 0.5;
    ctx.fillStyle = dark
      ? `rgba(53, 70, 42, ${0.04 + rng() * 0.16})`
      : `rgba(248, 246, 224, ${0.04 + rng() * 0.15})`;
    ctx.beginPath();
    ctx.ellipse(x, y, r, r * (0.55 + rng() * 0.6), rng() * Math.PI, 0, Math.PI * 2);
    ctx.fill();
  }
  for (let i = 0; i < 1800; i++) {
    ctx.fillStyle = rng() > 0.5
      ? `rgba(44, 58, 34, ${0.04 + rng() * 0.12})`
      : `rgba(255, 255, 235, ${0.04 + rng() * 0.12})`;
    ctx.fillRect(rng() * size, rng() * size, 1 + rng() * 2, 1 + rng() * 2);
  }
  const map = new THREE.CanvasTexture(canvas);
  map.wrapS = map.wrapT = THREE.RepeatWrapping;
  map.repeat.set(2.4, 2.4);
  map.colorSpace = THREE.SRGBColorSpace;
  map.anisotropy = 4;
  return map;
}

/* ---------- leaf / needle silhouette cards ---------- */

function drawLeaf(ctx, x, y, len, wid, angle, fill, vein) {
  ctx.save();
  ctx.translate(x, y);
  ctx.rotate(angle);
  ctx.fillStyle = fill;
  ctx.beginPath();
  ctx.ellipse(0, 0, len, wid, 0, 0, Math.PI * 2);
  ctx.fill();
  if (vein) {
    ctx.strokeStyle = vein;
    ctx.lineWidth = Math.max(0.5, wid * 0.16);
    ctx.beginPath();
    ctx.moveTo(-len * 0.8, 0);
    ctx.lineTo(len * 0.8, 0);
    ctx.stroke();
  }
  ctx.restore();
}

export function makeCanopyCardTexture() {
  const rng = mulberry32(7719);
  const size = 512;
  const canvas = makeCanvas(size);
  const ctx = canvas.getContext('2d');
  ctx.clearRect(0, 0, size, size);

  // A loose, airy cluster of leaves, transparent at the edges.
  const clusters = 9;
  for (let c = 0; c < clusters; c++) {
    const cx = size * (0.2 + rng() * 0.6);
    const cy = size * (0.2 + rng() * 0.6);
    const spread = 42 + rng() * 64;
    if (Math.hypot(cx - size / 2, (cy - size / 2) * 1.1) > size * 0.44) continue;

    // A quiet dark underlayer keeps the spray from dissolving at distance.
    for (let b = 0; b < 4; b++) {
      const a = rng() * Math.PI * 2;
      const d = rng() * spread * 0.42;
      const bx = cx + Math.cos(a) * d;
      const by = cy + Math.sin(a) * d * 0.7;
      const br = spread * (0.26 + rng() * 0.2);
      const g = 64 + rng() * 22;
      ctx.fillStyle = `rgba(${28 + rng() * 16 | 0}, ${g | 0}, ${26 + rng() * 14 | 0}, 0.9)`;
      ctx.beginPath();
      ctx.ellipse(bx, by, br, br * 0.68, rng() * Math.PI, 0, Math.PI * 2);
      ctx.fill();
    }

    const leaves = 15 + Math.floor(rng() * 16);
    for (let i = 0; i < leaves; i++) {
      const a = rng() * Math.PI * 2;
      const d = Math.sqrt(rng()) * spread;
      const x = cx + Math.cos(a) * d;
      const y = cy + Math.sin(a) * d * 0.78;
      if (Math.hypot(x - size / 2, (y - size / 2) * 1.1) > size * 0.48) continue;
      const depth = 1 - d / (spread + 1);
      const g = 92 + rng() * 54 + depth * 24;
      const r = 38 + rng() * 32;
      const b = 34 + rng() * 26;
      drawLeaf(
        ctx, x, y,
        10 + rng() * 13, 5 + rng() * 6,
        a + (rng() - 0.5) * 0.6,
        `rgba(${r | 0}, ${g | 0}, ${b | 0}, ${0.74 + rng() * 0.26})`,
        `rgba(${(r * 0.55) | 0}, ${(g * 0.55) | 0}, ${(b * 0.5) | 0}, 0.55)`
      );
    }
  }

  // A few bright rim leaves catch the sun.
  for (let i = 0; i < 40; i++) {
    const x = size * (0.16 + rng() * 0.68);
    const y = size * (0.14 + rng() * 0.62);
    if (Math.hypot(x - size / 2, (y - size / 2) * 1.1) > size * 0.42) continue;
    drawLeaf(ctx, x, y, 6 + rng() * 9, 2.5 + rng() * 4, rng() * Math.PI * 2,
      `rgba(${100 + rng() * 50 | 0}, ${145 + rng() * 45 | 0}, ${64 + rng() * 30 | 0}, ${0.5 + rng() * 0.4})`,
      'rgba(64, 84, 42, 0.4)');
  }

  const map = new THREE.CanvasTexture(canvas);
  map.colorSpace = THREE.SRGBColorSpace;
  map.anisotropy = 4;
  map.generateMipmaps = true;
  map.minFilter = THREE.LinearMipmapLinearFilter;
  return map;
}

export function makeNeedleCardTexture() {
  const rng = mulberry32(3407);
  const size = 512;
  const canvas = makeCanvas(size);
  const ctx = canvas.getContext('2d');
  ctx.clearRect(0, 0, size, size);

  // A drooping conifer bough: central twig, needle sprays left and right.
  const cx = size * 0.5;
  const baseY = size * 0.18;
  ctx.strokeStyle = 'rgba(66, 52, 38, 0.9)';
  ctx.lineWidth = 5;
  ctx.beginPath();
  ctx.moveTo(cx, baseY);
  ctx.quadraticCurveTo(cx + 6, size * 0.5, cx + 2, size * 0.86);
  ctx.stroke();

  const twigs = 13;
  for (let t = 0; t < twigs; t++) {
    const y = baseY + (t / twigs) * size * 0.66;
    const dir = t % 2 === 0 ? 1 : -1;
    const len = (size * 0.34) * (0.45 + (t / twigs) * 0.62) * (0.8 + rng() * 0.35);
    const droop = 10 + rng() * 34;
    for (const side of [-1, 1]) {
      ctx.strokeStyle = `rgba(${58 + rng() * 18 | 0}, ${74 + rng() * 20 | 0}, ${44 + rng() * 16 | 0}, 0.8)`;
      ctx.lineWidth = 2.2;
      ctx.beginPath();
      ctx.moveTo(cx, y);
      ctx.quadraticCurveTo(cx + side * len * 0.5, y + droop * 0.2, cx + side * len, y + droop);
      ctx.stroke();

      const needles = 16 + Math.floor(rng() * 10);
      for (let i = 0; i < needles; i++) {
        const u = 0.08 + (i / needles) * 0.9;
        const px = cx + side * len * u;
        const py = y + droop * u * u + (rng() - 0.5) * 5;
        const nl = 7 + rng() * 15;
        const na = Math.PI * 0.5 + side * (0.45 + rng() * 0.6) + (rng() - 0.5) * 0.5;
        const g = 72 + rng() * 44 + u * 20;
        const r = 32 + rng() * 22;
        const b = 38 + rng() * 20;
        ctx.strokeStyle = `rgba(${r | 0}, ${g | 0}, ${b | 0}, ${0.65 + rng() * 0.35})`;
        ctx.lineWidth = 1.1 + rng() * 1.4;
        ctx.beginPath();
        ctx.moveTo(px, py);
        ctx.lineTo(px + Math.cos(na) * nl, py + Math.sin(na) * nl);
        ctx.stroke();
      }
    }
  }

  // Soft highlights along the sunward edge.
  for (let i = 0; i < 260; i++) {
    const x = size * (0.2 + rng() * 0.6);
    const y = size * (0.14 + rng() * 0.66);
    ctx.strokeStyle = `rgba(${120 + rng() * 50 | 0}, ${150 + rng() * 40 | 0}, ${80 + rng() * 34 | 0}, ${0.15 + rng() * 0.28})`;
    ctx.lineWidth = 0.9;
    ctx.beginPath();
    ctx.moveTo(x, y);
    ctx.lineTo(x + (rng() - 0.5) * 8, y + 6 + rng() * 14);
    ctx.stroke();
  }

  const map = new THREE.CanvasTexture(canvas);
  map.colorSpace = THREE.SRGBColorSpace;
  map.anisotropy = 4;
  return map;
}


/* ---------- grass tuft ---------- */

export function makeGrassTexture() {
  const rng = mulberry32(8841);
  const w = 128;
  const h = 256;
  const canvas = makeCanvas(w, h);
  const ctx = canvas.getContext('2d');
  ctx.clearRect(0, 0, w, h);

  const blades = 13;
  for (let b = 0; b < blades; b++) {
    const baseX = 20 + rng() * 88;
    const tipX = baseX + (rng() - 0.5) * 66;
    const tipY = 6 + rng() * 54;
    const width = 1.4 + rng() * 3.1;
    const ctrlX = baseX + (tipX - baseX) * 0.22 + (rng() - 0.5) * 20;
    const ctrlY = 112 + rng() * 62;

    const grad = ctx.createLinearGradient(0, h, 0, tipY);
    const hueShift = rng();
    grad.addColorStop(0, `rgba(${48 + hueShift * 28}, ${72 + hueShift * 28}, ${34 + hueShift * 18}, 1)`);
    grad.addColorStop(0.55, `rgba(${86 + hueShift * 32}, ${116 + hueShift * 32}, ${56 + hueShift * 22}, 0.96)`);
    grad.addColorStop(1, `rgba(${138 + hueShift * 34}, ${156 + hueShift * 34}, ${88 + hueShift * 28}, 0.86)`);

    ctx.fillStyle = grad;
    ctx.beginPath();
    ctx.moveTo(baseX - width, h);
    ctx.quadraticCurveTo(ctrlX - width * 0.5, ctrlY, tipX, tipY);
    ctx.quadraticCurveTo(ctrlX + width * 0.5, ctrlY, baseX + width, h);
    ctx.closePath();
    ctx.fill();
  }

  const map = new THREE.CanvasTexture(canvas);
  map.colorSpace = THREE.SRGBColorSpace;
  map.anisotropy = 4;
  return map;
}

/* ---------- soft particle ---------- */

export function makeSoftDotTexture() {
  const size = 64;
  const canvas = makeCanvas(size);
  const ctx = canvas.getContext('2d');
  const grad = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
  grad.addColorStop(0, 'rgba(255,255,255,1)');
  grad.addColorStop(0.35, 'rgba(255,255,255,0.9)');
  grad.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, size, size);
  const map = new THREE.CanvasTexture(canvas);
  map.colorSpace = THREE.SRGBColorSpace;
  return map;
}

/* ---------- leaf litter ---------- */

export function makeLeafTexture() {
  const size = 64;
  const canvas = makeCanvas(size);
  const ctx = canvas.getContext('2d');
  ctx.clearRect(0, 0, size, size);
  ctx.fillStyle = '#d9c48d';
  ctx.beginPath();
  ctx.ellipse(32, 32, 21, 9, 0.5, 0, Math.PI * 2);
  ctx.fill();
  ctx.strokeStyle = 'rgba(104, 77, 40, 0.65)';
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(14, 42);
  ctx.lineTo(50, 22);
  ctx.stroke();
  const map = new THREE.CanvasTexture(canvas);
  map.colorSpace = THREE.SRGBColorSpace;
  return map;
}
