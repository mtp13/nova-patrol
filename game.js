"use strict";

// Nova Patrol: a wave-based space shooter. Everything is drawn on a 480x720
// canvas in game units and scaled to fit the screen.
(() => {
  const W = 480;
  const H = 720;
  const TAU = Math.PI * 2;

  const canvas = document.getElementById("game");
  const ctx = canvas.getContext("2d");
  const overlay = document.getElementById("overlay");
  const overlayTitle = document.getElementById("overlay-title");
  const overlayBody = document.getElementById("overlay-body");
  const overlayBest = document.getElementById("overlay-best");
  const startBtn = document.getElementById("start-btn");
  const pauseBtn = document.getElementById("pause-btn");
  const muteBtn = document.getElementById("mute-btn");
  const bombBtn = document.getElementById("bomb-btn");

  // ---------- helpers ----------
  const rand = (a, b) => a + Math.random() * (b - a);
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
  const dist2 = (a, b) => (a.x - b.x) ** 2 + (a.y - b.y) ** 2;
  const hits = (a, b) => dist2(a, b) < (a.r + b.r) ** 2;

  function pickWeighted(table) {
    let total = 0;
    for (const [, w] of table) total += w;
    let roll = Math.random() * total;
    for (const [item, w] of table) {
      roll -= w;
      if (roll <= 0) return item;
    }
    return table[table.length - 1][0];
  }

  // localStorage can throw (private windows, blocked storage).
  const store = {
    get(key, fallback) {
      try {
        const v = localStorage.getItem(key);
        return v === null ? fallback : v;
      } catch {
        return fallback;
      }
    },
    set(key, value) {
      try {
        localStorage.setItem(key, String(value));
      } catch {
        // ignore
      }
    },
  };

  // ---------- sound (tiny synth, no audio files) ----------
  const SOUNDS = {
    shoot: { wave: "square", f0: 900, f1: 500, d: 0.05, v: 0.015 },
    hit: { wave: "square", f0: 320, f1: 160, d: 0.05, v: 0.03 },
    boom: { wave: "sawtooth", f0: 220, f1: 40, d: 0.35, v: 0.07 },
    big: { wave: "sawtooth", f0: 160, f1: 25, d: 1.2, v: 0.15 },
    power: { wave: "triangle", f0: 400, f1: 1300, d: 0.25, v: 0.08 },
    hurt: { wave: "sawtooth", f0: 420, f1: 50, d: 0.6, v: 0.12 },
    bomb: { wave: "sawtooth", f0: 140, f1: 30, d: 0.9, v: 0.15 },
    wave: { wave: "triangle", f0: 500, f1: 1000, d: 0.4, v: 0.07 },
    dive: { wave: "sine", f0: 1200, f1: 300, d: 0.4, v: 0.04 },
  };
  let audio = null;
  let muted = store.get("nova-patrol-muted", "0") === "1";

  function sound(name) {
    if (muted) return;
    try {
      audio ??= new (window.AudioContext || window.webkitAudioContext)();
      if (audio.state === "suspended") audio.resume();
      const s = SOUNDS[name];
      const t = audio.currentTime;
      const osc = audio.createOscillator();
      const gain = audio.createGain();
      osc.type = s.wave;
      osc.frequency.setValueAtTime(s.f0, t);
      osc.frequency.exponentialRampToValueAtTime(s.f1, t + s.d);
      gain.gain.setValueAtTime(s.v, t);
      gain.gain.exponentialRampToValueAtTime(0.0001, t + s.d);
      osc.connect(gain).connect(audio.destination);
      osc.start(t);
      osc.stop(t + s.d);
    } catch {
      // no audio available
    }
  }

  function updateMuteButton() {
    muteBtn.textContent = muted ? "🔇" : "🔊";
    muteBtn.setAttribute("aria-label", muted ? "Unmute sound" : "Mute sound");
  }

  // ---------- game state ----------
  let state = "menu"; // menu | playing | paused | over
  let best = Number(store.get("nova-patrol-best", "0")) || 0;
  let bestWave = Number(store.get("nova-patrol-best-wave", "0")) || 0;
  let player;
  let bullets = [];
  let enemyBullets = [];
  let enemies = [];
  let powerups = [];
  let particles = [];
  let floaters = [];
  let spawnQueue;
  let spawnTimer;
  let wave;
  let waveDone;
  let nextWaveTimer;
  let banner = null;
  let score;
  let combo;
  let comboTimer;
  let shake;
  let flash;
  let time = 0;

  const stars = Array.from({ length: 90 }, () => ({
    x: rand(0, W),
    y: rand(0, H),
    speed: rand(20, 140),
    size: rand(0.5, 2),
  }));

  function resetGame() {
    player = {
      x: W / 2,
      y: H - 90,
      r: 12,
      lives: 3,
      inv: 0,
      fireCd: 0,
      weapon: 1,
      rapid: 0,
      shield: 0,
      bombs: 1,
    };
    bullets = [];
    enemyBullets = [];
    enemies = [];
    powerups = [];
    particles = [];
    floaters = [];
    score = 0;
    combo = 1;
    comboTimer = 0;
    shake = 0;
    flash = 0;
    startWave(1);
  }

  function showBanner(text, sub = "") {
    banner = { text, sub, t: 2.2 };
  }

  function startWave(n) {
    wave = n;
    waveDone = false;
    nextWaveTimer = 0;
    spawnQueue = [];
    spawnTimer = 2;
    if (n % 5 === 0) {
      showBanner(`WAVE ${n}`, "BOSS INCOMING!");
      spawnQueue.push({ type: "boss", gap: 0 });
    } else {
      showBanner(`WAVE ${n}`, n === 1 ? "Get ready!" : "");
      const table = [["scout", 10]];
      if (n >= 2) table.push(["zig", 6], ["squad", 2]);
      if (n >= 3) table.push(["rock", 4]);
      if (n >= 4) table.push(["gunner", 3 + n * 0.3]);
      if (n >= 6) table.push(["diver", 4 + n * 0.3]);
      const count = 7 + n * 2;
      const gap = Math.max(0.28, 1.1 - n * 0.07);
      for (let i = 0; i < count; i++) {
        spawnQueue.push({ type: pickWeighted(table), gap });
      }
    }
    sound("wave");
  }

  // ---------- enemies ----------
  function rockShape(points) {
    return Array.from({ length: points }, (_, i) => ({
      a: (i / points) * TAU,
      m: rand(0.75, 1.1),
    }));
  }

  function makeEnemy(type, x = rand(30, W - 30)) {
    const s = 1 + (wave - 1) * 0.045; // speed scale
    switch (type) {
      case "scout":
        return {
          type,
          x,
          y: -20,
          r: 12,
          hp: 1,
          vy: rand(110, 150) * s,
          pts: 100,
          color: "#5eead4",
        };
      case "zig":
        return {
          type,
          x,
          y: -20,
          r: 13,
          hp: 2,
          baseX: clamp(x, 100, W - 100),
          phase: rand(0, TAU),
          amp: rand(40, 90),
          vy: 85 * s,
          pts: 150,
          color: "#f472b6",
        };
      case "gunner":
        return {
          type,
          x,
          y: -24,
          r: 17,
          hp: 5,
          targetY: rand(70, 250),
          vx: Math.random() < 0.5 ? -70 : 70,
          fireCd: rand(1, 2),
          life: 0,
          pts: 300,
          color: "#facc15",
        };
      case "rock":
        return {
          type,
          x,
          y: -30,
          r: 26,
          hp: 6,
          vx: rand(-40, 40),
          vy: rand(55, 85) * s,
          rot: 0,
          spin: rand(-2, 2),
          shape: rockShape(10),
          big: true,
          pts: 200,
          color: "#a8a29e",
        };
      case "diver":
        return {
          type,
          x,
          y: -20,
          r: 13,
          hp: 2,
          mode: "enter",
          targetY: rand(70, 200),
          wait: rand(0.6, 1.4),
          vx: 0,
          vy: 0,
          pts: 250,
          color: "#fb923c",
        };
      case "boss": {
        const level = wave / 5;
        const hp = 70 + wave * 14;
        return {
          type,
          x: W / 2,
          y: -90,
          r: 46,
          hp,
          maxHp: hp,
          level,
          mode: "enter",
          t: 0,
          fireCd: 2,
          pattern: 0,
          pts: 5000 * level,
          color: ["#a78bfa", "#f87171", "#34d399", "#60a5fa"][(level - 1) % 4],
        };
      }
    }
    return null;
  }

  function spawn(type) {
    if (type === "squad") {
      const cx = rand(110, W - 110);
      for (let i = -2; i <= 2; i++) {
        const e = makeEnemy("scout", cx + i * 38);
        e.y = -20 - Math.abs(i) * 30;
        e.vy = 130 * (1 + (wave - 1) * 0.045);
        enemies.push(e);
      }
    } else {
      enemies.push(makeEnemy(type));
    }
  }

  function fireAt(e, speed, spread = 0) {
    const a = Math.atan2(player.y - e.y, player.x - e.x) + spread;
    enemyBullets.push({
      x: e.x,
      y: e.y,
      vx: Math.cos(a) * speed,
      vy: Math.sin(a) * speed,
      r: 5,
      color: "#fde047",
    });
  }

  function fireAngle(e, angle, speed, color = "#f9a8d4") {
    enemyBullets.push({
      x: e.x,
      y: e.y + 20,
      vx: Math.cos(angle) * speed,
      vy: Math.sin(angle) * speed,
      r: 6,
      color,
    });
  }

  const bulletSpeed = () => 170 + wave * 7;

  function updateEnemy(e, dt) {
    const s = 1 + (wave - 1) * 0.045;
    switch (e.type) {
      case "scout":
        e.y += e.vy * dt;
        break;
      case "zig":
        e.y += e.vy * dt;
        e.phase += dt * 3;
        e.x = e.baseX + Math.sin(e.phase) * e.amp;
        break;
      case "gunner":
        e.life += dt;
        if (e.life > 14) {
          e.y += 140 * dt; // leave the screen
        } else if (e.y < e.targetY) {
          e.y += 90 * dt;
        } else {
          e.x += e.vx * dt;
          if (e.x < 30 || e.x > W - 30) {
            e.vx = -e.vx;
            e.x = clamp(e.x, 30, W - 30);
          }
          e.fireCd -= dt;
          if (e.fireCd <= 0) {
            fireAt(e, bulletSpeed());
            if (wave >= 9) {
              fireAt(e, bulletSpeed(), 0.25);
              fireAt(e, bulletSpeed(), -0.25);
            }
            e.fireCd = Math.max(0.9, 2.3 - wave * 0.08);
          }
        }
        break;
      case "rock":
        e.x += e.vx * dt;
        e.y += e.vy * dt;
        e.rot += e.spin * dt;
        if (e.x < e.r || e.x > W - e.r) {
          e.vx = -e.vx;
          e.x = clamp(e.x, e.r, W - e.r);
        }
        break;
      case "diver":
        if (e.mode === "enter") {
          e.y += 140 * dt;
          if (e.y >= e.targetY) e.mode = "wait";
        } else if (e.mode === "wait") {
          e.wait -= dt;
          e.x += Math.sin(time * 10) * 30 * dt; // wobble before diving
          if (e.wait <= 0) {
            const a = Math.atan2(player.y - e.y, player.x - e.x);
            const sp = 330 * s;
            e.vx = Math.cos(a) * sp;
            e.vy = Math.sin(a) * sp;
            e.mode = "dive";
            sound("dive");
          }
        } else {
          e.x += e.vx * dt;
          e.y += e.vy * dt;
        }
        break;
      case "boss":
        updateBoss(e, dt);
        break;
    }
  }

  function updateBoss(e, dt) {
    e.t += dt;
    if (e.mode === "enter") {
      e.y += 60 * dt;
      if (e.y >= 120) {
        e.mode = "fight";
        e.t = 0;
      }
      return;
    }
    const angry = e.hp < e.maxHp / 2;
    e.x = W / 2 + Math.sin(e.t * (angry ? 1.1 : 0.7)) * (W / 2 - 70);
    e.y = 120 + Math.sin(e.t * 1.7) * 20;
    e.fireCd -= dt;
    if (e.fireCd > 0) return;

    const sp = bulletSpeed();
    const pattern = e.pattern % (e.level >= 2 ? 4 : 3);
    if (pattern === 0) {
      // fan of bullets straight down
      const n = 5 + e.level * 2;
      for (let i = 0; i < n; i++) {
        fireAngle(e, Math.PI / 2 + (i - (n - 1) / 2) * 0.18, sp);
      }
      e.fireCd = angry ? 0.9 : 1.3;
    } else if (pattern === 1) {
      // aimed burst
      for (let i = -1; i <= 1; i++) fireAt(e, sp * 1.3, i * 0.12);
      e.fireCd = angry ? 0.45 : 0.7;
    } else if (pattern === 2) {
      // ring
      const n = 14 + e.level * 2;
      const off = Math.random() * TAU;
      for (let i = 0; i < n; i++)
        fireAngle(e, off + (i / n) * TAU, sp * 0.8, "#c4b5fd");
      e.fireCd = angry ? 1.1 : 1.5;
    } else {
      // call in helpers
      enemies.push(makeEnemy("scout", e.x - 60), makeEnemy("scout", e.x + 60));
      e.fireCd = 1.2;
    }
    e.burst = (e.burst ?? 0) + 1;
    if (e.burst >= (pattern === 1 ? 4 : 2)) {
      e.burst = 0;
      e.pattern++;
    }
  }

  function damageEnemy(e, dmg) {
    e.hp -= dmg;
    e.flash = 0.08;
    if (e.hp <= 0 && !e.dead) killEnemy(e);
    else if (e.type === "boss") sound("hit");
  }

  function killEnemy(e) {
    e.dead = true;
    const pts = e.pts * combo;
    score += pts;
    floaters.push({
      x: e.x,
      y: e.y,
      text: combo > 1 ? `${pts} x${combo}` : `${pts}`,
      t: 0.9,
    });
    combo = Math.min(8, combo + 1);
    comboTimer = 1.6;

    if (e.type === "boss") {
      explode(e.x, e.y, e.color, 120, 380);
      explode(e.x, e.y, "#ffffff", 60, 250);
      shake = 0.8;
      flash = 0.4;
      sound("big");
      dropPowerup(e.x - 30, e.y, "L");
      dropPowerup(e.x + 30, e.y, "P");
      enemyBullets = [];
      return;
    }
    explode(e.x, e.y, e.color, e.r * 1.6, 180);
    sound("boom");

    if (e.type === "rock" && e.big) {
      for (const dir of [-1, 1]) {
        enemies.push({
          ...makeEnemy("rock", e.x),
          y: e.y,
          r: 14,
          hp: 2,
          vx: dir * rand(60, 110),
          vy: e.vy * 1.2,
          shape: rockShape(8),
          big: false,
          pts: 75,
        });
      }
    }
    const chance = { gunner: 0.35, diver: 0.15, rock: 0.12 }[e.type] ?? 0.07;
    if (Math.random() < chance) dropPowerup(e.x, e.y);
  }

  // ---------- power-ups ----------
  const POWERUPS = {
    P: { color: "#60a5fa", label: "P" },
    R: { color: "#fb923c", label: "R" },
    S: { color: "#34d399", label: "S" },
    B: { color: "#f87171", label: "B" },
    L: { color: "#f472b6", label: "♥" },
  };

  function dropPowerup(x, y, kind) {
    const table = [
      ["P", 35],
      ["R", 25],
      ["S", 20],
      ["B", 15],
    ];
    if (player.lives < 5) table.push(["L", 5]);
    powerups.push({
      x,
      y,
      r: 12,
      vy: 85,
      kind: kind ?? pickWeighted(table),
      t: 0,
    });
  }

  function collect(p) {
    sound("power");
    let text = "";
    switch (p.kind) {
      case "P":
        if (player.weapon < 4) {
          player.weapon++;
          text = "MORE GUNS!";
        } else {
          score += 500;
          text = "+500";
        }
        break;
      case "R":
        player.rapid = 8;
        text = "RAPID FIRE!";
        break;
      case "S":
        player.shield = 12;
        text = "SHIELD!";
        break;
      case "B":
        player.bombs = Math.min(3, player.bombs + 1);
        text = "+1 BOMB";
        break;
      case "L":
        player.lives = Math.min(5, player.lives + 1);
        text = "+1 LIFE";
        break;
    }
    floaters.push({
      x: p.x,
      y: p.y,
      text,
      t: 1.1,
      color: POWERUPS[p.kind].color,
    });
  }

  // ---------- player ----------
  function fire() {
    const { x, y } = player;
    const shots = {
      1: [[0, 0]],
      2: [
        [-7, 0],
        [7, 0],
      ],
      3: [
        [0, 0],
        [-10, -0.14],
        [10, 0.14],
      ],
      4: [
        [-6, 0],
        [6, 0],
        [-12, -0.2],
        [12, 0.2],
      ],
    }[player.weapon];
    for (const [dx, angle] of shots) {
      bullets.push({
        x: x + dx,
        y: y - 16,
        vx: Math.sin(angle) * 650,
        vy: -Math.cos(angle) * 650,
        r: 4,
      });
    }
    sound("shoot");
  }

  function hurtPlayer() {
    if (player.inv > 0) return;
    if (player.shield > 0) {
      player.shield = 0;
      player.inv = 1;
      explode(player.x, player.y, "#34d399", 20, 150);
      sound("hit");
      return;
    }
    player.lives--;
    player.weapon = Math.max(1, player.weapon - 1);
    player.rapid = 0;
    player.inv = 2.2;
    combo = 1;
    shake = 0.5;
    explode(player.x, player.y, "#7dd3fc", 40, 220);
    sound("hurt");
    if (player.lives <= 0) gameOver();
  }

  function useBomb() {
    if (state !== "playing" || player.bombs <= 0) return;
    player.bombs--;
    enemyBullets = [];
    flash = 0.5;
    shake = 0.4;
    sound("bomb");
    for (const e of [...enemies]) damageEnemy(e, e.type === "boss" ? 20 : 12);
  }

  // ---------- particles ----------
  function explode(x, y, color, count, speed) {
    for (let i = 0; i < count; i++) {
      const a = rand(0, TAU);
      const sp = rand(0.2, 1) * speed;
      const life = rand(0.3, 0.9);
      particles.push({
        x,
        y,
        vx: Math.cos(a) * sp,
        vy: Math.sin(a) * sp,
        life,
        max: life,
        color,
        size: rand(1.5, 3.5),
      });
    }
  }

  // ---------- input ----------
  const keys = new Set();
  const pointer = { active: false, id: null, sx: 0, sy: 0, px: 0, py: 0 };

  function toGame(ev) {
    const rect = canvas.getBoundingClientRect();
    return {
      x: ((ev.clientX - rect.left) / rect.width) * W,
      y: ((ev.clientY - rect.top) / rect.height) * H,
    };
  }

  canvas.addEventListener("pointerdown", (ev) => {
    if (state !== "playing") return;
    const p = toGame(ev);
    Object.assign(pointer, {
      active: true,
      id: ev.pointerId,
      sx: p.x,
      sy: p.y,
      px: player.x,
      py: player.y,
    });
    canvas.setPointerCapture(ev.pointerId);
    ev.preventDefault();
  });
  canvas.addEventListener("pointermove", (ev) => {
    if (!pointer.active || ev.pointerId !== pointer.id || state !== "playing")
      return;
    const p = toGame(ev);
    player.x = pointer.px + (p.x - pointer.sx) * 1.3;
    player.y = pointer.py + (p.y - pointer.sy) * 1.3;
    ev.preventDefault();
  });
  const endPointer = (ev) => {
    if (ev.pointerId === pointer.id) pointer.active = false;
  };
  canvas.addEventListener("pointerup", endPointer);
  canvas.addEventListener("pointercancel", endPointer);

  const GAME_KEYS = new Set([
    "ArrowUp",
    "ArrowDown",
    "ArrowLeft",
    "ArrowRight",
    " ",
  ]);
  window.addEventListener("keydown", (ev) => {
    if (GAME_KEYS.has(ev.key) && state === "playing") ev.preventDefault();
    const k = ev.key.toLowerCase();
    keys.add(k);
    if (ev.repeat) return;
    if (k === "p" || k === "escape") togglePause();
    else if ((k === "b" || k === "x") && state === "playing") useBomb();
    else if (k === "enter" && (state === "menu" || state === "over")) {
      ev.preventDefault(); // or the focused Start button would click too
      startGame();
    }
  });
  window.addEventListener("keyup", (ev) => keys.delete(ev.key.toLowerCase()));
  window.addEventListener("blur", () => {
    keys.clear();
    if (state === "playing") togglePause();
  });
  document.addEventListener("visibilitychange", () => {
    if (document.hidden && state === "playing") togglePause();
  });

  startBtn.addEventListener("click", () => {
    if (state === "paused") togglePause();
    else startGame();
  });
  pauseBtn.addEventListener("click", togglePause);
  bombBtn.addEventListener("click", useBomb);
  muteBtn.addEventListener("click", () => {
    muted = !muted;
    store.set("nova-patrol-muted", muted ? "1" : "0");
    updateMuteButton();
  });

  // ---------- screens ----------
  function setOverlay(title, html, button) {
    overlayTitle.textContent = title;
    if (html !== null) overlayBody.innerHTML = html;
    overlayBest.textContent =
      best > 0 ? `Best: ${best.toLocaleString()} (wave ${bestWave})` : "";
    startBtn.textContent = button;
    overlay.hidden = false;
    startBtn.focus({ preventScroll: true });
  }

  function startGame() {
    resetGame();
    state = "playing";
    overlay.hidden = true;
    pauseBtn.textContent = "⏸";
    canvas.focus?.();
  }

  function togglePause() {
    if (state === "playing") {
      state = "paused";
      keys.clear();
      pointer.active = false;
      pauseBtn.textContent = "▶";
      pauseBtn.setAttribute("aria-label", "Resume");
      setOverlay("Paused", "<p>Take a breather.</p>", "Resume");
    } else if (state === "paused") {
      state = "playing";
      overlay.hidden = true;
      pauseBtn.textContent = "⏸";
      pauseBtn.setAttribute("aria-label", "Pause");
    }
  }

  function gameOver() {
    state = "over";
    const newBest = score > best;
    if (newBest) {
      best = score;
      bestWave = wave;
      store.set("nova-patrol-best", best);
      store.set("nova-patrol-best-wave", bestWave);
    }
    setTimeout(() => {
      if (state !== "over") return; // already restarted
      setOverlay(
        "Game Over",
        `<p class="big">${score.toLocaleString()}</p>
         <p>You reached wave ${wave}.</p>
         ${newBest ? '<p class="tip">🏆 New high score!</p>' : `<p>${encouragement()}</p>`}`,
        "Play Again",
      );
    }, 900);
  }

  function encouragement() {
    if (wave < 5) return "Tip: keep moving and grab the P power-ups.";
    if (wave < 10) return "Tip: save a bomb for the boss's ring attack.";
    return "Amazing flying, pilot!";
  }

  // ---------- update ----------
  function update(dt) {
    time += dt;
    for (const s of stars) {
      s.y += s.speed * dt * (state === "playing" ? 1 : 0.3);
      if (s.y > H) {
        s.y = 0;
        s.x = rand(0, W);
      }
    }
    if (banner) {
      banner.t -= dt;
      if (banner.t <= 0) banner = null;
    }
    for (const p of particles) {
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      p.vx *= 0.97;
      p.vy *= 0.97;
      p.life -= dt;
    }
    particles = particles.filter((p) => p.life > 0);
    for (const f of floaters) {
      f.y -= 40 * dt;
      f.t -= dt;
    }
    floaters = floaters.filter((f) => f.t > 0);
    shake = Math.max(0, shake - dt);
    flash = Math.max(0, flash - dt);

    if (state !== "playing") return;

    // player movement
    let mx = 0;
    let my = 0;
    if (keys.has("arrowleft") || keys.has("a")) mx -= 1;
    if (keys.has("arrowright") || keys.has("d")) mx += 1;
    if (keys.has("arrowup") || keys.has("w")) my -= 1;
    if (keys.has("arrowdown") || keys.has("s")) my += 1;
    if (mx || my) {
      const len = Math.hypot(mx, my);
      player.x += (mx / len) * 330 * dt;
      player.y += (my / len) * 330 * dt;
    }
    player.x = clamp(player.x, player.r, W - player.r);
    player.y = clamp(player.y, H * 0.3, H - player.r - 6);
    player.inv = Math.max(0, player.inv - dt);
    player.rapid = Math.max(0, player.rapid - dt);
    player.shield = Math.max(0, player.shield - dt);

    player.fireCd -= dt;
    if (player.fireCd <= 0) {
      fire();
      player.fireCd = player.rapid > 0 ? 0.09 : 0.2;
    }

    comboTimer -= dt;
    if (comboTimer <= 0) combo = 1;

    // spawning
    if (spawnQueue.length) {
      spawnTimer -= dt;
      if (spawnTimer <= 0) {
        const next = spawnQueue.shift();
        spawn(next.type);
        spawnTimer = next.gap * rand(0.6, 1.4);
      }
    } else if (!enemies.length && !waveDone) {
      waveDone = true;
      const bonus = wave * 250;
      score += bonus;
      floaters.push({
        x: W / 2,
        y: H / 2,
        text: `WAVE CLEAR +${bonus}`,
        t: 1.6,
        color: "#7dd3fc",
      });
      nextWaveTimer = 1.5;
    } else if (waveDone) {
      nextWaveTimer -= dt;
      if (nextWaveTimer <= 0) startWave(wave + 1);
    }

    // bullets
    for (const b of bullets) {
      b.x += b.vx * dt;
      b.y += b.vy * dt;
    }
    for (const b of enemyBullets) {
      b.x += b.vx * dt;
      b.y += b.vy * dt;
    }

    for (const e of enemies) {
      updateEnemy(e, dt);
      e.flash = Math.max(0, (e.flash ?? 0) - dt);
    }

    // player bullets vs enemies
    for (const b of bullets) {
      for (const e of enemies) {
        if (!e.dead && !b.used && hits(b, e)) {
          b.used = true;
          damageEnemy(e, 1);
          particles.push({
            x: b.x,
            y: b.y,
            vx: rand(-60, 60),
            vy: rand(20, 80),
            life: 0.2,
            max: 0.2,
            color: "#ffffff",
            size: 2,
          });
        }
      }
    }

    // enemies and bullets vs player
    const hitbox = { x: player.x, y: player.y, r: player.r * 0.6 };
    for (const e of enemies) {
      if (!e.dead && hits(hitbox, e)) {
        hurtPlayer();
        if (e.type !== "boss") damageEnemy(e, 3);
      }
    }
    for (const b of enemyBullets) {
      if (hits(hitbox, b)) {
        b.used = true;
        hurtPlayer();
      }
    }

    // power-ups
    for (const p of powerups) {
      p.y += p.vy * dt;
      p.t += dt;
      p.x += Math.sin(p.t * 3) * 25 * dt;
      if (hits({ x: player.x, y: player.y, r: player.r + 6 }, p)) {
        p.used = true;
        collect(p);
      }
    }

    const onScreen = (o, m = 40) =>
      o.x > -m && o.x < W + m && o.y > -120 && o.y < H + m;
    bullets = bullets.filter((b) => !b.used && onScreen(b, 10));
    enemyBullets = enemyBullets.filter((b) => !b.used && onScreen(b, 10));
    enemies = enemies.filter((e) => !e.dead && onScreen(e, 60));
    powerups = powerups.filter((p) => !p.used && p.y < H + 20);
  }

  // ---------- drawing ----------
  function polygon(points) {
    ctx.beginPath();
    points.forEach(([x, y], i) => (i ? ctx.lineTo(x, y) : ctx.moveTo(x, y)));
    ctx.closePath();
  }

  function glow(color, blur = 12) {
    ctx.shadowColor = color;
    ctx.shadowBlur = blur;
  }

  function drawPlayer() {
    if (state === "over") return;
    if (player.inv > 0 && Math.floor(time * 15) % 2 === 0) return;
    const { x, y } = player;
    ctx.save();
    ctx.translate(x, y);
    // engine flame
    const flame = 10 + Math.sin(time * 40) * 4;
    ctx.fillStyle = "#fb923c";
    glow("#fb923c", 15);
    polygon([
      [-5, 12],
      [5, 12],
      [0, 12 + flame],
    ]);
    ctx.fill();
    // body
    glow("#7dd3fc", 14);
    ctx.fillStyle = "#e0f2fe";
    polygon([
      [0, -18],
      [6, -4],
      [16, 8],
      [16, 13],
      [5, 10],
      [-5, 10],
      [-16, 13],
      [-16, 8],
      [-6, -4],
    ]);
    ctx.fill();
    ctx.fillStyle = "#0ea5e9";
    polygon([
      [0, -10],
      [3, -2],
      [-3, -2],
    ]);
    ctx.fill();
    if (player.shield > 0) {
      const fading = player.shield < 2 && Math.floor(time * 8) % 2 === 0;
      if (!fading) {
        ctx.strokeStyle = "#34d399";
        ctx.lineWidth = 2;
        glow("#34d399", 18);
        ctx.beginPath();
        ctx.arc(0, 0, 24, 0, TAU);
        ctx.stroke();
      }
    }
    ctx.restore();
  }

  function drawEnemy(e) {
    ctx.save();
    ctx.translate(e.x, e.y);
    const color = e.flash > 0 ? "#ffffff" : e.color;
    ctx.fillStyle = color;
    ctx.strokeStyle = color;
    glow(e.color, 12);
    switch (e.type) {
      case "scout":
        polygon([
          [0, 12],
          [12, -8],
          [0, -3],
          [-12, -8],
        ]);
        ctx.fill();
        break;
      case "zig":
        polygon([
          [0, 14],
          [13, 0],
          [0, -14],
          [-13, 0],
        ]);
        ctx.fill();
        ctx.fillStyle = "#05060f";
        ctx.beginPath();
        ctx.arc(0, 0, 4, 0, TAU);
        ctx.fill();
        break;
      case "gunner": {
        const pts = [];
        for (let i = 0; i < 6; i++)
          pts.push([
            Math.cos((i / 6) * TAU) * 17,
            Math.sin((i / 6) * TAU) * 17,
          ]);
        polygon(pts);
        ctx.fill();
        ctx.fillStyle = "#05060f";
        ctx.fillRect(-3, 4, 6, 14);
        ctx.beginPath();
        ctx.arc(0, 0, 6, 0, TAU);
        ctx.fill();
        break;
      }
      case "rock":
        ctx.rotate(e.rot);
        ctx.lineWidth = 2.5;
        polygon(
          e.shape.map(({ a, m }) => [
            Math.cos(a) * e.r * m,
            Math.sin(a) * e.r * m,
          ]),
        );
        ctx.fillStyle = e.flash > 0 ? "#ffffff" : "#44403c";
        ctx.fill();
        ctx.stroke();
        break;
      case "diver": {
        if (e.mode === "dive") ctx.rotate(Math.atan2(e.vy, e.vx) - Math.PI / 2);
        polygon([
          [0, 15],
          [10, -10],
          [0, -4],
          [-10, -10],
        ]);
        ctx.fill();
        if (e.mode === "wait") {
          ctx.strokeStyle = "#fb923c";
          ctx.lineWidth = 2;
          ctx.beginPath();
          ctx.arc(0, 0, 20 + Math.sin(time * 20) * 3, 0, TAU);
          ctx.stroke();
        }
        break;
      }
      case "boss":
        drawBoss(e, color);
        break;
    }
    ctx.restore();
  }

  function drawBoss(e, color) {
    polygon([
      [0, 40],
      [26, 22],
      [56, 28],
      [46, -6],
      [26, -26],
      [0, -18],
      [-26, -26],
      [-46, -6],
      [-56, 28],
      [-26, 22],
    ]);
    ctx.fill();
    ctx.fillStyle = "#05060f";
    polygon([
      [0, 24],
      [16, 4],
      [0, -8],
      [-16, 4],
    ]);
    ctx.fill();
    ctx.fillStyle = e.hp < e.maxHp / 2 ? "#ef4444" : "#fde047";
    glow(ctx.fillStyle, 16);
    ctx.beginPath();
    ctx.arc(0, 6, 6 + Math.sin(time * 6) * 1.5, 0, TAU);
    ctx.fill();
    ctx.fillStyle = color;
    ctx.fillRect(-40, 22, 8, 16);
    ctx.fillRect(32, 22, 8, 16);
  }

  function drawPowerup(p) {
    const def = POWERUPS[p.kind];
    ctx.save();
    ctx.translate(p.x, p.y);
    const pulse = 1 + Math.sin(p.t * 6) * 0.08;
    ctx.scale(pulse, pulse);
    glow(def.color, 16);
    ctx.fillStyle = def.color;
    ctx.beginPath();
    ctx.arc(0, 0, p.r, 0, TAU);
    ctx.fill();
    ctx.shadowBlur = 0;
    ctx.fillStyle = "#05060f";
    ctx.font = "bold 14px 'Roboto Mono', monospace";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText(def.label, 0, 1);
    ctx.restore();
  }

  function drawMiniShip(x, y, s) {
    ctx.save();
    ctx.translate(x, y);
    ctx.scale(s, s);
    polygon([
      [0, -18],
      [16, 12],
      [0, 6],
      [-16, 12],
    ]);
    ctx.fill();
    ctx.restore();
  }

  function drawHud() {
    ctx.save();
    ctx.shadowBlur = 0;
    ctx.font = "bold 18px 'Roboto Mono', monospace";
    ctx.textBaseline = "top";
    ctx.textAlign = "left";
    ctx.fillStyle = "#e8ebee";
    ctx.fillText(score.toLocaleString(), 12, 10);
    ctx.font = "12px 'Roboto Mono', monospace";
    ctx.fillStyle = "#9aa4af";
    ctx.fillText(`WAVE ${wave}`, 12, 32);
    if (combo > 1) {
      ctx.fillStyle = "#facc15";
      ctx.font = "bold 14px 'Roboto Mono', monospace";
      ctx.fillText(`COMBO x${combo}`, 12, 48);
    }

    ctx.textAlign = "right";
    ctx.fillStyle = "#9aa4af";
    ctx.font = "12px 'Roboto Mono', monospace";
    ctx.fillText(`BEST ${Math.max(best, score).toLocaleString()}`, W - 12, 12);
    ctx.fillStyle = "#7dd3fc";
    for (let i = 0; i < player.lives; i++)
      drawMiniShip(W - 18 - i * 22, 40, 0.5);

    // bottom: bombs and active power-ups
    ctx.textAlign = "left";
    ctx.textBaseline = "bottom";
    ctx.font = "14px 'Roboto Mono', monospace";
    ctx.fillStyle = "#f87171";
    ctx.fillText(
      `BOMBS ${"●".repeat(player.bombs)}${"○".repeat(3 - player.bombs)}`,
      12,
      H - 10,
    );
    const status = [];
    if (player.weapon > 1) status.push(["GUNS " + player.weapon, "#60a5fa"]);
    if (player.rapid > 0)
      status.push([`RAPID ${Math.ceil(player.rapid)}`, "#fb923c"]);
    if (player.shield > 0)
      status.push([`SHIELD ${Math.ceil(player.shield)}`, "#34d399"]);
    let sx = 12;
    ctx.font = "12px 'Roboto Mono', monospace";
    for (const [text, color] of status) {
      ctx.fillStyle = color;
      ctx.fillText(text, sx, H - 30);
      sx += ctx.measureText(text).width + 14;
    }

    const boss = enemies.find((e) => e.type === "boss");
    if (boss) {
      const w = W - 120;
      ctx.fillStyle = "#1f2937";
      ctx.fillRect(60, 70, w, 8);
      ctx.fillStyle = boss.color;
      ctx.fillRect(60, 70, (w * Math.max(0, boss.hp)) / boss.maxHp, 8);
      ctx.strokeStyle = "#e8ebee";
      ctx.lineWidth = 1;
      ctx.strokeRect(60, 70, w, 8);
    }
    ctx.restore();
  }

  function draw() {
    ctx.save();
    ctx.setTransform(canvas.width / W, 0, 0, canvas.height / H, 0, 0);
    ctx.fillStyle = "#05060f";
    ctx.fillRect(0, 0, W, H);

    if (shake > 0)
      ctx.translate(rand(-1, 1) * shake * 12, rand(-1, 1) * shake * 12);

    for (const s of stars) {
      ctx.fillStyle = `rgba(255,255,255,${0.25 + s.speed / 200})`;
      ctx.fillRect(s.x, s.y, s.size, s.size * (1 + s.speed / 80));
    }

    if (state !== "menu") {
      for (const p of powerups) drawPowerup(p);
      for (const e of enemies) drawEnemy(e);

      ctx.save();
      glow("#7dd3fc", 8);
      ctx.fillStyle = "#bae6fd";
      for (const b of bullets) ctx.fillRect(b.x - 2, b.y - 8, 4, 14);
      for (const b of enemyBullets) {
        glow(b.color, 10);
        ctx.fillStyle = b.color;
        ctx.beginPath();
        ctx.arc(b.x, b.y, b.r, 0, TAU);
        ctx.fill();
      }
      ctx.restore();

      drawPlayer();

      for (const p of particles) {
        ctx.globalAlpha = Math.max(0, p.life / p.max);
        ctx.fillStyle = p.color;
        ctx.fillRect(p.x, p.y, p.size, p.size);
      }
      ctx.globalAlpha = 1;

      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      for (const f of floaters) {
        ctx.globalAlpha = Math.min(1, f.t * 2);
        ctx.fillStyle = f.color ?? "#fde047";
        ctx.font = "bold 13px 'Roboto Mono', monospace";
        ctx.fillText(f.text, f.x, f.y);
      }
      ctx.globalAlpha = 1;

      if (banner) {
        ctx.globalAlpha = Math.min(1, banner.t * 2);
        glow("#7dd3fc", 20);
        ctx.fillStyle = "#e0f2fe";
        ctx.font = "bold 40px 'Roboto Mono', monospace";
        ctx.fillText(banner.text, W / 2, H * 0.4);
        if (banner.sub) {
          ctx.font = "bold 18px 'Roboto Mono', monospace";
          ctx.fillStyle = banner.sub.includes("BOSS") ? "#f87171" : "#9aa4af";
          ctx.fillText(banner.sub, W / 2, H * 0.4 + 40);
        }
        ctx.globalAlpha = 1;
        ctx.shadowBlur = 0;
      }

      drawHud();
    }

    if (flash > 0) {
      ctx.fillStyle = `rgba(255,255,255,${flash})`;
      ctx.fillRect(-20, -20, W + 40, H + 40);
    }
    ctx.restore();
  }

  // ---------- sizing and loop ----------
  // Fit a 2:3 canvas inside the stage, then match its pixel buffer to the
  // screen so it stays sharp.
  const stage = canvas.parentElement;
  function resize() {
    const availW = Math.max(160, stage.clientWidth - 16);
    const availH = Math.max(240, stage.clientHeight - 8);
    const cssW = Math.floor(Math.min(availW, (availH * W) / H));
    const cssH = Math.floor((cssW * H) / W);
    canvas.style.width = `${cssW}px`;
    canvas.style.height = `${cssH}px`;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    canvas.width = Math.round(cssW * dpr);
    canvas.height = Math.round(cssH * dpr);
  }
  window.addEventListener("resize", resize);

  let last = performance.now();
  function frame(now) {
    const dt = Math.min(0.033, (now - last) / 1000);
    last = now;
    update(dt);
    draw();
    requestAnimationFrame(frame);
  }

  updateMuteButton();
  setOverlay(overlayTitle.textContent, null, "Start");
  resize();
  requestAnimationFrame(frame);
})();
