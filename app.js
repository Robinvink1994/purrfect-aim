/* =============================================================================
   PURRFECT AIM — projectie-boogschietspel met katten
   Eén bestand voor zowel de BEAMER (host) als de TELEFOON (controller).
   - Host:        index.html            (laptop → HDMI → beamer)
   - Controller:  index.html?join=CODE  (telefoon scant QR-code)
   - Lokale test: index.html?local=CODE (tweede tabblad op dezelfde pc)
   Verbinding: PeerJS (WebRTC) via internet-signalering, of BroadcastChannel lokaal.
   ========================================================================== */
(() => {
'use strict';

// -----------------------------------------------------------------------------
// 1. INSTELLINGEN & SPELDATA  (pas hier balans, prijzen en unlocks aan)
// -----------------------------------------------------------------------------
const VERSION = 1;
const W = 480, H = 270;                 // interne pixel-resolutie (×4 = 1920×1080)
const PEER_PREFIX = 'purrfect-aim-v1-';
const SAVE_KEY = 'pa.host.v1';
const ME_KEY = 'pa.me.v1';

const CFG = {
  arrowLife: 30,        // sec dat een pijl in een doel blijft steken
  gravity: 220,         // px/s²
  vMin: 110, vMax: 300, // pijlsnelheid bij 0% en 100% spanning (px/s)
  baseReload: 8,        // sec per nieuwe pijl (start)
  wobbleBase: 0.30,     // rad: hoe ver het richten op en neer zwiept
  wobbleSpeed: 2.4,
  walkSpeed: 38,        // px/s
  comboWindow: 6,       // sec tussen treffers om combo te houden
  baseGold: 3,
  sizeRef: 1600,        // px² waarbij grootte-factor 1 is
  splitRadius: 3.2,     // px: pijl-in-pijl ("Robin Hood")
  maxStuck: 260,
  balloonEvery: [6, 12],
  mouseEvery: [80, 150],
  offlineGrace: 15
};

// level-curve: xp nodig voor level L → L+1
const xpNeed = (L) => Math.round(30 * Math.pow(1.28, L - 1) + 15 * (L - 1));
const MAX_LEVEL = 50;

// Upgrade-web. pos = [kolom 0..4, rij 0..3]; req = { upgradeId: minimumNiveau }
const UPGRADES = {
  reload:    { name: 'Snelle Pootjes',   icon: '⏱', desc: 'Sneller een nieuwe pijl in je koker.', max: 15, base: 25,   growth: 1.55, lvl: 1,  pos: [0, 0] },
  power:     { name: 'Sterke Boog',      icon: '🏹', desc: 'Pijlen vliegen harder en verder.',     max: 12, base: 40,   growth: 1.6,  lvl: 1,  pos: [2, 0] },
  feet:      { name: 'Fluwelen Voetjes', icon: '🐾', desc: 'Sneller lopen over platforms.',        max: 8,  base: 30,   growth: 1.5,  lvl: 1,  pos: [4, 0] },
  quiver:    { name: 'Grotere Koker',    icon: '🎒', desc: '+1 pijl in je koker.',                 max: 6,  base: 120,  growth: 2.4,  lvl: 3,  pos: [0, 1], req: { reload: 2 } },
  steady:    { name: 'Kattenogen',       icon: '👁', desc: 'Richten zwiept minder op en neer.',    max: 10, base: 60,   growth: 1.65, lvl: 2,  pos: [2, 1], req: { power: 2 } },
  hunter:    { name: 'Muizenjager',      icon: '🐭', desc: '+25% beloning op ballonnen en muizen.', max: 8,  base: 90,   growth: 1.7,  lvl: 4,  pos: [4, 1], req: { feet: 2 } },
  multishot: { name: 'Driedubbel Miauw', icon: '✨', desc: 'Schiet een extra gratis pijl mee.',     max: 2,  base: 1500, growth: 4,    lvl: 12, pos: [0, 2], req: { quiver: 2 } },
  greed:     { name: 'Gouden Snorharen', icon: '💰', desc: '+8% goud per treffer.',                max: 20, base: 80,   growth: 1.5,  lvl: 4,  pos: [2, 2], req: { steady: 1 } },
  wisdom:    { name: 'Wijze Oude Kat',   icon: '📜', desc: '+10% XP per treffer.',                 max: 10, base: 150,  growth: 1.65, lvl: 6,  pos: [4, 2], req: { hunter: 1 } },
  crit:      { name: 'Nagelscherp',      icon: '💥', desc: '+3% kans op kritieke treffer (×3).',  max: 10, base: 200,  growth: 1.7,  lvl: 8,  pos: [1, 3], req: { greed: 3 } },
  combo:     { name: 'Spinnende Reeks',  icon: '🔥', desc: 'Combo houdt 1 sec langer aan.',        max: 6,  base: 250,  growth: 1.9,  lvl: 10, pos: [3, 3], req: { greed: 3, wisdom: 1 } }
};
const upgradeCost = (id, n) => Math.round(UPGRADES[id].base * Math.pow(UPGRADES[id].growth, n));

// Pijlsoorten (unlock per level). Effecten zijn klein; vooral de beleving telt.
const ARROWS = {
  wood:    { name: 'Houten pijl',     lvl: 1,  fletch: '#d8d8d8', trail: null,      desc: 'Betrouwbaar en eerlijk.' },
  fish:    { name: 'Visgraat-pijl',   lvl: 3,  fletch: '#9fd8ff', trail: 'fish',    desc: '+10% XP. Laat visgraatjes achter.', xp: 1.1 },
  yarn:    { name: 'Wolbol-pijl',     lvl: 6,  fletch: '#ff6fb5', trail: 'yarn',    desc: '+10% goud. Regenboog-wolspoor.', gold: 1.1 },
  paw:     { name: 'Pootjes-pijl',    lvl: 10, fletch: '#ffd23f', trail: 'paw',     desc: '+5% crit. Pootafdrukken bij elke treffer.', crit: 0.05 },
  laser:   { name: 'Laserstip-pijl',  lvl: 15, fletch: '#ff3030', trail: 'laser',   desc: 'Bijna geen zwaartekracht. Katten worden gek.', grav: 0.45 },
  catnip:  { name: 'Kattenkruid-pijl',lvl: 20, fletch: '#7dff5a', trail: 'catnip',  desc: '+15% goud en pijl-in-pijl ×6.', gold: 1.15, split: 6 }
};

const FURS = {
  orange:  { name: 'Rode kater',  lvl: 1, c: ['#f08a2c', '#ffb25e', '#b85d14'] },
  black:   { name: 'Zwarte kat',  lvl: 1, c: ['#2a2733', '#4a4658', '#121016'] },
  grey:    { name: 'Grijze kat',  lvl: 1, c: ['#8c93a3', '#b7bdc9', '#5d6372'] },
  white:   { name: 'Witte kat',   lvl: 1, c: ['#eeeae2', '#ffffff', '#b9b3a6'] },
  calico:  { name: 'Lapjeskat',   lvl: 5, c: ['#eeeae2', '#f08a2c', '#2a2733'] },
  siamese: { name: 'Siamees',     lvl: 8, c: ['#efe0c4', '#fff4de', '#5a3d2b'] },
  golden:  { name: 'Gouden kat',  lvl: 25, c: ['#ffcf33', '#fff08a', '#c48a00'] }
};
const HATS = {
  none:    { name: 'Geen',          lvl: 1 },
  hood:    { name: 'Boogschutterskap', lvl: 2 },
  feather: { name: 'Veertjeshoed',  lvl: 4 },
  helm:    { name: 'Riddershelm',   lvl: 7 },
  wizard:  { name: 'Tovenaarshoed', lvl: 10 },
  crown:   { name: 'Kattenkroon',   lvl: 15 },
  halo:    { name: 'Negen-levens-halo', lvl: 22 }
};
const CAPES = {
  none:   { name: 'Geen',   lvl: 1,  c: null },
  red:    { name: 'Rood',   lvl: 2,  c: '#b3263a' },
  blue:   { name: 'Blauw',  lvl: 3,  c: '#2c55c9' },
  green:  { name: 'Woudgroen', lvl: 5, c: '#2f8a3b' },
  purple: { name: 'Paars',  lvl: 9,  c: '#7a35c9' },
  gold:   { name: 'Goud',   lvl: 14, c: '#e0a800' }
};
const PETS = {
  none:   { name: 'Geen',            lvl: 1 },
  kitten: { name: 'Kitten',          lvl: 5,  fur: 'grey' },
  ginger: { name: 'Rode kitten',     lvl: 7,  fur: 'orange' },
  void:   { name: 'Zwart katje',     lvl: 11, fur: 'black' },
  snow:   { name: 'Sneeuwkitten',    lvl: 16, fur: 'white' }
};

const ZONE_TYPES = {
  target:   { name: 'Doel',      icon: '🎯', tools: ['rect', 'poly'], desc: 'Hier schiet je op. Klein en ver weg = meer goud.' },
  wall:     { name: 'Muur',      icon: '🧱', tools: ['rect', 'poly'], desc: 'Pijlen blijven steken, geen punten. Gebruik als obstakel.' },
  platform: { name: 'Platform',  icon: '🌿', tools: ['line'],         desc: 'Lijn waarop katten lopen. Teken op planken, randen, kasten.' },
  pond:     { name: 'Visvijver', icon: '🐟', tools: ['rect', 'poly'], desc: 'Hier stijgen visballonnen op: bewegende bonusdoelen.' }
};
const TOOLS = { rect: 'Rechthoek', poly: 'Polygoon', line: 'Lijn' };

// -----------------------------------------------------------------------------
// 2. HULPFUNCTIES & GEOMETRIE
// -----------------------------------------------------------------------------
const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
const lerp = (a, b, t) => a + (b - a) * t;
const rand = (a, b) => a + Math.random() * (b - a);
const pick = (arr) => arr[Math.floor(Math.random() * arr.length)];
const isNum = (v) => typeof v === 'number' && Number.isFinite(v);
const uid = () => (crypto?.randomUUID ? crypto.randomUUID() : 'id-' + Math.random().toString(36).slice(2) + Date.now().toString(36));
const fmt = (n) => (n >= 1e6 ? (n / 1e6).toFixed(1) + 'M' : n >= 1e4 ? (n / 1e3).toFixed(1) + 'K' : String(Math.floor(n)));
const genCode = (n = 5) => { const A = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789'; let s = ''; for (let i = 0; i < n; i++) s += A[Math.floor(Math.random() * A.length)]; return s; };
const cleanName = (s) => String(s || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^A-Za-z0-9 _\-!?.]/g, '').trim().slice(0, 12);

function polyArea(p) { let a = 0; for (let i = 0; i < p.length; i++) { const q = p[i], r = p[(i + 1) % p.length]; a += q.x * r.y - r.x * q.y; } return Math.abs(a) / 2; }
function centroid(p) { let x = 0, y = 0; for (const q of p) { x += q.x; y += q.y; } return { x: x / p.length, y: y / p.length }; }
function bounds(p) { let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity; for (const q of p) { x0 = Math.min(x0, q.x); y0 = Math.min(y0, q.y); x1 = Math.max(x1, q.x); y1 = Math.max(y1, q.y); } return { x0, y0, x1, y1, w: x1 - x0, h: y1 - y0 }; }
function inPoly(x, y, p) { let c = false; for (let i = 0, j = p.length - 1; i < p.length; j = i++) { const a = p[i], b = p[j]; if ((a.y > y) !== (b.y > y) && x < ((b.x - a.x) * (y - a.y)) / (b.y - a.y) + a.x) c = !c; } return c; }
/** Snijpunt segment p0-p1 met segment a-b → s (0..1 langs p0-p1) of -1 */
function segHit(p0x, p0y, p1x, p1y, ax, ay, bx, by) {
  const rx = p1x - p0x, ry = p1y - p0y, sx = bx - ax, sy = by - ay;
  const d = rx * sy - ry * sx; if (Math.abs(d) < 1e-9) return -1;
  const qx = ax - p0x, qy = ay - p0y;
  const t = (qx * sy - qy * sx) / d, u = (qx * ry - qy * rx) / d;
  return t >= 0 && t <= 1 && u >= 0 && u <= 1 ? t : -1;
}
function distSeg(px, py, ax, ay, bx, by) { const dx = bx - ax, dy = by - ay, l = dx * dx + dy * dy; let t = l ? ((px - ax) * dx + (py - ay) * dy) / l : 0; t = clamp(t, 0, 1); return Math.hypot(px - (ax + dx * t), py - (ay + dy * t)); }
const rectPts = (a, b) => [{ x: Math.min(a.x, b.x), y: Math.min(a.y, b.y) }, { x: Math.max(a.x, b.x), y: Math.min(a.y, b.y) }, { x: Math.max(a.x, b.x), y: Math.max(a.y, b.y) }, { x: Math.min(a.x, b.x), y: Math.max(a.y, b.y) }];
const toPx = (pts) => pts.map((q) => ({ x: q.x * W, y: q.y * H }));

// -----------------------------------------------------------------------------
// 3. PIXEL-LETTERTYPE (3×5) & SPRITES (gedeeld door beamer en telefoon)
// -----------------------------------------------------------------------------
const FONT = {
  A: '010101111101101', B: '110101110101110', C: '011100100100011', D: '110101101101110', E: '111100110100111', F: '111100110100100', G: '011100101101011',
  H: '101101111101101', I: '111010010010111', J: '001001001101010', K: '101101110101101', L: '100100100100111', M: '101111111101101', N: '110101101101101',
  O: '010101101101010', P: '110101110100100', Q: '010101101110011', R: '110101110101101', S: '011100010001110', T: '111010010010010', U: '101101101101111',
  V: '101101101101010', W: '101101111111101', X: '101101010101101', Y: '101101010010010', Z: '111001010100111',
  0: '111101101101111', 1: '010110010010111', 2: '110001010100111', 3: '110001010001110', 4: '101101111001001', 5: '111100110001110', 6: '011100111101111',
  7: '111001010010010', 8: '111101111101111', 9: '111101111001110', '+': '000010111010000', '-': '000000111000000', '!': '010010010000010', '.': '000000000000010',
  ':': '000010000010000', '?': '110001010000010', '/': '001001010100100', '%': '101001010100101', "'": '010010000000000', '(': '010100100100010', ')': '010001001001010',
  x: '000101010101000', ' ': '000000000000000', '#': '101111101111101', '<': '001010100010001', '>': '100010001010100', '=': '000111000111000', '_': '000000000000111', '*': '000101010101000'
};
function textWidth(str, s = 1) { return String(str).length * 4 * s - s; }
function drawText(ctx, str, x, y, color = '#fff', s = 1, shadow = '#000', align = 'left') {
  str = String(str).normalize('NFD').replace(/[\u0300-\u036f]/g, '').toUpperCase();
  if (align === 'center') x -= textWidth(str, s) / 2; else if (align === 'right') x -= textWidth(str, s);
  x = Math.round(x); y = Math.round(y);
  for (const pass of shadow ? [0, 1] : [1]) {
    ctx.fillStyle = pass ? color : shadow;
    const o = pass ? 0 : s;
    for (let i = 0; i < str.length; i++) {
      const g = FONT[str[i]] || FONT['?'];
      for (let b = 0; b < 15; b++) if (g.charCodeAt(b) === 49) ctx.fillRect(x + i * 4 * s + (b % 3) * s + o, y + Math.floor(b / 3) * s + o, s, s);
    }
  }
}

/**
 * Teken een katten-boogschutter. (x,y) = voeten. look = {fur,hat,cape}.
 * o = { facing, frame, aim (rad|null), pull (0..1), nocked, alpha }
 */
function drawCat(ctx, x, y, look, o = {}) {
  const f = (FURS[look.fur] || FURS.orange).c;
  const facing = o.facing || 1;
  x = Math.round(x); y = Math.round(y);
  const P = (dx, dy, w, h, c) => { ctx.fillStyle = c; ctx.fillRect(facing > 0 ? x + dx : x - dx - w, y + dy, w, h); };
  const walk = o.frame || 0;
  const cape = CAPES[look.cape]?.c;
  ctx.globalAlpha = o.alpha ?? 1;
  // staart (achter)
  const tw = Math.round(Math.sin((o.t || 0) * 3) * 1);
  P(-5, -6, 1, 3, f[0]); P(-6, -8 + tw, 1, 3, f[0]); P(-6, -9 + tw, 1, 1, f[2]);
  // cape
  if (cape) { P(-4, -9, 2, 7, cape); P(-5, -4, 1, 2, cape); }
  // benen
  const l1 = walk === 1 ? -1 : 0, l2 = walk === 3 ? -1 : 0;
  P(-2, -3 + l1, 2, 3 - (l1 ? 0 : 0), '#5a3d2b'); P(1, -3 + l2, 2, 3, '#5a3d2b');
  P(-2, -1, 2, 1, '#2b1d14'); P(1, -1, 2, 1, '#2b1d14');
  // tuniek
  P(-3, -9, 6, 6, '#3f7a3a'); P(-3, -9, 6, 1, '#5aa04f'); P(-3, -5, 6, 1, '#7a4b22'); P(0, -5, 1, 1, '#ffd23f');
  // hoofd
  P(-3, -15, 7, 6, f[0]); P(-2, -14, 5, 1, f[1]);
  if (look.fur === 'calico') { P(-3, -15, 3, 2, f[1]); P(2, -12, 2, 2, f[2]); }
  if (look.fur === 'siamese') { P(1, -12, 3, 3, f[2]); }
  // oren
  P(-3, -17, 2, 2, f[0]); P(2, -17, 2, 2, f[0]); P(-3, -16, 1, 1, '#ff9fb0'); P(3, -16, 1, 1, '#ff9fb0');
  // ogen, neus, snorharen
  const eye = look.fur === 'black' ? '#ffe14a' : '#2fd36b';
  P(0, -13, 1, 1, eye); P(2, -13, 1, 1, eye); P(3, -11, 1, 1, '#ff7fa0');
  P(4, -12, 2, 1, '#e8e8e8'); P(4, -10, 2, 1, '#e8e8e8');
  // hoed
  switch (look.hat) {
    case 'hood': P(-4, -16, 8, 2, '#2f6b2e'); P(-4, -14, 1, 4, '#2f6b2e'); P(-4, -18, 2, 2, '#2f6b2e'); P(2, -18, 2, 2, '#2f6b2e'); break;
    case 'feather': P(-3, -17, 7, 2, '#3f8a3a'); P(-4, -15, 9, 1, '#2b5e28'); P(-5, -21, 1, 4, '#d43a3a'); P(-4, -20, 1, 2, '#ff6b6b'); break;
    case 'helm': P(-4, -17, 9, 4, '#aeb6c2'); P(-4, -17, 9, 1, '#e3e8ef'); P(0, -14, 4, 1, '#5d6372'); P(-3, -19, 2, 2, '#aeb6c2'); P(2, -19, 2, 2, '#aeb6c2'); break;
    case 'wizard': P(-4, -16, 9, 1, '#4b2d9a'); P(-2, -19, 5, 3, '#5d3cc0'); P(-1, -22, 3, 3, '#5d3cc0'); P(0, -24, 2, 2, '#5d3cc0'); P(1, -18, 1, 1, '#ffd23f'); break;
    case 'crown': P(-3, -18, 7, 2, '#ffd23f'); P(-3, -19, 1, 1, '#ffd23f'); P(0, -19, 1, 1, '#ffd23f'); P(3, -19, 1, 1, '#ffd23f'); P(0, -18, 1, 1, '#ff3a5c'); break;
    case 'halo': P(-3, -21, 7, 1, '#fff6a8'); P(-4, -20, 1, 1, '#fff6a8'); P(4, -20, 1, 1, '#fff6a8'); break;
    default:
  }
  // boog (in wereldcoördinaten: richting = aim)
  const a = o.aim ?? (facing > 0 ? -0.3 : Math.PI + 0.3);
  const hx = x + 4 * facing, hy = y - 9;
  const ca = Math.cos(a), sa = Math.sin(a);
  const pull = clamp(o.pull || 0, 0, 1);
  ctx.fillStyle = '#9b6a3a';
  for (let i = -6; i <= 6; i++) {
    const bend = 2.6 - (i * i) / 14;               // gebogen hout, bolle kant naar voren
    ctx.fillRect(Math.round(hx + ca * bend - sa * i), Math.round(hy + sa * bend + ca * i), 1, 1);
  }
  // pees
  const nx = hx - ca * (pull * 4), ny = hy - sa * (pull * 4);
  ctx.fillStyle = '#e8e2d0';
  for (const end of [-6, 6]) {
    const ex = hx + ca * (2.6 - 36 / 14) - sa * end, ey = hy + sa * (2.6 - 36 / 14) + ca * end;
    for (let k = 0; k <= 6; k++) ctx.fillRect(Math.round(lerp(ex, nx, k / 6)), Math.round(lerp(ey, ny, k / 6)), 1, 1);
  }
  if (o.nocked) drawArrowSprite(ctx, nx + ca * 8, ny + sa * 8, a, o.fletch || '#d8d8d8', 8);
  // pootje aan de boog
  ctx.fillStyle = f[0]; ctx.fillRect(Math.round(hx), Math.round(hy), 2, 2);
  ctx.globalAlpha = 1;
}

/** Klein kitten-huisdier (x,y = voeten) */
function drawKitten(ctx, x, y, furKey, facing = 1, t = 0, sit = false) {
  const f = (FURS[furKey] || FURS.grey).c;
  x = Math.round(x); y = Math.round(y);
  const P = (dx, dy, w, h, c) => { ctx.fillStyle = c; ctx.fillRect(facing > 0 ? x + dx : x - dx - w, y + dy, w, h); };
  const b = sit ? 0 : Math.round(Math.abs(Math.sin(t * 10)));
  P(-3, -4 - b, 5, 3, f[0]); P(1, -6 - b, 3, 3, f[0]); P(1, -7 - b, 1, 1, f[0]); P(3, -7 - b, 1, 1, f[0]);
  P(2, -5 - b, 1, 1, '#2fd36b'); P(-4, -6 - b + Math.round(Math.sin(t * 4)), 1, 3, f[2]);
  P(-3, -1, 1, 1, f[2]); P(1, -1, 1, 1, f[2]);
}

/** Pijl: (x,y) = punt, a = vliegrichting */
function drawArrowSprite(ctx, x, y, a, fletch = '#d8d8d8', len = 9) {
  const c = Math.cos(a), s = Math.sin(a);
  ctx.fillStyle = '#c9a26b';
  for (let i = 1; i < len; i++) ctx.fillRect(Math.round(x - c * i), Math.round(y - s * i), 1, 1);
  ctx.fillStyle = '#e9eef5'; ctx.fillRect(Math.round(x), Math.round(y), 1, 1); ctx.fillRect(Math.round(x - c), Math.round(y - s), 1, 1);
  ctx.fillStyle = fletch;
  for (let i = len - 2; i <= len; i++) {
    ctx.fillRect(Math.round(x - c * i - s), Math.round(y - s * i + c), 1, 1);
    ctx.fillRect(Math.round(x - c * i + s), Math.round(y - s * i - c), 1, 1);
  }
}

// -----------------------------------------------------------------------------
// 4. SPELERSPROFIEL & AFGELEIDE WAARDEN
// -----------------------------------------------------------------------------
function newProfile(id, name) {
  return {
    id, name: cleanName(name) || 'KAT', fur: 'orange', hat: 'none', cape: 'none', pet: 'none', arrow: 'wood',
    level: 1, xp: 0, gold: 0, upgrades: {}, admin: false,
    stats: { shots: 0, hits: 0, best: 0, splits: 0, earned: 0, balloons: 0, mice: 0, bestCombo: 0 },
    created: Date.now(), seen: Date.now()
  };
}
function statsOf(pr) {
  const u = (k) => pr.upgrades[k] | 0;
  const ar = ARROWS[pr.arrow] || ARROWS.wood;
  return {
    reload: CFG.baseReload * Math.pow(0.9, u('reload')),
    maxArrows: 1 + u('quiver'),
    vMax: CFG.vMax * (1 + 0.06 * u('power')),
    wobble: CFG.wobbleBase * Math.pow(0.86, u('steady')),
    walk: CFG.walkSpeed * (1 + 0.12 * u('feet')),
    goldMult: (1 + 0.08 * u('greed')) * (ar.gold || 1),
    xpMult: (1 + 0.1 * u('wisdom')) * (ar.xp || 1),
    crit: 0.03 * u('crit') + (ar.crit || 0),
    multishot: u('multishot'),
    hunter: 1 + 0.25 * u('hunter'),
    gravity: CFG.gravity * (ar.grav || 1),
    split: ar.split || 4,
    comboWindow: CFG.comboWindow + u('combo')
  };
}
/** Kan deze speler deze upgrade kopen? → { ok, reason, cost } */
function canBuy(pr, id) {
  const up = UPGRADES[id]; if (!up) return { ok: false, reason: 'Onbekend' };
  const n = pr.upgrades[id] | 0;
  if (n >= up.max) return { ok: false, reason: 'Maximaal', cost: 0 };
  const cost = upgradeCost(id, n);
  if (pr.level < up.lvl) return { ok: false, reason: `Level ${up.lvl} nodig`, cost };
  for (const [rid, rn] of Object.entries(up.req || {})) if ((pr.upgrades[rid] | 0) < rn) return { ok: false, reason: `Eerst ${UPGRADES[rid].name} ${rn}`, cost };
  if (pr.gold < cost) return { ok: false, reason: 'Te weinig goud', cost };
  return { ok: true, cost };
}
function unlocksAt(level) {
  const out = [];
  const add = (tbl, kind) => { for (const [k, v] of Object.entries(tbl)) if (v.lvl === level) out.push(`${kind}: ${v.name}`); };
  add(ARROWS, 'Pijl'); add(HATS, 'Hoed'); add(CAPES, 'Cape'); add(PETS, 'Huisdier'); add(FURS, 'Vacht');
  for (const [k, v] of Object.entries(UPGRADES)) if (v.lvl === level && level > 1) out.push(`Upgrade: ${v.name}`);
  return out;
}

// -----------------------------------------------------------------------------
// 5. SPELKERN (draait alleen op de beamer/host; puur rekenwerk, geen tekenen)
// -----------------------------------------------------------------------------
class Game {
  constructor(save) {
    const s = save && typeof save === 'object' ? save : {};
    this.world = {
      code: typeof s.world?.code === 'string' ? s.world.code : genCode(),
      pin: typeof s.world?.pin === 'string' ? s.world.pin : String(Math.floor(1000 + Math.random() * 9000)),
      zones: Array.isArray(s.world?.zones) ? s.world.zones.filter(validZone) : [],
      nextZone: isNum(s.world?.nextZone) ? s.world.nextZone : 1,
      settings: Object.assign({ decor: true, grid: false, names: true, board: true, labels: false, qr: 'auto', fit: 'letterbox', volume: 0.6 }, s.world?.settings || {})
    };
    this.profiles = {};
    for (const [id, p] of Object.entries(s.profiles || {})) this.profiles[id] = sanitizeProfile(p);
    this.players = new Map();       // online spelers (runtime)
    this.arrows = [];               // vliegend + vastzittend
    this.balloons = [];
    this.mouse = null;
    this.events = [];               // voor renderer/geluid
    this.outbox = [];               // [playerId, bericht]
    this.flash = new Map();         // zoneId → tijd
    this.draw = { active: false, type: 'target', tool: 'rect', pts: [], cursor: { x: 0.5, y: 0.5 }, by: null };
    this.t = 0;
    this.balloonT = rand(...CFG.balloonEvery);
    this.mouseT = rand(...CFG.mouseEvery);
    this.dirty = false;
    this.zoneCache = new Map();
    this.rebuildZones();
  }

  // ---------- opslag ----------
  serialize() { return { version: VERSION, world: this.world, profiles: this.profiles }; }
  rebuildZones() {
    this.zonePx = this.world.zones.map((z) => {
      const p = toPx(z.pts); const b = bounds(p);
      return { z, p, b, area: z.shape === 'line' ? 0 : polyArea(p), c: centroid(p) };
    });
    this.platforms = this.zonePx.filter((q) => q.z.type === 'platform').map((q) => {
      const [a, b] = q.p[0].x <= q.p[1].x ? [q.p[0], q.p[1]] : [q.p[1], q.p[0]];
      return { id: q.z.id, a, b, len: Math.hypot(b.x - a.x, b.y - a.y) };
    });
    if (!this.platforms.length) this.platforms = [{ id: 'ground', a: { x: W * 0.04, y: H * 0.93 }, b: { x: W * 0.96, y: H * 0.93 }, len: W * 0.92, virtual: true }];
    for (const p of this.players.values()) if (!this.platforms.find((q) => q.id === p.platform)) this.placeOnPlatform(p, this.nearestPlatform(p.x, p.y));
    this.dirty = true;
  }

  // ---------- spelers ----------
  profileFor(id) { return this.profiles[id]; }
  join(id, name, fur) {
    if (typeof id !== 'string' || id.length > 64) return null;
    let pr = this.profiles[id];
    if (!pr) { pr = this.profiles[id] = newProfile(id, name); if (FURS[fur] && FURS[fur].lvl <= 1) pr.fur = fur; }
    else if (name) pr.name = cleanName(name) || pr.name;
    pr.seen = Date.now();
    let p = this.players.get(id);
    if (!p) {
      const st = statsOf(pr);
      p = { id, platform: null, u: 0.5, x: W / 2, y: H * 0.9, dir: 0, moveT: 0, facing: 1, arrows: Math.min(1, st.maxArrows), reloadT: 0, aim: null,
        phase: Math.random() * 6.28, combo: 0, comboT: 0, jump: null, online: true, offT: 0, walkAnim: 0, shootAnim: 0, pet: { x: 0, y: 0 } };
      const plats = this.platforms;
      const pl = plats[this.players.size % plats.length];
      this.players.set(id, p);
      this.placeOnPlatform(p, pl, rand(0.15, 0.85));
      p.pet.x = p.x - 8; p.pet.y = p.y;
      this.events.push({ k: 'join', x: p.x, y: p.y, id });
    }
    p.online = true; p.offT = 0;
    this.dirty = true;
    return pr;
  }
  leave(id) { const p = this.players.get(id); if (p) { p.online = false; p.aim = null; p.dir = 0; } }

  placeOnPlatform(p, pl, u) {
    p.platform = pl.id;
    p.u = u ?? clamp(pl.len ? ((p.x - pl.a.x) / (pl.b.x - pl.a.x || 1)) : 0.5, 0, 1);
    p.x = lerp(pl.a.x, pl.b.x, p.u); p.y = lerp(pl.a.y, pl.b.y, p.u);
  }
  nearestPlatform(x, y) {
    let best = this.platforms[0], bd = Infinity;
    for (const pl of this.platforms) { const d = distSeg(x, y, pl.a.x, pl.a.y, pl.b.x, pl.b.y); if (d < bd) { bd = d; best = pl; } }
    return best;
  }
  platformAt(id) { return this.platforms.find((q) => q.id === id) || this.platforms[0]; }

  /** Spring naar platform erboven (-1) of eronder (+1) dat onder dezelfde x ligt */
  jump(p, d) {
    if (p.jump) return false;
    const cur = this.platformAt(p.platform);
    let best = null, bestDy = Infinity;
    for (const pl of this.platforms) {
      if (pl === cur) continue;
      const x = clamp(p.x, pl.a.x, pl.b.x);
      if (Math.abs(x - p.x) > 14) continue;
      const u = (x - pl.a.x) / (pl.b.x - pl.a.x || 1);
      const y = lerp(pl.a.y, pl.b.y, u);
      const dy = (y - p.y) * d;
      if (dy > 3 && dy < bestDy) { bestDy = dy; best = { pl, x, y, u }; }
    }
    if (!best) return false;
    p.jump = { t: 0, dur: 0.45, x0: p.x, y0: p.y, x1: best.x, y1: best.y, pl: best.pl.id, u: best.u };
    this.events.push({ k: 'jump', x: p.x, y: p.y });
    return true;
  }

  // ---------- schieten ----------
  aimAngle(p, a) { const pr = this.profiles[p.id]; return a + Math.sin(this.t * CFG.wobbleSpeed + p.phase) * statsOf(pr).wobble; }
  shoot(p, a, power) {
    const pr = this.profiles[p.id];
    if (!pr || p.arrows < 1 || p.jump) return false;
    if (!isNum(a) || !isNum(power)) return false;
    const st = statsOf(pr);
    const ang = this.aimAngle(p, a);
    const v = lerp(CFG.vMin, st.vMax, clamp(power, 0, 1));
    p.arrows -= 1;
    p.facing = Math.cos(ang) >= 0 ? 1 : -1;
    p.shootAnim = 0.25;
    p.aim = null;
    pr.stats.shots++;
    const ox = p.x + 2 * p.facing, oy = p.y - 8;
    const spread = [0];
    for (let i = 1; i <= st.multishot; i++) spread.push(i % 2 ? 0.07 * Math.ceil(i / 2) : -0.07 * Math.ceil(i / 2));
    for (const off of spread) {
      this.arrows.push({ owner: p.id, type: pr.arrow, x: ox, y: oy, sx: ox, sy: oy, vx: Math.cos(ang + off) * v, vy: Math.sin(ang + off) * v,
        g: st.gravity, state: 'fly', t: 0, a: ang + off, life: 0, zone: null, bonus: off !== 0 });
    }
    this.events.push({ k: 'shoot', x: ox, y: oy, id: p.id });
    this.dirty = true;
    return true;
  }

  /** Eerste botsing van segment (x0,y0)→(x1,y1) */
  collide(x0, y0, x1, y1) {
    let best = null;
    for (const q of this.zonePx) {
      if (q.z.type === 'pond') continue;
      if (x1 < q.b.x0 - 2 && x0 < q.b.x0 - 2) continue;
      if (x1 > q.b.x1 + 2 && x0 > q.b.x1 + 2) continue;
      const n = q.z.shape === 'line' ? 1 : q.p.length;
      for (let i = 0; i < n; i++) {
        const a = q.p[i], b = q.p[(i + 1) % q.p.length];
        const s = segHit(x0, y0, x1, y1, a.x, a.y, b.x, b.y);
        if (s >= 0 && (!best || s < best.s)) best = { s, q };
      }
    }
    for (const bl of this.balloons) {
      if (bl.popped) continue;
      if (distSeg(bl.x, bl.y, x0, y0, x1, y1) < 5.5) {
        const s = clamp(Math.hypot(bl.x - x0, bl.y - y0) / (Math.hypot(x1 - x0, y1 - y0) || 1), 0, 1);
        if (!best || s < best.s) best = { s, balloon: bl };
      }
    }
    if (this.mouse && distSeg(this.mouse.x, this.mouse.y - 2, x0, y0, x1, y1) < 4.5) {
      const s = clamp(Math.hypot(this.mouse.x - x0, this.mouse.y - y0) / (Math.hypot(x1 - x0, y1 - y0) || 1), 0, 1);
      if (!best || s < best.s) best = { s, mouse: true };
    }
    return best;
  }

  reward(p, pr, base, ar, hitX, hitY, tags) {
    const st = statsOf(pr);
    const dist = Math.hypot(hitX - ar.sx, hitY - ar.sy);
    const distMult = 1 + Math.pow(dist / 120, 1.25);
    let mult = base.mult * distMult * st.goldMult;
    if (base.combo) {
      p.combo = (p.combo || 0) + 1; p.comboT = st.comboWindow;
      mult *= 1 + 0.1 * Math.min(p.combo - 1, 10);
      pr.stats.bestCombo = Math.max(pr.stats.bestCombo, p.combo);
    }
    if (Math.random() < st.crit) { mult *= 3; tags.push('CRIT'); }
    const gold = Math.max(1, Math.round(base.gold * mult));
    const xp = Math.max(1, Math.round(gold * st.xpMult));
    pr.gold += gold; pr.stats.earned += gold; pr.stats.best = Math.max(pr.stats.best, gold);
    this.addXp(p, pr, xp);
    this.outbox.push([p.id, { t: 'reward', gold, xp, tags, combo: p.combo, dist: Math.round(dist) }]);
    this.dirty = true;
    return { gold, xp, dist };
  }

  addXp(p, pr, xp) {
    pr.xp += xp;
    while (pr.level < MAX_LEVEL && pr.xp >= xpNeed(pr.level)) {
      pr.xp -= xpNeed(pr.level); pr.level++;
      const un = unlocksAt(pr.level);
      this.events.push({ k: 'levelup', id: p.id, level: pr.level, x: p.x, y: p.y });
      this.outbox.push([p.id, { t: 'levelup', level: pr.level, unlocks: un }]);
    }
  }

  miss(p) { if (p && p.combo) { p.combo = 0; this.outbox.push([p.id, { t: 'miss' }]); } }

  stick(ar, x, y, zoneId) {
    ar.state = 'stuck'; ar.x = x; ar.y = y; ar.life = 0; ar.zone = zoneId;
    ar.a = Math.atan2(ar.vy, ar.vx);
    const stuck = this.arrows.filter((q) => q.state === 'stuck');
    if (stuck.length > CFG.maxStuck) { stuck[0].state = 'fall'; stuck[0].vx = 0; stuck[0].vy = 0; }
  }

  updateArrow(ar, dt) {
    if (ar.state === 'stuck') {
      ar.life += dt;
      if (ar.life > (this.world.settings.arrowLife || CFG.arrowLife)) { ar.state = 'fall'; ar.vx = rand(-10, 10); ar.vy = -20; ar.spin = rand(-8, 8); ar.life = 0; }
      return;
    }
    if (ar.state === 'fall') {
      ar.life += dt; ar.vy += 300 * dt; ar.x += ar.vx * dt; ar.y += ar.vy * dt; ar.a += (ar.spin || 4) * dt;
      if (ar.y > H + 20 || ar.life > 3) ar.dead = true;
      return;
    }
    ar.t += dt;
    const steps = Math.max(1, Math.ceil((Math.hypot(ar.vx, ar.vy) * dt) / 3));
    const h = dt / steps;
    for (let i = 0; i < steps && ar.state === 'fly'; i++) {
      const x0 = ar.x, y0 = ar.y;
      ar.vy += ar.g * h;
      const x1 = x0 + ar.vx * h, y1 = y0 + ar.vy * h;
      ar.a = Math.atan2(ar.vy, ar.vx);
      const hit = ar.t > 0.04 ? this.collide(x0, y0, x1, y1) : null;
      if (hit) { this.onHit(ar, hit, lerp(x0, x1, hit.s), lerp(y0, y1, hit.s)); return; }
      ar.x = x1; ar.y = y1;
    }
    if (ar.x < -30 || ar.x > W + 30 || ar.y > H + 30 || ar.t > 8) { ar.dead = true; if (!ar.bonus) this.miss(this.players.get(ar.owner)); this.events.push({ k: 'lost' }); }
  }

  onHit(ar, hit, x, y) {
    const p = this.players.get(ar.owner), pr = this.profiles[ar.owner];
    if (hit.balloon) {
      hit.balloon.popped = true; ar.dead = true;
      if (p && pr) {
        const tags = ['VIS!'];
        const r = this.reward(p, pr, { gold: 25 * statsOf(pr).hunter, mult: 1, combo: true }, ar, x, y, tags);
        pr.stats.balloons++; pr.stats.hits++;
        this.events.push({ k: 'balloon', x, y, gold: r.gold, tags, id: ar.owner });
      }
      return;
    }
    if (hit.mouse) {
      const m = this.mouse; this.mouse = null; ar.dead = true;
      if (p && pr) {
        const tags = ['GOUDEN MUIS!'];
        const r = this.reward(p, pr, { gold: 120 * statsOf(pr).hunter, mult: 1, combo: true }, ar, x, y, tags);
        pr.stats.mice++; pr.stats.hits++;
        this.events.push({ k: 'mouse', x: m.x, y: m.y, gold: r.gold, tags, id: ar.owner });
      }
      return;
    }
    const q = hit.q;
    // een pijltje terugzetten zodat het mooi in de rand steekt
    const sp = Math.hypot(ar.vx, ar.vy) || 1;
    const px = x + (ar.vx / sp) * 1.5, py = y + (ar.vy / sp) * 1.5;
    if (q.z.type === 'target' && p && pr) {
      const tags = [];
      let splitMult = 1;
      for (const o of this.arrows) {
        if (o.state === 'stuck' && o.zone === q.z.id && Math.hypot(o.x - px, o.y - py) < CFG.splitRadius) {
          o.state = 'fall'; o.vx = rand(-30, 30); o.vy = -60; o.spin = rand(-12, 12); o.life = 0;
          splitMult = statsOf(pr).split; tags.push('PIJL IN PIJL!'); pr.stats.splits++;
          break;
        }
      }
      const sizeMult = clamp(Math.sqrt(CFG.sizeRef / Math.max(q.area, 1)), 0.6, 3.5);
      const r = this.reward(p, pr, { gold: CFG.baseGold * sizeMult * (q.z.mult || 1) * splitMult, mult: 1, combo: true }, ar, px, py, tags);
      pr.stats.hits++;
      this.flash.set(q.z.id, 0.18);
      this.stick(ar, px, py, q.z.id);
      this.events.push({ k: 'hit', x: px, y: py, gold: r.gold, tags, id: ar.owner, zone: q.z.id, combo: p.combo, type: ar.type, dist: r.dist });
    } else {
      this.stick(ar, px, py, q.z.id);
      if (!ar.bonus) this.miss(p);
      this.events.push({ k: 'thunk', x: px, y: py, type: q.z.type });
    }
  }

  // ---------- bonusdoelen ----------
  updateBonus(dt) {
    const ponds = this.zonePx.filter((q) => q.z.type === 'pond');
    this.balloonT -= dt;
    if (this.balloonT <= 0 && ponds.length && this.players.size) {
      this.balloonT = rand(...CFG.balloonEvery);
      const q = pick(ponds);
      if (this.balloons.filter((b) => b.pond === q.z.id).length < 4) {
        for (let i = 0; i < 12; i++) {
          const x = rand(q.b.x0, q.b.x1), y = rand(q.b.y0, q.b.y1);
          if (inPoly(x, y, q.p)) { this.balloons.push({ x, y, x0: x, vy: rand(-16, -10), ph: Math.random() * 6, pond: q.z.id, t: 0, color: pick(['#ff4f6d', '#4fc3ff', '#ffd23f', '#b26bff']) }); this.events.push({ k: 'bubble', x, y }); break; }
        }
      }
    }
    for (const b of this.balloons) { b.t += dt; b.y += b.vy * dt; b.x = b.x0 + Math.sin(b.t * 1.6 + b.ph) * 6; if (b.y < -15) b.dead = true; if (b.popped) b.dead = true; }
    this.balloons = this.balloons.filter((b) => !b.dead);

    this.mouseT -= dt;
    if (!this.mouse && this.mouseT <= 0 && this.players.size) {
      this.mouseT = rand(...CFG.mouseEvery);
      const pl = pick(this.platforms);
      const dir = Math.random() < 0.5 ? 1 : -1;
      this.mouse = { pl: pl.id, u: dir > 0 ? 0 : 1, dir, x: 0, y: 0, t: 0 };
      this.events.push({ k: 'mouseSpawn' });
    }
    if (this.mouse) {
      const m = this.mouse, pl = this.platformAt(m.pl);
      m.t += dt; m.u += (m.dir * 48 * dt) / (pl.len || 1);
      m.x = lerp(pl.a.x, pl.b.x, m.u); m.y = lerp(pl.a.y, pl.b.y, m.u);
      if (m.u < 0 || m.u > 1 || pl.id !== m.pl) this.mouse = null;
    }
  }

  // ---------- hoofdlus ----------
  update(dt) {
    dt = Math.min(dt, 0.1);
    this.t += dt;
    for (const [id, f] of this.flash) { const n = f - dt; if (n <= 0) this.flash.delete(id); else this.flash.set(id, n); }
    for (const p of this.players.values()) {
      const pr = this.profiles[p.id]; if (!pr) continue;
      const st = statsOf(pr);
      if (!p.online) { p.offT += dt; if (p.offT > CFG.offlineGrace) { this.players.delete(p.id); this.events.push({ k: 'leave', x: p.x, y: p.y }); } continue; }
      if (p.arrows < st.maxArrows) { p.reloadT += dt; if (p.reloadT >= st.reload) { p.arrows++; p.reloadT = 0; this.outbox.push([p.id, { t: 'reloaded' }]); } } else p.reloadT = 0;
      if (p.comboT > 0) { p.comboT -= dt; if (p.comboT <= 0 && p.combo) { p.combo = 0; } }
      p.shootAnim = Math.max(0, p.shootAnim - dt);
      if (p.jump) {
        const j = p.jump; j.t += dt; const k = clamp(j.t / j.dur, 0, 1);
        p.x = lerp(j.x0, j.x1, k); p.y = lerp(j.y0, j.y1, k) - Math.sin(k * Math.PI) * 18;
        if (k >= 1) { const pl = this.platformAt(j.pl); p.platform = pl.id; p.u = j.u; p.jump = null; p.x = j.x1; p.y = j.y1; this.events.push({ k: 'land', x: p.x, y: p.y }); }
      } else {
        p.moveT -= dt; if (p.moveT <= 0) p.dir = 0;
        const pl = this.platformAt(p.platform);
        if (pl.id !== p.platform) this.placeOnPlatform(p, pl);
        if (p.dir) {
          p.u = clamp(p.u + (p.dir * st.walk * dt) / (pl.len || 1), 0, 1);
          p.facing = p.dir; p.walkAnim += dt * 8;
        }
        p.x = lerp(pl.a.x, pl.b.x, p.u); p.y = lerp(pl.a.y, pl.b.y, p.u);
      }
      if (p.aim) { p.aim.age += dt; if (p.aim.age > 0.6) p.aim = null; else p.facing = Math.cos(p.aim.a) >= 0 ? 1 : -1; }
      // huisdier volgt
      if (pr.pet !== 'none') { const tx = p.x - 9 * p.facing; p.pet.x += (tx - p.pet.x) * Math.min(1, dt * 4); p.pet.y += (p.y - p.pet.y) * Math.min(1, dt * 6); }
    }
    for (const ar of this.arrows) this.updateArrow(ar, dt);
    this.arrows = this.arrows.filter((a) => !a.dead);
    this.updateBonus(dt);
  }

  /** Persoonlijke status voor de telefoon */
  personal(id) {
    const pr = this.profiles[id], p = this.players.get(id);
    if (!pr) return null;
    const st = statsOf(pr);
    return { t: 'me', profile: pr, arrows: p ? p.arrows : 0, max: st.maxArrows, reload: p ? p.reloadT / st.reload : 0, reloadTime: st.reload,
      combo: p ? p.combo : 0, need: xpNeed(pr.level), stats: st, draw: pr.admin ? this.draw : null };
  }

  // ---------- profielacties ----------
  buy(id, upId) {
    const pr = this.profiles[id]; if (!pr) return { ok: false, reason: 'Geen profiel' };
    const c = canBuy(pr, upId); if (!c.ok) return c;
    pr.gold -= c.cost; pr.upgrades[upId] = (pr.upgrades[upId] | 0) + 1;
    const p = this.players.get(id);
    if (p) this.events.push({ k: 'upgrade', x: p.x, y: p.y, id });
    this.dirty = true;
    return { ok: true, level: pr.upgrades[upId] };
  }
  setLook(id, look) {
    const pr = this.profiles[id]; if (!pr || !look) return;
    const ok = (tbl, v) => tbl[v] && tbl[v].lvl <= pr.level;
    if (typeof look.name === 'string' && cleanName(look.name)) pr.name = cleanName(look.name);
    if (ok(FURS, look.fur)) pr.fur = look.fur;
    if (ok(HATS, look.hat)) pr.hat = look.hat;
    if (ok(CAPES, look.cape)) pr.cape = look.cape;
    if (ok(PETS, look.pet)) pr.pet = look.pet;
    if (ok(ARROWS, look.arrow)) pr.arrow = look.arrow;
    this.dirty = true;
  }

  // ---------- zones tekenen / bewerken ----------
  drawStart(type, tool, by = 'host') {
    if (!ZONE_TYPES[type]) return false;
    if (!ZONE_TYPES[type].tools.includes(tool)) tool = ZONE_TYPES[type].tools[0];
    Object.assign(this.draw, { active: true, type, tool, pts: [], by, erase: false });
    return true;
  }
  drawErase(by = 'host') { Object.assign(this.draw, { active: true, erase: true, pts: [], by }); }
  drawCursor(x, y, rel) {
    const c = this.draw.cursor;
    if (rel) { c.x = clamp(c.x + clamp(x, -0.5, 0.5), 0, 1); c.y = clamp(c.y + clamp(y, -0.5, 0.5), 0, 1); }
    else { c.x = clamp(x, 0, 1); c.y = clamp(y, 0, 1); }
  }
  drawPoint() {
    const d = this.draw; if (!d.active) return { ok: false };
    const c = { ...d.cursor };
    if (d.erase) { const z = this.zoneAt(c.x * W, c.y * H); if (z) { this.deleteZone(z.id); return { ok: true, erased: true }; } return { ok: true, erased: false }; }
    if (d.tool === 'rect' || d.tool === 'line') { if (d.pts.length >= 2) d.pts = []; d.pts.push(c); if (d.pts.length === 2) return this.drawSave(); }
    else if (d.pts.length < 40) d.pts.push(c);
    return { ok: true };
  }
  drawUndo() { this.draw.pts.pop(); }
  drawCancel() { Object.assign(this.draw, { active: false, pts: [], erase: false }); }
  drawSave() {
    const d = this.draw; if (!d.active || d.erase) return { ok: false, reason: 'Niet aan het tekenen' };
    let pts;
    if (d.tool === 'rect') { if (d.pts.length < 2) return { ok: false, reason: 'Twee hoeken nodig' }; pts = rectPts(d.pts[0], d.pts[1]); }
    else if (d.tool === 'line') { if (d.pts.length < 2) return { ok: false, reason: 'Begin- en eindpunt nodig' }; pts = d.pts.slice(0, 2); }
    else { if (d.pts.length < 3) return { ok: false, reason: 'Minstens 3 punten nodig' }; pts = d.pts.slice(); }
    const z = { id: 'z' + this.world.nextZone++, type: d.type, shape: d.tool, pts: pts.map((q) => ({ x: q.x, y: q.y })), mult: 1, label: ZONE_TYPES[d.type].name };
    if (!validZone(z)) { d.pts = []; return { ok: false, reason: 'Vorm is te klein' }; }
    this.world.zones.push(z);
    d.pts = [];
    this.rebuildZones();
    this.events.push({ k: 'zone', id: z.id });
    return { ok: true, id: z.id };
  }
  zoneAt(x, y) {
    let best = null, ba = Infinity;
    for (const q of this.zonePx) {
      let hit;
      if (q.z.shape === 'line') hit = distSeg(x, y, q.p[0].x, q.p[0].y, q.p[1].x, q.p[1].y) < 4;
      else hit = inPoly(x, y, q.p);
      if (hit && q.area < ba) { best = q.z; ba = q.area; }
    }
    return best;
  }
  deleteZone(id) {
    const i = this.world.zones.findIndex((z) => z.id === id); if (i < 0) return;
    this.world.zones.splice(i, 1);
    for (const a of this.arrows) if (a.zone === id && a.state === 'stuck') { a.state = 'fall'; a.vx = 0; a.vy = 0; a.life = 0; }
    this.rebuildZones();
    this.events.push({ k: 'zoneDel' });
  }
  setZonePts(id, pts) {
    const z = this.world.zones.find((q) => q.id === id); if (!z) return;
    const nz = { ...z, pts: pts.map((q) => ({ x: clamp(q.x, 0, 1), y: clamp(q.y, 0, 1) })) };
    if (!validZone(nz)) return;
    z.pts = nz.pts;
    for (const a of this.arrows) if (a.zone === id && a.state === 'stuck') { a.state = 'fall'; a.vx = 0; a.vy = 0; a.life = 0; }
    this.rebuildZones();
  }
  setZoneProps(id, props) {
    const z = this.world.zones.find((q) => q.id === id); if (!z) return;
    if (isNum(props.mult)) z.mult = clamp(props.mult, 0.25, 5);
    if (typeof props.label === 'string') z.label = cleanName(props.label) || z.label;
    this.rebuildZones();
  }
}

function validZone(z) {
  if (!z || typeof z !== 'object' || !ZONE_TYPES[z.type] || !Array.isArray(z.pts)) return false;
  if (!z.pts.every((q) => q && isNum(q.x) && isNum(q.y))) return false;
  if (z.shape === 'line') { if (z.pts.length !== 2) return false; return Math.hypot((z.pts[0].x - z.pts[1].x) * W, (z.pts[0].y - z.pts[1].y) * H) >= 10; }
  if (z.shape !== 'rect' && z.shape !== 'poly') return false;
  if (z.pts.length < 3 || z.pts.length > 40) return false;
  const b = bounds(toPx(z.pts));
  return b.w >= 4 && b.h >= 4 && polyArea(toPx(z.pts)) >= 16;
}
function sanitizeProfile(p) {
  const base = newProfile(String(p.id || uid()), p.name);
  const pr = Object.assign(base, {
    fur: FURS[p.fur] ? p.fur : 'orange', hat: HATS[p.hat] ? p.hat : 'none', cape: CAPES[p.cape] ? p.cape : 'none',
    pet: PETS[p.pet] ? p.pet : 'none', arrow: ARROWS[p.arrow] ? p.arrow : 'wood',
    level: clamp(p.level | 0, 1, MAX_LEVEL), xp: Math.max(0, +p.xp || 0), gold: Math.max(0, +p.gold || 0), admin: !!p.admin,
    created: +p.created || Date.now(), seen: +p.seen || Date.now()
  });
  for (const k of Object.keys(UPGRADES)) if (p.upgrades && isNum(p.upgrades[k])) pr.upgrades[k] = clamp(p.upgrades[k] | 0, 0, UPGRADES[k].max);
  if (p.stats) for (const k of Object.keys(pr.stats)) if (isNum(p.stats[k])) pr.stats[k] = p.stats[k];
  return pr;
}

// -----------------------------------------------------------------------------
// 6. NETWERK  (PeerJS/WebRTC voor telefoons, BroadcastChannel voor lokale tabbladen)
// -----------------------------------------------------------------------------
class HostNet {
  constructor(code, { onMsg, onStatus, onClose }) {
    this.code = code; this.onMsg = onMsg; this.onStatus = onStatus; this.onClose = onClose;
    this.peer = null; this.bc = null; this.status = 'starting';
  }
  start() {
    try {
      this.bc = new BroadcastChannel('pa-' + this.code);
      this.bc.onmessage = (e) => {
        const m = e.data; if (!m || m.to || typeof m.from !== 'string') return;
        const conn = { kind: 'local', id: m.from, send: (obj) => this.bc.postMessage({ ...obj, to: m.from }) };
        this.onMsg(conn, m);
      };
    } catch { /* BroadcastChannel niet beschikbaar */ }
    if (typeof window.Peer !== 'function') { this.setStatus('nopeer'); return; }
    this.connectPeer();
  }
  connectPeer() {
    const peer = (this.peer = new window.Peer(PEER_PREFIX + this.code, { debug: 1 }));
    peer.on('open', () => this.setStatus('online'));
    peer.on('connection', (c) => {
      const conn = { kind: 'peer', c, send: (obj) => { try { if (c.open) c.send(obj); } catch { /* verbinding weg */ } } };
      c.on('data', (m) => { if (m && typeof m === 'object') this.onMsg(conn, m); });
      c.on('close', () => this.onClose(conn));
      c.on('error', () => this.onClose(conn));
    });
    peer.on('disconnected', () => { this.setStatus('reconnecting'); setTimeout(() => { if (!peer.destroyed) peer.reconnect(); }, 2000); });
    peer.on('error', (e) => {
      if (e.type === 'unavailable-id') this.setStatus('taken');
      else if (e.type === 'network' || e.type === 'server-error' || e.type === 'socket-error') { this.setStatus('reconnecting'); }
      else console.warn('[peer]', e.type, e);
    });
  }
  setStatus(s) { this.status = s; this.onStatus(s); }
  stop() { try { this.peer?.destroy(); } catch { /* */ } try { this.bc?.close(); } catch { /* */ } }
}

class ClientNet {
  constructor(code, local, myId, { onMsg, onStatus }) {
    this.code = code; this.local = local; this.myId = myId; this.onMsg = onMsg; this.onStatus = onStatus;
    this.conn = null; this.peer = null; this.status = 'connecting'; this.retry = null; this.lastMsg = 0;
  }
  start() {
    if (this.local) {
      this.bc = new BroadcastChannel('pa-' + this.code);
      this.bc.onmessage = (e) => { const m = e.data; if (m && m.to === this.myId) { this.lastMsg = Date.now(); if (this.status !== 'connected') this.setStatus('connected'); this.onMsg(m); } };
      this.sendRaw = (obj) => this.bc.postMessage({ ...obj, from: this.myId });
      this.onOpen?.();
      setInterval(() => { if (Date.now() - this.lastMsg > 4000 && this.status === 'connected') this.setStatus('reconnecting'); }, 1000);
      return;
    }
    if (typeof window.Peer !== 'function') { this.setStatus('nopeer'); return; }
    this.peer = new window.Peer({ debug: 1 });
    this.peer.on('open', () => this.dial());
    this.peer.on('error', (e) => {
      if (e.type === 'peer-unavailable') this.setStatus('nohost');
      else this.setStatus('reconnecting');
      this.scheduleRetry();
    });
    this.peer.on('disconnected', () => { setTimeout(() => { if (!this.peer.destroyed) this.peer.reconnect(); }, 1500); });
  }
  dial() {
    clearTimeout(this.retry);
    try { this.conn?.close(); } catch { /* */ }
    const c = (this.conn = this.peer.connect(PEER_PREFIX + this.code, { reliable: true, serialization: 'json' }));
    c.on('open', () => { this.setStatus('connected'); this.onOpen?.(); });
    c.on('data', (m) => { this.lastMsg = Date.now(); this.onMsg(m); });
    c.on('close', () => { if (this.conn === c) { this.setStatus('reconnecting'); this.scheduleRetry(); } });
    c.on('error', () => { if (this.conn === c) { this.setStatus('reconnecting'); this.scheduleRetry(); } });
    this.retry = setTimeout(() => { if (!c.open) { this.setStatus(this.status === 'nohost' ? 'nohost' : 'reconnecting'); this.dial(); } }, 8000);
  }
  scheduleRetry() {
    clearTimeout(this.retry);
    this.retry = setTimeout(() => { if (this.peer && !this.peer.destroyed && this.peer.open) this.dial(); }, 2500);
  }
  send(obj) {
    if (this.local) { this.sendRaw(obj); return true; }
    if (this.conn && this.conn.open) { try { this.conn.send(obj); return true; } catch { return false; } }
    return false;
  }
  setStatus(s) { if (this.status !== s) { this.status = s; this.onStatus(s); } }
}

// -----------------------------------------------------------------------------
// 7. BEAMER-WEERGAVE (Canvas 2D, 480×270 pixels, opgeschaald zonder smoothing)
// -----------------------------------------------------------------------------
const hash2 = (x, y) => { let h = (x * 374761393 + y * 668265263) | 0; h = (h ^ (h >>> 13)) * 1274126177; return ((h ^ (h >>> 16)) >>> 0) / 4294967296; };
const hexRgb = (h) => { const n = parseInt(h.slice(1), 16); return [(n >> 16) & 255, (n >> 8) & 255, n & 255]; };
const TARGET_RINGS = ['#ffd23f', '#ffd23f', '#e0303b', '#e0303b', '#2f7be0', '#2f7be0', '#24242c', '#24242c', '#f3ecd8', '#f3ecd8'].map(hexRgb);

class Renderer {
  constructor(canvas, game) {
    this.canvas = canvas; this.game = game;
    this.ctx = canvas.getContext('2d');
    this.buf = document.createElement('canvas'); this.buf.width = W; this.buf.height = H;
    this.b = this.buf.getContext('2d');
    this.view = { x: 0, y: 0, sx: 1, sy: 1 };
    this.zc = new Map();           // zone-textures
    this.parts = []; for (let i = 0; i < 500; i++) this.parts.push({ on: false });
    this.floaters = []; this.banners = [];
    this.stars = Array.from({ length: 70 }, () => ({ x: Math.floor(Math.random() * W), y: Math.floor(Math.random() * H * 0.7), p: Math.random() * 6, c: pick(['#ffffff', '#ffe9a8', '#bfe0ff']) }));
    this.qr = null; this.qrUrl = '';
    this.t = 0; this.shake = 0;
    this.overlay = { sel: null, hostTool: 'none', mouse: null };
  }
  resize() {
    const dpr = 1; // pixel-art: CSS-pixels zijn genoeg
    const cw = Math.floor(window.innerWidth * dpr), ch = Math.floor(window.innerHeight * dpr);
    if (this.canvas.width !== cw || this.canvas.height !== ch) { this.canvas.width = cw; this.canvas.height = ch; }
    const fit = this.game.world.settings.fit;
    if (fit === 'stretch') this.view = { x: 0, y: 0, sx: cw / W, sy: ch / H };
    else { const s = Math.min(cw / W, ch / H); this.view = { x: (cw - W * s) / 2, y: (ch - H * s) / 2, sx: s, sy: s }; }
  }
  toWorld(cx, cy) { const r = this.canvas.getBoundingClientRect(); const x = (cx - r.left) * (this.canvas.width / r.width), y = (cy - r.top) * (this.canvas.height / r.height); return { x: (x - this.view.x) / this.view.sx, y: (y - this.view.y) / this.view.sy }; }

  // ---------- effecten ----------
  spawn(o) { const p = this.parts.find((q) => !q.on) || this.parts[Math.floor(Math.random() * this.parts.length)]; Object.assign(p, { on: true, t: 0, g: 0, kind: 'px', s: 1, vx: 0, vy: 0 }, o); }
  burst(x, y, colors, n, sp = 60, o = {}) { for (let i = 0; i < n; i++) { const a = Math.random() * Math.PI * 2, v = sp * rand(0.3, 1); this.spawn({ x, y, vx: Math.cos(a) * v, vy: Math.sin(a) * v - 20, g: 120, life: rand(0.4, 0.9), c: pick(colors), ...o }); } }
  float(text, x, y, c = '#ffd23f', s = 1, life = 1.3) { this.floaters.push({ text, x, y, c, s, t: 0, life }); }
  banner(text, sub, c = '#ffd23f') { this.banners.push({ text, sub, c, t: 0, life: 2.8 }); }

  handleEvents(sfx) {
    const g = this.game;
    for (const e of g.events) {
      const pr = e.id ? g.profiles[e.id] : null;
      switch (e.k) {
        case 'shoot': sfx.play('twang'); break;
        case 'hit': {
          const big = e.tags.length || e.gold >= 40;
          this.burst(e.x, e.y, ['#ffd23f', '#fff6a8', '#ffffff', '#e0303b'], big ? 22 : 10, big ? 90 : 55);
          if (e.type === 'paw' || e.tags.includes('CRIT')) for (let i = 0; i < 5; i++) this.spawn({ kind: 'paw', x: e.x + rand(-10, 10), y: e.y + rand(-10, 10), vy: -10, life: 1.2, c: '#ffd23f' });
          if (e.type === 'catnip') this.burst(e.x, e.y, ['#7dff5a', '#c8ff9e'], 14, 50);
          this.float('+' + e.gold, e.x, e.y - 6, '#ffd23f', e.gold >= 100 ? 2 : 1);
          e.tags.forEach((tg, i) => this.float(tg, e.x, e.y - 16 - i * 8, tg === 'CRIT' ? '#ff5a5a' : '#7dff5a', 1, 1.6));
          if (e.combo >= 3) this.float('COMBO X' + e.combo, e.x, e.y + 6, '#ff9a3c', 1, 1);
          if (e.tags.includes('PIJL IN PIJL!')) { this.shake = 0.25; sfx.play('split'); }
          if (pr && pr.pet !== 'none') { const p = g.players.get(e.id); if (p) this.spawn({ kind: 'heart', x: p.pet.x, y: p.pet.y - 8, vy: -14, life: 1.1, c: '#ff6fb5' }); }
          sfx.play('thunk'); sfx.play(e.tags.length ? 'jackpot' : 'coin');
          if (e.combo >= 5 && e.combo % 5 === 0) sfx.play('meow');
          break;
        }
        case 'thunk': this.burst(e.x, e.y, e.type === 'platform' ? ['#6b4a2b', '#3f7a3a'] : ['#8c93a3', '#5d6372'], 5, 30); sfx.play('thunk'); break;
        case 'balloon':
          this.burst(e.x, e.y, ['#ff4f6d', '#4fc3ff', '#ffd23f', '#ffffff'], 20, 80);
          this.spawn({ kind: 'fish', x: e.x, y: e.y, vx: rand(-20, 20), vy: -40, g: 160, life: 2 });
          this.float('+' + e.gold, e.x, e.y - 8, '#4fc3ff', 2); this.float('VIS!', e.x, e.y - 22, '#ffffff');
          sfx.play('pop'); sfx.play('jackpot'); break;
        case 'mouse':
          this.burst(e.x, e.y, ['#ffd23f', '#fff6a8', '#ffffff'], 40, 120); this.shake = 0.35;
          this.float('+' + e.gold, e.x, e.y - 10, '#ffd23f', 3, 2); this.banner('GOUDEN MUIS!', pr ? pr.name : '', '#ffd23f');
          sfx.play('jackpot'); sfx.play('meow'); break;
        case 'mouseSpawn': this.banner('EEN GOUDEN MUIS!', 'SCHIET HEM VOOR VEEL GOUD', '#ffd23f'); sfx.play('squeak'); break;
        case 'levelup':
          this.banner((pr ? pr.name : '') + ' LEVEL ' + e.level + '!', 'NIEUWE UNLOCKS OP JE TELEFOON', '#7dff5a');
          for (let i = 0; i < 24; i++) this.spawn({ kind: 'paw', x: e.x + rand(-30, 30), y: e.y - rand(0, 40), vx: rand(-20, 20), vy: rand(-50, -10), g: 40, life: 1.8, c: pick(['#7dff5a', '#ffd23f', '#ff6fb5']) });
          sfx.play('levelup'); break;
        case 'upgrade': this.burst(e.x, e.y - 8, ['#4fc3ff', '#ffffff', '#b26bff'], 16, 50); this.float('UPGRADE!', e.x, e.y - 22, '#4fc3ff'); sfx.play('upgrade'); break;
        case 'join': this.burst(e.x, e.y - 6, ['#ffffff', '#ffd23f'], 18, 60); this.float(pr ? pr.name : 'NIEUW', e.x, e.y - 26, '#ffffff'); sfx.play('meow'); break;
        case 'leave': this.burst(e.x, e.y - 6, ['#8c93a3'], 12, 40); break;
        case 'land': this.burst(e.x, e.y, ['#c9b38a'], 4, 20); break;
        case 'zone': sfx.play('build'); break;
        case 'bubble': this.spawn({ x: e.x, y: e.y, vy: -15, life: 0.8, c: '#bfe0ff' }); break;
        default:
      }
    }
    g.events.length = 0;
  }

  // ---------- zone-texturen ----------
  zoneTex(q) {
    const key = q.z.id + JSON.stringify(q.z.pts) + q.z.type;
    const c = this.zc.get(q.z.id);
    if (c && c.key === key) return c;
    const b = q.b, x0 = Math.floor(b.x0) - 2, y0 = Math.floor(b.y0) - 2, w = Math.ceil(b.w) + 5, h = Math.ceil(b.h) + 5;
    const cv = document.createElement('canvas'); cv.width = Math.max(1, w); cv.height = Math.max(1, h);
    const cx = cv.getContext('2d');
    if (q.z.shape === 'line') {
      // platform: gras + aarde langs de lijn
      const [a, bb] = [q.p[0], q.p[1]];
      const steps = Math.max(1, Math.ceil(Math.abs(bb.x - a.x) + Math.abs(bb.y - a.y)));
      for (let i = 0; i <= steps; i++) {
        const px = Math.round(lerp(a.x, bb.x, i / steps)) - x0, py = Math.round(lerp(a.y, bb.y, i / steps)) - y0;
        const r = hash2(px, 7);
        cx.fillStyle = '#5c3d22'; cx.fillRect(px, py, 1, 3);
        cx.fillStyle = r > 0.5 ? '#4a3019' : '#6e4a2a'; cx.fillRect(px, py + 1, 1, 1);
        cx.fillStyle = r > 0.3 ? '#4fb84a' : '#3f9a3b'; cx.fillRect(px, py - 1, 1, 1);
        if (r > 0.72) { cx.fillStyle = '#6fd65f'; cx.fillRect(px, py - 2, 1, 1); }
        if (r > 0.97) { cx.fillStyle = pick(['#ff6fb5', '#ffd23f', '#ffffff']); cx.fillRect(px, py - 3, 1, 1); }
      }
    } else {
      const img = cx.createImageData(w, h), d = img.data;
      const inside = new Uint8Array(w * h);
      for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) inside[y * w + x] = inPoly(x + x0 + 0.5, y + y0 + 0.5, q.p) ? 1 : 0;
      const In = (x, y) => x >= 0 && y >= 0 && x < w && y < h && inside[y * w + x] === 1;
      let maxR = 1; for (const p of q.p) maxR = Math.max(maxR, Math.hypot(p.x - q.c.x, p.y - q.c.y));
      const rw = Math.max(1.5, maxR / 10);
      for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
        if (!In(x, y)) continue;
        const edge = !In(x - 1, y) || !In(x + 1, y) || !In(x, y - 1) || !In(x, y + 1);
        const edge2 = !edge && (!In(x - 2, y) || !In(x + 2, y) || !In(x, y - 2) || !In(x, y + 2));
        const n = hash2(x + x0, y + y0);
        let col;
        const wx = x + x0, wy = y + y0;
        switch (q.z.type) {
          case 'target': {
            if (edge) col = n > 0.5 ? [122, 75, 34] : [96, 58, 26];
            else if (edge2) col = [168, 112, 58];
            else { const ri = Math.min(9, Math.floor(Math.hypot(wx - q.c.x, wy - q.c.y) / rw)); col = TARGET_RINGS[ri].slice(); const k = 0.9 + n * 0.12; col = col.map((v) => Math.min(255, v * k)); }
            break;
          }
          case 'wall': {
            const row = Math.floor(wy / 4), off = row % 2 ? 4 : 0;
            const mortar = wy % 4 === 0 || (wx + off) % 9 === 0;
            const bc = hash2(Math.floor((wx + off) / 9), row);
            col = edge ? [60, 62, 72] : mortar ? [52, 54, 62] : bc > 0.6 ? [128, 132, 146] : bc > 0.3 ? [112, 116, 130] : [98, 101, 114];
            if (!mortar && n > 0.93) col = [70, 120, 70]; // mos
            break;
          }
          case 'pond': {
            const wave = Math.sin(wx * 0.5 + Math.floor(wy / 3) * 1.7) > 0.6 && wy % 3 === 0;
            col = edge ? (n > 0.5 ? [47, 138, 59] : [63, 154, 59]) : edge2 ? [26, 90, 130] : wave ? [110, 190, 245] : n > 0.5 ? [30, 90, 170] : [24, 74, 150];
            break;
          }
          default: col = [255, 0, 255];
        }
        const i = (y * w + x) * 4; d[i] = col[0]; d[i + 1] = col[1]; d[i + 2] = col[2]; d[i + 3] = 255;
      }
      cx.putImageData(img, 0, 0);
      if (q.z.type === 'pond') { cx.fillStyle = '#4fb84a'; for (let i = 0; i < q.p.length; i++) { const p = q.p[i]; cx.fillRect(Math.round(p.x) - x0, Math.round(p.y) - y0 - 3, 1, 3); } }
    }
    const tex = { key, cv, x0, y0 };
    this.zc.set(q.z.id, tex);
    return tex;
  }

  // ---------- QR op de muur ----------
  setQr(url) {
    if (url === this.qrUrl) return;
    this.qrUrl = url; this.qr = null;
    if (typeof window.qrcode !== 'function') return;
    try {
      const q = window.qrcode(0, 'M'); q.addData(url); q.make();
      const n = q.getModuleCount(), m = 2, cv = document.createElement('canvas');
      cv.width = cv.height = (n + 4) * m;
      const c = cv.getContext('2d'); c.fillStyle = '#ffffff'; c.fillRect(0, 0, cv.width, cv.height); c.fillStyle = '#000000';
      for (let r = 0; r < n; r++) for (let k = 0; k < n; k++) if (q.isDark(r, k)) c.fillRect((k + 2) * m, (r + 2) * m, m, m);
      this.qr = cv;
    } catch (e) { console.warn('QR mislukt', e); }
  }

  // ---------- frame ----------
  frame(dt, sfx) {
    this.t += dt;
    this.handleEvents(sfx);
    const g = this.game, b = this.b, st = g.world.settings;
    b.fillStyle = '#000'; b.fillRect(0, 0, W, H);
    if (st.decor) this.drawDecor(b);
    if (st.grid) { b.fillStyle = '#123'; for (let x = 0; x < W; x += 30) b.fillRect(x, 0, 1, H); for (let y = 0; y < H; y += 30) b.fillRect(0, y, W, 1); }

    // zones (vijvers onderop, platforms bovenop)
    const order = { pond: 0, wall: 1, target: 2, platform: 3 };
    const zs = [...g.zonePx].sort((a, c) => order[a.z.type] - order[c.z.type]);
    for (const q of zs) {
      const tex = this.zoneTex(q);
      b.drawImage(tex.cv, tex.x0, tex.y0);
      const fl = g.flash.get(q.z.id);
      if (fl) { b.globalAlpha = fl / 0.18; b.globalCompositeOperation = 'lighter'; b.drawImage(tex.cv, tex.x0, tex.y0); b.globalCompositeOperation = 'source-over'; b.globalAlpha = 1; }
      if (q.z.type === 'pond' && Math.random() < dt * 3) { const x = rand(q.b.x0, q.b.x1), y = rand(q.b.y0, q.b.y1); if (inPoly(x, y, q.p)) this.spawn({ x, y, life: 0.5, c: '#d6f0ff' }); }
      if (st.labels || this.overlay.hostTool !== 'none') drawText(b, q.z.label + (q.z.type === 'target' && q.z.mult !== 1 ? ' X' + q.z.mult : ''), q.c.x, q.b.y0 - 8, '#bfe0ff', 1, '#000', 'center');
    }
    if (g.platforms[0]?.virtual) { const pl = g.platforms[0]; b.fillStyle = '#1d3a1c'; b.fillRect(pl.a.x, pl.a.y, pl.b.x - pl.a.x, 1); }

    // ballonnen & muis
    for (const bl of g.balloons) {
      const x = Math.round(bl.x), y = Math.round(bl.y);
      b.fillStyle = '#e8e2d0'; b.fillRect(x, y + 5, 1, 5);
      b.fillStyle = bl.color; b.fillRect(x - 3, y - 4, 7, 8); b.fillRect(x - 2, y - 5, 5, 10);
      b.fillStyle = '#ffffff'; b.fillRect(x - 2, y - 3, 1, 2);
      // vis aan het touwtje
      b.fillStyle = '#9fd8ff'; b.fillRect(x - 2, y + 10, 5, 2); b.fillRect(x + 3, y + 9, 1, 4); b.fillStyle = '#000'; b.fillRect(x - 1, y + 10, 1, 1);
    }
    if (g.mouse) {
      const m = g.mouse, x = Math.round(m.x), y = Math.round(m.y), f = m.dir;
      const P = (dx, dy, w, h, c) => { b.fillStyle = c; b.fillRect(f > 0 ? x + dx : x - dx - w, y + dy, w, h); };
      const bob = Math.round(Math.abs(Math.sin(this.t * 18)));
      P(-3, -4 - bob, 6, 3, '#ffd23f'); P(2, -5 - bob, 2, 2, '#ffd23f'); P(3, -3 - bob, 1, 1, '#000'); P(-6, -3, 3, 1, '#ff9fb0'); P(1, -6 - bob, 1, 1, '#ffb0c0');
      if (Math.random() < 0.3) this.spawn({ x: m.x, y: m.y - 3, life: 0.6, c: '#fff6a8', vy: -10 });
    }

    // vastzittende & vallende pijlen
    for (const a of g.arrows) if (a.state !== 'fly') {
      b.globalAlpha = a.state === 'fall' ? Math.max(0, 1 - a.life / 1.5) : a.life > (st.arrowLife || CFG.arrowLife) - 3 ? 0.5 + 0.5 * Math.sin(this.t * 20) : 1;
      drawArrowSprite(b, a.x, a.y, a.a, ARROWS[a.type]?.fletch);
      b.globalAlpha = 1;
    }

    // spelers
    for (const p of g.players.values()) this.drawPlayer(b, p);

    // vliegende pijlen + spoor
    for (const a of g.arrows) if (a.state === 'fly') {
      const tr = ARROWS[a.type]?.trail;
      if (tr && Math.random() < 0.7) {
        const c = tr === 'yarn' ? `hsl(${(this.t * 300) % 360},90%,65%)` : tr === 'laser' ? '#ff3030' : tr === 'catnip' ? '#7dff5a' : tr === 'fish' ? '#9fd8ff' : '#ffd23f';
        this.spawn({ x: a.x - Math.cos(a.a) * 7, y: a.y - Math.sin(a.a) * 7, life: tr === 'laser' ? 0.25 : 0.5, c, kind: tr === 'fish' && Math.random() < 0.15 ? 'bone' : 'px' });
      }
      drawArrowSprite(b, a.x, a.y, a.a, ARROWS[a.type]?.fletch);
    }

    this.drawParticles(b, dt);
    this.drawFloaters(b, dt);
    if (st.board) this.drawBoard(b);
    this.drawEditor(b);
    this.drawQr(b);
    this.drawBanners(b, dt);

    // naar scherm
    const ctx = this.ctx;
    ctx.imageSmoothingEnabled = false;
    ctx.fillStyle = '#000'; ctx.fillRect(0, 0, this.canvas.width, this.canvas.height);
    let ox = 0, oy = 0;
    if (this.shake > 0) { this.shake -= dt; ox = rand(-2, 2) * this.view.sx * 0.5; oy = rand(-2, 2) * this.view.sy * 0.5; }
    ctx.drawImage(this.buf, Math.round(this.view.x + ox), Math.round(this.view.y + oy), Math.round(W * this.view.sx), Math.round(H * this.view.sy));
  }

  drawDecor(b) {
    for (const s of this.stars) { const tw = Math.sin(this.t * 1.5 + s.p); if (tw > -0.3) { b.fillStyle = s.c; b.globalAlpha = 0.25 + 0.35 * (tw + 0.3); b.fillRect(s.x, s.y, 1, 1); } }
    b.globalAlpha = 1;
    // maan
    b.fillStyle = '#20222e'; for (let y = -9; y <= 9; y++) { const w = Math.round(Math.sqrt(81 - y * y)); b.fillRect(W - 46 - w, 26 + y, w * 2, 1); }
    b.fillStyle = '#181a24'; b.fillRect(W - 50, 22, 3, 3); b.fillRect(W - 42, 30, 2, 2);
    // kasteelsilhouet
    b.fillStyle = '#0a0b12';
    const base = H - 6;
    b.fillRect(20, base - 30, 40, 36); b.fillRect(14, base - 44, 12, 50); b.fillRect(54, base - 44, 12, 50);
    for (let i = 0; i < 4; i++) { b.fillRect(14 + i * 3, base - 47, 2, 3); b.fillRect(54 + i * 3, base - 47, 2, 3); }
    b.fillRect(30, base - 54, 20, 30); b.fillRect(38, base - 64, 4, 10);
    b.fillStyle = '#3a2a10'; b.fillRect(39, base - 40, 2, 3); b.fillRect(18, base - 34, 1, 2); // raampjes
    if (Math.sin(this.t * 3) > 0.2) { b.fillStyle = '#5a3d10'; b.fillRect(58, base - 34, 1, 2); }
  }

  drawPlayer(b, p) {
    const g = this.game, pr = g.profiles[p.id]; if (!pr) return;
    const st = statsOf(pr);
    const aim = p.aim ? g.aimAngle(p, p.aim.a) : null;
    const frame = p.dir && !p.jump ? Math.floor(p.walkAnim) % 4 : 0;
    const alpha = p.online ? 1 : 0.35;
    if (pr.pet !== 'none') drawKitten(b, p.pet.x, p.pet.y, PETS[pr.pet].fur, p.facing, this.t, !p.dir);
    drawCat(b, p.x, p.y, pr, { facing: p.facing, frame, aim, pull: p.aim ? p.aim.p : p.shootAnim > 0 ? 0 : 0.1, nocked: p.arrows >= 1 && !p.shootAnim, fletch: ARROWS[pr.arrow]?.fletch, alpha, t: this.t + p.phase });
    // richt-voorspelling: kort stukje baan
    if (aim !== null && p.arrows >= 1) {
      const v = lerp(CFG.vMin, st.vMax, p.aim.p);
      let x = p.x + 2 * p.facing, y = p.y - 8, vx = Math.cos(aim) * v, vy = Math.sin(aim) * v;
      const dur = 0.22 + 0.02 * (pr.upgrades.steady | 0);
      for (let t = 0, i = 0; t < dur; t += 0.02, i++) {
        vy += st.gravity * 0.02; x += vx * 0.02; y += vy * 0.02;
        if (i % 2 === 0) { b.fillStyle = i % 4 === 0 ? '#ffffff' : '#ffd23f'; b.globalAlpha = 1 - t / dur; b.fillRect(Math.round(x), Math.round(y), 1, 1); }
      }
      b.globalAlpha = 1;
    }
    if (g.world.settings.names) {
      const ny = p.y - (pr.hat === 'wizard' ? 34 : 28);
      drawText(b, pr.name, p.x, ny, p.online ? '#ffffff' : '#777', 1, '#000', 'center');
      drawText(b, 'LV' + pr.level, p.x, ny - 7, '#7dff5a', 1, '#000', 'center');
      // koker: gevulde pijltjes + herlaadbalk
      const n = st.maxArrows, w = n * 3 - 1, x0 = Math.round(p.x - w / 2);
      for (let i = 0; i < n; i++) { b.fillStyle = i < p.arrows ? '#ffd23f' : '#3a3a44'; b.fillRect(x0 + i * 3, ny + 7, 2, 2); }
      if (p.arrows < n) { b.fillStyle = '#4fc3ff'; b.fillRect(x0, ny + 10, Math.round(w * (p.reloadT / st.reload)), 1); }
      if (p.combo >= 2) drawText(b, 'X' + p.combo, p.x + 9, p.y - 12, '#ff9a3c', 1, '#000');
    }
  }

  drawParticles(b, dt) {
    for (const p of this.parts) {
      if (!p.on) continue;
      p.t += dt; if (p.t >= p.life) { p.on = false; continue; }
      p.vy += (p.g || 0) * dt; p.x += p.vx * dt; p.y += p.vy * dt;
      const k = 1 - p.t / p.life;
      b.globalAlpha = Math.min(1, k * 1.5);
      const x = Math.round(p.x), y = Math.round(p.y);
      b.fillStyle = p.c || '#fff';
      switch (p.kind) {
        case 'paw': b.fillRect(x - 1, y, 3, 2); b.fillRect(x - 2, y - 2, 1, 1); b.fillRect(x, y - 3, 1, 1); b.fillRect(x + 2, y - 2, 1, 1); break;
        case 'heart': b.fillRect(x - 2, y - 1, 2, 2); b.fillRect(x + 1, y - 1, 2, 2); b.fillRect(x - 1, y + 1, 3, 1); b.fillRect(x, y + 2, 1, 1); break;
        case 'fish': b.fillStyle = '#9fd8ff'; b.fillRect(x - 3, y, 5, 2); b.fillRect(x + 2, y - 1, 1, 4); b.fillStyle = '#000'; b.fillRect(x - 2, y, 1, 1); break;
        case 'bone': b.fillStyle = '#e8f4ff'; b.fillRect(x - 2, y, 5, 1); b.fillRect(x - 1, y - 1, 1, 3); b.fillRect(x + 1, y - 1, 1, 3); break;
        default: b.fillRect(x, y, p.s || 1, p.s || 1);
      }
    }
    b.globalAlpha = 1;
  }
  drawFloaters(b, dt) {
    for (const f of this.floaters) {
      f.t += dt;
      const k = f.t / f.life, pop = f.t < 0.12 ? 1 + (0.12 - f.t) * 4 : 1;
      b.globalAlpha = k > 0.7 ? (1 - k) / 0.3 : 1;
      drawText(b, f.text, f.x, f.y - f.t * 18, f.c, Math.round(f.s * pop) || 1, '#000', 'center');
    }
    b.globalAlpha = 1;
    this.floaters = this.floaters.filter((f) => f.t < f.life);
  }
  drawBanners(b, dt) {
    const bn = this.banners[0]; if (!bn) return;
    bn.t += dt;
    const k = bn.t / bn.life, a = k < 0.1 ? k / 0.1 : k > 0.85 ? (1 - k) / 0.15 : 1;
    b.globalAlpha = a;
    const y = 40 + Math.round(Math.sin(bn.t * 6) * 1);
    b.fillStyle = 'rgba(0,0,0,0.6)'; b.fillRect(0, y - 6, W, 34);
    drawText(b, bn.text, W / 2, y, bn.c, 3, '#000', 'center');
    if (bn.sub) drawText(b, bn.sub, W / 2, y + 20, '#ffffff', 1, '#000', 'center');
    b.globalAlpha = 1;
    if (bn.t >= bn.life) this.banners.shift();
  }
  drawBoard(b) {
    const g = this.game;
    const list = [...g.players.values()].filter((p) => p.online).map((p) => g.profiles[p.id]).filter(Boolean)
      .sort((a, c) => c.level - a.level || c.stats.earned - a.stats.earned).slice(0, 5);
    if (!list.length) return;
    drawText(b, 'TOP KATTEN', 6, 6, '#ffd23f', 1);
    list.forEach((pr, i) => drawText(b, `${i + 1} ${pr.name.slice(0, 8)} LV${pr.level}`, 6, 14 + i * 7, i === 0 ? '#ffffff' : '#aab', 1));
  }
  drawQr(b) {
    const g = this.game, mode = g.world.settings.qr;
    const online = [...g.players.values()].some((p) => p.online);
    if (mode === 'off' || (mode === 'auto' && online) || !this.qr) {
      if (mode !== 'off' && !this.qr && !online) drawText(b, 'CODE: ' + g.world.code, W / 2, H / 2, '#ffffff', 2, '#000', 'center');
      return;
    }
    const s = this.qr.width, x = W - s - 6, y = H - s - 16;
    b.fillStyle = '#ffd23f'; b.fillRect(x - 2, y - 2, s + 4, s + 4);
    b.drawImage(this.qr, x, y);
    drawText(b, 'SCAN & SPEEL', x + s / 2, y + s + 4, '#ffd23f', 1, '#000', 'center');
    if (!online) {
      drawText(b, 'PURRFECT AIM', W / 2, 70, '#ffd23f', 4, '#000', 'center');
      drawText(b, 'SCAN DE CODE MET JE TELEFOON OM MEE TE SCHIETEN', W / 2, 100, '#ffffff', 1, '#000', 'center');
      drawKitten(b, W / 2 - 12, 130, 'orange', 1, this.t, true); drawKitten(b, W / 2 + 12, 130, 'black', -1, this.t, true);
    }
  }
  drawEditor(b) {
    const g = this.game, d = g.draw, ov = this.overlay;
    if (ov.sel) {
      const q = g.zonePx.find((z) => z.z.id === ov.sel);
      if (q) {
        b.fillStyle = '#ffffff';
        for (let i = 0; i < (q.z.shape === 'line' ? 1 : q.p.length); i++) { const a = q.p[i], c = q.p[(i + 1) % q.p.length]; pixLine(b, a.x, a.y, c.x, c.y, Math.floor(this.t * 6) % 2 ? '#ffffff' : '#ffd23f'); }
        for (const p of q.p) { b.fillStyle = '#000'; b.fillRect(Math.round(p.x) - 2, Math.round(p.y) - 2, 5, 5); b.fillStyle = '#ffd23f'; b.fillRect(Math.round(p.x) - 1, Math.round(p.y) - 1, 3, 3); }
      }
    }
    if (!d.active) return;
    const cx = d.cursor.x * W, cy = d.cursor.y * H;
    const col = d.erase ? '#ff4f4f' : '#ffd23f';
    if (d.erase) { const z = g.zoneAt(cx, cy); if (z) { const q = g.zonePx.find((r) => r.z.id === z.id); for (let i = 0; i < (q.z.shape === 'line' ? 1 : q.p.length); i++) { const a = q.p[i], c = q.p[(i + 1) % q.p.length]; pixLine(b, a.x, a.y, c.x, c.y, '#ff4f4f'); } } }
    else {
      const pts = d.pts.map((q) => ({ x: q.x * W, y: q.y * H }));
      let shape = [...pts, { x: cx, y: cy }];
      if (d.tool === 'rect' && pts.length === 1) shape = toPx(rectPts(d.pts[0], d.cursor));
      for (let i = 0; i < shape.length - 1; i++) pixLine(b, shape[i].x, shape[i].y, shape[i + 1].x, shape[i + 1].y, col);
      if ((d.tool === 'rect' && pts.length === 1) || (d.tool === 'poly' && shape.length > 2)) pixLine(b, shape[shape.length - 1].x, shape[shape.length - 1].y, shape[0].x, shape[0].y, d.tool === 'poly' ? '#886a1f' : col);
      for (const p of pts) { b.fillStyle = '#fff'; b.fillRect(Math.round(p.x) - 1, Math.round(p.y) - 1, 3, 3); }
    }
    const pulse = 4 + Math.round(Math.sin(this.t * 8) * 1.5);
    b.fillStyle = col;
    b.fillRect(Math.round(cx) - pulse - 4, Math.round(cy), 5, 1); b.fillRect(Math.round(cx) + pulse, Math.round(cy), 5, 1);
    b.fillRect(Math.round(cx), Math.round(cy) - pulse - 4, 1, 5); b.fillRect(Math.round(cx), Math.round(cy) + pulse, 1, 5);
    b.fillRect(Math.round(cx), Math.round(cy), 1, 1);
    const info = d.erase ? 'WISSEN: TIK OP EEN VLAK' : `${ZONE_TYPES[d.type].name} - ${TOOLS[d.tool]} - ${d.pts.length} PUNT${d.pts.length === 1 ? '' : 'EN'}`;
    drawText(b, info, Math.min(W - 4, cx + 8), cy + 8, col, 1, '#000', cx > W - 120 ? 'right' : 'left');
  }
}
function pixLine(b, x0, y0, x1, y1, c) {
  b.fillStyle = c; const n = Math.max(1, Math.ceil(Math.max(Math.abs(x1 - x0), Math.abs(y1 - y0))));
  for (let i = 0; i <= n; i++) b.fillRect(Math.round(lerp(x0, x1, i / n)), Math.round(lerp(y0, y1, i / n)), 1, 1);
}

// -----------------------------------------------------------------------------
// 8. GELUID (gesynthetiseerd, geen bestanden nodig)
// -----------------------------------------------------------------------------
class Sfx {
  constructor() { this.ctx = null; this.vol = 0.6; this.last = {}; }
  unlock() {
    if (this.ctx) { this.ctx.resume?.(); return; }
    try { const AC = window.AudioContext || window.webkitAudioContext; if (!AC) return; this.ctx = new AC(); this.master = this.ctx.createGain(); this.master.gain.value = this.vol; this.master.connect(this.ctx.destination); } catch { this.ctx = null; }
  }
  setVolume(v) { this.vol = v; if (this.master) this.master.gain.value = v; }
  tone(f, d, { type = 'square', g = 0.15, to = null, at = 0, q = null } = {}) {
    const c = this.ctx, t = c.currentTime + at, o = c.createOscillator(), gn = c.createGain();
    o.type = type; o.frequency.setValueAtTime(f, t); if (to) o.frequency.exponentialRampToValueAtTime(to, t + d);
    gn.gain.setValueAtTime(0.0001, t); gn.gain.exponentialRampToValueAtTime(g, t + 0.01); gn.gain.exponentialRampToValueAtTime(0.0001, t + d);
    let node = o;
    if (q) { const fl = c.createBiquadFilter(); fl.type = 'lowpass'; fl.frequency.value = q; o.connect(fl); node = fl; }
    node.connect(gn).connect(this.master); o.start(t); o.stop(t + d + 0.05);
  }
  noise(d, g = 0.2, freq = 800) {
    const c = this.ctx, n = Math.floor(c.sampleRate * d), buf = c.createBuffer(1, n, c.sampleRate), ch = buf.getChannelData(0);
    for (let i = 0; i < n; i++) ch[i] = (Math.random() * 2 - 1) * (1 - i / n);
    const s = c.createBufferSource(), f = c.createBiquadFilter(), gn = c.createGain();
    s.buffer = buf; f.type = 'lowpass'; f.frequency.value = freq; gn.gain.value = g; s.connect(f).connect(gn).connect(this.master); s.start();
  }
  play(name) {
    if (!this.ctx || this.ctx.state !== 'running' || this.vol <= 0) return;
    const now = performance.now(); if (now - (this.last[name] || 0) < 40) return; this.last[name] = now;
    try {
      switch (name) {
        case 'twang': this.tone(320, 0.18, { type: 'triangle', to: 120, g: 0.2 }); this.noise(0.06, 0.08, 3000); break;
        case 'thunk': this.noise(0.08, 0.35, 500); this.tone(110, 0.08, { type: 'sine', g: 0.2, to: 60 }); break;
        case 'coin': this.tone(988, 0.07, { g: 0.08 }); this.tone(1319, 0.18, { g: 0.08, at: 0.06 }); break;
        case 'jackpot': [784, 988, 1175, 1568].forEach((f, i) => this.tone(f, 0.12, { g: 0.07, at: i * 0.06 })); break;
        case 'split': this.tone(1568, 0.3, { type: 'triangle', g: 0.12, to: 2093 }); break;
        case 'pop': this.noise(0.05, 0.4, 2500); break;
        case 'meow': { const c = this.ctx, t = c.currentTime, o = c.createOscillator(), g = c.createGain(), f = c.createBiquadFilter();
          o.type = 'sawtooth'; o.frequency.setValueAtTime(520, t); o.frequency.linearRampToValueAtTime(820, t + 0.12); o.frequency.linearRampToValueAtTime(480, t + 0.42);
          f.type = 'bandpass'; f.frequency.setValueAtTime(900, t); f.frequency.linearRampToValueAtTime(1800, t + 0.15); f.frequency.linearRampToValueAtTime(700, t + 0.42); f.Q.value = 3;
          g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(0.25, t + 0.05); g.gain.exponentialRampToValueAtTime(0.0001, t + 0.45);
          o.connect(f).connect(g).connect(this.master); o.start(t); o.stop(t + 0.5); break; }
        case 'squeak': this.tone(2400, 0.06, { type: 'sine', g: 0.1, to: 3200 }); this.tone(2600, 0.06, { type: 'sine', g: 0.1, to: 3400, at: 0.1 }); break;
        case 'levelup': [523, 659, 784, 1047, 1319].forEach((f, i) => this.tone(f, 0.16, { g: 0.09, at: i * 0.08 })); break;
        case 'upgrade': this.tone(440, 0.1, { g: 0.08 }); this.tone(880, 0.2, { g: 0.08, at: 0.08 }); break;
        case 'build': this.tone(196, 0.1, { g: 0.1 }); this.tone(294, 0.15, { g: 0.1, at: 0.08 }); break;
        default:
      }
    } catch { /* audio-fout negeren */ }
  }
}

// -----------------------------------------------------------------------------
// 9. DOM-HULP
// -----------------------------------------------------------------------------
function h(tag, props = {}, ...kids) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(props || {})) {
    if (v == null || v === false) continue;
    if (k === 'class') el.className = v;
    else if (k === 'style') el.style.cssText = v;
    else if (k.startsWith('on')) el.addEventListener(k.slice(2), v);
    else if (k in el && k !== 'list') el[k] = v;
    else el.setAttribute(k, v === true ? '' : v);
  }
  for (const c of kids.flat()) if (c != null && c !== false) el.append(c instanceof Node ? c : document.createTextNode(String(c)));
  return el;
}
/** Vervang kinderen; null/false worden overgeslagen (anders toont de browser 'null'). */
function fill(el, ...kids) { el.replaceChildren(...kids.flat().filter((k) => k != null && k !== false)); }
function toast(msg, kind = '') {
  let box = document.getElementById('toasts');
  if (!box) { box = h('div', { id: 'toasts' }); document.body.append(box); }
  const t = h('div', { class: 'toast ' + kind }, msg);
  box.append(t);
  while (box.children.length > 3) box.firstChild.remove();
  setTimeout(() => t.remove(), kind === 'err' ? 5000 : 3000);
}
function joinUrl(code, local) {
  const base = location.href.split(/[?#]/)[0];
  return `${base}?${local ? 'local' : 'join'}=${code}`;
}

// -----------------------------------------------------------------------------
// 10. HOST (beamer)
// -----------------------------------------------------------------------------
function startHost() {
  document.body.className = 'host';
  let save = null;
  try { save = JSON.parse(localStorage.getItem(SAVE_KEY) || 'null'); } catch { save = null; }
  const game = new Game(save);
  const canvas = h('canvas', { id: 'stage' });
  document.body.append(canvas);
  const R = new Renderer(canvas, game);
  const sfx = new Sfx(); sfx.setVolume(game.world.settings.volume);
  const conns = new Map();   // playerId → conn
  const lastSeen = new Map();

  // ---------- netwerk ----------
  let net;
  const startNet = () => {
    net = new HostNet(game.world.code, { onMsg, onStatus: (s) => { ui.status(s); if (s === 'taken') { toast('Kamercode bezet, nieuwe code gemaakt', 'err'); net.stop(); game.world.code = genCode(); game.dirty = true; startNet(); ui.refreshLink(); } }, onClose });
    net.start();
    R.setQr(joinUrl(game.world.code));
  };
  function onClose(conn) { for (const [id, c] of conns) if (c === conn) { conns.delete(id); game.leave(id); } }
  function send(id, m) { const c = conns.get(id); if (c) c.send(m); }
  function onMsg(conn, m) {
    if (m.t === 'hello') {
      if (typeof m.id !== 'string') return;
      const pr = game.join(m.id, m.name, m.fur);
      if (!pr) return;
      conn.id = m.id; conns.set(m.id, conn); lastSeen.set(m.id, performance.now());
      conn.send({ t: 'welcome', code: game.world.code });
      conn.send(game.personal(m.id));
      ui.players();
      return;
    }
    const id = conn.id || m.from;
    if (!id || !game.profiles[id]) { conn.send({ t: 'rejoin' }); return; }
    if (!game.players.has(id) || !game.players.get(id).online) { conn.send({ t: 'rejoin' }); return; }
    conns.set(id, conn);
    lastSeen.set(id, performance.now());
    const p = game.players.get(id), pr = game.profiles[id];
    switch (m.t) {
      case 'ping': break;
      case 'move': p.dir = clamp(m.d | 0, -1, 1); p.moveT = 0.7; break;
      case 'jump': if (!game.jump(p, m.d < 0 ? -1 : 1)) conn.send({ t: 'info', text: m.d < 0 ? 'Geen platform erboven' : 'Geen platform eronder' }); break;
      case 'aim': if (isNum(m.a) && isNum(m.p)) p.aim = { a: m.a, p: clamp(m.p, 0, 1), age: 0 }; break;
      case 'aimEnd': p.aim = null; break;
      case 'shoot': if (!game.shoot(p, m.a, m.p)) conn.send({ t: 'info', text: p.arrows < 1 ? 'Nog aan het herladen…' : 'Kan nu niet schieten' }); break;
      case 'buy': { const r = game.buy(id, m.id); conn.send({ t: 'bought', ok: r.ok, id: m.id, reason: r.reason }); break; }
      case 'look': game.setLook(id, m.look); break;
      case 'admin': if (String(m.pin) === game.world.pin) { pr.admin = true; game.dirty = true; conn.send({ t: 'info', text: 'Bouwer-modus ontgrendeld!' }); } else conn.send({ t: 'info', text: 'Onjuiste pincode', err: true }); break;
      default:
        if (m.t?.startsWith('b') && pr.admin) buildCmd(m, conn);
    }
  }
  function buildCmd(m, conn) {
    let r = null;
    switch (m.t) {
      case 'bStart': game.drawStart(m.type, m.tool, 'phone'); break;
      case 'bErase': game.drawErase('phone'); break;
      case 'bMove': if (isNum(m.dx) && isNum(m.dy)) game.drawCursor(m.dx, m.dy, true); break;
      case 'bAbs': if (isNum(m.x) && isNum(m.y)) game.drawCursor(m.x, m.y, false); break;
      case 'bPoint': r = game.drawPoint(); break;
      case 'bUndo': game.drawUndo(); break;
      case 'bSave': r = game.drawSave(); break;
      case 'bCancel': game.drawCancel(); break;
      default:
    }
    if (r && r.reason) conn.send({ t: 'info', text: r.reason, err: true });
    if (r && r.ok && r.id) conn.send({ t: 'info', text: 'Vlak opgeslagen!' });
    ui.zones();
  }

  // ---------- muis-bewerking op de beamer ----------
  let drag = null;
  canvas.addEventListener('mousemove', (e) => {
    const w = R.toWorld(e.clientX, e.clientY);
    R.overlay.mouse = w;
    if (game.draw.active && game.draw.by === 'host') game.drawCursor(w.x / W, w.y / H, false);
    if (drag) {
      const dx = (w.x - drag.start.x) / W, dy = (w.y - drag.start.y) / H;
      const pts = drag.orig.map((q, i) => (drag.vertex === -1 || drag.vertex === i ? { x: q.x + dx, y: q.y + dy } : q));
      const z = game.world.zones.find((q) => q.id === drag.id);
      if (z && z.shape === 'rect' && drag.vertex >= 0) { const opp = drag.orig[(drag.vertex + 2) % 4]; game.setZonePts(drag.id, rectPts(opp, pts[drag.vertex])); }
      else game.setZonePts(drag.id, pts);
    }
  });
  canvas.addEventListener('mousedown', (e) => {
    sfx.unlock();
    const w = R.toWorld(e.clientX, e.clientY);
    const tool = R.overlay.hostTool;
    if (tool === 'draw' || tool === 'erase') { if (game.draw.active && game.draw.by === 'host') { game.drawCursor(w.x / W, w.y / H, false); const r = game.drawPoint(); if (r?.reason) toast(r.reason, 'err'); if (r?.id) { toast('Vlak opgeslagen'); } ui.zones(); ui.build(); } return; }
    if (tool === 'select') {
      const sel = game.zonePx.find((q) => q.z.id === R.overlay.sel);
      if (sel) { const vi = sel.p.findIndex((p) => Math.hypot(p.x - w.x, p.y - w.y) < 4); if (vi >= 0) { drag = { id: sel.z.id, vertex: vi, start: w, orig: sel.z.pts.map((q) => ({ ...q })) }; return; } }
      const z = game.zoneAt(w.x, w.y);
      R.overlay.sel = z ? z.id : null; ui.selection();
      if (z) drag = { id: z.id, vertex: -1, start: w, orig: z.pts.map((q) => ({ ...q })) };
    }
  });
  window.addEventListener('mouseup', () => { drag = null; });
  canvas.addEventListener('dblclick', (e) => {
    if (R.overlay.hostTool === 'draw' && game.draw.tool === 'poly') { game.drawUndo(); const r = game.drawSave(); if (r.reason) toast(r.reason, 'err'); else toast('Vlak opgeslagen'); ui.zones(); }
    else if (R.overlay.hostTool === 'none') toggleFs();
  });
  window.addEventListener('keydown', (e) => {
    if (e.target.tagName === 'INPUT' || e.target.tagName === 'SELECT') return;
    sfx.unlock();
    const k = e.key.toLowerCase();
    if (k === 'h') ui.toggle();
    else if (k === 'f') toggleFs();
    else if (k === 'enter' && game.draw.active) { const r = game.drawSave(); if (r.reason) toast(r.reason, 'err'); ui.zones(); }
    else if (k === 'escape') { game.drawCancel(); R.overlay.hostTool = 'none'; R.overlay.sel = null; ui.build(); }
    else if (k === 'backspace' && game.draw.active) game.drawUndo();
    else if (k === 'delete' && R.overlay.sel) { game.deleteZone(R.overlay.sel); R.overlay.sel = null; ui.zones(); ui.selection(); }
  });
  let idle; window.addEventListener('mousemove', () => { document.body.classList.remove('idle'); clearTimeout(idle); idle = setTimeout(() => document.body.classList.add('idle'), 2500); });
  function toggleFs() { if (document.fullscreenElement) document.exitFullscreen(); else document.documentElement.requestFullscreen?.().catch(() => toast('Fullscreen geblokkeerd, gebruik F11', 'err')); }

  // ---------- paneel ----------
  const ui = buildHostPanel(game, R, sfx, { toggleFs, send, conns, getNet: () => net, restartNet: () => { net.stop(); startNet(); } });

  // ---------- lussen ----------
  let last = performance.now(), sendT = 0, saveT = 0;
  function loop(now) {
    const dt = Math.min(0.1, (now - last) / 1000); last = now;
    game.update(dt);
    for (const [id, m] of game.outbox) send(id, m);
    game.outbox.length = 0;
    sendT += dt;
    if (sendT > 0.2) {
      sendT = 0;
      for (const [id, t] of lastSeen) if (now - t > 10000 && game.players.get(id)?.online) { game.leave(id); conns.delete(id); }
      for (const id of conns.keys()) if (game.players.get(id)?.online) send(id, game.personal(id));
    }
    saveT += dt;
    if (saveT > 3 && game.dirty) { saveT = 0; persist(); ui.players(); }
    R.resize();
    R.frame(dt, sfx);
    requestAnimationFrame(loop);
  }
  function persist() { try { localStorage.setItem(SAVE_KEY, JSON.stringify(game.serialize())); game.dirty = false; } catch (e) { console.warn('opslaan mislukt', e); } }
  window.addEventListener('beforeunload', persist);
  startNet();
  ui.refreshLink();
  requestAnimationFrame(loop);
  window.PA_HOST = { game, R };
}

function buildHostPanel(game, R, sfx, api) {
  const s = game.world.settings;
  const panel = h('aside', { id: 'panel' });
  const fab = h('button', { id: 'fab', title: 'Menu (H)', onclick: () => toggle() }, '☰');
  document.body.append(panel, fab);
  let open = !game.world.zones.length;
  const toggle = () => { open = !open; panel.classList.toggle('open', open); };
  panel.classList.toggle('open', open);

  // verbinden
  const statusEl = h('span', { class: 'pill' }, 'starten…');
  const qrImg = h('div', { class: 'qrbox' });
  const linkEl = h('input', { class: 'link', readOnly: true, onclick: (e) => e.target.select() });
  const fileWarn = h('div', { class: 'warn', hidden: location.protocol !== 'file:' }, 'Je opent dit bestand lokaal (file://). Telefoons kunnen de pagina dan niet openen. Zet de 3 bestanden online (bv. Vercel) — lokaal testen in een 2e tabblad werkt wel.');
  const pinEl = h('b', {}, game.world.pin);
  // spelers
  const plist = h('div', { class: 'plist' });
  // bouwen
  const typeSel = h('div', { class: 'chips' });
  const toolSel = h('div', { class: 'chips' });
  let bType = 'target', bTool = 'rect';
  const buildInfo = h('div', { class: 'small' });
  const buildBtns = h('div', { class: 'row' });
  const selBox = h('div', { class: 'selbox' });
  const zlist = h('div', { class: 'zlist' });

  function refreshLink() {
    const url = joinUrl(game.world.code);
    linkEl.value = url;
    fill(qrImg, );
    if (R.qr) { const c = document.createElement('canvas'); c.width = R.qr.width; c.height = R.qr.height; c.getContext('2d').drawImage(R.qr, 0, 0); qrImg.append(c); }
    else qrImg.append(h('div', { class: 'small' }, 'QR-bibliotheek niet geladen (offline?). Gebruik de link of code.'));
    R.setQr(url);
  }
  function status(st) {
    const map = { online: ['Online — telefoons kunnen verbinden', 'ok'], starting: ['Starten…', ''], reconnecting: ['Opnieuw verbinden…', 'warn'], taken: ['Code bezet', 'err'], nopeer: ['PeerJS niet geladen: alleen lokale test', 'err'] };
    const [t, c] = map[st] || [st, ''];
    statusEl.textContent = t; statusEl.className = 'pill ' + c;
  }
  function players() {
    const arr = Object.values(game.profiles).sort((a, b) => (game.players.get(b.id)?.online ? 1 : 0) - (game.players.get(a.id)?.online ? 1 : 0) || b.level - a.level);
    fill(plist, ...(arr.length ? arr.slice(0, 30).map((pr) => {
      const on = game.players.get(pr.id)?.online;
      return h('div', { class: 'prow' }, h('span', { class: 'dot ' + (on ? 'on' : '') }), h('b', {}, pr.name), ` LV${pr.level} · ${fmt(pr.gold)} goud`, pr.admin ? ' · 🛠' : '',
        h('button', { class: 'mini', title: 'Bouwrechten aan/uit', onclick: () => { pr.admin = !pr.admin; game.dirty = true; players(); } }, pr.admin ? 'bouwer ✓' : 'bouwer'));
    }) : [h('div', { class: 'small' }, 'Nog geen spelers. Scan de QR-code op de muur.')]));
  }
  function build() {
    fill(typeSel, ...Object.entries(ZONE_TYPES).map(([k, v]) => h('button', { class: 'chip' + (bType === k ? ' on' : ''), onclick: () => { bType = k; if (!v.tools.includes(bTool)) bTool = v.tools[0]; if (game.draw.active && !game.draw.erase) game.drawStart(bType, bTool, 'host'); build(); } }, v.icon + ' ' + v.name)));
    fill(toolSel, ...ZONE_TYPES[bType].tools.map((t) => h('button', { class: 'chip' + (bTool === t ? ' on' : ''), onclick: () => { bTool = t; if (game.draw.active && !game.draw.erase) game.drawStart(bType, bTool, 'host'); build(); } }, TOOLS[t])));
    const d = game.draw, tool = R.overlay.hostTool;
    buildInfo.textContent = ZONE_TYPES[bType].desc + ' ' + (bTool === 'rect' ? 'Klik 2 hoeken.' : bTool === 'line' ? 'Klik begin en eind.' : 'Klik punten, dubbelklik of Enter om te sluiten.');
    fill(buildBtns, 
      h('button', { class: 'btn ' + (tool === 'draw' ? 'on' : 'primary'), onclick: () => { R.overlay.hostTool = 'draw'; R.overlay.sel = null; game.drawStart(bType, bTool, 'host'); build(); selection(); } }, '✎ Tekenen'),
      h('button', { class: 'btn ' + (tool === 'select' ? 'on' : ''), onclick: () => { game.drawCancel(); R.overlay.hostTool = 'select'; build(); } }, '✥ Selecteren'),
      h('button', { class: 'btn ' + (tool === 'erase' ? 'on' : ''), onclick: () => { R.overlay.hostTool = 'erase'; R.overlay.sel = null; game.drawErase('host'); build(); selection(); } }, '⌫ Wissen'),
      d.active && !d.erase ? h('button', { class: 'btn', onclick: () => game.drawUndo() }, '↶ Punt terug') : null,
      d.active && !d.erase && d.tool === 'poly' ? h('button', { class: 'btn ok', onclick: () => { const r = game.drawSave(); if (r.reason) toast(r.reason, 'err'); zones(); } }, '✓ Opslaan') : null,
      tool !== 'none' ? h('button', { class: 'btn', onclick: () => { game.drawCancel(); R.overlay.hostTool = 'none'; R.overlay.sel = null; build(); selection(); } }, 'Klaar') : null
    );
  }
  function selection() {
    const z = game.world.zones.find((q) => q.id === R.overlay.sel);
    if (!z) { fill(selBox, R.overlay.hostTool === 'select' ? h('div', { class: 'small' }, 'Klik een vlak om het te selecteren. Sleep het vlak of de gele hoekpunten.') : ''); return; }
    const mult = h('input', { type: 'range', min: 0.25, max: 5, step: 0.25, value: z.mult || 1, oninput: (e) => { game.setZoneProps(z.id, { mult: +e.target.value }); mv.textContent = '×' + e.target.value; } });
    const mv = h('span', {}, '×' + (z.mult || 1));
    fill(selBox, 
      h('div', {}, h('b', {}, ZONE_TYPES[z.type].icon + ' ' + ZONE_TYPES[z.type].name), ' ', z.id),
      h('label', {}, 'Naam ', h('input', { value: z.label, maxLength: 12, onchange: (e) => { game.setZoneProps(z.id, { label: e.target.value }); zones(); } })),
      z.type === 'target' ? h('label', {}, 'Waarde ', mult, mv) : null,
      h('div', { class: 'row' }, h('button', { class: 'btn danger', onclick: () => { game.deleteZone(z.id); R.overlay.sel = null; selection(); zones(); } }, 'Verwijderen'))
    );
  }
  function zones() {
    fill(zlist, ...game.world.zones.map((z) => h('button', { class: 'zrow' + (R.overlay.sel === z.id ? ' on' : ''), onclick: () => { R.overlay.hostTool = 'select'; R.overlay.sel = z.id; game.drawCancel(); build(); selection(); zones(); } }, `${ZONE_TYPES[z.type].icon} ${z.label}`, z.type === 'target' ? ` ×${z.mult}` : '')));
    if (!game.world.zones.length) zlist.append(h('div', { class: 'small' }, 'Nog geen vlakken. Tip: begin met een Platform (lijn op een plank/rand) en een Doel.'));
    build();
  }
  const toggleRow = (key, label) => h('label', { class: 'tog' }, h('input', { type: 'checkbox', checked: !!s[key], onchange: (e) => { s[key] = e.target.checked; game.dirty = true; } }), label);
  const fileIn = h('input', { type: 'file', accept: '.json,application/json', hidden: true, onchange: async (e) => {
    const f = e.target.files[0]; e.target.value = ''; if (!f) return;
    if (f.size > 3e6) return toast('Bestand te groot', 'err');
    try { const data = JSON.parse(await f.text()); if (!data || !data.world) throw new Error('geen wereld'); localStorage.setItem(SAVE_KEY, JSON.stringify(data)); location.reload(); }
    catch (err) { toast('Ongeldig bestand: ' + err.message, 'err'); }
  } });

  panel.append(
    h('h1', {}, '🐾 Purrfect Aim'),
    h('section', {}, h('h2', {}, 'Verbinden'), statusEl, fileWarn, qrImg,
      h('div', { class: 'small' }, 'Kamercode ', h('b', {}, game.world.code), ' · Bouw-pincode ', pinEl),
      linkEl,
      h('div', { class: 'row' },
        h('button', { class: 'btn', onclick: () => { navigator.clipboard?.writeText(linkEl.value).then(() => toast('Link gekopieerd')); } }, 'Kopieer link'),
        h('button', { class: 'btn', onclick: () => window.open(joinUrl(game.world.code, true), '_blank') }, 'Test-controller (tab)'),
        h('button', { class: 'btn', onclick: () => { game.world.pin = String(Math.floor(1000 + Math.random() * 9000)); pinEl.textContent = game.world.pin; game.dirty = true; } }, 'Nieuwe pin'))),
    h('section', {}, h('h2', {}, 'Spelers'), plist),
    h('section', {}, h('h2', {}, 'Bouwen (muis op de beamer)'), typeSel, toolSel, buildInfo, buildBtns, selBox, zlist),
    h('section', {}, h('h2', {}, 'Weergave'),
      toggleRow('decor', 'Achtergrond (maan, kasteel, sterren)'), toggleRow('names', 'Namen & koker boven katten'), toggleRow('board', 'Scorebord'), toggleRow('labels', 'Vlaknamen'), toggleRow('grid', 'Raster'),
      h('label', {}, 'QR op muur ', h('select', { onchange: (e) => { s.qr = e.target.value; game.dirty = true; } }, ...[['auto', 'Als niemand speelt'], ['always', 'Altijd'], ['off', 'Uit']].map(([v, t]) => h('option', { value: v, selected: s.qr === v }, t)))),
      h('label', {}, 'Beeld ', h('select', { onchange: (e) => { s.fit = e.target.value; game.dirty = true; } }, ...[['letterbox', '16:9 (zwarte randen)'], ['stretch', 'Vullen']].map(([v, t]) => h('option', { value: v, selected: s.fit === v }, t)))),
      h('label', {}, 'Volume ', h('input', { type: 'range', min: 0, max: 1, step: 0.05, value: s.volume, oninput: (e) => { s.volume = +e.target.value; sfx.setVolume(s.volume); sfx.unlock(); game.dirty = true; } })),
      h('div', { class: 'row' }, h('button', { class: 'btn primary', onclick: api.toggleFs }, '⛶ Fullscreen (F)'))),
    h('section', {}, h('h2', {}, 'Opslag'),
      h('div', { class: 'small' }, 'Alles wordt automatisch in deze browser bewaard (wereld + alle spelers).'),
      h('div', { class: 'row' },
        h('button', { class: 'btn', onclick: () => { const blob = new Blob([JSON.stringify(game.serialize(), null, 1)], { type: 'application/json' }); const a = h('a', { href: URL.createObjectURL(blob), download: 'purrfect-aim-save.json' }); document.body.append(a); a.click(); a.remove(); } }, '⇩ Export'),
        h('button', { class: 'btn', onclick: () => fileIn.click() }, '⇧ Import'), fileIn,
        h('button', { class: 'btn danger', onclick: () => { if (confirm('Alle vlakken wissen? Spelers blijven bewaard.')) { game.world.zones = []; game.rebuildZones(); game.arrows = []; zones(); } } }, 'Wis vlakken'),
        h('button', { class: 'btn danger', onclick: () => { if (confirm('ALLE spelersvoortgang wissen? Dit kan niet ongedaan.')) { game.profiles = {}; game.players.clear(); game.dirty = true; players(); } } }, 'Wis spelers'))),
    h('div', { class: 'small foot' }, 'Toetsen: H menu · F fullscreen · Enter opslaan · Esc stoppen · Del vlak wissen')
  );
  players(); zones(); selection();
  return { toggle, status, players, zones, build, selection, refreshLink };
}

// -----------------------------------------------------------------------------
// 11. CONTROLLER (telefoon)
// -----------------------------------------------------------------------------
function startController(code, local) {
  document.body.className = 'ctrl';
  let me = {};
  try { me = JSON.parse(localStorage.getItem(ME_KEY) || '{}'); } catch { me = {}; }
  if (!me.id) me.id = uid();
  me.code = code;
  const saveMe = () => { try { localStorage.setItem(ME_KEY, JSON.stringify(me)); } catch { /* privémodus */ } };
  saveMe();

  let srv = null, srvAt = 0, tab = 'play', joined = false, lastReward = null, selUp = null;
  const app = h('div', { id: 'ctrl' });
  document.body.append(app);
  const statusEl = h('div', { class: 'status' }, 'Verbinden…');

  const net = new ClientNet(code, local, me.id, {
    onStatus: (s) => {
      const t = { connected: '● Verbonden', connecting: 'Verbinden…', reconnecting: 'Verbinding kwijt — opnieuw proberen…', nohost: 'Beamer niet gevonden. Staat het spel open op de laptop? Klopt de code?', nopeer: 'Netwerkbibliotheek niet geladen. Controleer internet.' }[s] || s;
      statusEl.textContent = t; statusEl.className = 'status ' + (s === 'connected' ? 'ok' : s === 'nohost' || s === 'nopeer' ? 'err' : 'warn');
      if (s === 'connected' && me.name) hello();
    },
    onMsg
  });
  net.onOpen = () => { if (me.name) hello(); };
  const send = (m) => net.send(m);
  const hello = () => send({ t: 'hello', id: me.id, name: me.name, fur: me.fur });
  const vib = (p) => { try { navigator.vibrate?.(p); } catch { /* */ } };

  function onMsg(m) {
    switch (m.t) {
      case 'welcome': joined = true; render(); break;
      case 'me': {
        const firstAdmin = m.profile?.admin && !srv?.profile?.admin;
        const first = !srv;
        srv = m; srvAt = performance.now();
        if (first || (firstAdmin && tab === 'build')) render();
        update();
        break;
      }
      case 'rejoin': hello(); break;
      case 'reward': lastReward = m; vib(m.tags.length ? [30, 40, 60] : 25); flashReward(m); break;
      case 'miss': break;
      case 'reloaded': vib(8); break;
      case 'levelup': vib([60, 60, 120]); showLevelUp(m); break;
      case 'bought': if (m.ok) { vib(30); toast('Upgrade gekocht!'); } else toast(m.reason || 'Kan niet kopen', 'err'); setTimeout(render, 50); break;
      case 'info': toast(m.text, m.err ? 'err' : ''); if (m.text?.includes('Bouwer')) setTimeout(render, 300); break;
      default:
    }
  }

  // ---------- schermen ----------
  function render() {
    if (!me.name) return renderJoin();
    if (!srv) { fill(app, statusEl, h('div', { class: 'center' }, h('div', { class: 'big' }, '🐾'), h('p', {}, 'Even geduld, je kat wordt opgehaald…'))); return; }
    const pr = srv.profile;
    const tabs = [['play', '🏹', 'Schieten'], ['up', '⬆', 'Upgrades'], ['cat', '🐱', 'Mijn kat'], ['build', '🛠', 'Bouwen']];
    const body = tab === 'play' ? renderPlay() : tab === 'up' ? renderUp() : tab === 'cat' ? renderCat() : renderBuild();
    fill(app, statusEl, renderTop(pr), h('main', { class: 'tabbody t-' + tab }, body),
      h('nav', { class: 'tabs' }, ...tabs.map(([k, i, l]) => h('button', { class: tab === k ? 'on' : '', onclick: () => { tab = k; render(); } }, h('span', {}, i), l))));
    update();
  }

  function renderJoin() {
    let fur = me.fur || 'orange';
    const name = h('input', { class: 'name', placeholder: 'Naam van je kat', maxLength: 12, value: me.name || '' });
    const prev = h('canvas', { class: 'preview', width: 40, height: 34 });
    const drawPrev = () => { const c = prev.getContext('2d'); c.clearRect(0, 0, 40, 34); drawCat(c, 18, 31, { fur, hat: 'none', cape: 'none' }, { facing: 1, aim: -0.4, pull: 0.3, nocked: true }); };
    const furs = h('div', { class: 'opts' }, ...Object.entries(FURS).filter(([, v]) => v.lvl <= 1).map(([k, v]) => h('button', { class: 'opt' + (k === fur ? ' on' : ''), style: `--c:${v.c[0]}`, onclick: (e) => { fur = k; [...furs.children].forEach((b) => b.classList.remove('on')); e.currentTarget.classList.add('on'); drawPrev(); } }, h('i', {}), v.name)));
    fill(app, statusEl, h('div', { class: 'join' },
      h('h1', {}, 'Purrfect Aim'), h('p', {}, 'Je bent een boogschutter-kat. Schiet op de vlakken op de muur, verdien goud en word sterker.'),
      prev, name, h('h3', {}, 'Kies je vacht'), furs,
      h('button', { class: 'btn primary big', onclick: () => { const n = cleanName(name.value); if (!n) return toast('Vul een naam in (letters/cijfers)', 'err'); me.name = n; me.fur = fur; saveMe(); hello(); render(); } }, 'Meedoen! 🐾'),
      h('p', { class: 'small' }, 'Je voortgang wordt op de beamer-laptop bewaard en gekoppeld aan deze telefoon.')));
    drawPrev();
  }

  // bovenbalk
  const topEls = {};
  function renderTop(pr) {
    topEls.gold = h('b', { class: 'gold' }); topEls.lv = h('b', {}); topEls.xpbar = h('i', {}); topEls.xpt = h('span', { class: 'small' });
    topEls.quiver = h('div', { class: 'quiver' }); topEls.reload = h('i', {});
    return h('header', { class: 'top' },
      h('div', { class: 'row' }, h('span', {}, '💰 ', topEls.gold), h('span', {}, 'LV ', topEls.lv), topEls.quiver),
      h('div', { class: 'bar xp' }, topEls.xpbar), topEls.xpt, h('div', { class: 'bar rl' }, topEls.reload));
  }
  function update() {
    if (!srv || !topEls.gold) return;
    const pr = srv.profile;
    topEls.gold.textContent = fmt(pr.gold);
    topEls.lv.textContent = pr.level;
    topEls.xpbar.style.width = Math.min(100, (pr.xp / srv.need) * 100) + '%';
    topEls.xpt.textContent = `${fmt(pr.xp)} / ${fmt(srv.need)} XP`;
    if (topEls.quiver.childElementCount !== srv.max) fill(topEls.quiver, ...Array.from({ length: srv.max }, () => h('i', {})));
    [...topEls.quiver.children].forEach((c, i) => c.classList.toggle('full', i < srv.arrows));
    const k = srv.arrows >= srv.max ? 1 : Math.min(1, srv.reload + (performance.now() - srvAt) / 1000 / srv.reloadTime);
    topEls.reload.style.width = k * 100 + '%';
    if (tab === 'up' && upEls) refreshUpNodes();
  }
  setInterval(update, 100);

  // ---------- SCHIETEN ----------
  let aim = null;
  function renderPlay() {
    const pad = h('canvas', { class: 'aimpad' });
    const hint = h('div', { class: 'hint' }, 'Sleep naar achteren om de boog te spannen (zoals een katapult). Laat los om te schieten.');
    const feed = h('div', { class: 'feed' }, lastReward ? `Laatste treffer: +${lastReward.gold} goud · ${lastReward.dist}px` : 'Hoe verder weg en hoe kleiner het doel, hoe meer goud.');
    topEls.feed = feed;
    const ctx = pad.getContext('2d');
    const size = () => { const r = pad.getBoundingClientRect(); pad.width = r.width * devicePixelRatio; pad.height = r.height * devicePixelRatio; drawPad(); };
    let sendT = 0;
    function drawPad() {
      const c = ctx, w = pad.width, hh = pad.height, d = devicePixelRatio;
      c.clearRect(0, 0, w, hh);
      c.strokeStyle = '#2a3a2e'; c.lineWidth = 1;
      for (let x = 0; x < w; x += 24 * d) { c.beginPath(); c.moveTo(x, 0); c.lineTo(x, hh); c.stroke(); }
      for (let y = 0; y < hh; y += 24 * d) { c.beginPath(); c.moveTo(0, y); c.lineTo(w, y); c.stroke(); }
      if (!aim) { c.fillStyle = '#7fa08a'; c.font = `${14 * d}px monospace`; c.textAlign = 'center'; c.fillText(srv && srv.arrows < 1 ? 'Herladen…' : 'Tik & sleep om te richten', w / 2, hh / 2); return; }
      const { sx, sy, x, y, p } = aim;
      const col = p > 0.85 ? '#ff5a5a' : p > 0.5 ? '#ffd23f' : '#7dff5a';
      c.strokeStyle = '#ffffff55'; c.lineWidth = 3 * d; c.beginPath(); c.moveTo(sx, sy); c.lineTo(x, y); c.stroke();
      c.fillStyle = col; c.beginPath(); c.arc(x, y, 10 * d, 0, 7); c.fill();
      // pijl in schietrichting
      const a = aim.a, L = 40 * d + p * 70 * d;
      c.strokeStyle = col; c.lineWidth = 4 * d; c.beginPath(); c.moveTo(sx, sy); c.lineTo(sx + Math.cos(a) * L, sy + Math.sin(a) * L); c.stroke();
      c.beginPath(); c.moveTo(sx + Math.cos(a) * L, sy + Math.sin(a) * L); c.lineTo(sx + Math.cos(a - 0.4) * (L - 14 * d), sy + Math.sin(a - 0.4) * (L - 14 * d)); c.lineTo(sx + Math.cos(a + 0.4) * (L - 14 * d), sy + Math.sin(a + 0.4) * (L - 14 * d)); c.closePath(); c.fill();
      c.strokeStyle = '#ffffff'; c.lineWidth = 2 * d; c.beginPath(); c.arc(sx, sy, 8 * d, 0, 7); c.stroke();
      c.fillStyle = '#fff'; c.font = `bold ${16 * d}px monospace`; c.textAlign = 'center'; c.fillText(Math.round(p * 100) + '%', sx, sy - 18 * d);
    }
    pad.addEventListener('pointerdown', (e) => {
      e.preventDefault(); pad.setPointerCapture(e.pointerId);
      const r = pad.getBoundingClientRect(), d = devicePixelRatio;
      aim = { id: e.pointerId, sx: (e.clientX - r.left) * d, sy: (e.clientY - r.top) * d, x: 0, y: 0, a: 0, p: 0 };
      aim.x = aim.sx; aim.y = aim.sy; drawPad();
    });
    pad.addEventListener('pointermove', (e) => {
      if (!aim || aim.id !== e.pointerId) return;
      e.preventDefault();
      const r = pad.getBoundingClientRect(), d = devicePixelRatio;
      aim.x = (e.clientX - r.left) * d; aim.y = (e.clientY - r.top) * d;
      const dx = aim.x - aim.sx, dy = aim.y - aim.sy, len = Math.hypot(dx, dy);
      aim.a = Math.atan2(-dy, -dx);
      aim.p = clamp(len / (Math.min(pad.width, pad.height) * 0.45), 0, 1);
      if (len > 14 * d && performance.now() - sendT > 50) { sendT = performance.now(); send({ t: 'aim', a: aim.a, p: aim.p }); }
      drawPad();
    });
    const release = (e) => {
      if (!aim || aim.id !== e.pointerId) return;
      const len = Math.hypot(aim.x - aim.sx, aim.y - aim.sy);
      if (len > 18 * devicePixelRatio && e.type === 'pointerup') { send({ t: 'shoot', a: aim.a, p: aim.p }); vib(15); } else send({ t: 'aimEnd' });
      aim = null; drawPad();
    };
    pad.addEventListener('pointerup', release); pad.addEventListener('pointercancel', release);
    setTimeout(size, 0);
    window.onresize = size;

    const hold = (d) => {
      let iv = null;
      const start = (e) => { e.preventDefault(); send({ t: 'move', d }); clearInterval(iv); iv = setInterval(() => send({ t: 'move', d }), 200); };
      const stop = () => { clearInterval(iv); iv = null; send({ t: 'move', d: 0 }); };
      return h('button', { class: 'ctl', onpointerdown: start, onpointerup: stop, onpointercancel: stop, onpointerleave: () => iv && stop(), oncontextmenu: (e) => e.preventDefault() }, d < 0 ? '◀' : '▶');
    };
    return [h('div', { class: 'padwrap' }, pad), feed, hint,
      h('div', { class: 'controls' }, hold(-1), h('button', { class: 'ctl', onclick: () => send({ t: 'jump', d: -1 }) }, '▲'), h('button', { class: 'ctl', onclick: () => send({ t: 'jump', d: 1 }) }, '▼'), hold(1))];
  }
  function flashReward(m) {
    if (topEls.feed) topEls.feed.textContent = `+${m.gold} goud · +${m.xp} XP · ${m.dist}px${m.combo > 1 ? ' · combo ×' + m.combo : ''}${m.tags.length ? ' · ' + m.tags.join(' ') : ''}`;
    const f = h('div', { class: 'pop' }, '+' + m.gold + (m.tags.length ? ' ' + m.tags[0] : ''));
    document.body.append(f); setTimeout(() => f.remove(), 1200);
  }
  function showLevelUp(m) {
    const box = h('div', { class: 'overlay', onclick: () => box.remove() },
      h('div', { class: 'card lvl' }, h('div', { class: 'big' }, '⭐'), h('h2', {}, 'Level ' + m.level + '!'),
        m.unlocks.length ? h('div', {}, h('p', {}, 'Nieuw ontgrendeld:'), h('ul', {}, ...m.unlocks.map((u) => h('li', {}, u)))) : h('p', {}, 'Je kat wordt steeds sterker.'),
        h('button', { class: 'btn primary' }, 'Miauw!')));
    document.body.append(box);
  }

  // ---------- UPGRADES ----------
  let upEls = null;
  function renderUp() {
    const web = h('div', { class: 'web' });
    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.setAttribute('viewBox', '0 0 100 100'); svg.setAttribute('preserveAspectRatio', 'none');
    const P = (id) => { const [c, r] = UPGRADES[id].pos; return [10 + c * 20, 12 + r * 25]; };
    for (const [id, u] of Object.entries(UPGRADES)) for (const rid of Object.keys(u.req || {})) {
      const [x1, y1] = P(rid), [x2, y2] = P(id);
      const l = document.createElementNS('http://www.w3.org/2000/svg', 'line');
      l.setAttribute('x1', x1); l.setAttribute('y1', y1); l.setAttribute('x2', x2); l.setAttribute('y2', y2); l.dataset.to = id; l.dataset.from = rid;
      svg.append(l);
    }
    web.append(svg);
    const nodes = {};
    for (const [id, u] of Object.entries(UPGRADES)) {
      const [x, y] = P(id);
      nodes[id] = h('button', { class: 'node', style: `left:${x}%;top:${y}%`, onclick: () => { selUp = id; refreshUpNodes(); } }, h('span', { class: 'ic' }, u.icon), h('span', { class: 'lv' }));
      web.append(nodes[id]);
    }
    const detail = h('div', { class: 'detail' });
    upEls = { nodes, detail, svg };
    if (!selUp) selUp = 'reload';
    setTimeout(refreshUpNodes, 0);
    return [h('p', { class: 'small' }, 'Upgrade-web: tik een rondje. Lijnen tonen wat je eerst nodig hebt. Prijzen stijgen per niveau.'), web, detail];
  }
  let lastUpKey = '';
  function refreshUpNodes() {
    if (!srv || !upEls) return;
    const pr = srv.profile;
    const key = JSON.stringify([pr.gold, pr.level, pr.upgrades, selUp]);
    if (key === lastUpKey) return; lastUpKey = key;
    for (const [id, el] of Object.entries(upEls.nodes)) {
      const n = pr.upgrades[id] | 0, u = UPGRADES[id], c = canBuy(pr, id);
      el.className = 'node' + (n >= u.max ? ' max' : c.ok ? ' buy' : n > 0 ? ' own' : (pr.level < u.lvl || c.reason?.startsWith('Eerst')) ? ' lock' : '') + (selUp === id ? ' sel' : '');
      el.querySelector('.lv').textContent = `${n}/${u.max}`;
    }
    for (const l of upEls.svg.querySelectorAll('line')) l.setAttribute('class', (pr.upgrades[l.dataset.from] | 0) >= (UPGRADES[l.dataset.to].req[l.dataset.from]) ? 'met' : '');
    const id = selUp, u = UPGRADES[id], n = pr.upgrades[id] | 0, c = canBuy(pr, id);
    const now = statsOf(pr), next = statsOf({ ...pr, upgrades: { ...pr.upgrades, [id]: Math.min(u.max, n + 1) } });
    const eff = { reload: ['Herlaadtijd', (v) => v.reload.toFixed(2) + 's'], power: ['Max. snelheid', (v) => Math.round(v.vMax)], feet: ['Loopsnelheid', (v) => Math.round(v.walk)], quiver: ['Pijlen in koker', (v) => v.maxArrows],
      steady: ['Zwiep', (v) => Math.round(v.wobble * 57.3) + '°'], hunter: ['Bonus-beloning', (v) => '×' + v.hunter.toFixed(2)], multishot: ['Extra pijlen', (v) => v.multishot], greed: ['Goud', (v) => '×' + v.goldMult.toFixed(2)],
      wisdom: ['XP', (v) => '×' + v.xpMult.toFixed(2)], crit: ['Crit-kans', (v) => Math.round(v.crit * 100) + '%'], combo: ['Combo-tijd', (v) => v.comboWindow + 's'] }[id];
    const reqs = Object.entries(u.req || {}).map(([r, k]) => `${UPGRADES[r].name} ${k}`).join(', ');
    fill(upEls.detail, 
      h('h3', {}, u.icon + ' ' + u.name, h('span', { class: 'small' }, `  niveau ${n}/${u.max}`)),
      h('p', {}, u.desc),
      h('p', { class: 'small' }, `${eff[0]}: ${eff[1](now)}${n < u.max ? ' → ' + eff[1](next) : ''}`),
      h('p', { class: 'small' }, `Vereist: level ${u.lvl}${reqs ? ' · ' + reqs : ''}`),
      n >= u.max ? h('div', { class: 'btn' }, 'Maximaal ✓') :
        h('button', { class: 'btn ' + (c.ok ? 'primary' : ''), disabled: !c.ok, onclick: () => send({ t: 'buy', id }) }, c.ok ? `Koop voor 💰 ${fmt(c.cost)}` : `${c.reason} (💰 ${fmt(c.cost)})`));
  }

  // ---------- MIJN KAT ----------
  function renderCat() {
    const pr = srv.profile;
    const look = { name: pr.name, fur: pr.fur, hat: pr.hat, cape: pr.cape, pet: pr.pet, arrow: pr.arrow };
    const prev = h('canvas', { class: 'preview', width: 56, height: 40 });
    let t = 0;
    const drawPrev = () => { const c = prev.getContext('2d'); c.clearRect(0, 0, 56, 40); if (look.pet !== 'none') drawKitten(c, 12, 37, PETS[look.pet].fur, 1, t, true); drawCat(c, 32, 37, look, { facing: 1, aim: -0.35, pull: 0.4, nocked: true, fletch: ARROWS[look.arrow].fletch, t }); };
    const anim = setInterval(() => { if (!prev.isConnected) return clearInterval(anim); t += 0.1; drawPrev(); }, 100);
    const commit = () => { send({ t: 'look', look }); me.name = look.name; me.fur = look.fur; saveMe(); drawPrev(); };
    const group = (title, tbl, key, swatch) => h('div', {}, h('h3', {}, title), h('div', { class: 'opts' }, ...Object.entries(tbl).map(([k, v]) => {
      const locked = v.lvl > pr.level;
      return h('button', { class: 'opt' + (look[key] === k ? ' on' : '') + (locked ? ' locked' : ''), disabled: locked, style: swatch ? `--c:${swatch(v)}` : '',
        onclick: (e) => { look[key] = k; e.currentTarget.parentNode.querySelectorAll('.opt').forEach((b) => b.classList.remove('on')); e.currentTarget.classList.add('on'); commit(); } },
        swatch ? h('i', {}) : null, v.name, locked ? h('small', {}, ` 🔒LV${v.lvl}`) : null);
    })));
    const name = h('input', { class: 'name', maxLength: 12, value: look.name, onchange: (e) => { const n = cleanName(e.target.value); if (n) { look.name = n; commit(); } } });
    const st = pr.stats;
    return [h('div', { class: 'catcard' }, prev, name),
      group('Pijlsoort', ARROWS, 'arrow', (v) => v.fletch),
      h('p', { class: 'small' }, ARROWS[look.arrow].desc),
      group('Vacht', FURS, 'fur', (v) => v.c[0]), group('Hoed', HATS, 'hat'), group('Cape', CAPES, 'cape', (v) => v.c || '#333'), group('Huisdier', PETS, 'pet'),
      h('h3', {}, 'Statistieken'),
      h('div', { class: 'stats' }, ...[['Schoten', st.shots], ['Treffers', st.hits], ['Raak %', st.shots ? Math.round((st.hits / st.shots) * 100) + '%' : '-'], ['Beste schot', st.best], ['Pijl-in-pijl', st.splits], ['Visballonnen', st.balloons], ['Gouden muizen', st.mice], ['Beste combo', st.bestCombo], ['Totaal verdiend', fmt(st.earned)]]
        .map(([k, v]) => h('div', {}, h('span', {}, k), h('b', {}, v)))),
      h('button', { class: 'btn small', onclick: () => { if (confirm('Uitloggen op deze telefoon? Je voortgang blijft op de beamer bewaard zolang je hetzelfde ID gebruikt.')) { me.name = ''; saveMe(); location.reload(); } } }, 'Naam/kat opnieuw kiezen')];
  }

  // ---------- BOUWEN ----------
  let bType = 'target', bTool = 'rect';
  function renderBuild() {
    const pr = srv.profile;
    if (!pr.admin) {
      const pin = h('input', { class: 'name', inputMode: 'numeric', maxLength: 4, placeholder: 'Pincode' });
      return [h('h3', {}, 'Bouwen'), h('p', {}, 'Met bouwen teken je vlakken op de muur: doelen, platforms, muren en visvijvers. Vraag de pincode aan de host (staat in het menu op de laptop).'), pin,
        h('button', { class: 'btn primary', onclick: () => send({ t: 'admin', pin: pin.value }) }, 'Ontgrendel')];
    }
    const d = srv.draw || {};
    const pad = h('div', { class: 'trackpad' }, 'Sleep = cursor bewegen op de muur · Tik = punt plaatsen');
    let last = null, moved = 0, t0 = 0, acc = { x: 0, y: 0 }, st = 0;
    pad.addEventListener('pointerdown', (e) => { e.preventDefault(); pad.setPointerCapture(e.pointerId); last = { x: e.clientX, y: e.clientY }; moved = 0; t0 = performance.now(); });
    pad.addEventListener('pointermove', (e) => {
      if (!last) return; e.preventDefault();
      const r = pad.getBoundingClientRect(); const dx = (e.clientX - last.x) / r.width, dy = (e.clientY - last.y) / r.height;
      moved += Math.hypot(e.clientX - last.x, e.clientY - last.y); last = { x: e.clientX, y: e.clientY };
      acc.x += dx * 1.2; acc.y += dy * 1.2;
      if (performance.now() - st > 33) { st = performance.now(); send({ t: 'bMove', dx: acc.x, dy: acc.y }); acc = { x: 0, y: 0 }; }
    });
    pad.addEventListener('pointerup', () => { if (acc.x || acc.y) send({ t: 'bMove', dx: acc.x, dy: acc.y }); acc = { x: 0, y: 0 }; if (moved < 8 && performance.now() - t0 < 300) { send({ t: 'bPoint' }); vib(10); } last = null; });
    const chips = (obj, cur, set) => h('div', { class: 'opts' }, ...obj.map(([k, l]) => h('button', { class: 'opt' + (cur === k ? ' on' : ''), onclick: () => { set(k); render(); } }, l)));
    return [h('h3', {}, 'Wat wil je bouwen?'),
      chips(Object.entries(ZONE_TYPES).map(([k, v]) => [k, v.icon + ' ' + v.name]), bType, (k) => { bType = k; bTool = ZONE_TYPES[k].tools[0]; }),
      h('p', { class: 'small' }, ZONE_TYPES[bType].desc),
      chips(ZONE_TYPES[bType].tools.map((t) => [t, TOOLS[t]]), bTool, (k) => { bTool = k; }),
      h('div', { class: 'row' }, h('button', { class: 'btn primary', onclick: () => { send({ t: 'bStart', type: bType, tool: bTool }); toast('Kijk naar de muur: gele cursor'); } }, '✎ Start tekenen'), h('button', { class: 'btn danger', onclick: () => send({ t: 'bErase' }) }, '⌫ Wis-modus')),
      pad,
      h('div', { class: 'row' }, h('button', { class: 'btn', onclick: () => send({ t: 'bPoint' }) }, '＋ Punt'), h('button', { class: 'btn', onclick: () => send({ t: 'bUndo' }) }, '↶ Terug'),
        h('button', { class: 'btn ok', onclick: () => send({ t: 'bSave' }) }, '✓ Opslaan'), h('button', { class: 'btn', onclick: () => send({ t: 'bCancel' }) }, '✕ Stop')),
      h('p', { class: 'small' }, d.active ? (d.erase ? 'Wis-modus actief.' : `Bezig: ${ZONE_TYPES[d.type]?.name} (${TOOLS[d.tool]}) · ${d.pts?.length || 0} punten`) : 'Niet aan het tekenen.')];
  }

  document.addEventListener('gesturestart', (e) => e.preventDefault());
  render();
  net.start();
  setInterval(() => { if (net.status === 'connected') send({ t: 'ping' }); }, 3000);
}

// -----------------------------------------------------------------------------
// 12. START
// -----------------------------------------------------------------------------
function startMenu() {
  document.body.className = 'ctrl';
  const code = h('input', { class: 'name', placeholder: 'KAMERCODE', maxLength: 6, style: 'text-transform:uppercase;text-align:center;letter-spacing:.3em' });
  document.body.append(h('div', { id: 'ctrl' }, h('div', { class: 'join' },
    h('h1', {}, 'Purrfect Aim'),
    h('p', {}, 'Boogschieten met katten op je eigen muur.'),
    h('button', { class: 'btn primary big', onclick: () => { location.search = '?host=1'; } }, '📽 Start als beamer (laptop)'),
    h('h3', {}, 'Of doe mee met je telefoon'), code,
    h('button', { class: 'btn big', onclick: () => { const c = code.value.trim().toUpperCase(); if (c) location.search = '?join=' + c; } }, '🐾 Meedoen'),
    h('p', { class: 'small' }, 'Tip: scan gewoon de QR-code op de muur.'))));
}
function boot() {
  const q = new URLSearchParams(location.search);
  const join = q.get('join'), local = q.get('local');
  if (join) startController(join.toUpperCase().slice(0, 8), false);
  else if (local) startController(local.toUpperCase().slice(0, 8), true);
  else if (q.get('host') || window.innerWidth > 900) startHost();
  else startMenu();
}

window.PurrfectAim = { Game, Renderer, statsOf, canBuy, upgradeCost, xpNeed, unlocksAt, newProfile, sanitizeProfile, validZone, drawCat, drawKitten, drawText, CFG, UPGRADES, ARROWS, W, H };
if (!window.__PA_NO_BOOT) {
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot); else boot();
}
})();
