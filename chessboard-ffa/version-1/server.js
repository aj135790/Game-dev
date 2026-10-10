'use strict';

const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');

const app = express();
const server = http.createServer(app);
const io = new Server(server, { cors: { origin: '*' }, maxHttpBufferSize: 1e6 });
const PORT = process.env.PORT || 3000;
app.use(express.static(path.join(__dirname, 'public')));
app.get('/health', (_req, res) => res.json({ ok: true, game: 'Chessboard FFA' }));

const TICK_RATE = 30;
const TICK_MS = 1000 / TICK_RATE;
const MAX_PLAYERS = 10;
const TARGET_LOBBY_SIZE = 8;
const ARENA_HALF = 15.5;
const PLAYER_RADIUS = 0.42;
const GRAVITY = 20;
const JUMP_SPEED = 7.2;
const MATCH_SECONDS = 600;
const SCORE_LIMIT = 20;

const GUNS = {
  rifle: {
    id: 'rifle', name: 'Assault Rifle', magazine: 30, reserve: 120,
    reloadMs: 1650, fireMs: 105, range: 78, spread: 0.022,
    description: 'Reliable automatic fire. Best at close-to-medium range.'
  },
  shotgun: {
    id: 'shotgun', name: 'Shotgun', magazine: 6, reserve: 24,
    reloadMs: 1900, fireMs: 820, range: 26, spread: 0.085,
    description: 'Eight pellets. Devastating up close; falls off quickly.'
  },
  sniper: {
    id: 'sniper', name: 'Sniper', magazine: 7, reserve: 21,
    reloadMs: 2050, fireMs: 1120, range: 120, spread: 0.013,
    description: 'Precise, slow shots. Rewards controlled long-range aim.'
  }
};

// 32 stylized chess pieces scattered over the board. These positions are also sent to the client.
const PIECES = [
  { id: 'p01', type: 'pawn', x: -10, z: -10, side: 'ivory' },
  { id: 'p02', type: 'knight', x: -6, z: -10, side: 'onyx' },
  { id: 'p03', type: 'pawn', x: -2, z: -10, side: 'ivory' },
  { id: 'p04', type: 'rook', x: 2, z: -10, side: 'onyx' },
  { id: 'p05', type: 'bishop', x: 6, z: -10, side: 'ivory' },
  { id: 'p06', type: 'pawn', x: 10, z: -10, side: 'onyx' },
  { id: 'p07', type: 'queen', x: -10, z: -6, side: 'onyx' },
  { id: 'p08', type: 'pawn', x: -6, z: -6, side: 'ivory' },
  { id: 'p09', type: 'bishop', x: -2, z: -6, side: 'onyx' },
  { id: 'p10', type: 'pawn', x: 2, z: -6, side: 'ivory' },
  { id: 'p11', type: 'knight', x: 6, z: -6, side: 'onyx' },
  { id: 'p12', type: 'pawn', x: 10, z: -6, side: 'ivory' },
  { id: 'p13', type: 'pawn', x: -10, z: -2, side: 'ivory' },
  { id: 'p14', type: 'rook', x: -6, z: -2, side: 'onyx' },
  { id: 'p15', type: 'pawn', x: -2, z: -2, side: 'onyx' },
  { id: 'p16', type: 'king', x: 2, z: -2, side: 'ivory' },
  { id: 'p17', type: 'pawn', x: 6, z: -2, side: 'ivory' },
  { id: 'p18', type: 'bishop', x: 10, z: -2, side: 'onyx' },
  { id: 'p19', type: 'knight', x: -10, z: 2, side: 'onyx' },
  { id: 'p20', type: 'pawn', x: -6, z: 2, side: 'ivory' },
  { id: 'p21', type: 'queen', x: -2, z: 2, side: 'onyx' },
  { id: 'p22', type: 'pawn', x: 2, z: 2, side: 'onyx' },
  { id: 'p23', type: 'rook', x: 6, z: 2, side: 'ivory' },
  { id: 'p24', type: 'pawn', x: 10, z: 2, side: 'ivory' },
  { id: 'p25', type: 'pawn', x: -10, z: 6, side: 'onyx' },
  { id: 'p26', type: 'bishop', x: -6, z: 6, side: 'ivory' },
  { id: 'p27', type: 'pawn', x: -2, z: 6, side: 'onyx' },
  { id: 'p28', type: 'knight', x: 2, z: 6, side: 'ivory' },
  { id: 'p29', type: 'pawn', x: 6, z: 6, side: 'onyx' },
  { id: 'p30', type: 'rook', x: 10, z: 6, side: 'ivory' },
  { id: 'p31', type: 'pawn', x: -6, z: 10, side: 'onyx' },
  { id: 'p32', type: 'pawn', x: 6, z: 10, side: 'ivory' }
].map(p => ({ ...p, radius: p.type === 'pawn' ? 0.42 : 0.58, height: ({ pawn: 1.05, rook: 1.55, knight: 1.62, bishop: 1.7, queen: 1.9, king: 2.12 })[p.type] }));

const players = new Map();
const usedNames = new Set();
let botCounter = 1;
let matchStartedAt = Date.now();
let matchRound = 1;
let lastMatchWinner = '';
const killFeed = [];

function clamp(n, min, max) { return Math.max(min, Math.min(max, n)); }
function randomName() {
  const names = ['KnightByte', 'PixelPawn', 'RookRanger', 'BishopBlitz', 'QueenShift', 'CastleCrash', 'CheckmateX', 'ForkHunter', 'SideQuest', 'Endgame'];
  let name = names[Math.floor(Math.random() * names.length)] + (Math.floor(Math.random() * 90) + 10);
  while (usedNames.has(name)) name = 'Bot' + Math.floor(Math.random() * 9999);
  usedNames.add(name);
  return name;
}
function freshSpawn(exclude = null) {
  const candidates = [
    [-13.2, -13.2], [13.2, -13.2], [-13.2, 13.2], [13.2, 13.2],
    [-13.2, 0], [13.2, 0], [0, -13.2], [0, 13.2],
    [-12, -4], [12, 4], [-4, 12], [4, -12], [-12, 8], [12, -8],
    [-8, -13.2], [8, 13.2], [-13.2, 8], [13.2, -8]
  ];
  const free = candidates.filter(([x, z]) => {
    if (PIECES.some(piece => Math.hypot(piece.x - x, piece.z - z) < piece.radius + 1.15)) return false;
    for (const p of players.values()) {
      if (p.id !== exclude && p.alive && Math.hypot(p.x - x, p.z - z) < 2.2) return false;
    }
    return true;
  });
  const point = (free.length ? free : candidates)[Math.floor(Math.random() * (free.length ? free : candidates).length)];
  return { x: point[0], z: point[1] };
}
function makePlayer({ id, socketId = null, name, weapon = 'rifle', isBot = false }) {
  const spawn = freshSpawn();
  const gun = GUNS[weapon] ? weapon : 'rifle';
  return {
    id, socketId, name: String(name || 'Player').slice(0, 16), isBot, x: spawn.x, z: spawn.z,
    jumpY: 0, vy: 0, yaw: Math.random() * Math.PI * 2, pitch: 0,
    health: 100, alive: true, respawnAt: 0,
    kills: 0, deaths: 0, streak: 0, bestStreak: 0, xp: 0,
    weapon: gun, equipped: 'primary', ammo: GUNS[gun].magazine, reserve: GUNS[gun].reserve,
    reloadingUntil: 0, nextFireAt: 0, nextMeleeAt: 0, keys: {}, aiming: false,
    lastDamageAt: 0, botThinkAt: 0, botTarget: null, botStrafe: Math.random() < 0.5 ? -1 : 1,
    lastHitBy: null, lastHitDamage: 0, joinedAt: Date.now()
  };
}
function addFeed(textLine, kind = 'kill') {
  killFeed.unshift({ id: `${Date.now()}_${Math.random()}`, text: textLine, kind, at: Date.now() });
  if (killFeed.length > 6) killFeed.length = 6;
}
function humansCount() { let n = 0; for (const p of players.values()) if (!p.isBot) n++; return n; }
function botsCount() { let n = 0; for (const p of players.values()) if (p.isBot) n++; return n; }
function removeBotsToMakeRoom() {
  while (players.size >= MAX_PLAYERS) {
    const bot = [...players.values()].find(p => p.isBot);
    if (!bot) break;
    players.delete(bot.id);
    usedNames.delete(bot.name);
  }
}
function fillBots() {
  const desired = Math.min(MAX_PLAYERS, Math.max(0, TARGET_LOBBY_SIZE - humansCount()));
  while (botsCount() < desired && players.size < MAX_PLAYERS) {
    const weapon = ['rifle', 'shotgun', 'sniper'][Math.floor(Math.random() * 3)];
    const bot = makePlayer({ id: `bot_${botCounter++}`, name: randomName(), weapon, isBot: true });
    players.set(bot.id, bot);
  }
}
function getPublicPlayer(p) {
  return {
    id: p.id, name: p.name, isBot: p.isBot, x: p.x, z: p.z, jumpY: p.jumpY,
    yaw: p.yaw, pitch: p.pitch, health: p.health, alive: p.alive,
    kills: p.kills, deaths: p.deaths, streak: p.streak, xp: p.xp,
    weapon: p.weapon, equipped: p.equipped, ammo: p.ammo, reserve: p.reserve,
    reloading: p.reloadingUntil > Date.now(), aiming: p.aiming
  };
}
function emitState() {
  const now = Date.now();
  const elapsed = Math.floor((now - matchStartedAt) / 1000);
  const remain = Math.max(0, MATCH_SECONDS - elapsed);
  const state = {
    players: [...players.values()].map(getPublicPlayer),
    feed: killFeed,
    match: { round: matchRound, remaining: remain, scoreLimit: SCORE_LIMIT, winner: lastMatchWinner, humans: humansCount(), total: players.size }
  };
  io.volatile.emit('state', state);
}
function collisionAt(x, z, ignoreId = null) {
  if (x < -ARENA_HALF + PLAYER_RADIUS || x > ARENA_HALF - PLAYER_RADIUS || z < -ARENA_HALF + PLAYER_RADIUS || z > ARENA_HALF - PLAYER_RADIUS) return true;
  for (const piece of PIECES) {
    const minDist = piece.radius + PLAYER_RADIUS;
    if (Math.hypot(x - piece.x, z - piece.z) < minDist) return true;
  }
  for (const p of players.values()) {
    if (p.id !== ignoreId && p.alive && Math.hypot(x - p.x, z - p.z) < PLAYER_RADIUS * 1.55) return true;
  }
  return false;
}
function movePlayer(p, dt) {
  if (!p.alive) return;
  if (p.reloadingUntil && Date.now() >= p.reloadingUntil) {
    const gun = GUNS[p.weapon];
    const needed = gun.magazine - p.ammo;
    const loaded = Math.min(needed, p.reserve);
    p.ammo += loaded;
    p.reserve -= loaded;
    p.reloadingUntil = 0;
  }
  const keys = p.keys || {};
  const forward = (keys.w ? 1 : 0) - (keys.s ? 1 : 0);
  const side = (keys.d ? 1 : 0) - (keys.a ? 1 : 0);
  let dx = Math.sin(p.yaw) * forward + Math.cos(p.yaw) * side;
  let dz = -Math.cos(p.yaw) * forward + Math.sin(p.yaw) * side;
  const length = Math.hypot(dx, dz);
  if (length > 0) { dx /= length; dz /= length; }
  let speed = keys.shift ? 7.6 : 5.1;
  if (keys.ctrl) speed = 2.8;
  if (p.aiming) speed *= 0.82;
  const nx = p.x + dx * speed * dt;
  const nz = p.z + dz * speed * dt;
  if (!collisionAt(nx, p.z, p.id)) p.x = nx;
  if (!collisionAt(p.x, nz, p.id)) p.z = nz;
  p.vy -= GRAVITY * dt;
  p.jumpY += p.vy * dt;
  if (p.jumpY < 0) { p.jumpY = 0; p.vy = 0; }
}
function raySphere(origin, dir, center, radius) {
  const ox = origin.x - center.x, oy = origin.y - center.y, oz = origin.z - center.z;
  const b = ox * dir.x + oy * dir.y + oz * dir.z;
  const c = ox * ox + oy * oy + oz * oz - radius * radius;
  const disc = b * b - c;
  if (disc < 0) return Infinity;
  const t = -b - Math.sqrt(disc);
  return t >= 0 ? t : Infinity;
}
function rayPieceDistance(origin, dir, piece, maxDistance) {
  const a = dir.x * dir.x + dir.z * dir.z;
  if (a < 1e-8) return Infinity;
  const ox = origin.x - piece.x, oz = origin.z - piece.z;
  const b = 2 * (ox * dir.x + oz * dir.z);
  const c = ox * ox + oz * oz - piece.radius * piece.radius;
  const disc = b * b - 4 * a * c;
  if (disc < 0) return Infinity;
  const root = Math.sqrt(disc);
  const ts = [(-b - root) / (2 * a), (-b + root) / (2 * a)];
  for (const t of ts) {
    if (t <= 0 || t > maxDistance) continue;
    const y = origin.y + dir.y * t;
    if (y >= 0 && y <= piece.height) return t;
  }
  return Infinity;
}
function normalize(v) {
  const mag = Math.hypot(v.x, v.y, v.z) || 1;
  return { x: v.x / mag, y: v.y / mag, z: v.z / mag };
}
function directionFromAngles(yaw, pitch) {
  const cp = Math.cos(pitch);
  return { x: Math.sin(yaw) * cp, y: Math.sin(pitch), z: -Math.cos(yaw) * cp };
}
function addSpread(dir, amount) {
  const yawJitter = (Math.random() - 0.5) * amount * 2;
  const pitchJitter = (Math.random() - 0.5) * amount * 2;
  return directionFromAngles(Math.atan2(dir.x, -dir.z) + yawJitter, Math.asin(clamp(dir.y, -1, 1)) + pitchJitter);
}
function traceBullet(shooter, dir, range) {
  const origin = { x: shooter.x, y: 1.55 + shooter.jumpY, z: shooter.z };
  let nearest = range;
  let hit = null;
  let hitZone = 'body';
  for (const p of players.values()) {
    if (!p.alive || p.id === shooter.id) continue;
    const jump = p.jumpY;
    const bodyDist = raySphere(origin, dir, { x: p.x, y: 0.92 + jump, z: p.z }, 0.52);
    const headDist = raySphere(origin, dir, { x: p.x, y: 1.57 + jump, z: p.z }, 0.255);
    const targetDist = Math.min(bodyDist, headDist);
    const zone = headDist < bodyDist ? 'head' : 'body';
    if (targetDist < nearest) {
      let blocked = false;
      for (const piece of PIECES) {
        if (rayPieceDistance(origin, dir, piece, targetDist) < targetDist) { blocked = true; break; }
      }
      if (!blocked) { nearest = targetDist; hit = p; hitZone = zone; }
    }
  }
  let blockedDistance = Infinity;
  for (const piece of PIECES) blockedDistance = Math.min(blockedDistance, rayPieceDistance(origin, dir, piece, range));
  const distance = Math.min(nearest, blockedDistance, range);
  if (hit && nearest <= blockedDistance && nearest <= range) return { hit, hitZone, distance: nearest, origin, dir };
  return { hit: null, hitZone: null, distance: Math.min(distance, range), origin, dir };
}
function computeDamage(weapon, distance, zone, pellet = false) {
  if (weapon === 'rifle') {
    const falloff = distance <= 18 ? 1 : distance <= 45 ? 1 - ((distance - 18) / 27) * 0.30 : distance <= 78 ? 0.70 - ((distance - 45) / 33) * 0.34 : 0.2;
    const base = zone === 'head' ? 34 : 23;
    return Math.max(5, Math.round(base * falloff));
  }
  if (weapon === 'shotgun') {
    const falloff = distance <= 5 ? 1 : distance <= 14 ? 1 - ((distance - 5) / 9) * 0.60 : distance <= 26 ? 0.40 - ((distance - 14) / 12) * 0.34 : 0.05;
    return Math.max(1, Math.round((zone === 'head' ? 10 : 8) * falloff));
  }
  if (weapon === 'sniper') {
    if (distance > 120) return 0;
    if (zone === 'head') return 100;
    return distance < 65 ? 78 : 70;
  }
  return pellet ? 0 : 0;
}
function finishDeath(victim, killer, weapon, hitZone = 'body') {
  victim.alive = false;
  victim.health = 0;
  victim.deaths++;
  victim.streak = 0;
  victim.respawnAt = Date.now() + 2600;
  victim.vy = 0;
  victim.jumpY = 0;
  if (killer && killer.id !== victim.id) {
    killer.kills++;
    killer.streak++;
    killer.bestStreak = Math.max(killer.bestStreak, killer.streak);
    const bonus = weapon === 'sniper' && hitZone === 'head' ? 175 : (hitZone === 'head' ? 125 : 100);
    killer.xp += bonus;
    const streakTxt = killer.streak >= 3 ? ` · ${killer.streak} streak` : '';
    const headTxt = hitZone === 'head' ? ' · precision hit' : '';
    addFeed(`${killer.name} eliminated ${victim.name}${streakTxt}${headTxt}`, 'kill');
    if (!killer.isBot && !victim.isBot) io.to(killer.socketId).emit('reward', { type: 'kill', xp: bonus, streak: killer.streak, victim: victim.name, headshot: hitZone === 'head' });
    if (killer.kills >= SCORE_LIMIT) {
      lastMatchWinner = killer.name;
      addFeed(`${killer.name} wins the round`, 'round');
      matchStartedAt = Date.now();
      matchRound++;
      for (const p of players.values()) {
        p.kills = 0; p.deaths = 0; p.streak = 0; p.health = 100; p.alive = true;
        p.respawnAt = 0; p.xp += p.id === killer.id ? 250 : 0;
        const s = freshSpawn(p.id); p.x = s.x; p.z = s.z;
        p.ammo = GUNS[p.weapon].magazine; p.reserve = GUNS[p.weapon].reserve; p.reloadingUntil = 0;
      }
    }
  } else {
    addFeed(`${victim.name} was eliminated`, 'environment');
  }
  if (!victim.isBot && victim.socketId) io.to(victim.socketId).emit('youDied', { killer: killer ? killer.name : 'the arena', weapon });
}
function fireWeapon(shooter) {
  if (!shooter || !shooter.alive || shooter.equipped === 'knife') return;
  const now = Date.now();
  const gun = GUNS[shooter.weapon] || GUNS.rifle;
  if (shooter.reloadingUntil > now || now < shooter.nextFireAt) return;
  if (shooter.ammo <= 0) {
    if (!shooter.isBot && shooter.socketId) io.to(shooter.socketId).emit('empty');
    return;
  }
  shooter.nextFireAt = now + gun.fireMs;
  shooter.ammo--;
  let baseDir = directionFromAngles(shooter.yaw, shooter.pitch);
  if (!shooter.isBot && !shooter.aiming) {
    const moveSpread = (shooter.keys.w || shooter.keys.a || shooter.keys.s || shooter.keys.d) ? 1.16 : 1;
    baseDir = addSpread(baseDir, gun.spread * moveSpread);
  } else if (shooter.isBot) {
    baseDir = addSpread(baseDir, gun.spread * 1.7);
  } else if (shooter.aiming) {
    baseDir = addSpread(baseDir, gun.spread * 0.36);
  }
  const traces = [];
  let totalDamage = 0;
  let killed = null;
  let headshot = false;
  const pelletCount = shooter.weapon === 'shotgun' ? 8 : 1;
  for (let i = 0; i < pelletCount; i++) {
    const dir = shooter.weapon === 'shotgun' ? addSpread(baseDir, gun.spread * (shooter.aiming ? 0.72 : 1.0)) : baseDir;
    const result = traceBullet(shooter, dir, gun.range);
    traces.push({ dir, distance: result.distance, hitId: result.hit ? result.hit.id : null });
    if (!result.hit) continue;
    const damage = computeDamage(shooter.weapon, result.distance, result.hitZone, shooter.weapon === 'shotgun');
    if (damage <= 0 || !result.hit.alive) continue;
    result.hit.health = Math.max(0, result.hit.health - damage);
    result.hit.lastDamageAt = now;
    result.hit.lastHitBy = shooter.id;
    result.hit.lastHitDamage = damage;
    totalDamage += damage;
    if (result.hitZone === 'head') headshot = true;
    if (result.hit.health <= 0 && !killed) killed = { victim: result.hit, zone: result.hitZone };
    if (!result.hit.isBot && result.hit.socketId) io.to(result.hit.socketId).emit('damageTaken', { amount: damage, from: shooter.name, health: result.hit.health });
  }
  io.volatile.emit('shotFx', { shooterId: shooter.id, weapon: shooter.weapon, origin: { x: shooter.x, y: 1.55 + shooter.jumpY, z: shooter.z }, traces, aiming: shooter.aiming });
  if (!shooter.isBot && shooter.socketId) {
    if (totalDamage > 0) io.to(shooter.socketId).emit('hitConfirm', { damage: totalDamage, headshot, killed: !!killed });
  }
  if (killed) finishDeath(killed.victim, shooter, shooter.weapon, killed.zone);
}

function knifeAttack(attacker) {
  if (!attacker || !attacker.alive || attacker.equipped !== 'knife') return;
  const now = Date.now();
  if (now < attacker.nextMeleeAt) return;
  attacker.nextMeleeAt = now + 520;
  const facing = { x: Math.sin(attacker.yaw), z: -Math.cos(attacker.yaw) };
  let target = null;
  let bestDistance = 2.35;
  for (const p of players.values()) {
    if (!p.alive || p.id === attacker.id) continue;
    const dx = p.x - attacker.x, dz = p.z - attacker.z;
    const distance = Math.hypot(dx, dz);
    if (distance >= bestDistance) continue;
    const dot = (facing.x * dx + facing.z * dz) / Math.max(distance, 0.001);
    if (dot < 0.35) continue;
    bestDistance = distance;
    target = p;
  }
  io.volatile.emit('meleeFx', { attackerId: attacker.id, targetId: target ? target.id : null, hit: !!target });
  if (!target) return;
  const targetFacing = { x: Math.sin(target.yaw), z: -Math.cos(target.yaw) };
  const toAttacker = { x: attacker.x - target.x, z: attacker.z - target.z };
  const behindDot = (targetFacing.x * toAttacker.x + targetFacing.z * toAttacker.z) / Math.max(Math.hypot(toAttacker.x, toAttacker.z), 0.001);
  const damage = behindDot < -0.25 ? 82 : 60;
  target.health = Math.max(0, target.health - damage);
  target.lastDamageAt = now;
  target.lastHitBy = attacker.id;
  target.lastHitDamage = damage;
  if (!target.isBot && target.socketId) io.to(target.socketId).emit('damageTaken', { amount: damage, from: attacker.name, health: target.health });
  if (!attacker.isBot && attacker.socketId) io.to(attacker.socketId).emit('hitConfirm', { damage, headshot: false, killed: target.health <= 0, melee: true });
  if (target.health <= 0) finishDeath(target, attacker, 'knife', 'body');
}

function botThink(bot, now) {
  if (!bot.alive || now < bot.botThinkAt) return;
  bot.botThinkAt = now + 120 + Math.random() * 130;
  let targets = [...players.values()].filter(p => p.alive && p.id !== bot.id);
  if (!targets.length) return;
  // Bots lightly prefer real players without ignoring the free-for-all.
  targets.sort((a, b) => (a.isBot ? 1 : 0) - (b.isBot ? 1 : 0) || Math.hypot(a.x - bot.x, a.z - bot.z) - Math.hypot(b.x - bot.x, b.z - bot.z));
  let target = bot.botTarget && targets.find(p => p.id === bot.botTarget) ? targets.find(p => p.id === bot.botTarget) : null;
  if (!target || Math.random() < 0.18) target = targets[Math.floor(Math.random() * Math.min(targets.length, 4))];
  bot.botTarget = target.id;
  const dx = target.x - bot.x, dz = target.z - bot.z;
  const dist = Math.hypot(dx, dz);
  const ideal = bot.weapon === 'shotgun' ? 7.5 : bot.weapon === 'sniper' ? 22 : 13;
  const desiredYaw = Math.atan2(dx, -dz);
  const yawDelta = Math.atan2(Math.sin(desiredYaw - bot.yaw), Math.cos(desiredYaw - bot.yaw));
  bot.yaw += clamp(yawDelta, -0.11, 0.11);
  const targetY = 1.0 + target.jumpY;
  bot.pitch = clamp(Math.atan2(targetY - (1.55 + bot.jumpY), Math.max(0.1, dist)) + (Math.random() - 0.5) * 0.07, -0.55, 0.55);
  bot.aiming = bot.weapon === 'sniper' || (bot.weapon === 'rifle' && dist > 12);
  bot.keys = {};
  if (dist > ideal * 1.08) bot.keys.w = true;
  else if (dist < ideal * 0.54) bot.keys.s = true;
  if (Math.random() < 0.48) bot.keys[bot.botStrafe < 0 ? 'a' : 'd'] = true;
  if (Math.random() < 0.12) bot.botStrafe *= -1;
  if (Math.random() < 0.012) bot.keys.shift = true;
  if (Math.random() < 0.008) bot.keys.jump = true;
  if (bot.keys.jump && bot.jumpY === 0) bot.vy = JUMP_SPEED;
  const maxFireDist = bot.weapon === 'shotgun' ? 16 : bot.weapon === 'sniper' ? 85 : 38;
  if (dist < maxFireDist && Math.abs(yawDelta) < 0.27 && Math.random() < 0.78) fireWeapon(bot);
  if (bot.ammo === 0 && !bot.reloadingUntil) bot.reloadingUntil = now + GUNS[bot.weapon].reloadMs;
}

io.on('connection', socket => {
  socket.emit('arena', { pieces: PIECES, guns: GUNS, arenaHalf: ARENA_HALF, scoreLimit: SCORE_LIMIT });

  socket.on('join', payload => {
    if (players.has(socket.id)) return;
    if (humansCount() >= MAX_PLAYERS) {
      socket.emit('joinError', 'This match is full. Try again in a moment.');
      return;
    }
    removeBotsToMakeRoom();
    // Keep the practice lobby near eight total combatants by replacing bots as humans arrive.
    while (players.size >= TARGET_LOBBY_SIZE && botsCount() > 0) {
      const bot = [...players.values()].find(p => p.isBot);
      if (!bot) break;
      players.delete(bot.id);
      usedNames.delete(bot.name);
    }
    let name = String(payload && payload.name || 'Player').trim().replace(/[^a-zA-Z0-9 _-]/g, '').slice(0, 16) || 'Player';
    if ([...players.values()].some(p => p.name.toLowerCase() === name.toLowerCase())) name = `${name}${Math.floor(Math.random() * 90 + 10)}`;
    usedNames.add(name);
    const weapon = GUNS[payload && payload.weapon] ? payload.weapon : 'rifle';
    const p = makePlayer({ id: socket.id, socketId: socket.id, name, weapon });
    players.set(p.id, p);
    socket.emit('joined', { id: p.id, player: getPublicPlayer(p) });
    addFeed(`${p.name} joined the arena`, 'join');
    fillBots();
  });

  socket.on('input', data => {
    const p = players.get(socket.id);
    if (!p || !p.alive || !data) return;
    const keys = data.keys && typeof data.keys === 'object' ? data.keys : {};
    p.keys = {
      w: !!keys.w, a: !!keys.a, s: !!keys.s, d: !!keys.d,
      shift: !!keys.shift, ctrl: !!keys.ctrl
    };
    if (keys.jump && p.jumpY <= 0.001 && p.vy <= 0.01) p.vy = JUMP_SPEED;
    if (Number.isFinite(data.yaw)) p.yaw = data.yaw;
    if (Number.isFinite(data.pitch)) p.pitch = clamp(data.pitch, -1.2, 1.2);
    p.aiming = !!data.aiming;
  });

  socket.on('chooseWeapon', id => {
    const p = players.get(socket.id);
    if (!p || !GUNS[id]) return;
    p.weapon = id;
    p.equipped = 'primary';
    p.ammo = GUNS[id].magazine;
    p.reserve = GUNS[id].reserve;
    p.reloadingUntil = 0;
    socket.emit('weaponChanged', { weapon: id });
  });

  socket.on('shoot', () => {
    const p = players.get(socket.id);
    if (p) fireWeapon(p);
  });

  socket.on('switchSlot', slot => {
    const p = players.get(socket.id);
    if (!p || !p.alive) return;
    p.equipped = slot === 'knife' ? 'knife' : 'primary';
    p.aiming = false;
  });

  socket.on('melee', () => {
    const p = players.get(socket.id);
    if (p) knifeAttack(p);
  });

  socket.on('reload', () => {
    const p = players.get(socket.id);
    if (!p || !p.alive || p.reloadingUntil > Date.now()) return;
    const gun = GUNS[p.weapon];
    if (p.ammo >= gun.magazine || p.reserve <= 0) return;
    p.reloadingUntil = Date.now() + gun.reloadMs;
    socket.emit('reloadStarted', { duration: gun.reloadMs });
  });

  socket.on('disconnect', () => {
    const p = players.get(socket.id);
    if (p) {
      players.delete(socket.id);
      usedNames.delete(p.name);
      addFeed(`${p.name} left the arena`, 'join');
      fillBots();
    }
  });
});

setInterval(() => {
  const now = Date.now();
  const dt = Math.min(0.06, TICK_MS / 1000);
  for (const p of players.values()) {
    if (!p.alive && now >= p.respawnAt) {
      const spawn = freshSpawn(p.id);
      p.x = spawn.x; p.z = spawn.z; p.jumpY = 0; p.vy = 0;
      p.health = 100; p.alive = true; p.ammo = GUNS[p.weapon].magazine;
      p.reserve = GUNS[p.weapon].reserve; p.reloadingUntil = 0; p.nextFireAt = now + 300;
      p.keys = {};
    } else if (p.alive) {
      if (p.isBot) botThink(p, now);
      movePlayer(p, dt);
      if (p.reloadingUntil && now >= p.reloadingUntil) {
        const gun = GUNS[p.weapon];
        const amount = Math.min(gun.magazine - p.ammo, p.reserve);
        p.ammo += amount; p.reserve -= amount; p.reloadingUntil = 0;
      }
    }
  }
  if (now - matchStartedAt >= MATCH_SECONDS * 1000) {
    let leader = [...players.values()].sort((a, b) => b.kills - a.kills || b.xp - a.xp)[0];
    lastMatchWinner = leader && leader.kills > 0 ? leader.name : 'No winner';
    addFeed(`Round ${matchRound} ended · ${lastMatchWinner}`, 'round');
    matchRound++;
    matchStartedAt = now;
    for (const p of players.values()) {
      p.kills = 0; p.deaths = 0; p.streak = 0; p.health = 100; p.alive = true; p.respawnAt = 0;
      const s = freshSpawn(p.id); p.x = s.x; p.z = s.z; p.ammo = GUNS[p.weapon].magazine;
      p.reserve = GUNS[p.weapon].reserve; p.reloadingUntil = 0;
    }
  }
  emitState();
}, TICK_MS);

server.listen(PORT, '0.0.0.0', () => {
  console.log(`Chessboard FFA running at http://localhost:${PORT}`);
});
