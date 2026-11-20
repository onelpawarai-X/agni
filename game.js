/* ============================================================
   অগ্নি — a real-time twin-stick survival shooter on canvas
   ============================================================ */

const cv = document.getElementById('cv');
const ctx = cv.getContext('2d', { alpha: false });

let W = 0, H = 0, DPR = 1;
// Keep the visible world area roughly constant across screen sizes, so a phone and a
// desktop see a comparable amount of action instead of the phone seeing a keyhole.
let ZOOM = 2.15;
function resize() {
  DPR = Math.min(window.devicePixelRatio || 1, 2);
  W = window.innerWidth;
  H = window.innerHeight;
  cv.width = Math.round(W * DPR);
  cv.height = Math.round(H * DPR);
  cv.style.width = W + 'px';
  cv.style.height = H + 'px';
  ctx.setTransform(DPR, 0, 0, DPR, 0, 0);
  computeZoom();
}
window.addEventListener('resize', resize);
resize();

/* ---------------- utils ---------------- */
const TAU = Math.PI * 2;
const rand = (a, b) => a + Math.random() * (b - a);
const randInt = (a, b) => Math.floor(rand(a, b + 1));
const clamp = (v, a, b) => v < a ? a : v > b ? b : v;
const lerp = (a, b, t) => a + (b - a) * t;
const dist2 = (a, b) => { const dx = a.x - b.x, dy = a.y - b.y; return dx * dx + dy * dy; };
const bn = n => String(Math.floor(n)).replace(/\d/g, d => '০১২৩৪৫৬৭৮৯'[d]);

/* ---------------- audio ---------------- */
let AC = null, muted = false;
function tone(freq, dur, type, vol, slide) {
  if (muted) return;
  try {
    AC = AC || new (window.AudioContext || window.webkitAudioContext)();
    if (AC.state === 'suspended') AC.resume();
    const o = AC.createOscillator(), g = AC.createGain();
    o.type = type || 'sine';
    o.frequency.setValueAtTime(freq, AC.currentTime);
    if (slide) o.frequency.exponentialRampToValueAtTime(Math.max(20, slide), AC.currentTime + dur);
    g.gain.setValueAtTime(vol, AC.currentTime);
    g.gain.exponentialRampToValueAtTime(0.0001, AC.currentTime + dur);
    o.connect(g); g.connect(AC.destination);
    o.start(); o.stop(AC.currentTime + dur);
  } catch (e) { }
}
const sfx = {
  shoot: () => tone(680, .06, 'square', .028, 380),
  hit: () => tone(200, .07, 'square', .035, 120),
  kill: () => tone(150, .16, 'sawtooth', .04, 50),
  hurt: () => tone(110, .22, 'sawtooth', .07, 55),
  dash: () => tone(520, .13, 'sine', .05, 900),
  pick: () => tone(1050, .07, 'sine', .028, 1500),
  level: () => { tone(520, .1, 'sine', .05); setTimeout(() => tone(780, .12, 'sine', .05), 80); setTimeout(() => tone(1050, .18, 'sine', .05), 165); },
  boss: () => { tone(80, .5, 'sawtooth', .07, 40); },
};

/* ---------------- world / camera ---------------- */
function computeZoom() {
  // resize() runs before the utils below are initialised, so no clamp() here
  const short = Math.min(W, H);
  ZOOM = Math.min(2.2, Math.max(1.15, short / 330));
}
const world = { w: 2600, h: 2600 };
const cam = { x: 0, y: 0, shake: 0, shakeT: 0 };
function shake(amt) { cam.shake = Math.max(cam.shake, amt); cam.shakeT = 1; }

/* ---------------- game state ---------------- */
const G = {
  state: 'title',           // title | play | upgrade | dead | pause
  t: 0, dt: 0, last: 0,
  score: 0, wave: 1, kills: 0,
  spawnT: 0, waveT: 0, bossSpawned: {},
  slowmo: 0,
};

const P = {
  x: 0, y: 0, vx: 0, vy: 0, r: 19,
  hp: 100, maxHp: 100,
  speed: 232,
  fireRate: .42, fireT: 0,
  dmg: 12, bulletSpeed: 720, bullets: 1, spread: .10, pierce: 0,
  range: 520,
  xp: 0, level: 1, xpNext: 6,
  dashCd: 0, dashT: 0, dashDir: { x: 1, y: 0 },
  iFrame: 0,
  magnet: 90,
  crit: 0,
  lifesteal: 0,
  regen: 0,
  trail: [],
};

let enemies = [], bullets = [], ebullets = [], orbs = [], parts = [], texts = [], rings = [];

/* ---------------- input ---------------- */
const keys = {};
addEventListener('keydown', e => {
  keys[e.key.toLowerCase()] = true;
  if (e.key === ' ' || e.key === 'Shift') { e.preventDefault(); tryDash(); }
  // one branch only: pauseGame() flips the state, so a second `if` would resume on the same keypress
  if (e.key === 'Escape') {
    if (G.state === 'play') pauseGame();
    else if (G.state === 'pause') resumeGame();
  }
});
addEventListener('keyup', e => { keys[e.key.toLowerCase()] = false; });

const touch = { active: false, id: null, ox: 0, oy: 0, x: 0, y: 0 };
function tpos(t) { const r = cv.getBoundingClientRect(); return { x: t.clientX - r.left, y: t.clientY - r.top }; }

cv.addEventListener('touchstart', e => {
  if (G.state !== 'play') return;
  e.preventDefault();
  const t = e.changedTouches[0];
  const p = tpos(t);
  // right-bottom quadrant = dash
  if (p.x > W - 110 && p.y > H - 130) { tryDash(); return; }
  if (!touch.active) { touch.active = true; touch.id = t.identifier; touch.ox = p.x; touch.oy = p.y; touch.x = p.x; touch.y = p.y; }
}, { passive: false });

cv.addEventListener('touchmove', e => {
  if (!touch.active) return;
  e.preventDefault();
  for (const t of e.changedTouches) {
    if (t.identifier === touch.id) { const p = tpos(t); touch.x = p.x; touch.y = p.y; }
  }
}, { passive: false });

const endTouch = e => {
  for (const t of e.changedTouches) if (t.identifier === touch.id) { touch.active = false; touch.id = null; }
};
cv.addEventListener('touchend', endTouch);
cv.addEventListener('touchcancel', endTouch);

document.getElementById('dashbtn').addEventListener('touchstart', e => { e.preventDefault(); tryDash(); }, { passive: false });
document.getElementById('dashbtn').addEventListener('click', e => { e.preventDefault(); tryDash(); });

/* ---------------- helpers ---------------- */
function tryDash() {
  if (G.state !== 'play' || P.dashCd > 0) return;
  let dx = 0, dy = 0;
  if (touch.active) { dx = touch.x - touch.ox; dy = touch.y - touch.oy; }
  else {
    if (keys['a'] || keys['arrowleft']) dx -= 1;
    if (keys['d'] || keys['arrowright']) dx += 1;
    if (keys['w'] || keys['arrowup']) dy -= 1;
    if (keys['s'] || keys['arrowdown']) dy += 1;
  }
  if (!dx && !dy) { dx = P.dashDir.x; dy = P.dashDir.y; }
  const m = Math.hypot(dx, dy) || 1;
  P.dashDir = { x: dx / m, y: dy / m };
  P.dashT = .16;
  P.dashCd = .85;
  P.iFrame = Math.max(P.iFrame, .26);
  sfx.dash();
  for (let i = 0; i < 14; i++) {
    parts.push({
      x: P.x, y: P.y, vx: rand(-160, 160) - P.dashDir.x * 200, vy: rand(-160, 160) - P.dashDir.y * 200,
      life: rand(.25, .5), max: .5, r: rand(1.5, 3.5), c: '#6ee7ff', glow: true
    });
  }
}

function addText(x, y, txt, c, size) {
  texts.push({ x, y, txt, c: c || '#fff', size: size || 13, life: .8, max: .8, vy: -46 });
}

function burst(x, y, n, color, spd, size) {
  for (let i = 0; i < n; i++) {
    const a = rand(0, TAU), s = rand(spd * .3, spd);
    parts.push({
      x, y, vx: Math.cos(a) * s, vy: Math.sin(a) * s,
      life: rand(.25, .65), max: .65, r: rand(size * .5, size), c: color, glow: true
    });
  }
}

function ring(x, y, color, r0, r1, life) {
  rings.push({ x, y, r: r0, r1, life, max: life, c: color });
}

/* ---------------- enemy types ---------------- */
const ETYPES = {
  grunt: { hp: 16, r: 16, spd: 74, dmg: 9, xp: 1, c: '#ff4d4d', c2: '#ffb3b3', score: 10 },
  swift: { hp: 10, r: 13, spd: 148, dmg: 7, xp: 1, c: '#ffd166', c2: '#fff2c0', score: 14 },
  tank: { hp: 52, r: 26, spd: 46, dmg: 16, xp: 3, c: '#a78bfa', c2: '#e0d4ff', score: 26 },
  shooter: { hp: 22, r: 17, spd: 58, dmg: 8, xp: 2, c: '#22d3ee', c2: '#c7f9ff', score: 22, ranged: true },
  splitter: { hp: 30, r: 22, spd: 66, dmg: 10, xp: 2, c: '#4ade80', c2: '#d1ffe0', score: 20, splits: 2 },
  boss: { hp: 520, r: 52, spd: 44, dmg: 22, xp: 24, c: '#ff2d6e', c2: '#ffc2d6', score: 400, ranged: true, boss: true },
};

function spawnEnemy(type, x, y) {
  const d = ETYPES[type];
  const scale = 1 + (G.wave - 1) * 0.13;
  const hp = Math.round(d.hp * scale);
  enemies.push({
    type, x, y, vx: 0, vy: 0, r: d.r,
    hp, maxHp: hp,
    spd: d.spd * (1 + (G.wave - 1) * 0.02),
    dmg: d.dmg * (1 + (G.wave - 1) * 0.06),
    c: d.c, c2: d.c2, xp: d.xp, score: d.score,
    ranged: !!d.ranged, splits: d.splits || 0, boss: !!d.boss,
    fireT: rand(.6, 1.8), hitT: 0, wob: rand(0, TAU), knock: { x: 0, y: 0 },
  });
}

function edgePoint(side) {
  const m = 50;
  const vw = W / ZOOM, vh = H / ZOOM;
  if (side === 0) return { x: rand(cam.x - m, cam.x + vw + m), y: cam.y - m };
  if (side === 1) return { x: cam.x + vw + m, y: rand(cam.y - m, cam.y + vh + m) };
  if (side === 2) return { x: rand(cam.x - m, cam.x + vw + m), y: cam.y + vh + m };
  return { x: cam.x - m, y: rand(cam.y - m, cam.y + vh + m) };
}

function spawnAtEdge(type, side) {
  const p = edgePoint(side === undefined ? randInt(0, 3) : side);
  spawnEnemy(type, p.x, p.y);
}

function spawnPack(n) {
  const side = randInt(0, 3);
  for (let i = 0; i < n; i++) {
    const p = edgePoint(side);
    spawnEnemy(pickType(), p.x + rand(-60, 60), p.y + rand(-60, 60));
  }
}

function pickType() {
  const w = G.wave;
  const pool = [];
  pool.push('grunt', 'grunt', 'grunt');
  if (w >= 2) pool.push('swift', 'swift');
  if (w >= 3) pool.push('shooter');
  if (w >= 4) pool.push('tank');
  if (w >= 5) pool.push('splitter');
  if (w >= 6) pool.push('shooter', 'tank');
  if (w >= 8) pool.push('swift', 'splitter');
  return pool[randInt(0, pool.length - 1)];
}

/* ---------------- run control ---------------- */
function resetGame() {
  P.x = 0; P.y = 0; P.vx = 0; P.vy = 0;
  P.hp = 100; P.maxHp = 100;
  P.speed = 232;
  P.fireRate = .42; P.fireT = 0;
  P.dmg = 12; P.bulletSpeed = 720; P.bullets = 1; P.spread = .10; P.pierce = 0;
  P.range = 520;
  P.xp = 0; P.level = 1; P.xpNext = 6;
  P.dashCd = 0; P.dashT = 0; P.iFrame = 0;
  P.magnet = 90; P.crit = 0; P.lifesteal = 0; P.regen = 0;
  P.trail = [];

  enemies = []; bullets = []; ebullets = []; orbs = []; parts = []; texts = []; rings = [];
  G.score = 0; G.wave = 1; G.kills = 0; G.t = 0;
  G.spawnT = .15; G.waveT = 0; G.bossSpawned = {}; G.slowmo = 0;
  cam.x = -W / 2; cam.y = -H / 2; cam.shake = 0;
  updateHud();
}

function startGame() {
  resetGame();
  G.state = 'play';
  document.getElementById('scr-title').classList.add('hide');
  document.getElementById('scr-dead').classList.add('hide');
  document.getElementById('scr-up').classList.add('hide');
  document.getElementById('hud').classList.remove('hide');
  document.getElementById('dashbtn').classList.remove('hide');
  tone(440, .12, 'sine', .05);
}

function die() {
  G.state = 'dead';
  sfx.hurt();
  burst(P.x, P.y, 60, '#ff4d4d', 340, 4);
  ring(P.x, P.y, '#ff4d4d', 10, 200, .7);
  shake(24);
  const best = Math.max(+(localStorage.getItem('agni-best') || 0), Math.floor(G.score));
  localStorage.setItem('agni-best', String(best));
  const bs = localStorage.getItem('agni-best-wave');
  localStorage.setItem('agni-best-wave', String(Math.max(+(bs || 0), G.wave)));

  document.getElementById('dead-stats').innerHTML = `
    <div class="ds"><div class="ds-l">স্কোর</div><div class="ds-v" style="color:#ffd166">${bn(G.score)}</div></div>
    <div class="ds"><div class="ds-l">তরঙ্গ</div><div class="ds-v" style="color:#6ee7ff">${bn(G.wave)}</div></div>
    <div class="ds"><div class="ds-l">হত্যা</div><div class="ds-v">${bn(G.kills)}</div></div>
    <div class="ds"><div class="ds-l">সেরা</div><div class="ds-v" style="color:#a78bfa">${bn(best)}</div></div>`;
  setTimeout(() => {
    document.getElementById('scr-dead').classList.remove('hide');
    document.getElementById('hud').classList.add('hide');
    document.getElementById('dashbtn').classList.add('hide');
  }, 700);
}

function pauseGame() {
  G.state = 'pause';
  document.getElementById('scr-pause').classList.remove('hide');
}
function resumeGame() {
  G.state = 'play';
  document.getElementById('scr-pause').classList.add('hide');
  G.last = performance.now();
}

/* ---------------- upgrades ---------------- */
const UPGRADES = [
  { i: '⚔️', n: 'ধারালো গোলা', d: 'ক্ষতি +৫', f: () => { P.dmg += 5; } },
  { i: '🔥', n: 'দ্রুত আঙুল', d: 'গোলার গতি +২২%', f: () => { P.fireRate = Math.max(.09, P.fireRate * .78); } },
  { i: '🏃', n: 'হালকা পা', d: 'চলার গতি +১৪%', f: () => { P.speed *= 1.14; } },
  { i: '❤️', n: 'শক্ত হৃদয়', d: 'সর্বোচ্চ প্রাণ +২৫, এখনই ভরে যায়', f: () => { P.maxHp += 25; P.hp = Math.min(P.maxHp, P.hp + 25); } },
  { i: '💥', n: 'বহু গোলা', d: 'একসাথে আরও একটা গোলা', f: () => { P.bullets += 1; P.spread += .055; } },
  { i: '🎯', n: 'ভেদ করা', d: 'গোলা এক শত্রু ভেদ করে যায়', f: () => { P.pierce += 1; } },
  { i: '🧲', n: 'চুম্বক', d: 'অভিজ্ঞতা অনেক দূর থেকে টানে', f: () => { P.magnet += 85; } },
  { i: '✨', n: 'সমালোচনা', d: '২০% সম্ভাবনায় দ্বিগুণ ক্ষতি', f: () => { P.crit += .2; } },
  { i: '🩸', n: 'রক্তপান', d: 'শত্রু মারলে ২ প্রাণ ফেরে', f: () => { P.lifesteal += 2; } },
  { i: '🌿', n: 'নিরাময়', d: 'প্রতি সেকেন্ডে ১ প্রাণ ফেরে', f: () => { P.regen += 1; } },
  { i: '⚡', n: 'ড্যাশ', d: 'ড্যাশ দ্রুত হয়, দূরত্ব বাড়ে', f: () => { P.dashT += .04; } },
  { i: '🎇', n: 'বিস্ফোরণ', d: 'গোলা লাগলে ছোট বিস্ফোরণ', f: () => { P.explode = (P.explode || 0) + 1; } },
];

function levelUp() {
  G.state = 'upgrade';
  sfx.level();
  ring(P.x, P.y, '#6ee7ff', 10, 160, .6);
  const pool = UPGRADES.slice();
  const chosen = [];
  for (let i = 0; i < 3 && pool.length; i++) {
    chosen.push(pool.splice(randInt(0, pool.length - 1), 1)[0]);
  }
  const list = document.getElementById('up-list');
  list.innerHTML = '';
  chosen.forEach(u => {
    const b = document.createElement('button');
    b.className = 'up-card';
    b.innerHTML = `<span class="up-ico">${u.i}</span>
      <span class="up-txt"><span class="up-n">${u.n}</span><span class="up-d">${u.d}</span></span>`;
    b.onclick = () => {
      u.f();
      document.getElementById('scr-up').classList.add('hide');
      G.state = 'play';
      G.last = performance.now();
      updateHud();
      tone(880, .1, 'sine', .05);
    };
    list.appendChild(b);
  });
  document.getElementById('scr-up').classList.remove('hide');
}

/* ---------------- update ---------------- */
function update(dt) {
  G.t += dt;

  /* ---- player movement ---- */
  let mx = 0, my = 0;
  if (touch.active) {
    let dx = touch.x - touch.ox, dy = touch.y - touch.oy;
    const m = Math.hypot(dx, dy);
    if (m > 12) { const k = Math.min(1, m / 70); mx = (dx / m) * k; my = (dy / m) * k; }
  } else {
    if (keys['a'] || keys['arrowleft']) mx -= 1;
    if (keys['d'] || keys['arrowright']) mx += 1;
    if (keys['w'] || keys['arrowup']) my -= 1;
    if (keys['s'] || keys['arrowdown']) my += 1;
    const m = Math.hypot(mx, my);
    if (m > 1) { mx /= m; my /= m; }
  }

  if (mx || my) P.dashDir = { x: mx, y: my };

  if (P.dashT > 0) {
    P.dashT -= dt;
    const ds = P.speed * 3.4;
    P.x += P.dashDir.x * ds * dt;
    P.y += P.dashDir.y * ds * dt;
    parts.push({
      x: P.x, y: P.y, vx: rand(-30, 30), vy: rand(-30, 30),
      life: .3, max: .3, r: rand(4, 9), c: '#6ee7ff', glow: true
    });
  } else {
    const accel = 2400;
    P.vx = lerp(P.vx, mx * P.speed, Math.min(1, accel * dt / P.speed));
    P.vy = lerp(P.vy, my * P.speed, Math.min(1, accel * dt / P.speed));
    P.x += P.vx * dt;
    P.y += P.vy * dt;
  }

  P.x = clamp(P.x, -world.w / 2 + P.r, world.w / 2 - P.r);
  P.y = clamp(P.y, -world.h / 2 + P.r, world.h / 2 - P.r);

  if (P.dashCd > 0) P.dashCd -= dt;
  if (P.iFrame > 0) P.iFrame -= dt;
  if (P.regen) P.hp = Math.min(P.maxHp, P.hp + P.regen * dt);

  // trail
  P.trail.unshift({ x: P.x, y: P.y });
  if (P.trail.length > 12) P.trail.pop();

  /* ---- camera ---- */
  const tx = P.x - (W / ZOOM) / 2, ty = P.y - (H / ZOOM) / 2;
  cam.x = lerp(cam.x, tx, Math.min(1, 9 * dt));
  cam.y = lerp(cam.y, ty, Math.min(1, 9 * dt));
  if (cam.shakeT > 0) { cam.shakeT -= dt * 3.2; cam.shake *= .88; } else cam.shake = 0;

  /* ---- auto fire ---- */
  P.fireT -= dt;
  let target = null, bestD = P.range * P.range;
  for (const e of enemies) {
    const d = dist2(P, e);
    if (d < bestD) { bestD = d; target = e; }
  }
  if (P.fireT <= 0 && target) {
    P.fireT = P.fireRate;
    const baseA = Math.atan2(target.y - P.y, target.x - P.x);
    for (let i = 0; i < P.bullets; i++) {
      const off = (i - (P.bullets - 1) / 2) * P.spread;
      const a = baseA + off;
      bullets.push({
        x: P.x + Math.cos(a) * (P.r + 4), y: P.y + Math.sin(a) * (P.r + 4),
        vx: Math.cos(a) * P.bulletSpeed, vy: Math.sin(a) * P.bulletSpeed,
        r: 5, dmg: P.dmg, pierce: P.pierce, hit: [], life: 1.5, px: P.x, py: P.y,
      });
    }
    sfx.shoot();
    P.vx -= Math.cos(baseA) * 16;
    P.vy -= Math.sin(baseA) * 16;
  }

  /* ---- bullets ---- */
  for (let i = bullets.length - 1; i >= 0; i--) {
    const b = bullets[i];
    b.x += b.vx * dt; b.y += b.vy * dt; b.life -= dt;
    if (b.life <= 0) { bullets.splice(i, 1); continue; }
    // snapshot: hurtEnemy() splices from `enemies`, so never iterate the live array
    const targets = enemies.slice();
    for (const e of targets) {
      if (e.hp <= 0) continue;
      if (b.hit.includes(e)) continue;
      if (dist2(b, e) >= (e.r + b.r) * (e.r + b.r)) continue;

      const crit = Math.random() < P.crit;
      const dmg = b.dmg * (crit ? 2 : 1);
      hurtEnemy(e, dmg, crit);

      if (P.explode) {
        const radius = 40 + P.explode * 10;
        ring(e.x, e.y, '#ffb347', 4, radius, .28);
        for (const o of enemies.slice()) {
          if (o.hp > 0 && o !== e && dist2(o, e) < radius * radius) hurtEnemy(o, dmg * .45, false);
        }
      }

      burst(b.x, b.y, 5, '#ffd166', 180, 2.4);
      b.hit.push(e);
      if (b.pierce > 0) { b.pierce--; } else { bullets.splice(i, 1); break; }
    }
  }

  /* ---- enemy bullets ---- */
  for (let i = ebullets.length - 1; i >= 0; i--) {
    const b = ebullets[i];
    b.x += b.vx * dt; b.y += b.vy * dt; b.life -= dt;
    if (b.life <= 0) { ebullets.splice(i, 1); continue; }
    if (dist2(b, P) < (P.r + b.r) * (P.r + b.r)) {
      if (P.iFrame <= 0) hurtPlayer(b.dmg);
      burst(b.x, b.y, 6, '#6ee7ff', 150, 2);
      ebullets.splice(i, 1);
    }
  }

  /* ---- enemies ---- */
  for (let i = enemies.length - 1; i >= 0; i--) {
    const e = enemies[i];
    const dx = P.x - e.x, dy = P.y - e.y;
    const d = Math.hypot(dx, dy) || 1;

    if (e.ranged) {
      const want = e.boss ? 260 : 300;
      const dir = d > want ? 1 : (d < want - 90 ? -1 : 0);
      e.x += (dx / d) * e.spd * dir * dt;
      e.y += (dy / d) * e.spd * dir * dt;
      e.x += Math.cos(G.t * 1.5 + e.wob) * 22 * dt;
      e.y += Math.sin(G.t * 1.5 + e.wob) * 22 * dt;
    } else {
      e.x += (dx / d) * e.spd * dt;
      e.y += (dy / d) * e.spd * dt;
    }

    e.x += e.knock.x * dt; e.y += e.knock.y * dt;
    e.knock.x *= .88; e.knock.y *= .88;
    if (e.hitT > 0) e.hitT -= dt;

    // separation so they don't stack
    for (let j = i - 1; j >= 0; j--) {
      const o = enemies[j];
      const ox = e.x - o.x, oy = e.y - o.y;
      const od = Math.hypot(ox, oy);
      const min = e.r + o.r;
      if (od > 0 && od < min) {
        const push = (min - od) / 2;
        e.x += (ox / od) * push; e.y += (oy / od) * push;
        o.x -= (ox / od) * push; o.y -= (oy / od) * push;
      }
    }

    // touch damage
    if (d < e.r + P.r && P.iFrame <= 0) {
      hurtPlayer(e.dmg);
      const k = 260;
      e.knock.x = (dx / d) * -k; e.knock.y = (dy / d) * -k;
    }

    // ranged fire
    if (e.ranged) {
      e.fireT -= dt;
      if (e.fireT <= 0 && d < 620) {
        e.fireT = e.boss ? 1.15 : rand(1.9, 2.8);
        const n = e.boss ? 7 : 1;
        const base = Math.atan2(dy, dx);
        for (let k = 0; k < n; k++) {
          const a = base + (k - (n - 1) / 2) * (e.boss ? .22 : 0);
          ebullets.push({
            x: e.x, y: e.y, vx: Math.cos(a) * 260, vy: Math.sin(a) * 260,
            r: e.boss ? 6 : 4.5, dmg: e.dmg * .7, life: 3.2,
          });
        }
        tone(300, .1, 'triangle', .022, 200);
      }
    }
  }

  /* ---- orbs ---- */
  for (let i = orbs.length - 1; i >= 0; i--) {
    const o = orbs[i];
    const dx = P.x - o.x, dy = P.y - o.y;
    const d = Math.hypot(dx, dy) || 1;
    if (d < P.magnet) {
      const pull = 520 * (1 - d / P.magnet) + 120;
      o.x += (dx / d) * pull * dt;
      o.y += (dy / d) * pull * dt;
    }
    o.bob += dt * 6;
    if (d < P.r + 10) {
      P.xp += o.v;
      sfx.pick();
      burst(o.x, o.y, 4, '#6ee7ff', 120, 1.8);
      orbs.splice(i, 1);
      if (P.xp >= P.xpNext) {
        P.xp -= P.xpNext;
        P.level++;
        P.xpNext = Math.round(P.xpNext * 1.42 + 3);
        levelUp();
      }
      updateHud();
    }
  }

  /* ---- particles ---- */
  for (let i = parts.length - 1; i >= 0; i--) {
    const p = parts[i];
    p.x += p.vx * dt; p.y += p.vy * dt;
    p.vx *= .95; p.vy *= .95;
    p.life -= dt;
    if (p.life <= 0) parts.splice(i, 1);
  }
  for (let i = rings.length - 1; i >= 0; i--) {
    const r = rings[i];
    r.life -= dt;
    r.r = lerp(r.r, r.r1, dt * 9);
    if (r.life <= 0) rings.splice(i, 1);
  }
  for (let i = texts.length - 1; i >= 0; i--) {
    const t = texts[i];
    t.y += t.vy * dt; t.vy *= .93; t.life -= dt;
    if (t.life <= 0) texts.splice(i, 1);
  }

  /* ---- spawning / waves ---- */
  G.spawnT -= dt;
  if (G.spawnT <= 0) {
    const alive = enemies.length;
    const cap = Math.min(80, 22 + G.wave * 6);
    if (alive < cap) {
      spawnPack(randInt(2, 3 + Math.min(4, Math.floor(G.wave / 2))));
      G.spawnT = Math.max(.28, .95 - G.wave * .045);
    } else {
      G.spawnT = .5;
    }
  }

  G.waveT += dt;
  if (G.waveT > 22) {
    G.waveT = 0;
    G.wave++;
    addText(P.x, P.y - 50, 'তরঙ্গ ' + bn(G.wave), '#ffd166', 20);
    tone(660, .18, 'sine', .05);
    if (G.wave % 4 === 0) {
      const k = 'b' + G.wave;
      if (!G.bossSpawned[k]) {
        G.bossSpawned[k] = true;
        spawnAtEdge('boss');
        sfx.boss();
        shake(14);
        addText(P.x, P.y - 80, 'প্রহরী এসেছে', '#ff3d6e', 22);
      }
    }
    updateHud();
  }

  if (P.hp <= 0 && G.state === 'play') die();
}

function hurtEnemy(e, dmg, crit) {
  e.hp -= dmg;
  e.hitT = .1;
  sfx.hit();
  addText(e.x + rand(-8, 8), e.y - e.r - 4, (crit ? '✸' : '') + bn(dmg), crit ? '#ffd166' : '#fff', crit ? 16 : 12);
  if (e.hp <= 0) {
    G.kills++;
    G.score += e.score;
    burst(e.x, e.y, e.boss ? 40 : 12, e.c, e.boss ? 340 : 200, e.boss ? 5 : 3);
    ring(e.x, e.y, e.c, e.r, e.r * 3.4, .32);
    sfx.kill();
    if (P.lifesteal) P.hp = Math.min(P.maxHp, P.hp + P.lifesteal);
    shake(e.boss ? 18 : 2.5);

    // drops
    const n = e.boss ? 14 : 1;
    for (let i = 0; i < n; i++) {
      orbs.push({
        x: e.x + rand(-16, 16), y: e.y + rand(-16, 16),
        v: e.boss ? 2 : e.xp, bob: rand(0, TAU),
      });
    }
    if (e.splits) {
      for (let i = 0; i < e.splits; i++) {
        const a = rand(0, TAU);
        const ne = {
          type: 'grunt', x: e.x + Math.cos(a) * 22, y: e.y + Math.sin(a) * 22,
          vx: 0, vy: 0, r: 9,
          hp: 9, maxHp: 9, spd: 118, dmg: e.dmg * .55,
          c: '#7cf58a', c2: '#1f6f36', xp: 1, score: 6,
          ranged: false, splits: 0, boss: false, fireT: 2, hitT: 0, wob: 0,
          knock: { x: 0, y: 0 },
        };
        enemies.push(ne);
      }
    }
    const idx = enemies.indexOf(e);
    if (idx >= 0) enemies.splice(idx, 1);
    updateHud();
  }
}

function hurtPlayer(dmg) {
  P.hp -= dmg;
  P.iFrame = .55;
  sfx.hurt();
  shake(9);
  burst(P.x, P.y, 10, '#ff4d4d', 220, 3);
  addText(P.x, P.y - 26, '-' + bn(dmg), '#ff5c5c', 16);
  updateHud();
  if (P.hp <= 0) P.hp = 0;
}

function updateHud() {
  const hpPct = clamp(P.hp / P.maxHp, 0, 1);
  document.getElementById('hpfill').style.width = (hpPct * 100) + '%';
  document.getElementById('hptext').textContent = Math.ceil(P.hp) + ' / ' + P.maxHp;
  document.getElementById('waveN').textContent = bn(G.wave);
  document.getElementById('scoreN').textContent = bn(G.score);
  document.getElementById('xpfill').style.width = clamp(P.xp / P.xpNext, 0, 1) * 100 + '%';
  const db = document.getElementById('dashbtn');
  db.classList.toggle('cool', P.dashCd > 0);
}

/* ---------------- render ---------------- */
function render() {
  const vw = W / ZOOM, vh = H / ZOOM;
  const sx = cam.shake ? rand(-cam.shake, cam.shake) : 0;
  const sy = cam.shake ? rand(-cam.shake, cam.shake) : 0;

  // background
  ctx.fillStyle = '#0d1322';
  ctx.fillRect(0, 0, W, H);

  ctx.save();
  ctx.scale(ZOOM, ZOOM);
  ctx.translate(-cam.x + sx, -cam.y + sy);

  // floor tiles — clearly readable checkerboard
  const ts = 140;
  const tx0 = Math.floor(cam.x / ts) * ts;
  const ty0 = Math.floor(cam.y / ts) * ts;
  for (let x = tx0; x < cam.x + vw + ts; x += ts) {
    for (let y = ty0; y < cam.y + vh + ts; y += ts) {
      const alt = ((Math.round(x / ts) + Math.round(y / ts)) % 2 === 0);
      ctx.fillStyle = alt ? '#1a2438' : '#141c2c';
      ctx.fillRect(x, y, ts, ts);
    }
  }

  // grid lines
  const grid = 70;
  const x0 = Math.floor(cam.x / grid) * grid;
  const y0 = Math.floor(cam.y / grid) * grid;
  ctx.lineWidth = 1;
  ctx.strokeStyle = 'rgba(120,170,255,.22)';
  ctx.beginPath();
  for (let x = x0; x < cam.x + vw + grid; x += grid) { ctx.moveTo(x, cam.y - grid); ctx.lineTo(x, cam.y + vh + grid); }
  for (let y = y0; y < cam.y + vh + grid; y += grid) { ctx.moveTo(cam.x - grid, y); ctx.lineTo(cam.x + vw + grid, y); }
  ctx.stroke();

  // arena border
  ctx.strokeStyle = 'rgba(110,231,255,.45)';
  ctx.lineWidth = 4;
  ctx.strokeRect(-world.w / 2, -world.h / 2, world.w, world.h);

  // rings
  for (const r of rings) {
    const a = r.life / r.max;
    ctx.strokeStyle = r.c;
    ctx.globalAlpha = a * .8;
    ctx.lineWidth = 3 * a;
    ctx.beginPath();
    ctx.arc(r.x, r.y, r.r, 0, TAU);
    ctx.stroke();
    ctx.globalAlpha = 1;
  }

  // orbs
  for (const o of orbs) {
    const pulse = 1 + Math.sin(o.bob) * .18;
    ctx.shadowColor = '#6ee7ff';
    ctx.shadowBlur = 14;
    ctx.fillStyle = '#6ee7ff';
    ctx.beginPath();
    ctx.arc(o.x, o.y, 4.2 * pulse, 0, TAU);
    ctx.fill();
    ctx.shadowBlur = 0;
  }

  // enemy bullets
  for (const b of ebullets) {
    ctx.shadowColor = '#6ee7ff';
    ctx.shadowBlur = 12;
    ctx.fillStyle = '#bff3ff';
    ctx.beginPath();
    ctx.arc(b.x, b.y, b.r, 0, TAU);
    ctx.fill();
    ctx.shadowBlur = 0;
  }

  // enemies
  for (const e of enemies) {
    const flash = e.hitT > 0;
    ctx.save();
    ctx.translate(e.x, e.y);

    // glow
    ctx.shadowColor = e.c;
    ctx.shadowBlur = e.boss ? 38 : 22;

    // body
    ctx.fillStyle = flash ? '#ffffff' : e.c;
    ctx.strokeStyle = 'rgba(0,0,0,.55)';
    ctx.lineWidth = 3;
    ctx.beginPath();
    if (e.boss) {
      const spikes = 8;
      for (let i = 0; i < spikes * 2; i++) {
        const a = (i / (spikes * 2)) * TAU + G.t * .5;
        const rr = i % 2 === 0 ? e.r : e.r * .72;
        const px = Math.cos(a) * rr, py = Math.sin(a) * rr;
        i === 0 ? ctx.moveTo(px, py) : ctx.lineTo(px, py);
      }
      ctx.closePath();
    } else if (e.type === 'swift') {
      const a = Math.atan2(P.y - e.y, P.x - e.x);
      ctx.rotate(a);
      ctx.moveTo(e.r, 0);
      ctx.lineTo(-e.r * .7, e.r * .8);
      ctx.lineTo(-e.r * .7, -e.r * .8);
      ctx.closePath();
    } else if (e.type === 'tank') {
      for (let i = 0; i < 6; i++) {
        const a = (i / 6) * TAU;
        const px = Math.cos(a) * e.r, py = Math.sin(a) * e.r;
        i === 0 ? ctx.moveTo(px, py) : ctx.lineTo(px, py);
      }
      ctx.closePath();
    } else {
      ctx.arc(0, 0, e.r, 0, TAU);
    }
    ctx.fill();
    ctx.stroke();

    // inner core
    ctx.shadowBlur = 0;
    ctx.fillStyle = flash ? '#ffffff' : e.c2;
    ctx.beginPath();
    ctx.arc(0, 0, e.r * .34, 0, TAU);
    ctx.fill();

    // eyes
    const ea = Math.atan2(P.y - e.y, P.x - e.x);
    ctx.fillStyle = '#fff';
    ctx.beginPath();
    ctx.arc(Math.cos(ea - .45) * e.r * .45, Math.sin(ea - .45) * e.r * .45, e.r * .16, 0, TAU);
    ctx.arc(Math.cos(ea + .45) * e.r * .45, Math.sin(ea + .45) * e.r * .45, e.r * .16, 0, TAU);
    ctx.fill();

    ctx.restore();

    // hp bar
    if (e.hp < e.maxHp) {
      const w = e.r * 2.2, h = 3.4;
      const pct = clamp(e.hp / e.maxHp, 0, 1);
      ctx.fillStyle = 'rgba(0,0,0,.6)';
      ctx.fillRect(e.x - w / 2, e.y - e.r - 11, w, h);
      ctx.fillStyle = e.boss ? '#ff3d6e' : '#ff6b6b';
      ctx.fillRect(e.x - w / 2, e.y - e.r - 11, w * pct, h);
    }
  }

  // bullets with streaks
  ctx.lineCap = 'round';
  for (const b of bullets) {
    const tx = b.x - b.vx * .022, ty = b.y - b.vy * .022;
    const g2 = ctx.createLinearGradient(tx, ty, b.x, b.y);
    g2.addColorStop(0, 'rgba(255,209,102,0)');
    g2.addColorStop(1, 'rgba(255,243,196,.95)');
    ctx.strokeStyle = g2;
    ctx.lineWidth = b.r * 1.7;
    ctx.beginPath(); ctx.moveTo(tx, ty); ctx.lineTo(b.x, b.y); ctx.stroke();

    ctx.shadowColor = '#ffd166';
    ctx.shadowBlur = 16;
    ctx.fillStyle = '#fff8dc';
    ctx.beginPath();
    ctx.arc(b.x, b.y, b.r, 0, TAU);
    ctx.fill();
    ctx.shadowBlur = 0;
  }

  // player trail
  for (let i = P.trail.length - 1; i >= 1; i--) {
    const t = P.trail[i];
    const a = (1 - i / P.trail.length) * .22;
    ctx.globalAlpha = a;
    ctx.fillStyle = '#6ee7ff';
    ctx.beginPath();
    ctx.arc(t.x, t.y, P.r * (1 - i / P.trail.length) * .9, 0, TAU);
    ctx.fill();
  }
  ctx.globalAlpha = 1;

  // player
  if (G.state !== 'dead') {
    const fa = Math.atan2(P.dashDir.y, P.dashDir.x);
    ctx.save();
    ctx.translate(P.x, P.y);

    // ground glow
    const g2 = ctx.createRadialGradient(0, 0, 2, 0, 0, P.r * 3.4);
    g2.addColorStop(0, 'rgba(110,231,255,.30)');
    g2.addColorStop(.5, 'rgba(110,231,255,.10)');
    g2.addColorStop(1, 'rgba(110,231,255,0)');
    ctx.fillStyle = g2;
    ctx.beginPath(); ctx.arc(0, 0, P.r * 3.4, 0, TAU); ctx.fill();

    const blink = P.iFrame > 0 && Math.floor(G.t * 22) % 2 === 0;
    const bodyC = blink ? '#ffffff' : (P.dashT > 0 ? '#ffffff' : '#8bfaff');

    ctx.rotate(fa);

    // cloak behind
    ctx.shadowColor = '#2bb8ff';
    ctx.shadowBlur = 26;
    ctx.fillStyle = 'rgba(30,120,190,.85)';
    ctx.beginPath();
    ctx.moveTo(-P.r * .5, 0);
    ctx.quadraticCurveTo(-P.r * 2.0, -P.r * 1.15, -P.r * 1.55, 0);
    ctx.quadraticCurveTo(-P.r * 2.0, P.r * 1.15, -P.r * .5, 0);
    ctx.fill();

    // body: arrowhead
    ctx.fillStyle = bodyC;
    ctx.beginPath();
    ctx.moveTo(P.r * 1.32, 0);
    ctx.lineTo(-P.r * .62, -P.r * .98);
    ctx.lineTo(-P.r * .18, 0);
    ctx.lineTo(-P.r * .62, P.r * .98);
    ctx.closePath();
    ctx.fill();

    // outline
    ctx.shadowBlur = 0;
    ctx.strokeStyle = 'rgba(4,20,32,.85)';
    ctx.lineWidth = 2.4;
    ctx.stroke();

    // eye/core
    ctx.fillStyle = '#062a3d';
    ctx.beginPath();
    ctx.arc(P.r * .30, 0, P.r * .26, 0, TAU);
    ctx.fill();
    ctx.fillStyle = '#eafcff';
    ctx.beginPath();
    ctx.arc(P.r * .34, 0, P.r * .12, 0, TAU);
    ctx.fill();

    ctx.restore();

    // dash cooldown ring
    if (P.dashCd > 0) {
      ctx.save();
      ctx.translate(P.x, P.y);
      ctx.strokeStyle = 'rgba(110,231,255,.55)';
      ctx.lineWidth = 2.5;
      ctx.beginPath();
      ctx.arc(0, 0, P.r + 9, -Math.PI / 2, -Math.PI / 2 + TAU * (1 - P.dashCd / .85));
      ctx.stroke();
      ctx.restore();
    }
  }

  // particles
  for (const p of parts) {
    const a = p.life / p.max;
    ctx.globalAlpha = a;
    if (p.glow) { ctx.shadowColor = p.c; ctx.shadowBlur = 10; }
    ctx.fillStyle = p.c;
    ctx.beginPath();
    ctx.arc(p.x, p.y, p.r * a, 0, TAU);
    ctx.fill();
    ctx.shadowBlur = 0;
  }
  ctx.globalAlpha = 1;

  // floating text
  for (const t of texts) {
    const a = clamp(t.life / t.max, 0, 1);
    ctx.globalAlpha = a;
    ctx.font = `800 ${t.size}px "Hind Siliguri", sans-serif`;
    ctx.textAlign = 'center';
    ctx.fillStyle = '#000';
    ctx.fillText(t.txt, t.x + 1, t.y + 1);
    ctx.fillStyle = t.c;
    ctx.fillText(t.txt, t.x, t.y);
  }
  ctx.globalAlpha = 1;

  ctx.restore();

  // soft edge darkening only — keep the play area bright
  const vg = ctx.createRadialGradient(W / 2, H / 2, Math.min(W, H) * .62, W / 2, H / 2, Math.max(W, H) * 1.0);
  vg.addColorStop(0, 'rgba(0,0,0,0)');
  vg.addColorStop(1, 'rgba(0,0,0,.34)');
  ctx.fillStyle = vg;
  ctx.fillRect(0, 0, W, H);

  // low-hp red pulse
  if (P.hp / P.maxHp < .3 && G.state === 'play') {
    const a = (1 - P.hp / P.maxHp) * .3 * (0.6 + Math.sin(G.t * 7) * .4);
    ctx.fillStyle = `rgba(255,40,40,${a})`;
    ctx.fillRect(0, 0, W, H);
  }

  // off-screen enemy arrows
  if (G.state === 'play') {
    const cx0 = W / 2, cy0 = H / 2;
    const pad = 34;
    for (const e of enemies) {
      const sxp = (e.x - cam.x) * ZOOM, syp = (e.y - cam.y) * ZOOM;
      if (sxp > -20 && sxp < W + 20 && syp > -20 && syp < H + 20) continue;
      const a = Math.atan2(syp - cy0, sxp - cx0);
      const rx = (W / 2 - pad), ry = (H / 2 - pad);
      const k = Math.min(rx / Math.abs(Math.cos(a) || 1e-6), ry / Math.abs(Math.sin(a) || 1e-6));
      const px2 = cx0 + Math.cos(a) * k, py2 = cy0 + Math.sin(a) * k;
      ctx.save();
      ctx.translate(px2, py2);
      ctx.rotate(a);
      ctx.globalAlpha = e.boss ? .95 : .5;
      ctx.fillStyle = e.boss ? '#ff2d6e' : e.c;
      ctx.shadowColor = e.c;
      ctx.shadowBlur = 10;
      const sz = e.boss ? 11 : 7;
      ctx.beginPath();
      ctx.moveTo(sz, 0);
      ctx.lineTo(-sz * .8, sz * .75);
      ctx.lineTo(-sz * .8, -sz * .75);
      ctx.closePath();
      ctx.fill();
      ctx.restore();
    }
    ctx.globalAlpha = 1;
  }

  // touch joystick
  if (touch.active) {
    ctx.globalAlpha = .35;
    ctx.strokeStyle = '#6ee7ff';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(touch.ox, touch.oy, 46, 0, TAU);
    ctx.stroke();
    const dx = touch.x - touch.ox, dy = touch.y - touch.oy;
    const m = Math.hypot(dx, dy), k = Math.min(m, 46) / (m || 1);
    ctx.fillStyle = '#6ee7ff';
    ctx.beginPath();
    ctx.arc(touch.ox + dx * k, touch.oy + dy * k, 20, 0, TAU);
    ctx.fill();
    ctx.globalAlpha = 1;
  }
}

/* ---------------- loop ---------------- */
function frame(now) {
  requestAnimationFrame(frame);
  const dtRaw = Math.min(0.05, (now - G.last) / 1000 || 0);
  G.last = now;

  if (G.state === 'play') {
    update(dtRaw);
  } else if (G.state === 'dead') {
    // keep particles alive on the death screen
    for (let i = parts.length - 1; i >= 0; i--) {
      const p = parts[i];
      p.x += p.vx * dtRaw; p.y += p.vy * dtRaw;
      p.vx *= .95; p.vy *= .95; p.life -= dtRaw;
      if (p.life <= 0) parts.splice(i, 1);
    }
    for (let i = rings.length - 1; i >= 0; i--) {
      const r = rings[i]; r.life -= dtRaw; r.r = lerp(r.r, r.r1, dtRaw * 9);
      if (r.life <= 0) rings.splice(i, 1);
    }
    cam.shake *= .9;
  }

  if (G.state === 'title') {
    // idle attract animation
    G.t += dtRaw;
    cam.x = Math.sin(G.t * .18) * 120 - W / 2;
    cam.y = Math.cos(G.t * .14) * 90 - H / 2;
  }

  render();
  if (G.state === 'play') updateHud();
}

/* ---------------- boot ---------------- */
(function boot() {
  const best = +(localStorage.getItem('agni-best') || 0);
  const bw = +(localStorage.getItem('agni-best-wave') || 0);
  if (best || bw) {
    document.getElementById('bestline').textContent =
      `সেরা স্কোর ${bn(best)}` + (bw ? ` · তরঙ্গ ${bn(bw)}` : '');
  }
  P.x = 0; P.y = 0;
  cam.x = -W / 2; cam.y = -H / 2;

  document.getElementById('btn-play').onclick = startGame;
  document.getElementById('btn-again').onclick = startGame;
  document.getElementById('btn-resume').onclick = resumeGame;
  document.getElementById('btn-quit').onclick = () => {
    document.getElementById('scr-pause').classList.add('hide');
    startGame();
  };

  G.last = performance.now();
  requestAnimationFrame(frame);
})();

// expose for automated testing
window.__G = G; window.__P = P;
window.__ents = () => ({ enemies, bullets, ebullets, orbs, parts });
window.__start = startGame;
