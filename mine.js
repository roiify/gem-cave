// Rylan's Mine — tap-to-dig mining game with procedural caves and random loot
// Loot comes from the real gem database, so everything he digs up links back to the 3D viewer.
import { GEMS } from './gems.js';

const COLS = 10;
const ROWS = 15;
const SWINGS_PER_CAVE = 60;
const GEM_BY_ID = Object.fromEntries(GEMS.map(g => [g.id, g]));

// loot odds by category; deep caves boost the precious ones
const CAT_WEIGHTS = {
  quartz: 30, colorful: 18, pattern: 14, metal: 12, volcano: 10,
  lightshow: 10, crystal: 10, alive: 8, magic: 8, famous: 6, rare: 2,
};

// ---------------------------------------------------------------- save data
const save = JSON.parse(localStorage.getItem('rylanMine') || '{}');
save.caveNum = save.caveNum || 1;
save.collection = save.collection || {};
save.muted = save.muted || false;
function persist() { localStorage.setItem('rylanMine', JSON.stringify(save)); }

// ---------------------------------------------------------------- tiny synth sounds
let audioCtx = null;
function beep(freq, dur, type = 'sine', vol = 0.12, delay = 0) {
  if (save.muted) return;
  audioCtx = audioCtx || new (window.AudioContext || window.webkitAudioContext)();
  const t = audioCtx.currentTime + delay;
  const osc = audioCtx.createOscillator();
  const gain = audioCtx.createGain();
  osc.type = type;
  osc.frequency.value = freq;
  gain.gain.setValueAtTime(vol, t);
  gain.gain.exponentialRampToValueAtTime(0.001, t + dur);
  osc.connect(gain).connect(audioCtx.destination);
  osc.start(t);
  osc.stop(t + dur);
}
const sfx = {
  dig: () => beep(120 + Math.random() * 60, 0.08, 'square', 0.06),
  crack: () => beep(70, 0.12, 'sawtooth', 0.07),
  gem: () => { beep(660, 0.15, 'sine', 0.1); beep(990, 0.25, 'sine', 0.1, 0.08); },
  fanfare: () => [523, 659, 784, 1047].forEach((f, i) => beep(f, 0.22, 'triangle', 0.1, i * 0.1)),
  empty: () => beep(200, 0.05, 'sine', 0.04),
};

// ---------------------------------------------------------------- rng
function mulberry32(seed) {
  return () => {
    seed |= 0; seed = (seed + 0x6D2B79F5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function pickGem(rand, depthBoost, rowFrac) {
  const pool = [];
  for (const g of GEMS) {
    let w = CAT_WEIGHTS[g.cat] || 0;
    if (!w) continue;
    if (g.cat === 'famous' || g.cat === 'rare') w *= 1 + depthBoost * 0.4 + rowFrac * 1.5;
    pool.push([g, w]);
  }
  let total = pool.reduce((s, [, w]) => s + w, 0);
  let r = rand() * total;
  for (const [g, w] of pool) { r -= w; if (r <= 0) return g; }
  return pool[0][0];
}

// ---------------------------------------------------------------- cave generation
let grid, swings, caveLoot, rand;

function generateCave() {
  rand = mulberry32((save.caveNum * 7919 + 12345) ^ Date.now());
  grid = [];
  for (let y = 0; y < ROWS; y++) {
    const row = [];
    for (let x = 0; x < COLS; x++) {
      if (y === 0) { row.push({ kind: 'dug', hp: 0 }); continue; } // surface sky
      const depth = y / ROWS;
      const roll = rand();
      let kind = 'dirt', hp = 1;
      if (roll < 0.18 + depth * 0.3) { kind = 'rock'; hp = 2; }
      if (roll < depth * 0.18) { kind = 'hard'; hp = 3; }
      row.push({ kind, hp, maxHp: hp });
    }
    grid.push(row);
  }
  // drunken-walk soft tunnels so there is always a fun path down
  for (let t = 0; t < 3; t++) {
    let x = 2 + Math.floor(rand() * (COLS - 4));
    for (let y = 1; y < ROWS - 1; y += rand() < 0.7 ? 1 : 0) {
      grid[y][x] = { kind: 'dirt', hp: 1, maxHp: 1 };
      x = Math.max(1, Math.min(COLS - 2, x + (rand() < 0.5 ? -1 : 1)));
      grid[y][x] = { kind: 'dirt', hp: 1, maxHp: 1 };
    }
  }
  // sprinkle loot — first few sit shallow for quick wins, the rest hide deeper
  const gemCount = 14 + Math.min(save.caveNum, 6);
  const spots = new Set();
  for (let i = 0; i < gemCount; i++) {
    const y = i < 4
      ? 1 + Math.floor(rand() * 3)                      // rows 1-3: easy early finds
      : 2 + Math.floor(Math.sqrt(rand()) * (ROWS - 3)); // bias deep
    const x = Math.floor(rand() * COLS);
    if (spots.has(y * COLS + x)) { i--; continue; }
    spots.add(y * COLS + x);
    const gem = pickGem(rand, save.caveNum, y / ROWS);
    const tile = grid[y][x];
    tile.gem = gem.id;
    tile.kind = tile.kind === 'dirt' ? 'rock' : tile.kind; // gems hide in stone
    tile.hp = tile.maxHp = tile.kind === 'hard' ? 3 : 2;
  }
  // one guaranteed treasure near the bottom
  const ty = ROWS - 2 - Math.floor(rand() * 2);
  const tx = Math.floor(rand() * COLS);
  const rares = GEMS.filter(g => g.cat === 'rare' || g.cat === 'famous');
  grid[ty][tx] = { kind: 'hard', hp: 3, maxHp: 3, gem: rares[Math.floor(rand() * rares.length)].id, crown: true };

  swings = SWINGS_PER_CAVE;
  caveLoot = {};
  updateHud();
}

function isDigable(x, y) {
  const t = grid[y]?.[x];
  if (!t || t.kind === 'dug') return false;
  return [[0, -1], [0, 1], [-1, 0], [1, 0]].some(([dx, dy]) => grid[y + dy]?.[x + dx]?.kind === 'dug');
}

// ---------------------------------------------------------------- canvas
const canvas = document.getElementById('mine');
const ctx = canvas.getContext('2d');
let tileSize = 32, offsetX = 0, offsetY = 0;

function layout() {
  canvas.width = window.innerWidth * devicePixelRatio;
  canvas.height = window.innerHeight * devicePixelRatio;
  canvas.style.width = window.innerWidth + 'px';
  canvas.style.height = window.innerHeight + 'px';
  ctx.setTransform(devicePixelRatio, 0, 0, devicePixelRatio, 0, 0);
  const topPad = 64, botPad = 70;
  tileSize = Math.floor(Math.min((window.innerWidth - 12) / COLS, (window.innerHeight - topPad - botPad) / ROWS));
  offsetX = (window.innerWidth - tileSize * COLS) / 2;
  offsetY = topPad + (window.innerHeight - topPad - botPad - tileSize * ROWS) / 2;
}
window.addEventListener('resize', layout);
layout();

const particles = [];
const flyers = []; // collected gems flying to the bag

function spawnBurst(px, py, color, n = 14) {
  for (let i = 0; i < n; i++) {
    const a = Math.random() * Math.PI * 2;
    const s = 60 + Math.random() * 160;
    particles.push({ x: px, y: py, vx: Math.cos(a) * s, vy: Math.sin(a) * s - 80, life: 0.7 + Math.random() * 0.4, color });
  }
}

function drawGemShape(px, py, size, gem, twinkle = 1) {
  const [c1, c2, c3] = gem.swatch;
  const g = ctx.createLinearGradient(px - size / 2, py - size / 2, px + size / 2, py + size / 2);
  g.addColorStop(0, c1); g.addColorStop(0.55, c2); g.addColorStop(1, c3);
  ctx.fillStyle = g;
  ctx.beginPath();
  ctx.moveTo(px, py - size * 0.5);
  ctx.lineTo(px + size * 0.5, py - size * 0.12);
  ctx.lineTo(px, py + size * 0.5);
  ctx.lineTo(px - size * 0.5, py - size * 0.12);
  ctx.closePath();
  ctx.fill();
  ctx.fillStyle = `rgba(255,255,255,${0.55 * twinkle})`;
  ctx.beginPath();
  ctx.ellipse(px - size * 0.14, py - size * 0.22, size * 0.13, size * 0.07, -0.5, 0, Math.PI * 2);
  ctx.fill();
}

const TILE_COLORS = {
  dirt: ['#6e4a2e', '#5c3d24'],
  rock: ['#62656e', '#50525a'],
  hard: ['#3a3d47', '#2e3038'],
};

function draw(time) {
  const W = window.innerWidth, H = window.innerHeight;
  // cave backdrop
  const bg = ctx.createLinearGradient(0, 0, 0, H);
  bg.addColorStop(0, '#171326');
  bg.addColorStop(1, '#07050e');
  ctx.fillStyle = bg;
  ctx.fillRect(0, 0, W, H);

  for (let y = 0; y < ROWS; y++) {
    for (let x = 0; x < COLS; x++) {
      const t = grid[y][x];
      const px = offsetX + x * tileSize, py = offsetY + y * tileSize;
      if (t.kind === 'dug') {
        if (y === 0) { // grassy surface strip
          ctx.fillStyle = '#1b3a26';
          ctx.fillRect(px, py + tileSize * 0.55, tileSize, tileSize * 0.45);
          ctx.fillStyle = '#2e6e40';
          ctx.fillRect(px, py + tileSize * 0.55, tileSize, tileSize * 0.14);
        }
        continue;
      }
      const [cA, cB] = TILE_COLORS[t.kind] || TILE_COLORS.rock;
      ctx.fillStyle = (x + y) % 2 ? cA : cB;
      ctx.fillRect(px + 1, py + 1, tileSize - 2, tileSize - 2);
      // speckles
      ctx.fillStyle = 'rgba(255,255,255,0.05)';
      ctx.fillRect(px + (x * 7 % tileSize), py + (y * 11 % tileSize), 3, 3);
      // hidden gems twinkle to invite digging
      if (t.gem) {
        const tw = Math.max(0, Math.sin(time / 400 + x * 3 + y * 5));
        if (tw > 0.65) {
          ctx.fillStyle = `rgba(255,255,255,${(tw - 0.65) * 1.6})`;
          const sx = px + tileSize * 0.5, sy = py + tileSize * 0.4;
          ctx.beginPath();
          ctx.moveTo(sx, sy - 5); ctx.lineTo(sx + 2, sy - 1); ctx.lineTo(sx + 6, sy);
          ctx.lineTo(sx + 2, sy + 1); ctx.lineTo(sx, sy + 5); ctx.lineTo(sx - 2, sy + 1);
          ctx.lineTo(sx - 6, sy); ctx.lineTo(sx - 2, sy - 1);
          ctx.closePath();
          ctx.fill();
        }
      }
      // cracks as damage progresses
      if (t.hp < t.maxHp) {
        ctx.strokeStyle = 'rgba(0,0,0,0.55)';
        ctx.lineWidth = 1.5;
        ctx.beginPath();
        ctx.moveTo(px + tileSize * 0.25, py + tileSize * 0.2);
        ctx.lineTo(px + tileSize * 0.5, py + tileSize * 0.55);
        ctx.lineTo(px + tileSize * 0.35, py + tileSize * 0.85);
        if (t.hp <= t.maxHp - 2) {
          ctx.moveTo(px + tileSize * 0.75, py + tileSize * 0.15);
          ctx.lineTo(px + tileSize * 0.55, py + tileSize * 0.5);
          ctx.lineTo(px + tileSize * 0.8, py + tileSize * 0.8);
        }
        ctx.stroke();
      }
      // pulsing outline on tiles you can dig
      if (isDigable(x, y)) {
        const pulse = 0.25 + 0.2 * Math.sin(time / 300);
        ctx.strokeStyle = `rgba(255, 209, 102, ${pulse})`;
        ctx.lineWidth = 2;
        ctx.strokeRect(px + 2, py + 2, tileSize - 4, tileSize - 4);
      }
      if (t.crown) {
        ctx.font = `${Math.floor(tileSize * 0.34)}px serif`;
        ctx.fillText('👑', px + tileSize * 0.32, py + tileSize * 0.36);
      }
    }
  }

  // particles
  const dt = 1 / 60;
  for (let i = particles.length - 1; i >= 0; i--) {
    const p = particles[i];
    p.life -= dt;
    if (p.life <= 0) { particles.splice(i, 1); continue; }
    p.vy += 500 * dt;
    p.x += p.vx * dt;
    p.y += p.vy * dt;
    ctx.globalAlpha = Math.min(p.life, 1);
    ctx.fillStyle = p.color;
    ctx.fillRect(p.x, p.y, 4, 4);
  }
  ctx.globalAlpha = 1;

  // gems flying to the bag
  const bag = document.getElementById('bagBtn').getBoundingClientRect();
  for (let i = flyers.length - 1; i >= 0; i--) {
    const f = flyers[i];
    f.t += dt * 1.6;
    if (f.t >= 1) {
      flyers.splice(i, 1);
      updateHud();
      continue;
    }
    const ease = f.t * f.t * (3 - 2 * f.t);
    const fx = f.x + (bag.left + bag.width / 2 - f.x) * ease;
    const fy = f.y + (bag.top + bag.height / 2 - f.y) * ease;
    drawGemShape(fx, fy, tileSize * (1 - f.t * 0.5), GEM_BY_ID[f.gem]);
  }

  requestAnimationFrame(draw);
}
requestAnimationFrame(draw);

// ---------------------------------------------------------------- digging
canvas.addEventListener('pointerdown', (e) => {
  const x = Math.floor((e.clientX - offsetX) / tileSize);
  const y = Math.floor((e.clientY - offsetY) / tileSize);
  if (x < 0 || x >= COLS || y < 0 || y >= ROWS) return;
  const t = grid[y][x];
  if (t.kind === 'dug') { sfx.empty(); return; }
  if (!isDigable(x, y)) { sfx.empty(); return; }
  if (swings <= 0) { showRecap(); return; }

  swings--;
  t.hp--;
  const px = offsetX + x * tileSize + tileSize / 2;
  const py = offsetY + y * tileSize + tileSize / 2;
  spawnBurst(px, py, t.kind === 'dirt' ? '#8a5c38' : '#9aa0ad', 8);

  if (t.hp > 0) {
    sfx.crack();
  } else {
    const gemId = t.gem;
    grid[y][x] = { kind: 'dug', hp: 0 };
    sfx.dig();
    if (gemId) collectGem(gemId, px, py, t.crown);
  }
  updateHud();
  if (swings <= 0) setTimeout(showRecap, 1400);
});

function collectGem(gemId, px, py, crowned) {
  const gem = GEM_BY_ID[gemId];
  caveLoot[gemId] = (caveLoot[gemId] || 0) + 1;
  save.collection[gemId] = (save.collection[gemId] || 0) + 1;
  persist();
  flyers.push({ gem: gemId, x: px, y: py, t: 0 });
  spawnBurst(px, py, gem.accent, 22);
  const isRare = gem.cat === 'rare' || gem.cat === 'famous' || crowned;
  if (isRare) sfx.fanfare(); else sfx.gem();
  const toast = document.getElementById('toast');
  toast.textContent = `${gem.emoji} You found ${gem.name.toUpperCase()}!${isRare ? ' 🌟' : ''}`;
  toast.style.borderColor = gem.accent;
  toast.classList.remove('show');
  void toast.offsetWidth;
  toast.classList.add('show');
}

// ---------------------------------------------------------------- hud + overlays
function bagTotal() { return Object.values(save.collection).reduce((s, n) => s + n, 0); }

function updateHud() {
  document.getElementById('swings').textContent = swings;
  document.getElementById('caveNum').textContent = save.caveNum;
  document.getElementById('bagCount').textContent = bagTotal();
}

const overlay = document.getElementById('overlay');

function lootItemHtml(gemId, count, linkable) {
  const gem = GEM_BY_ID[gemId];
  const rare = gem.cat === 'rare' || gem.cat === 'famous' ? ' rare-find' : '';
  const inner = `<span class="le">${gem.emoji}</span><span class="ln">${gem.name}</span><span class="lc">×${count}</span>`;
  return linkable
    ? `<a class="loot-item${rare}" href="./?gem=${gemId}">${inner}</a>`
    : `<div class="loot-item${rare}">${inner}</div>`;
}

function showRecap() {
  const ids = Object.keys(caveLoot);
  overlay.innerHTML = `
    <div class="panel">
      <h2>⛏️ Cave ${save.caveNum} done!</h2>
      <p>${ids.length ? 'Look at your treasure, Rylan!' : 'No gems this time — the next cave is luckier!'}</p>
      <div class="loot-grid">${ids.map(id => lootItemHtml(id, caveLoot[id], false)).join('')}</div>
      <button class="big-btn" id="nextCave">⛏️ Dig a NEW cave!</button>
    </div>`;
  overlay.classList.add('show');
  document.getElementById('nextCave').addEventListener('click', () => {
    save.caveNum++;
    persist();
    overlay.classList.remove('show');
    generateCave();
  });
}

function showBag() {
  const ids = Object.keys(save.collection).sort((a, b) => save.collection[b] - save.collection[a]);
  overlay.innerHTML = `
    <div class="panel">
      <h2>🎒 Rylan's Treasure Box</h2>
      <p>${ids.length ? `${bagTotal()} treasures found! Tap one to learn its secrets.` : 'Dig some gems to fill your treasure box!'}</p>
      <div class="loot-grid">${ids.map(id => lootItemHtml(id, save.collection[id], true)).join('')}</div>
      <button class="big-btn" id="closeBag">⛏️ Back to digging!</button>
    </div>`;
  overlay.classList.add('show');
  document.getElementById('closeBag').addEventListener('click', () => overlay.classList.remove('show'));
}

document.getElementById('bagBtn').addEventListener('click', showBag);
document.getElementById('newCaveBtn').addEventListener('click', () => {
  save.caveNum++;
  persist();
  generateCave();
});

const muteBtn = document.getElementById('muteBtn');
muteBtn.textContent = save.muted ? '🔇' : '🔊';
muteBtn.addEventListener('click', () => {
  save.muted = !save.muted;
  persist();
  muteBtn.textContent = save.muted ? '🔇' : '🔊';
});

// go!
generateCave();

// test hook (harmless): lets automated checks inspect state
window.__mine = { get grid() { return grid; }, get swings() { return swings; }, get loot() { return caveLoot; }, isDigable };
