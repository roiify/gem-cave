import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { ConvexGeometry } from 'three/addons/geometries/ConvexGeometry.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { RGBELoader } from 'three/addons/loaders/RGBELoader.js';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { GEMS } from './gems.js';
import { createGemRefractionMaterial, setRefractionResolution } from './refraction.js';

// ---------------------------------------------------------------- renderer
const canvas = document.getElementById('scene');
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.1;

const scene = new THREE.Scene();
scene.background = new THREE.Color('#0b0916');

const camera = new THREE.PerspectiveCamera(42, window.innerWidth / window.innerHeight, 0.1, 100);
camera.position.set(0, 0.7, 5.4);

// environment: real studio HDRI (Poly Haven, CC0) — falls back to a synthetic room.
// The equirect texture is kept alive: the refraction shader samples it directly.
const pmrem = new THREE.PMREMGenerator(renderer);
scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
let hdrEquirect = null;
const hdrReady = new Promise((resolve) => {
  new RGBELoader().load(
    'assets/studio.hdr',
    (tex) => {
      tex.mapping = THREE.EquirectangularReflectionMapping;
      hdrEquirect = tex;
      scene.environment = pmrem.fromEquirectangular(tex).texture;
      resolve();
    },
    undefined,
    () => resolve() // keep RoomEnvironment fallback; refract gems fall back to physical
  );
});

// bloom makes bright facets genuinely sparkle
const composer = new EffectComposer(renderer);
composer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
composer.addPass(new RenderPass(scene, camera));
const bloomPass = new UnrealBloomPass(new THREE.Vector2(window.innerWidth, window.innerHeight), 0.4, 0.5, 0.87);
composer.addPass(bloomPass);
composer.addPass(new OutputPass());

const controls = new OrbitControls(camera, renderer.domElement);
controls.enableDamping = true;
controls.dampingFactor = 0.06;
controls.enablePan = false;
controls.minDistance = 3.2;
controls.maxDistance = 8;
controls.autoRotate = true;
controls.autoRotateSpeed = 2.2;
controls.target.set(0, 0.1, 0);

// ---------------------------------------------------------------- lights
const keyLight = new THREE.DirectionalLight(0xffffff, 2.2);
keyLight.position.set(5, 8, 6);
scene.add(keyLight);

const fillLight = new THREE.DirectionalLight(0x8899ff, 0.5);
fillLight.position.set(-6, -2, -4);
scene.add(fillLight);

const rimLight = new THREE.PointLight(0xffffff, 30, 30);
rimLight.position.set(-3, 2, -4);
scene.add(rimLight);

// ---------------------------------------------------------------- procedural textures
function mulberry32(seed) {
  return () => {
    seed |= 0; seed = (seed + 0x6D2B79F5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function makeCanvasTexture(size, draw) {
  const c = document.createElement('canvas');
  c.width = c.height = size;
  draw(c.getContext('2d'), size);
  const tex = new THREE.CanvasTexture(c);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  return tex;
}

function makeGlowTexture() {
  const c = document.createElement('canvas');
  c.width = c.height = 256;
  const ctx = c.getContext('2d');
  const g = ctx.createRadialGradient(128, 128, 0, 128, 128, 128);
  g.addColorStop(0, 'rgba(255,255,255,1)');
  g.addColorStop(0.35, 'rgba(255,255,255,0.35)');
  g.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, 256, 256);
  return new THREE.CanvasTexture(c);
}
const glowTex = makeGlowTexture();

// conchoidal ripple marks for obsidian (curved fracture rings, like real volcanic glass)
const rippleTex = makeCanvasTexture(512, (ctx, S) => {
  const rand = mulberry32(7);
  ctx.fillStyle = '#808080';
  ctx.fillRect(0, 0, S, S);
  ctx.filter = 'blur(2px)';
  for (let i = 0; i < 14; i++) {
    const x = rand() * S, y = rand() * S;
    const rings = 6 + Math.floor(rand() * 9);
    for (let j = 0; j < rings; j++) {
      const r = 8 + j * (10 + rand() * 9);
      const amp = 30 * (1 - j / rings);
      const shade = Math.round(128 + (j % 2 ? amp : -amp));
      ctx.strokeStyle = `rgb(${shade},${shade},${shade})`;
      ctx.lineWidth = 4 + rand() * 3;
      ctx.beginPath();
      ctx.arc(x, y, r, rand() * Math.PI * 2, rand() * Math.PI * 1.5 + Math.PI * 0.5);
      ctx.stroke();
    }
  }
});

// milky cloud patches for rose quartz
const cloudTex = makeCanvasTexture(512, (ctx, S) => {
  const rand = mulberry32(99);
  ctx.fillStyle = '#9a9a9a';
  ctx.fillRect(0, 0, S, S);
  ctx.filter = 'blur(22px)';
  for (let i = 0; i < 60; i++) {
    const shade = Math.round(70 + rand() * 170);
    ctx.fillStyle = `rgba(${shade},${shade},${shade},0.4)`;
    ctx.beginPath();
    ctx.arc(rand() * S, rand() * S, 18 + rand() * 60, 0, Math.PI * 2);
    ctx.fill();
  }
});

// play-of-color flakes for opal
const opalTex = makeCanvasTexture(512, (ctx, S) => {
  const rand = mulberry32(2026);
  ctx.fillStyle = '#101010';
  ctx.fillRect(0, 0, S, S);
  const colors = ['#ff3aa7', '#27e0c8', '#ffb521', '#7a5cff', '#37d24a', '#ff5722', '#19a7ff', '#f5f02a'];
  ctx.filter = 'blur(3px)';
  for (let i = 0; i < 240; i++) {
    ctx.fillStyle = colors[Math.floor(rand() * colors.length)];
    ctx.globalAlpha = 0.4 + rand() * 0.6;
    const x = rand() * S, y = rand() * S, r = 5 + rand() * 18;
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    for (let k = 1; k < 6; k++) {
      const a = (k / 6) * Math.PI * 2;
      const rr = r * (0.6 + rand() * 0.6);
      ctx.lineTo(x + Math.cos(a) * rr, y + Math.sin(a) * rr);
    }
    ctx.closePath();
    ctx.fill();
  }
});

// ---------------------------------------------------------------- cave atmosphere
const blobs = [];
[[-7, 3, -10, '#3d2a7a', 14], [8, -2, -12, '#143a5c', 16], [0, -6, -9, '#28104a', 12]].forEach(([x, y, z, col, s]) => {
  const m = new THREE.SpriteMaterial({ map: glowTex, color: new THREE.Color(col), transparent: true, opacity: 0.55, depthWrite: false });
  const sp = new THREE.Sprite(m);
  sp.position.set(x, y, z);
  sp.scale.setScalar(s);
  scene.add(sp);
  blobs.push(sp);
});

// glow disc under the gem, tinted per gem
const pedestalGlow = new THREE.Sprite(new THREE.SpriteMaterial({
  map: glowTex, color: 0xffffff, transparent: true, opacity: 0.5,
  blending: THREE.AdditiveBlending, depthWrite: false,
}));
pedestalGlow.position.set(0, -1.7, 0);
pedestalGlow.scale.set(4.5, 1.6, 1);
scene.add(pedestalGlow);

// floating cave dust
const dust = (() => {
  const N = 260;
  const pos = new Float32Array(N * 3);
  for (let i = 0; i < N; i++) {
    const r = 5 + Math.random() * 11;
    const a = Math.random() * Math.PI * 2;
    const y = (Math.random() - 0.5) * 12;
    pos[i * 3] = Math.cos(a) * r;
    pos[i * 3 + 1] = y;
    pos[i * 3 + 2] = Math.sin(a) * r;
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  const mat = new THREE.PointsMaterial({
    map: glowTex, color: 0xfff2c9, size: 0.13, transparent: true, opacity: 0.6,
    blending: THREE.AdditiveBlending, depthWrite: false, sizeAttenuation: true,
  });
  const pts = new THREE.Points(geo, mat);
  scene.add(pts);
  return pts;
})();

// ---------------------------------------------------------------- gem geometry builders
function ring(radius, y, count, offset = 0) {
  const pts = [];
  for (let i = 0; i < count; i++) {
    const a = (i / count) * Math.PI * 2 + offset;
    pts.push(new THREE.Vector3(Math.cos(a) * radius, y, Math.sin(a) * radius));
  }
  return pts;
}

const CUTS = {
  // round brilliant: table, star facets, bezel, real girdle band, lower-girdle bulge, culet
  brilliant() {
    const pts = [
      new THREE.Vector3(0, 0.5, 0),
      ...ring(0.53, 0.5, 8, Math.PI / 8),     // table edge
      ...ring(0.74, 0.41, 16),                // star facets
      ...ring(0.94, 0.2, 16, Math.PI / 16),   // bezel / upper girdle
      ...ring(1.0, 0.06, 32),                 // girdle top
      ...ring(1.0, -0.02, 32, Math.PI / 32),  // girdle bottom
      ...ring(0.62, -0.6, 16),                // lower-girdle facets
      new THREE.Vector3(0, -1.08, 0),         // culet
    ];
    return new ConvexGeometry(pts);
  },
  // step cut: three tiers above and below the girdle, stretched octagon
  emerald() {
    const oct = (r, y) => ring(r, y, 8, Math.PI / 8).map(p => { p.x *= 1.25; return p; });
    const pts = [
      ...oct(0.60, 0.75), ...oct(0.80, 0.57), ...oct(0.95, 0.30), ...oct(1.0, 0.0),
      ...oct(0.95, -0.27), ...oct(0.75, -0.57), ...oct(0.50, -0.78),
    ];
    return new ConvexGeometry(pts);
  },
  point() {
    const pts = [
      ...ring(0.55, -1.0, 6),
      ...ring(0.58, 0.35, 6),
      ...ring(0.3, 0.85, 6, Math.PI / 6),
      new THREE.Vector3(0.03, 1.25, 0.02),
    ];
    return new ConvexGeometry(pts);
  },
  chunk() {
    const rand = mulberry32(20260611);
    const pts = [];
    for (let i = 0; i < 46; i++) {
      const v = new THREE.Vector3(rand() - 0.5, rand() - 0.5, rand() - 0.5)
        .normalize()
        .multiplyScalar(0.8 + rand() * 0.35);
      v.y *= 1.15;
      pts.push(v);
    }
    return new ConvexGeometry(pts);
  },
  cabochon() {
    const geo = new THREE.SphereGeometry(1, 48, 32);
    geo.scale(1, 0.72, 1);
    return geo;
  },
};

// ConvexGeometry has no UVs — project them per-face so bump maps work
function addBoxUVs(geometry) {
  const pos = geometry.attributes.position;
  const norm = geometry.attributes.normal;
  const uv = new Float32Array(pos.count * 2);
  for (let i = 0; i < pos.count; i++) {
    const nx = Math.abs(norm.getX(i)), ny = Math.abs(norm.getY(i)), nz = Math.abs(norm.getZ(i));
    let u, v;
    if (nx >= ny && nx >= nz) { u = pos.getZ(i); v = pos.getY(i); }
    else if (ny >= nz) { u = pos.getX(i); v = pos.getZ(i); }
    else { u = pos.getX(i); v = pos.getY(i); }
    uv[i * 2] = u * 0.4 + 0.5;
    uv[i * 2 + 1] = v * 0.4 + 0.5;
  }
  geometry.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
}

function applyFx(material, fx) {
  if (fx === 'ripple') {
    material.bumpMap = rippleTex;
    material.bumpScale = 0.6;
  } else if (fx === 'cloudy') {
    material.roughnessMap = cloudTex;
    material.roughness = 0.85;
  } else if (fx === 'opal') {
    material.emissiveMap = opalTex;
    material.emissive = new THREE.Color(0xffffff);
    material.emissiveIntensity = 0.45;
  }
}

// amethyst-style druse: crystal points growing out of a rock base
function buildCluster(gemMaterial) {
  const group = new THREE.Group();
  const rand = mulberry32(424242);
  const rockGeo = CUTS.chunk();
  rockGeo.scale(1.5, 0.55, 1.3);
  const rockMat = new THREE.MeshStandardMaterial({ color: 0x4a4150, roughness: 0.92, metalness: 0.05 });
  const rock = new THREE.Mesh(rockGeo, rockMat);
  rock.position.y = -0.95;
  group.add(rock);
  const pointGeo = CUTS.point();
  for (let i = 0; i < 9; i++) {
    const m = new THREE.Mesh(pointGeo, gemMaterial);
    const s = 0.42 + rand() * 0.55;
    m.scale.setScalar(s);
    const a = rand() * Math.PI * 2;
    const r = rand() * 0.85;
    m.position.set(Math.cos(a) * r, -0.8 + s * 0.7, Math.sin(a) * r);
    m.rotation.set((rand() - 0.5) * 0.85, rand() * Math.PI * 2, (rand() - 0.5) * 0.85);
    group.add(m);
  }
  return group;
}

function buildGem(gem) {
  let obj;
  if (gem.refract && hdrEquirect) {
    // faceted transparent gems: true multi-bounce internal refraction
    const geo = CUTS[gem.cut]();
    const material = createGemRefractionMaterial(geo, hdrEquirect, camera, gem.refract);
    obj = new THREE.Mesh(geo, material);
  } else {
    const material = new THREE.MeshPhysicalMaterial({ ...gem.material });
    if (gem.material.attenuationColor) material.attenuationColor = new THREE.Color(gem.material.attenuationColor);
    applyFx(material, gem.fx);
    if (gem.cut === 'cluster') {
      obj = buildCluster(material);
    } else {
      const geo = CUTS[gem.cut]();
      if (gem.fx === 'ripple') addBoxUVs(geo);
      obj = new THREE.Mesh(geo, material);
    }
  }

  // normalize size + center inside a wrapper (the wrapper carries the pop animation)
  const wrapper = new THREE.Group();
  wrapper.add(obj);
  const box = new THREE.Box3().setFromObject(obj);
  const size = box.getSize(new THREE.Vector3());
  const center = box.getCenter(new THREE.Vector3());
  const s = 2.9 / Math.max(size.x, size.y, size.z);
  obj.scale.setScalar(s);
  obj.position.copy(center).multiplyScalar(-s);
  return wrapper;
}

// ---------------------------------------------------------------- sparkle burst
const burst = (() => {
  const N = 90;
  const pos = new Float32Array(N * 3);
  const vel = [];
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  const mat = new THREE.PointsMaterial({
    map: glowTex, color: 0xffe9a8, size: 0.22, transparent: true, opacity: 0,
    blending: THREE.AdditiveBlending, depthWrite: false,
  });
  const pts = new THREE.Points(geo, mat);
  pts.visible = false;
  scene.add(pts);
  let life = 0;
  return {
    fire(color) {
      mat.color.set(color).lerp(new THREE.Color('#ffffff'), 0.5);
      vel.length = 0;
      for (let i = 0; i < N; i++) {
        const d = new THREE.Vector3(Math.random() - 0.5, Math.random() - 0.5, Math.random() - 0.5).normalize();
        pos[i * 3] = d.x * 1.2;
        pos[i * 3 + 1] = d.y * 1.2;
        pos[i * 3 + 2] = d.z * 1.2;
        vel.push(d.multiplyScalar(2.5 + Math.random() * 3));
      }
      geo.attributes.position.needsUpdate = true;
      life = 1;
      pts.visible = true;
    },
    tick(dt) {
      if (life <= 0) return;
      life -= dt * 1.4;
      mat.opacity = Math.max(life, 0);
      for (let i = 0; i < N; i++) {
        pos[i * 3] += vel[i].x * dt;
        pos[i * 3 + 1] += vel[i].y * dt;
        pos[i * 3 + 2] += vel[i].z * dt;
      }
      geo.attributes.position.needsUpdate = true;
      if (life <= 0) pts.visible = false;
    },
  };
})();

// ---------------------------------------------------------------- gem switching
const gemGroup = new THREE.Group();
scene.add(gemGroup);
let currentMesh = null;
let currentGem = null;
let popT = 1; // 0..1 pop-in animation progress

const easeOutBack = (t) => { const c = 1.70158; return 1 + (c + 1) * Math.pow(t - 1, 3) + c * Math.pow(t - 1, 2); };

function disposeGem(obj) {
  obj.traverse((n) => {
    if (n.isMesh) {
      n.geometry.dispose();
      n.material.userData.bvhStruct?.dispose();
      n.material.dispose();
    }
  });
}

function showGem(gem) {
  if (currentGem?.id === gem.id) { burst.fire(gem.accent); return; }
  currentGem = gem;
  if (currentMesh) {
    gemGroup.remove(currentMesh);
    disposeGem(currentMesh);
  }
  currentMesh = buildGem(gem);
  gemGroup.add(currentMesh);
  popT = 0;
  burst.fire(gem.accent);
  pedestalGlow.material.color.set(gem.accent);
  document.documentElement.style.setProperty('--gem', gem.accent);
  renderCard(gem);
  renderShelfActive(gem.id);
  stopReading();
}

// ---------------------------------------------------------------- tap gem = sparkle
const raycaster = new THREE.Raycaster();
let downAt = null;
canvas.addEventListener('pointerdown', (e) => { downAt = { x: e.clientX, y: e.clientY, t: performance.now() }; });
canvas.addEventListener('pointerup', (e) => {
  if (!downAt) return;
  const moved = Math.hypot(e.clientX - downAt.x, e.clientY - downAt.y);
  const quick = performance.now() - downAt.t < 350;
  downAt = null;
  if (moved > 8 || !quick || !currentMesh) return;
  const ndc = new THREE.Vector2((e.clientX / window.innerWidth) * 2 - 1, -(e.clientY / window.innerHeight) * 2 + 1);
  raycaster.setFromCamera(ndc, camera);
  if (raycaster.intersectObject(currentMesh, true).length) {
    burst.fire(currentGem.accent);
    popT = 0.55; // little bounce
  }
});

// ---------------------------------------------------------------- fact card UI
const card = document.getElementById('card');

function renderCard(gem) {
  card.innerHTML = `
    <div class="card-inner">
      <div class="card-title">
        <span class="card-emoji">${gem.emoji}</span>
        <div>
          <h2>${gem.name}</h2>
          <p class="pronounce">say it: <b>${gem.pronounce}</b></p>
        </div>
      </div>
      <div class="chips">
        ${gem.chips.map(c => `
          <div class="chip">
            <span class="chip-icon">${c.icon}</span>
            <span class="chip-label">${c.label}</span>
            <span class="chip-value">${c.value}</span>
          </div>`).join('')}
      </div>
      <p class="story">${gem.story}</p>
      <div class="wow"><span class="wow-tag">🤯 WOW!</span> ${gem.wow}</div>
      <button id="readBtn" class="read-btn">🔊 Read it to me!</button>
    </div>`;
  document.getElementById('readBtn').addEventListener('click', toggleReading);
  card.classList.remove('pop');
  void card.offsetWidth; // restart animation
  card.classList.add('pop');
}

// ---------------------------------------------------------------- read aloud
let speaking = false;
function stopReading() {
  speechSynthesis.cancel();
  speaking = false;
  const btn = document.getElementById('readBtn');
  if (btn) btn.textContent = '🔊 Read it to me!';
}
function toggleReading() {
  if (speaking) { stopReading(); return; }
  const u = new SpeechSynthesisUtterance(`${currentGem.name}. ${currentGem.story} And here is a wow fact: ${currentGem.wow}`);
  u.rate = 0.92;
  u.pitch = 1.05;
  const voice = speechSynthesis.getVoices().find(v => v.lang.startsWith('en') && /Samantha|Google US/i.test(v.name));
  if (voice) u.voice = voice;
  u.onend = stopReading;
  speaking = true;
  document.getElementById('readBtn').textContent = '⏸️ Stop reading';
  speechSynthesis.speak(u);
}

// ---------------------------------------------------------------- gem shelf UI
const shelf = document.getElementById('shelf');
GEMS.forEach((gem) => {
  const btn = document.createElement('button');
  btn.className = 'gem-btn';
  btn.dataset.id = gem.id;
  btn.style.setProperty('--c1', gem.swatch[0]);
  btn.style.setProperty('--c2', gem.swatch[1]);
  btn.style.setProperty('--c3', gem.swatch[2]);
  btn.innerHTML = `<span class="gem-icon"></span><span class="gem-name">${gem.name}</span>`;
  btn.addEventListener('click', () => showGem(gem));
  shelf.appendChild(btn);
});

function renderShelfActive(id) {
  shelf.querySelectorAll('.gem-btn').forEach(b => b.classList.toggle('active', b.dataset.id === id));
  shelf.querySelector(`[data-id="${id}"]`)?.scrollIntoView({ behavior: 'smooth', block: 'nearest', inline: 'center' });
}

// ---------------------------------------------------------------- loop
const clock = new THREE.Clock();
renderer.setAnimationLoop(() => {
  const dt = Math.min(clock.getDelta(), 0.05);
  const t = clock.elapsedTime;

  if (currentMesh) {
    if (popT < 1) {
      popT = Math.min(popT + dt * 2.2, 1);
      currentMesh.scale.setScalar(Math.max(easeOutBack(popT), 0.001));
    }
    gemGroup.position.y = 0.1 + Math.sin(t * 1.3) * 0.08;
  }
  dust.rotation.y = t * 0.02;
  pedestalGlow.material.opacity = 0.42 + Math.sin(t * 2) * 0.08;
  burst.tick(dt);
  controls.update();
  composer.render();
});

window.addEventListener('resize', () => {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
  composer.setSize(window.innerWidth, window.innerHeight);
  setRefractionResolution(renderer);
});

// warm up speech voices (some browsers load them async)
speechSynthesis.getVoices();

// go! (wait for the HDRI so refraction gems get the real studio light)
setRefractionResolution(renderer);
hdrReady.then(() => showGem(GEMS[0]));
