import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { ConvexGeometry } from 'three/addons/geometries/ConvexGeometry.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { GEMS } from './gems.js';

// ---------------------------------------------------------------- renderer
const canvas = document.getElementById('scene');
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.15;

const scene = new THREE.Scene();
scene.background = new THREE.Color('#0b0916');

const camera = new THREE.PerspectiveCamera(42, window.innerWidth / window.innerHeight, 0.1, 100);
camera.position.set(0, 0.7, 5.4);

const pmrem = new THREE.PMREMGenerator(renderer);
scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;

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

// ---------------------------------------------------------------- cave atmosphere
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

// big soft color blobs deep in the cave (gives transmission something to bend)
const blobs = [];
[[-7, 3, -10, '#3d2a7a', 14], [8, -2, -12, '#143a5c', 16], [0, -6, -9, '#28104a', 12]].forEach(([x, y, z, col, s]) => {
  const m = new THREE.SpriteMaterial({ map: glowTex, color: new THREE.Color(col), transparent: true, opacity: 0.55, depthWrite: false });
  const sp = new THREE.Sprite(m);
  sp.position.set(x, y, z);
  sp.scale.setScalar(s);
  scene.add(sp);
  blobs.push(sp);
});

// soft accent glow directly behind the gem — gives transmissive gems bright light to refract
const backGlow = new THREE.Sprite(new THREE.SpriteMaterial({
  map: glowTex, color: 0xffffff, transparent: true, opacity: 0.5, depthWrite: false,
}));
backGlow.position.set(0, 0.4, -5.5);
backGlow.scale.setScalar(10);
scene.add(backGlow);

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
    map: glowTex, color: 0xfff2c9, size: 0.16, transparent: true, opacity: 0.7,
    blending: THREE.AdditiveBlending, depthWrite: false, sizeAttenuation: true,
  });
  const pts = new THREE.Points(geo, mat);
  scene.add(pts);
  return pts;
})();

// ---------------------------------------------------------------- gem geometry builders
function mulberry32(seed) {
  return () => {
    seed |= 0; seed = (seed + 0x6D2B79F5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function ring(radius, y, count, offset = 0) {
  const pts = [];
  for (let i = 0; i < count; i++) {
    const a = (i / count) * Math.PI * 2 + offset;
    pts.push(new THREE.Vector3(Math.cos(a) * radius, y, Math.sin(a) * radius));
  }
  return pts;
}

const CUTS = {
  brilliant() {
    const pts = [
      ...ring(0.55, 0.52, 8, Math.PI / 8), // table edge
      ...ring(0.92, 0.3, 16),              // crown
      ...ring(1.0, 0.0, 16, Math.PI / 16), // girdle
      new THREE.Vector3(0, 0.52, 0),       // table center
      new THREE.Vector3(0, -1.25, 0),      // culet
    ];
    return new ConvexGeometry(pts);
  },
  emerald() {
    const oct = (r, y) => ring(r, y, 8, Math.PI / 8).map(p => { p.x *= 1.35; return p; });
    const pts = [...oct(0.62, 0.5), ...oct(0.95, 0.22), ...oct(0.95, -0.22), ...oct(0.55, -0.5)];
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

function buildGemMesh(gem) {
  const geometry = CUTS[gem.cut]();
  geometry.computeBoundingSphere();
  const s = 1.45 / geometry.boundingSphere.radius;
  geometry.scale(s, s, s);
  geometry.center();
  const material = new THREE.MeshPhysicalMaterial({ side: THREE.FrontSide, ...gem.material });
  if (gem.material.attenuationColor) material.attenuationColor = new THREE.Color(gem.material.attenuationColor);
  return new THREE.Mesh(geometry, material);
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

function showGem(gem) {
  if (currentGem?.id === gem.id) { burst.fire(gem.accent); return; }
  currentGem = gem;
  if (currentMesh) {
    gemGroup.remove(currentMesh);
    currentMesh.geometry.dispose();
    currentMesh.material.dispose();
  }
  currentMesh = buildGemMesh(gem);
  gemGroup.add(currentMesh);
  popT = 0;
  burst.fire(gem.accent);
  pedestalGlow.material.color.set(gem.accent);
  backGlow.material.color.set(gem.accent).lerp(new THREE.Color('#ffffff'), 0.35);
  rimLight.color.set(gem.accent);
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
  if (raycaster.intersectObject(currentMesh).length) {
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
  renderer.render(scene, camera);
});

window.addEventListener('resize', () => {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
});

// warm up speech voices (some browsers load them async)
speechSynthesis.getVoices();

// go!
showGem(GEMS[0]);
