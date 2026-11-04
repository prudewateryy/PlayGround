import * as THREE from '../vendor/three.module.min.js';
import { createWorld } from './world.js';
import { ForestAudio } from './audio.js';

/* ============================================================
   Silverpine Wilds — game controller
   ============================================================ */

const $ = (id) => document.getElementById(id);

const dom = {
  canvas: $('scene'),
  loading: $('loadingScreen'),
  loadingLabel: document.querySelector('.loading-label'),
  loadingNote: document.querySelector('.loading-note'),
  startScreen: $('startScreen'),
  startButton: $('startButton'),
  startSettingsButton: $('startSettingsButton'),
  hud: $('hud'),
  settingsButton: $('settingsButton'),
  potatoPill: $('potatoPill'),
  compassTrack: $('compassTrack'),
  compassReadout: $('compassReadout'),
  locationName: $('locationName'),
  walkTime: $('walkTime'),
  walkDistance: $('walkDistance'),
  crosshair: document.querySelector('.crosshair'),
  mobileControls: $('mobileControls'),
  joystick: $('joystick'),
  joystickKnob: $('joystickKnob'),
  jumpButton: $('jumpButton'),
  lookHint: $('lookHint'),
  warningModal: $('warningModal'),
  turnOnPotato: $('turnOnPotato'),
  maybeLater: $('maybeLater'),
  settingsScrim: $('settingsScrim'),
  settingsPanel: $('settingsPanel'),
  closeSettings: $('closeSettings'),
  potatoToggle: $('potatoToggle'),
  fovRange: $('fovRange'),
  fovValue: $('fovValue'),
  sensitivityRange: $('sensitivityRange'),
  sensitivityValue: $('sensitivityValue'),
  volumeRange: $('volumeRange'),
  volumeValue: $('volumeValue'),
  qualitySelect: $('qualitySelect'),
  controlsSelect: $('controlsSelect'),
  resetPosition: $('resetPosition'),
  pauseMenu: $('pauseMenu'),
  resumeButton: $('resumeButton'),
  pauseSettingsButton: $('pauseSettingsButton'),
  toast: $('toast'),
  rotateHint: $('rotateHint'),
};

const isTouchDevice = (() => {
  const coarse = window.matchMedia?.('(pointer: coarse)').matches;
  const touch = navigator.maxTouchPoints > 0;
  return Boolean(coarse || touch);
})();

const state = {
  ready: false,
  started: false,
  paused: false,
  settingsOpen: false,
  warningOpen: true,
  potato: false,
  fov: 72,
  sensitivity: 1,
  volume: 0.4,
  controlsMode: 'auto',
  isTouch: isTouchDevice,
  keys: new Set(),
  joy: { id: null, x: 0, y: 0, active: false },
  look: { id: null, x: 0, y: 0 },
  elapsed: 0,
  distance: 0,
  zone: '',
  suppressUnlock: false,
  lockAcquiredAt: 0,
  lastHud: 0,
  lastZone: 0,
  stepAccum: 0,
  bobPhase: 0,
};

let renderer;
let scene;
let camera;
let world;
let audio;
let clock;

const player = {
  pos: new THREE.Vector3(0, 0, 0),
  vel: new THREE.Vector2(0, 0),
  yaw: 0,
  pitch: -0.03,
  vy: 0,
  onGround: true,
  bob: 0,
  landDip: 0,
  roll: 0,
  moveForward: 0,
  moveStrafe: 0,
};

let toastTimer = null;
let lookHintTimer = null;
let cinematicAngle = 0;

const CARDINALS = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'];
const compassItems = [];

function finite(value, fallback = 0) {
  return Number.isFinite(value) ? value : fallback;
}

/* ---------- formatting ---------- */

function pad(n) { return String(n).padStart(2, '0'); }

function formatTime(seconds) {
  const total = Math.floor(seconds);
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  return h > 0 ? `${h}:${pad(m)}:${pad(s)}` : `${pad(m)}:${pad(s)}`;
}

function showToast(html, duration = 3400) {
  dom.toast.innerHTML = html;
  dom.toast.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => dom.toast.classList.remove('show'), duration);
}

/* ---------- renderer ---------- */

function pixelRatio() {
  const dpr = window.devicePixelRatio || 1;
  return Math.min(dpr, state.potato ? 1 : 1.7);
}

function resize() {
  if (!renderer || !camera) return;
  const w = window.innerWidth;
  const h = window.innerHeight;
  renderer.setPixelRatio(pixelRatio());
  renderer.setSize(w, h);
  camera.aspect = w / h;
  camera.updateProjectionMatrix();
  updateResponsiveHints();
}

function setupRenderer() {
  renderer = new THREE.WebGLRenderer({
    canvas: dom.canvas,
    antialias: true,
    powerPreference: 'high-performance',
  });
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.03;
  renderer.setPixelRatio(pixelRatio());
  renderer.setSize(window.innerWidth, window.innerHeight);

  scene = new THREE.Scene();
  camera = new THREE.PerspectiveCamera(60, window.innerWidth / window.innerHeight, 0.08, 460);
  camera.rotation.order = 'YXZ';
  clock = new THREE.Clock();
}

/* ---------- player ---------- */

function resetPlayer(showMessage = false) {
  player.pos.copy(world.spawn);
  player.pos.y = world.heightAt(player.pos.x, player.pos.z);
  player.vel.set(0, 0);
  player.vy = 0;
  player.onGround = true;
  player.yaw = 0;
  player.pitch = -0.035;
  player.bob = 0;
  player.landDip = 0;
  player.roll = 0;
  state.elapsed = 0;
  state.distance = 0;
  state.stepAccum = 0;
  state.zone = '';
  syncCamera();
  if (showMessage) showToast('Returned to <strong>The Clearing</strong>.');
}

function syncCamera() {
  if (!world) return;
  const eye = 1.68;
  player.pos.x = finite(player.pos.x, world.spawn.x);
  player.pos.z = finite(player.pos.z, world.spawn.z);
  player.pos.y = finite(player.pos.y, world.heightAt(player.pos.x, player.pos.z));
  player.bob = finite(player.bob, 0);
  player.landDip = finite(player.landDip, 0);
  player.yaw = finite(player.yaw, 0);
  player.pitch = finite(player.pitch, -0.035);
  player.roll = finite(player.roll, 0);
  camera.position.set(player.pos.x, player.pos.y + eye + player.bob - player.landDip, player.pos.z);
  camera.rotation.set(player.pitch, player.yaw, player.roll);
}

function tryJump() {
  if (!state.started || state.paused || state.settingsOpen || !state.ready) return;
  if (!player.onGround) return;
  player.vy = 7.35;
  player.onGround = false;
  player.landDip = 0;
  audio?.jump();
}

function getInput() {
  let forward = 0;
  let strafe = 0;
  if (state.keys.has('KeyW') || state.keys.has('ArrowUp')) forward += 1;
  if (state.keys.has('KeyS') || state.keys.has('ArrowDown')) forward -= 1;
  if (state.keys.has('KeyD') || state.keys.has('ArrowRight')) strafe += 1;
  if (state.keys.has('KeyA') || state.keys.has('ArrowLeft')) strafe -= 1;

  if (state.joy.active) {
    strafe += state.joy.x;
    forward += -state.joy.y;
  }

  const len = Math.hypot(forward, strafe);
  if (len > 1) {
    forward /= len;
    strafe /= len;
  }
  return { forward, strafe, len: Math.min(len, 1) };
}

function updatePlayer(dt) {
  const input = getInput();
  player.moveForward = input.forward;
  player.moveStrafe = input.strafe;

  const sprinting = state.keys.has('ShiftLeft') || state.keys.has('ShiftRight');
  const touchSprint = state.joy.active && Math.hypot(state.joy.x, state.joy.y) > 0.93;
  const maxSpeed = sprinting ? 7.5 : touchSprint ? 5.9 : 4.35;

  const sin = Math.sin(player.yaw);
  const cos = Math.cos(player.yaw);
  const fwdX = -sin;
  const fwdZ = -cos;
  const rightX = cos;
  const rightZ = -sin;

  const targetX = (fwdX * input.forward + rightX * input.strafe) * maxSpeed;
  const targetZ = (fwdZ * input.forward + rightZ * input.strafe) * maxSpeed;
  const accel = player.onGround ? 13 : 3.2;
  const blend = 1 - Math.exp(-accel * dt);
  player.vel.x += (targetX - player.vel.x) * blend;
  player.vel.y += (targetZ - player.vel.y) * blend;

  const beforeX = player.pos.x;
  const beforeZ = player.pos.z;
  const nextX = player.pos.x + player.vel.x * dt;
  const nextZ = player.pos.z + player.vel.y * dt;
  if (!Number.isFinite(nextX) || !Number.isFinite(nextZ)) {
    player.vel.set(0, 0);
    player.pos.copy(world.spawn);
    player.pos.y = world.heightAt(player.pos.x, player.pos.z);
  } else {
    const solved = world.resolveCollision(nextX, nextZ, 0.36);
    player.pos.x = solved.x;
    player.pos.z = solved.z;
  }

  const moved = Math.hypot(player.pos.x - beforeX, player.pos.z - beforeZ);
  state.distance += moved;

  // Vertical motion and the forest floor.
  const ground = finite(world.heightAt(player.pos.x, player.pos.z), 0);
  player.vy = finite(player.vy, 0);
  if (player.onGround) {
    if (ground < player.pos.y - 0.62) {
      player.onGround = false;
    } else {
      player.pos.y = ground;
      player.vy = 0;
    }
  }
  if (!player.onGround) {
    player.vy -= 21.5 * dt;
    player.pos.y += player.vy * dt;
    if (player.pos.y <= ground) {
      const impact = player.vy;
      player.pos.y = ground;
      player.vy = 0;
      player.onGround = true;
      if (impact < -4.5) {
        player.landDip = Math.min(0.13, -impact * 0.012);
        audio?.land();
      }
    }
  }

  // Head bob and footsteps.
  const speed = Math.hypot(player.vel.x, player.vel.y);
  if (player.onGround && speed > 0.25) {
    player.bobPhase += dt * (6.3 + speed * 0.85);
    player.bob = Math.sin(player.bobPhase * 2) * 0.032 * Math.min(1, speed / 4.2);
    state.stepAccum += moved;
    if (state.stepAccum > 2.05) {
      state.stepAccum = 0;
      const surface = world.pathDistance(player.pos.x, player.pos.z) < 3.1 ? 'trail' : 'duff';
      audio?.footstep(surface);
    }
  } else {
    player.bob += (0 - player.bob) * (1 - Math.exp(-8 * dt));
  }

  if (!Number.isFinite(player.bob) || !Number.isFinite(player.bobPhase)) {
    player.bob = 0;
    player.bobPhase = 0;
  }

  player.landDip *= Math.exp(-9 * dt);
  player.roll += (-input.strafe * 0.009 - player.roll) * (1 - Math.exp(-7 * dt));

  state.elapsed += dt;

  // Camera follows the body with a gentle eye height.
  syncCamera();

  const portrait = window.innerHeight > window.innerWidth ? 6 : 0;
  const sprintFov = speed > 5.4 ? 3 : 0;
  const targetFov = state.fov + portrait + sprintFov;
  if (Math.abs(camera.fov - targetFov) > 0.03) {
    camera.fov += (targetFov - camera.fov) * (1 - Math.exp(-6 * dt));
    camera.updateProjectionMatrix();
  }
}

function updateCinematic(t) {
  const angle = 0.32 + Math.sin(t * 0.035) * 0.12;
  const x = 3.1 + Math.sin(angle) * 0.55;
  const z = 10.4 + Math.cos(angle) * 0.3;
  const y = world.heightAt(x, z) + 4.2 + Math.sin(t * 0.24) * 0.08;
  camera.position.set(x, y, z);
  const lookX = -2.2;
  const lookZ = -21;
  const lookY = world.heightAt(lookX, lookZ) + 2.2;
  camera.lookAt(lookX, lookY, lookZ);
  camera.rotation.z = 0;
  if (Math.abs(camera.fov - 61) > 0.1) {
    camera.fov += (61 - camera.fov) * 0.08;
    camera.updateProjectionMatrix();
  }
}

/* ---------- compass + HUD ---------- */

function buildCompass() {
  const names = { 0: 'N', 45: 'NE', 90: 'E', 135: 'SE', 180: 'S', 225: 'SW', 270: 'W', 315: 'NW' };
  for (let deg = 0; deg < 360; deg += 15) {
    const tick = document.createElement('span');
    tick.className = 'compass-tick' + (deg % 45 === 0 ? ' major' : '');
    tick.style.position = 'absolute';
    tick.style.left = '50%';
    dom.compassTrack.appendChild(tick);
    compassItems.push({ el: tick, deg, offset: 0 });

    if (names[deg] !== undefined) {
      const label = document.createElement('span');
      label.className = 'compass-label' + (deg % 90 === 0 ? ' cardinal' : '');
      label.textContent = names[deg];
      label.style.position = 'absolute';
      label.style.left = '50%';
      dom.compassTrack.appendChild(label);
      compassItems.push({ el: label, deg, offset: 0 });
    }
  }
}

function updateCompass() {
  const heading = ((-player.yaw * 180) / Math.PI % 360 + 360) % 360;
  for (const item of compassItems) {
    let d = item.deg - heading;
    while (d > 180) d -= 360;
    while (d < -180) d += 360;
    const offset = d * 2.05;
    item.el.style.transform = `translateX(calc(-50% + ${offset.toFixed(1)}px))`;
    item.el.style.opacity = Math.abs(offset) > 98 ? '0' : String(1 - Math.abs(offset) / 115);
  }
  const cardinal = CARDINALS[Math.round(heading / 45) % 8];
  dom.compassReadout.textContent = `${cardinal} · ${String(Math.round(heading)).padStart(3, '0')}°`;
}

function zoneName() {
  if (!world) return 'Silverpine Wilds';
  let best = null;
  let bestScore = Infinity;
  for (const landmark of world.landmarks) {
    const d = Math.hypot(player.pos.x - landmark.x, player.pos.z - landmark.z);
    if (d < landmark.r) {
      const score = d / landmark.r;
      if (score < bestScore) { bestScore = score; best = landmark; }
    }
  }
  return best ? best.name : 'Silverpine Wilds';
}

function updateHud(now) {
  if (now - state.lastHud < 0.15) return;
  state.lastHud = now;
  dom.walkTime.textContent = formatTime(state.elapsed);
  dom.walkDistance.textContent = `${Math.floor(state.distance)} m`;
  if (now - state.lastZone > 0.45) {
    state.lastZone = now;
    const zone = zoneName();
    if (zone !== state.zone) {
      state.zone = zone;
      dom.locationName.textContent = zone;
    }
  }
  updateCompass();
}

/* ---------- quality / settings ---------- */

function updateQualityUI() {
  dom.potatoToggle.setAttribute('aria-checked', String(state.potato));
  dom.potatoPill.classList.toggle('is-hidden', !state.potato);
  dom.qualitySelect.value = state.potato ? 'potato' : 'high';
  document.body.classList.toggle('potato-mode', state.potato);
}

function setPotato(on, { silent = false, pulse = false } = {}) {
  state.potato = Boolean(on);
  if (world) world.setPotato(state.potato);
  updateQualityUI();
  if (renderer && camera) resize();
  if (!silent) {
    showToast(state.potato
      ? '<strong>Potato Mode on.</strong> Dense grass, mist and shadows are off.'
      : '<strong>High graphics restored.</strong> The full forest is back.');
  }
  if (pulse) {
    dom.potatoToggle.classList.remove('pulse');
    void dom.potatoToggle.offsetWidth;
    dom.potatoToggle.classList.add('pulse');
    setTimeout(() => dom.potatoToggle.classList.remove('pulse'), 1500);
  }
  window.__potatoMode = state.potato;
}

function sensitivityLabel(value) {
  if (value < 55) return 'Low';
  if (value < 95) return 'Normal';
  if (value < 140) return 'High';
  return 'Very high';
}

function updateVolumeUI() {
  dom.volumeValue.textContent = `${Math.round(state.volume * 100)}%`;
}

/* ---------- overlays ---------- */

function dismissWarning() {
  if (!state.warningOpen) return;
  state.warningOpen = false;
  dom.warningModal.classList.add('is-hidden');
  setTimeout(() => dom.startButton.focus({ preventScroll: true }), 50);
}

function openSettings(options = {}) {
  if (!state.ready || state.settingsOpen) return;
  state.settingsOpen = true;
  dom.pauseMenu.classList.add('is-hidden');
  dom.settingsPanel.classList.remove('is-hidden');
  dom.settingsScrim.classList.remove('is-hidden');
  updateQualityUI();
  audio?.setPaused(true);
  if (document.pointerLockElement) {
    state.suppressUnlock = true;
    document.exitPointerLock?.();
    setTimeout(() => { state.suppressUnlock = false; }, 400);
  }
  refreshTouchControls();
  setTimeout(() => {
    const first = options.focusPotato ? dom.potatoToggle : dom.closeSettings;
    first?.focus({ preventScroll: true });
    if (options.focusPotato) {
      dom.potatoToggle.classList.remove('pulse');
      void dom.potatoToggle.offsetWidth;
      dom.potatoToggle.classList.add('pulse');
      setTimeout(() => dom.potatoToggle.classList.remove('pulse'), 1500);
    }
  }, 250);
}

function closeSettings() {
  if (!state.settingsOpen) return;
  state.settingsOpen = false;
  dom.settingsPanel.classList.add('is-hidden');
  dom.settingsScrim.classList.add('is-hidden');
  audio?.setPaused(state.paused);
  if (state.started) {
    if (state.paused) {
      dom.pauseMenu.classList.remove('is-hidden');
    } else {
      requestLock();
    }
  }
  refreshTouchControls();
  if (state.started) setTimeout(() => dom.canvas.focus?.({ preventScroll: true }), 30);
}

function pauseGame() {
  if (!state.started || state.paused) return;
  state.paused = true;
  if (state.settingsOpen) closeSettings();
  dom.pauseMenu.classList.remove('is-hidden');
  refreshTouchControls();
  audio?.setPaused(true);
  if (document.pointerLockElement) {
    state.suppressUnlock = true;
    document.exitPointerLock?.();
    setTimeout(() => { state.suppressUnlock = false; }, 400);
  }
}

function resumeGame() {
  if (!state.started) return;
  state.paused = false;
  dom.pauseMenu.classList.add('is-hidden');
  dom.settingsPanel.classList.add('is-hidden');
  dom.settingsScrim.classList.add('is-hidden');
  state.settingsOpen = false;
  refreshTouchControls();
  audio?.setPaused(false);
  requestLock();
  dom.canvas.focus?.({ preventScroll: true });
}

function requestLock() {
  if (state.isTouch) return;
  try {
    const promise = dom.canvas.requestPointerLock?.();
    if (promise && typeof promise.catch === 'function') promise.catch(() => {});
  } catch { /* pointer lock is a nice-to-have */ }
}

/* ---------- start / touch controls ---------- */

function showTouchControls() {
  if (state.controlsMode === 'on') return true;
  if (state.controlsMode === 'off') return false;
  return state.isTouch;
}

function refreshTouchControls() {
  const visible = state.started && !state.paused && !state.settingsOpen && showTouchControls();
  dom.mobileControls.classList.toggle('is-hidden', !visible);
  dom.crosshair.style.display = (state.isTouch || showTouchControls()) ? 'none' : '';
}

function startGame() {
  if (!state.started && state.ready) {
    state.started = true;
    if (state.warningOpen) dismissWarning();
    state.paused = false;
    state.elapsed = 0;
    state.distance = 0;
    player.pos.copy(world.spawn);
    player.pos.y = world.heightAt(player.pos.x, player.pos.z);
    player.yaw = 0;
    player.pitch = -0.035;
    syncCamera();
    dom.startScreen.classList.add('fade-out');
    setTimeout(() => dom.startScreen.classList.add('is-hidden'), 1050);
    dom.hud.classList.remove('is-hidden');
    document.body.classList.add('is-playing');
    refreshTouchControls();
    requestLock();
    audio?.start();
    audio?.setPaused(false);
    if (state.isTouch) {
      clearTimeout(lookHintTimer);
      dom.lookHint.classList.remove('fade');
      lookHintTimer = setTimeout(() => dom.lookHint.classList.add('fade'), 5200);
    }
    dom.canvas.tabIndex = -1;
    dom.canvas.focus({ preventScroll: true });
  }
}

/* ---------- input ---------- */

function onKeyDown(e) {
  const tag = e.target?.tagName;
  const inForm = tag === 'INPUT' || tag === 'SELECT' || tag === 'TEXTAREA' || tag === 'BUTTON';

  if (e.code === 'Escape') {
    if (state.warningOpen && !state.started) {
      e.preventDefault();
      setPotato(true);
      dismissWarning();
      showToast('<strong>Potato Mode on.</strong> Press Esc again any time for Settings.');
      return;
    }
    if (state.settingsOpen) {
      e.preventDefault();
      closeSettings();
      return;
    }
    if (state.paused) {
      e.preventDefault();
      resumeGame();
      return;
    }
    if (state.started) {
      e.preventDefault();
      pauseGame();
      return;
    }
  }

  if (inForm) return;

  if (e.code === 'KeyP') {
    if (state.ready) {
      e.preventDefault();
      setPotato(!state.potato, { pulse: true });
    }
    return;
  }

  if (!state.started || state.paused || state.settingsOpen) return;

  if (e.code === 'Space') {
    e.preventDefault();
    if (!e.repeat) tryJump();
    return;
  }

  if (e.code === 'KeyW' || e.code === 'KeyA' || e.code === 'KeyS' || e.code === 'KeyD' ||
      e.code === 'ArrowUp' || e.code === 'ArrowDown' || e.code === 'ArrowLeft' || e.code === 'ArrowRight' ||
      e.code === 'ShiftLeft' || e.code === 'ShiftRight') {
    e.preventDefault();
    state.keys.add(e.code);
  }
}

function onKeyUp(e) {
  state.keys.delete(e.code);
}

function setupJoystick() {
  const maxRadius = () => dom.joystick.clientWidth * 0.31;

  function update(e) {
    const rect = dom.joystick.getBoundingClientRect();
    const cx = rect.left + rect.width / 2;
    const cy = rect.top + rect.height / 2;
    let dx = e.clientX - cx;
    let dy = e.clientY - cy;
    const max = maxRadius();
    const dist = Math.hypot(dx, dy);
    if (dist > max) {
      dx = (dx / dist) * max;
      dy = (dy / dist) * max;
    }
    state.joy.x = dx / max;
    state.joy.y = dy / max;
    dom.joystickKnob.style.transform = `translate(calc(-50% + ${dx.toFixed(1)}px), calc(-50% + ${dy.toFixed(1)}px))`;
  }

  dom.joystick.addEventListener('pointerdown', (e) => {
    if (!state.started || state.paused || state.settingsOpen) return;
    e.preventDefault();
    state.joy.id = e.pointerId;
    state.joy.active = true;
    dom.joystick.classList.add('active');
    dom.joystick.setPointerCapture?.(e.pointerId);
    update(e);
  });

  dom.joystick.addEventListener('pointermove', (e) => {
    if (state.joy.id !== e.pointerId) return;
    update(e);
  });

  const end = (e) => {
    if (state.joy.id !== e.pointerId) return;
    state.joy.id = null;
    state.joy.active = false;
    state.joy.x = 0;
    state.joy.y = 0;
    dom.joystick.classList.remove('active');
    dom.joystickKnob.style.transform = 'translate(-50%, -50%)';
  };
  dom.joystick.addEventListener('pointerup', end);
  dom.joystick.addEventListener('pointercancel', end);
  dom.joystick.addEventListener('lostpointercapture', end);

  dom.jumpButton.addEventListener('pointerdown', (e) => {
    if (!state.started || state.paused || state.settingsOpen) return;
    e.preventDefault();
    dom.jumpButton.classList.add('pressed');
    dom.jumpButton.setPointerCapture?.(e.pointerId);
    tryJump();
  });
  const unpress = () => dom.jumpButton.classList.remove('pressed');
  dom.jumpButton.addEventListener('pointerup', unpress);
  dom.jumpButton.addEventListener('pointercancel', unpress);
  dom.jumpButton.addEventListener('pointerleave', unpress);
}

function setupTouchLook() {
  dom.canvas.addEventListener('pointerdown', (e) => {
    if (e.pointerType === 'mouse') {
      if (state.started && !state.paused && !state.settingsOpen && document.pointerLockElement !== dom.canvas) {
        requestLock();
      }
      return;
    }
    if (!state.started || state.paused || state.settingsOpen) return;
    e.preventDefault();
    state.look.id = e.pointerId;
    state.look.x = e.clientX;
    state.look.y = e.clientY;
    dom.canvas.setPointerCapture?.(e.pointerId);
    document.body.classList.add('is-looking');
  });

  dom.canvas.addEventListener('pointermove', (e) => {
    if (state.look.id !== e.pointerId) return;
    const dx = e.clientX - state.look.x;
    const dy = e.clientY - state.look.y;
    state.look.x = e.clientX;
    state.look.y = e.clientY;
    const sens = 0.0042 * state.sensitivity;
    player.yaw -= dx * sens;
    player.pitch = Math.max(-1.34, Math.min(1.34, player.pitch - dy * sens));
  });

  const endLook = (e) => {
    if (state.look.id !== e.pointerId) return;
    state.look.id = null;
    document.body.classList.remove('is-looking');
  };
  dom.canvas.addEventListener('pointerup', endLook);
  dom.canvas.addEventListener('pointercancel', endLook);
  dom.canvas.addEventListener('lostpointercapture', endLook);
}

function setupPointerLock() {
  document.addEventListener('pointerlockchange', () => {
    const locked = document.pointerLockElement === dom.canvas;
    document.body.classList.toggle('is-looking', locked);
    if (locked) {
      state.lockAcquiredAt = performance.now();
      if (state.paused && !state.settingsOpen) {
        state.paused = false;
        dom.pauseMenu.classList.add('is-hidden');
        audio?.setPaused(false);
        refreshTouchControls();
      }
      return;
    }
    if (state.started && !state.paused && !state.settingsOpen && !state.suppressUnlock && !state.isTouch) {
      pauseGame();
    }
  });

  document.addEventListener('pointerlockerror', () => {
    if (state.started) showToast('Click the forest to capture the mouse and look around.', 2800);
  });

  document.addEventListener('mousemove', (e) => {
    if (document.pointerLockElement !== dom.canvas) return;
    if (!state.started || state.paused || state.settingsOpen) return;
    if (performance.now() - state.lockAcquiredAt < 180) return;
    // Clamp instead of discarding: fast flicks still turn, but synthetic
    // pointer-lock spikes cannot snap the view around.
    const mx = Math.max(-160, Math.min(160, e.movementX || 0));
    const my = Math.max(-160, Math.min(160, e.movementY || 0));
    if (mx === 0 && my === 0) return;
    const sens = 0.0022 * state.sensitivity;
    player.yaw -= mx * sens;
    player.pitch = Math.max(-1.34, Math.min(1.34, player.pitch - my * sens));
  });
}

/* ---------- UI wiring ---------- */

function setupUI() {
  buildCompass();
  setupJoystick();
  setupTouchLook();
  setupPointerLock();

  dom.startButton.addEventListener('click', startGame);
  dom.startSettingsButton.addEventListener('click', () => openSettings());
  dom.settingsButton.addEventListener('click', () => openSettings());
  dom.pauseSettingsButton.addEventListener('click', () => openSettings());
  dom.closeSettings.addEventListener('click', closeSettings);
  dom.settingsScrim.addEventListener('click', closeSettings);
  dom.resumeButton.addEventListener('click', resumeGame);

  dom.turnOnPotato.addEventListener('click', () => {
    setPotato(true);
    dismissWarning();
  });
  dom.maybeLater.addEventListener('click', dismissWarning);

  dom.potatoToggle.addEventListener('click', () => setPotato(!state.potato, { pulse: true }));
  dom.qualitySelect.addEventListener('change', () => setPotato(dom.qualitySelect.value === 'potato'));

  dom.fovRange.addEventListener('input', () => {
    state.fov = Number(dom.fovRange.value);
    dom.fovValue.textContent = `${state.fov}°`;
  });
  dom.sensitivityRange.addEventListener('input', () => {
    state.sensitivity = Number(dom.sensitivityRange.value) / 100;
    dom.sensitivityValue.textContent = sensitivityLabel(Number(dom.sensitivityRange.value));
  });
  dom.volumeRange.addEventListener('input', () => {
    state.volume = Number(dom.volumeRange.value) / 100;
    updateVolumeUI();
    audio?.setVolume(state.volume);
  });
  dom.controlsSelect.addEventListener('change', () => {
    state.controlsMode = dom.controlsSelect.value;
    refreshTouchControls();
  });
  dom.resetPosition.addEventListener('click', () => resetPlayer(true));

  dom.settingsScrim.classList.add('is-hidden');
  dom.settingsPanel.classList.add('is-hidden');

  document.addEventListener('keydown', onKeyDown);
  document.addEventListener('keyup', onKeyUp);
  document.addEventListener('visibilitychange', () => {
    if (document.hidden && state.started && !state.paused) pauseGame();
  });
  window.addEventListener('resize', resize);
  window.addEventListener('orientationchange', () => setTimeout(() => { resize(); updateResponsiveHints(); }, 120));
  window.addEventListener('blur', () => state.keys.clear());

  dom.canvas.addEventListener('contextmenu', (e) => e.preventDefault());
  dom.canvas.addEventListener('touchmove', (e) => e.preventDefault(), { passive: false });
  document.addEventListener('gesturestart', (e) => e.preventDefault());

  // State that comes from persisted-ish defaults.
  dom.fovValue.textContent = `${state.fov}°`;
  dom.sensitivityValue.textContent = sensitivityLabel(100);
  updateVolumeUI();
  updateQualityUI();
  document.body.classList.toggle('touch-device', state.isTouch);
}

function updateResponsiveHints() {
  const portrait = window.innerHeight > window.innerWidth;
  const show = state.started && state.isTouch && portrait && window.innerWidth < 600;
  dom.rotateHint.classList.toggle('is-hidden', !show);
  if (show) {
    clearTimeout(updateResponsiveHints.timer);
    updateResponsiveHints.timer = setTimeout(() => dom.rotateHint.classList.add('is-hidden'), 4200);
  }
}

/* ---------- boot / loop ---------- */

async function boot() {
  setupUI();
  try {
    setupRenderer();
    // Let the loading screen paint before the synchronous forest generation.
    await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
    world = createWorld(scene, renderer);
    audio = new ForestAudio();
    audio.setVolume(state.volume);
    resetPlayer(false);
    updateCinematic(0);
    updateQualityUI();
    state.ready = true;

    dom.loading.classList.add('done');
    setTimeout(() => dom.loading.classList.add('is-hidden'), 950);
    dom.startScreen.classList.remove('is-hidden');
    dom.warningModal.classList.remove('is-hidden');

    window.__forestReady = true;
    window.__silverpine = {
      start: startGame,
      reset: () => resetPlayer(false),
      setPotato,
      dismissWarning,
      state,
      player,
      get world() { return world; },
      get camera() { return camera; },
      get renderer() { return renderer; },
    };

    clock.start();
    animate();
  } catch (error) {
    console.error(error);
    dom.loadingLabel.textContent = 'The forest could not grow';
    dom.loadingNote.textContent = 'Your browser may not support WebGL. Try a current version of Chrome, Edge or Safari.';
    dom.loading.classList.remove('done');
  }
}

function animate() {
  requestAnimationFrame(animate);
  if (!world) return;

  let dt = clock.getDelta();
  if (!Number.isFinite(dt) || dt <= 0) dt = 1 / 60;
  dt = Math.min(dt, 0.5);
  const t = clock.elapsedTime;

  if (state.started) {
    if (!state.paused && !state.settingsOpen) {
      // Fixed substeps keep movement speed honest on slower devices.
      let remaining = dt;
      while (remaining > 0.0001) {
        const step = Math.min(remaining, 1 / 30);
        updatePlayer(step);
        remaining -= step;
      }
    } else {
      syncCamera();
      const targetFov = state.fov + (window.innerHeight > window.innerWidth ? 6 : 0);
      if (Math.abs(camera.fov - targetFov) > 0.05) {
        camera.fov += (targetFov - camera.fov) * 0.1;
        camera.updateProjectionMatrix();
      }
    }
    updateHud(t);
  } else {
    updateCinematic(t);
  }

  world.update(t, dt, camera.position);
  renderer.render(scene, camera);
}

boot();
