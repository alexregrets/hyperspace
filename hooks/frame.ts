// Кадр анимации: настоящая 3D-сцена в четвертьблоках ▘▝▖▗ (2×2 пикселя на клетку).
// Корабль летит по +x, вокруг звёзды и космическая пыль, враги заходят в атаку, лазеры, протонные торпеды,
// взрывы с ударным кольцом, камера режет планы, прыжок в гиперпространство с туннелем как в кино.
// Чистая функция от времени: одно и то же t всегда даёт один и тот же кадр.

import {
  xwing, ywing, awing, tie, interceptor, falcon, destroyer, asteroid,
  Scene, project, toWorld, camPos, camDirToWorld, type Cam, type Light, Mesh, type Obj, type V,
} from './three.ts'

export const ROWS = 12 // строк терминала под сцену
export const DEF = 0x01000000 // цвет терминала по умолчанию

// разрешение: quad — четвертьблоки 2×2 на клетку, sext — секстанты 2×3 (Unicode 13, нужен свежий терминал)
export type Res = 'quad' | 'sext'
// событие из работы Claude: выстрел (инструмент), торпеда (правка файла), попадание по нам (ошибка)
export type Ev = { t: number; kind: 'shot' | 'torpedo' | 'hit' }
export type Opts = { seed?: number; events?: Ev[]; res?: Res }

export type Ship = 'xwing' | 'ywing' | 'awing' | 'falcon' | 'tie' | 'interceptor'
export const SHIPS: Ship[] = ['xwing', 'ywing', 'awing', 'falcon', 'tie', 'interceptor']
export type CamMode = 'auto' | 'side' | 'rear' | 'low' | 'front' | 'top' | 'cockpit'
export const CAMS: CamMode[] = ['auto', 'side', 'rear', 'low', 'front', 'top', 'cockpit']

const IMPERIAL = new Set<Ship>(['tie', 'interceptor'])

// детерминированный «рандом» от целого
const hash = (n: number) => {
  let x = Math.imul(n ^ 0x9e3779b9, 0x85ebca6b)
  x ^= x >>> 13
  x = Math.imul(x, 0xc2b2ae35)
  return ((x ^ (x >>> 16)) >>> 0) / 0xffffffff
}
const clamp01 = (x: number) => Math.max(0, Math.min(1, x))
const ease = (x: number) => { const k = clamp01(x); return k * k * (3 - 2 * k) }
const lerp = (a: number, b: number, k: number) => a + (b - a) * k
const lerpV = (a: V, b: V, k: number): V => [lerp(a[0], b[0], k), lerp(a[1], b[1], k), lerp(a[2], b[2], k)]

// ── меши: X-wing складывает крылья, остальные постоянные ──
const meshes = new Map<string, Mesh>()
function meshOf(ship: Ship | 'destroyer' | `rock${number}`, open = 0.24, head = 0, brace = 0): Mesh {
  const headStep = Math.round(head * 8), braceStep = Math.round(brace * 16)
  const key = ship === 'xwing' ? `x${Math.round(open * 40)}:${headStep}:${braceStep}` : ship
  if (ship.startsWith('rock')) {
    let r = meshes.get(key)
    if (!r) meshes.set(key, (r = asteroid(Number(ship.slice(4)))))
    return r
  }
  let m = meshes.get(key)
  if (!m) {
    m = ship === 'xwing' ? xwing(Math.round(open * 40) / 40, headStep / 8, braceStep / 16) : ship === 'ywing' ? ywing() : ship === 'awing' ? awing()
      : ship === 'falcon' ? falcon() : ship === 'tie' ? tie() : ship === 'interceptor' ? interceptor() : destroyer()
    if (meshes.size >= 128) meshes.clear()
    meshes.set(key, m)
  }
  return m
}

// ── прыжок в гиперпространство: тайминг фаз, мс от начала прыжка ──
const FIRST_JUMP = 12_000 // сначала бой, потом прыжок
const JUMP_EVERY = 34_000
const CHARGE = 1_300 // подготовка, затем ускоряющийся рост лучей
const STRETCH = 2_350 // камера остаётся, корабль уходит вдаль за 350 мс
const FLASH = 2_700 // точка → короткая белая вспышка → туннель
const EXIT = 8_200 // разрыв туннеля; лучи сжимаются за 520 мс
export const JUMP_LEN = 10_000

// мс от начала прыжка или −1
export const jumpTime = (t: number) => {
  if (t < FIRST_JUMP) return -1
  const p = (t - FIRST_JUMP) % JUMP_EVERY
  return p < JUMP_LEN ? p : -1
}
export const hyper = (t: number) => {
  const p = jumpTime(t)
  if (p < 0) return 0
  if (p < FLASH) return Math.pow(clamp01(p / STRETCH), 3)
  if (p < EXIT) return 1
  return 1 - ease((p - EXIT) / 700)
}
// Доля радиального удлинения: рост ease-in, сжатие намного быстрее.
const streakAt = (p: number) => {
  if (p < 0) return 0
  if (p < FLASH) return Math.pow(clamp01((p - 350) / (STRETCH - 350)), 3)
  if (p < EXIT) return 0
  return Math.pow(1 - clamp01((p - EXIT) / 520), 2)
}

// Только поза прыжка: модели не меняются. Дальность и сжатие дают уход в точку.
export function jumpPose(t: number) {
  const p = jumpTime(t)
  let forward = 0, scale = 1, stretch = 1, point = 0
  if (p >= STRETCH && p < FLASH + 650) {
    const q = p < FLASH ? clamp01((p - STRETCH) / (FLASH - STRETCH)) : 1 - ease((p - FLASH - 120) / 530)
    forward = 650 * q * q * q
    scale = 1 - 0.94 * q * q
    stretch = 1 + 4 * Math.sin(Math.PI * q)
    point = ease((q - 0.65) / 0.35)
  } else if (p >= EXIT) {
    const q = clamp01((p - EXIT - 40) / 1_050)
    forward = q === 1 ? 0 : 650 * Math.pow(1 - q, 5) - 448 * Math.pow(q * (1 - q), 3)
    scale = 0.06 + 0.94 * (1 - Math.pow(1 - q, 3))
    stretch = 1 + 3 * Math.sin(Math.PI * q) * (1 - q)
    point = Math.pow(1 - q, 4)
  }
  return { forward, scale, stretch, point }
}
// Аналитическая кинематика: скорость — производная пути, никаких интеграторов и dt.
// Корпус летит носом по касательной; крен отвечает боковому ускорению, а не отдельной синусоиде.
export function flightAt(t: number, evading = false): Obj {
  const u = t % 5_200, q = clamp01((u - 1_150) / 950)
  const sn = Math.sin(Math.PI * q), cs = Math.cos(Math.PI * q)
  const sign = Math.floor(t / 5_200) % 2 ? -1 : 1
  const dodge = evading ? Math.pow(sn, 4) : 0
  const dv = evading ? 4 * sn * sn * sn * cs * Math.PI / 950 : 0
  const da = evading ? (12 * sn * sn * cs * cs - 4 * Math.pow(sn, 4)) * Math.pow(Math.PI / 950, 2) : 0
  const y = 0.55 * Math.sin(t / 1_250) + 0.13 * Math.sin(t / 520) + dodge * 0.24
  const z = 0.9 * Math.sin(t / 1_700) + 0.2 * Math.sin(t / 730) + sign * dodge * 1.2
  const vy = 0.55 / 1_250 * Math.cos(t / 1_250) + 0.13 / 520 * Math.cos(t / 520) + dv * 0.24
  const vz = 0.9 / 1_700 * Math.cos(t / 1_700) + 0.2 / 730 * Math.cos(t / 730) + sign * dv * 1.2
  const az = -0.9 / (1_700 * 1_700) * Math.sin(t / 1_700) - 0.2 / (730 * 730) * Math.sin(t / 730) + sign * da * 1.2
  const br = clamp01(((t + 21_000) % 24_000) / 1_400)
  const barrel = br < 1 ? br * br * br * (10 + br * (-15 + 6 * br)) * Math.PI * 2 : 0
  return { pos: [0, y, z], yaw: -Math.atan2(vz, 0.03), pitch: Math.atan2(vy, 0.03), roll: -Math.atan(az * 8_000) - barrel }
}

// Сервопривод головы: плавный обзор, фиксация по курсу при разгоне и затухающая стабилизация.
export function r2At(t: number, attitude: Pick<Obj, 'yaw' | 'pitch'> = flightAt(t)) {
  const p = jumpTime(t)
  const charge = p >= 0 && p < FLASH ? ease(p / STRETCH) : 0
  const braking = p >= EXIT ? Math.exp(-(p - EXIT) / 240) * Math.sin((p - EXIT) / 105) : 0
  const scan = 0.65 * Math.sin(t / 2_600) + 0.18 * Math.sin(t / 970)
  return { head: scan * (1 - charge) * (p >= FLASH && p < EXIT ? 0.3 : 1) - attitude.yaw * 0.6, brace: Math.max(-0.16, Math.min(0.16, -attitude.pitch * 0.7 - 0.1 * charge + 0.08 * braking)) }
}

// идёт ли прыжок где-то в отрезке [a, b]
const jumpIn = (a: number, b: number) => {
  for (let x = a; x <= b; x += 250) if (jumpTime(x) >= 0) return true
  return jumpTime(b) >= 0
}

// ── цвет ──
type RGB = [number, number, number]
const rgbOf = (c: number): RGB => [((c >> 16) & 255) / 255, ((c >> 8) & 255) / 255, (c & 255) / 255]
const hexOf = (c: RGB) => {
  const ch = (v: number) => Math.max(0, Math.min(255, Math.round(v * 255)))
  return (ch(c[0]) << 16) | (ch(c[1]) << 8) | ch(c[2])
}
const mixC = (a: RGB, b: RGB, k: number): RGB => [lerp(a[0], b[0], k), lerp(a[1], b[1], k), lerp(a[2], b[2], k)]
const WHITE: RGB = [1, 1, 1]
// огонь: белый → жёлтый → оранжевый → красный → дым
const FIRE: RGB[] = [[1, 1, 0.95], [1, 0.9, 0.45], [1, 0.55, 0.15], [0.85, 0.2, 0.05], [0.25, 0.2, 0.2], [0, 0, 0]]
const fire = (k: number): RGB => {
  const x = clamp01(k) * (FIRE.length - 1), i = Math.min(FIRE.length - 2, Math.floor(x))
  return mixC(FIRE[i]!, FIRE[i + 1]!, x - i)
}
// туннель: глубокая синь → кобальт → голубой → белый
const TUN: RGB[] = [[0.01, 0.03, 0.1], [0.04, 0.14, 0.42], [0.16, 0.42, 0.88], [0.6, 0.85, 1], [1, 1, 1]]
const tun = (k: number): RGB => {
  const x = clamp01(k) * (TUN.length - 1), i = Math.min(TUN.length - 2, Math.floor(x))
  return mixC(TUN[i]!, TUN[i + 1]!, x - i)
}

// гладкий шум 2D: значения в узлах решётки, между ними smoothstep
function noise(x: number, y: number) {
  const xi = Math.floor(x), yi = Math.floor(y), xf = x - xi, yf = y - yi
  const h = (a: number, b: number) => hash(a * 374761 + b * 668265)
  const u = xf * xf * (3 - 2 * xf), v = yf * yf * (3 - 2 * yf)
  return lerp(lerp(h(xi, yi), h(xi + 1, yi), u), lerp(h(xi, yi + 1), h(xi + 1, yi + 1), u), v)
}

// цвет пикселя небесного тела по нормали: 0 — Звезда Смерти, 1 — пустынная планета, 2 — ледяная
function bodyColor(kind: number, nx: number, ny: number, seed: number): RGB {
  const nz = Math.sqrt(Math.max(0, 1 - nx * nx - ny * ny))
  const lam = Math.max(0, -0.35 * nx - 0.75 * ny + 0.55 * nz)
  const shade = 0.04 + 0.96 * lam
  const g = noise(nx * 9 + seed, ny * 9)
  let c: RGB
  if (kind === 0) {
    c = mixC([0.55, 0.57, 0.6], [0.72, 0.74, 0.77], g)
    if (Math.abs(ny + 0.04) < 0.06) c = mixC(c, [0.15, 0.15, 0.17], 0.7) // экваториальная траншея
    const dx = nx + 0.38, dy = ny + 0.36, dd = dx * dx + dy * dy
    if (dd < 0.07) c = mixC(c, [0.2, 0.21, 0.23], dd < 0.01 ? 0.3 : 0.6) // чаша суперлазера
  } else if (kind === 1) {
    c = mixC([0.85, 0.68, 0.45], [0.6, 0.42, 0.26], 0.5 + 0.5 * Math.sin(ny * 10 + g * 2.5))
  } else {
    c = mixC([0.92, 0.95, 1], [0.55, 0.68, 0.84], g * 0.8 + (Math.abs(ny) > 0.7 ? 0 : 0.15))
  }
  // атмосфера: голубой ободок по краю у планет
  const rim = kind === 0 ? 0 : Math.pow(1 - nz, 4) * 0.5 * (0.3 + lam)
  return [c[0] * shade + rim * 0.4, c[1] * shade + rim * 0.6, c[2] * shade + rim]
}

// ── камера: планы, монтаж по времени, ручная тряска ──
type Shot = { azim: number; elev: number; dist: number; fy: number; tx: number; cx: number; drift: number }
// прыжок: камера прямо за хвостом, точка схода по центру — как Сокол уходит в гипер в фильме
const JUMP_SHOT: Shot = { azim: Math.PI / 2, elev: 0.025, dist: 21, fy: 2.9, tx: 1, cx: 0.5, drift: 0 }
const SHOTS: Record<Exclude<CamMode, 'auto'>, Shot> = {
  side: { azim: 0.42, elev: 0.22, dist: 34, fy: 2.67, tx: 1, cx: 0.3, drift: 0.12 }, // классика: идёт вправо, чуть от нас
  rear: { azim: 1.18, elev: 0.12, dist: 30, fy: 2.73, tx: 3, cx: 0.34, drift: 0.08 }, // из-за хвоста: видна точка, куда летим
  low: { azim: 0.75, elev: -0.3, dist: 28, fy: 2.79, tx: 1, cx: 0.32, drift: 0.15 }, // снизу, героический ракурс
  front: { azim: -0.75, elev: 0.16, dist: 32, fy: 2.67, tx: 4, cx: 0.62, drift: -0.12 }, // спереди-сбоку: летит на нас
  top: { azim: 0.3, elev: 0.95, dist: 34, fy: 2.60, tx: 1, cx: 0.3, drift: 0.1 }, // сверху: вид на крылья
  cockpit: { azim: Math.PI / 2, elev: -0.02, dist: 30, fy: 2.6, tx: 30, cx: 0.5, drift: 0.04 }, // из кабины: камера в фонаре, смотрит по курсу
}
const CUT_ORDER: Exclude<CamMode, 'auto'>[] = ['side', 'rear', 'cockpit', 'low', 'side', 'front', 'top', 'cockpit']
const CUT = 6_500

// камера в момент t: в прыжке всегда из-за хвоста, иначе по монтажу или выбранная
export function cameraAt(t: number, mode: CamMode, PW: number, PH = ROWS * 2, shakeUntil = -1): { cam: Cam; name: string } {
  const p = jumpTime(t)
  let name: Exclude<CamMode, 'auto'>, u: number
  if (p >= 0) { name = 'rear'; u = p / JUMP_LEN }
  else if (mode === 'auto') { const k = Math.floor(t / CUT); name = CUT_ORDER[k % CUT_ORDER.length]!; u = (t % CUT) / CUT }
  else { name = mode; u = (t % 12_000) / 12_000 }
  const s = p >= 0 ? JUMP_SHOT : SHOTS[name]
  // ручная камера: медленный дрейф по плану + мелкая дрожь, на разгоне сильнее
  const hitShake = shakeUntil > t ? 0.05 * ((shakeUntil - t) / 450) : 0 // попадание по нам
  const shake = (p >= 0 ? (p < STRETCH ? 0.025 * Math.pow(p / STRETCH, 3) : p < FLASH ? 0.025 : 0.0015) : 0.004) + hitShake
  const jx = (noise(t / 140, 1) - 0.5) * shake, jy = (noise(t / 140, 7) - 0.5) * shake
  const SY = PH / ROWS // пикселей на клетку по вертикали: 2 или 3
  const cockpit = name === 'cockpit' && p < 0
  const cam: Cam = {
    target: [s.tx, cockpit ? 0.95 : 0, 0], azim: s.azim + s.drift * (u - 0.5) + jx, elev: s.elev + jy,
    roll: (p >= 0 ? 0 : cockpit ? Math.sin(t / 1300) * 0.2 : Math.sin(t / 2300) * 0.03) + jx * 0.5,
    dist: s.dist, fy: (s.fy * SY) / 2, ax: 4 / SY, cx: PW * s.cx, cy: PH / 2,
  }
  return { cam, name: p >= 0 ? 'jump' : name }
}

// ── звёзды и пыль: точки в мире, корабль летит сквозь них ──
type Star = { p: V; b: number; tint: RGB }
const TINTS: RGB[] = [[1, 1, 1], [0.8, 0.88, 1], [1, 0.93, 0.82], [1, 1, 1], [0.75, 0.82, 1]]
const STARS: Star[] = Array.from({ length: 1400 }, (_, i) => {
  let p: V = [0, 0, 0]
  for (let k = 0; k < 8; k++) {
    p = [(hash(i * 3 + 1 + k * 9001) - 0.5) * 520, (hash(i * 3 + 2 + k * 9001) - 0.5) * 300, (hash(i * 3 + 3 + k * 9001) - 0.5) * 520]
    if (Math.hypot(p[0], p[1], p[2]) > 70) break // не рядом с кораблём и камерой
  }
  return { p, b: 0.25 + 0.75 * Math.pow(hash(i * 7 + 5), 3), tint: TINTS[Math.floor(hash(i * 11) * TINTS.length)]! }
})
const DUST: V[] = Array.from({ length: 90 }, (_, i) => [(hash(i * 5 + 1) - 0.5) * 80, (hash(i * 5 + 2) - 0.5) * 30, (hash(i * 5 + 3) - 0.5) * 70])

const CRUISE = 0.03 // единиц мира за мс: ~2 корпуса в секунду

// ── бой: детерминированная хореография на цикле ──
const WAVE = 5_200
// болт: летит из a в b; abs — время задано абсолютно (а не от начала волны)
type Bolt = { a: V; b: V; t0: number; t1: number; col: RGB; abs?: boolean }

// позиция врага в волне на время u (мс от начала волны); враг заходит справа-сзади и идёт на нас
function enemyPath(k: number, u: number, reach: number): { pos: V; yaw: number; roll: number } {
  const sy = hash(k * 13) < 0.5 ? 1 : -1
  const S: V = [reach + 55, sy * (3 + hash(k * 5) * 3), -50 - hash(k * 3) * 25]
  const H: V = [reach, sy * (0.5 + hash(k * 9) * 1.5), -5 - hash(k * 17) * 6]
  const e = ease(u / 2_700)
  const pos: V = [lerp(S[0], H[0], e), lerp(S[1], H[1], e) + Math.sin(u / 300) * 0.6, lerp(S[2], H[2], e)]
  return { pos, yaw: Math.PI - 0.25 + Math.sin(u / 500) * 0.2, roll: Math.sin(u / 420 + k) * 0.6 }
}

// ── основной кадр ──
// буферы кадра живут между кадрами: на 15 к/с не плодим мусор для сборщика
const pool = new Map<string, { rgb: Float32Array; br: Float32Array; tmp: Float32Array; scene: Scene }>()
function buffers(PW: number, PH: number) {
  const key = `${PW}x${PH}`
  let b = pool.get(key)
  if (!b) {
    if (pool.size > 4) pool.clear()
    const n = PW * PH * 3
    pool.set(key, (b = { rgb: new Float32Array(n), br: new Float32Array(n), tmp: new Float32Array(n), scene: new Scene(PW, PH) }))
  }
  b.rgb.fill(0)
  b.scene.reset()
  return b
}

// сколько врагов сбито к моменту t хода: волна засчитана, когда враг взорвался
export function killsAt(t: number): number {
  let n = 0
  for (let k = 0; k * WAVE + 2_700 <= t; k++) if (!jumpIn(k * WAVE, k * WAVE + WAVE)) n++
  return n
}

export function frame(t: number, columns: number, ship: Ship, camMode: CamMode = 'auto', opts: Opts = {}): Uint32Array {
  const res = opts.res ?? 'quad', SY = res === 'sext' ? 3 : 2
  const PW = columns * 2, PH = ROWS * SY
  const N = PW * PH
  const seed = opts.seed ?? 0
  const events = opts.events ?? []
  const buf = buffers(PW, PH)
  const rgb = buf.rgb // HDR-буфер: может быть > 1, потом блум и мягкий клип
  const add = (x: number, y: number, c: RGB, a: number) => {
    x = Math.round(x); y = Math.round(y)
    if (x < 0 || x >= PW || y < 0 || y >= PH) return
    const o = (y * PW + x) * 3
    rgb[o] += c[0] * a; rgb[o + 1] += c[1] * a; rgb[o + 2] += c[2] * a
  }
  // отрезок с аддитивным свечением, яркость от головы к хвосту
  const ray = (x0: number, y0: number, x1: number, y1: number, c: RGB, a0: number, a1: number, occl?: (x: number, y: number) => boolean) => {
    const n = Math.min(600, Math.max(1, Math.ceil(Math.max(Math.abs(x1 - x0), Math.abs(y1 - y0) * 2))))
    for (let i = 0; i <= n; i++) {
      const k = i / n, x = lerp(x0, x1, k), y = lerp(y0, y1, k)
      if (occl && occl(x, y)) continue
      add(x, y, c, lerp(a0, a1, k))
    }
  }

  const p = jumpTime(t)
  const h = hyper(t)
  const lastHit = events.reduce((m, e) => (e.kind === 'hit' && e.t <= t ? Math.max(m, e.t) : m), -1e9)
  const { cam, name: shotName } = cameraAt(t, camMode, PW, PH, lastHit + 450)
  const cockpit = shotName === 'cockpit'
  const cp = camPos(cam)
  const imperial = IMPERIAL.has(ship)
  const myLaser: RGB = imperial ? [0.35, 1, 0.4] : [1, 0.25, 0.18]
  const theirLaser: RGB = imperial ? [1, 0.25, 0.18] : [0.35, 1, 0.4]
  const reach = Math.min(34, Math.max(16, (columns * 0.55) / 2.5)) // как далеко вперёд видно на этой ширине

  const inTunnel = p >= FLASH && p < EXIT + 80
  const scene = buf.scene

  // ── 1. цилиндр: широкие облачные потоки, смаз вдоль курса, белый центр ──
  if (inTunnel) {
    const tt = p - FLASH, R = 14
    // Ортонормальный базис один раз на кадр. Ненормированный луч даёт тот же
    // корень пересечения, экономя три поворота и hypot на каждом пикселе.
    const right = camDirToWorld([1, 0, 0], cam), up = camDirToWorld([0, 1, 0], cam)
    const forward = camDirToWorld([0, 0, -cam.dist], cam)
    const invX = 1 / (cam.ax * cam.fy), invY = 1 / cam.fy
    for (let y = 0; y < PH; y++) for (let x = 0; x < PW; x++) {
      const sx = (x + 0.5 - cam.cx) * invX, sy = -(y + 0.5 - cam.cy) * invY
      const wx = forward[0] + sx * right[0] + sy * up[0]
      const wy = forward[1] + sx * right[1] + sy * up[1]
      const wz = forward[2] + sx * right[2] + sy * up[2]
      const A = wy * wy + wz * wz, B = 2 * (cp[1] * wy + cp[2] * wz), C = cp[1] * cp[1] + cp[2] * cp[2] - R * R
      const distance = A < 1e-5 ? 2_000 : (-B + Math.sqrt(Math.max(0, B * B - 4 * A * C))) / (2 * A)
      const u = Math.min(450, cp[0] + distance * wx)
      const th = Math.atan2(cp[1] + distance * wy, cp[2] + distance * wz) + u * 0.002 + tt * 0.000065
      // Плюс время: облака идут от большой глубины к камере, от центра к краям.
      const flow = u * 0.026 + tt * 0.0045
      // Три выдержки вдоль оси: продольный смаз без высокочастотных октав.
      const angular = Math.cos(th) * 2.1 + 8
      const cloud = (noise(angular, flow) + 2 * noise(angular, flow - 0.65) + noise(angular, flow - 1.3)) / 4
      const cloudLight = ease((cloud - 0.25) / 0.5)
      const bands = Math.pow(0.5 + 0.5 * Math.sin(th * 7 + 1.3 * Math.sin(th * 3) + cloud * 2), 3)
      const trace = Math.pow(0.5 + 0.5 * Math.sin(th * 11 + Math.sin(th * 4) + u * 0.004), 18)
      const pulse = 0.4 + 0.6 * noise(Math.sin(th) * 2 + 20, flow * 0.45)
      const fog = 1 - Math.exp(-Math.max(0, u) / 105)
      const c = tun(0.08 + fog * 0.78 + bands * (0.05 + cloudLight * 0.43) + trace * pulse * 0.25)
      const core = Math.pow(fog, 8) * 1.5
      const o = (y * PW + x) * 3
      rgb[o] = c[0] + core; rgb[o + 1] = c[1] + core; rgb[o + 2] = c[2] + core
    }
  }

  // ── 2. далёкое: Звезда Смерти / пустынная / ледяная / звёздный разрушитель, раз в проход ──
  const span = 300, passX = (t * 0.006) % span
  const pass = Math.floor((t * 0.006) / span) + (t > FIRST_JUMP + EXIT ? 1 : 0)
  const kind = (pass + seed) % 5 // 0–2 планеты, 3 — разрушитель, 4 — поле астероидов
  if (!inTunnel && kind < 3) {
    const R = kind === 0 ? 26 : 34
    const center: V = [140 - passX, kind === 0 ? 30 : -28, -170]
    const pc = project(center, cam)
    if (pc) {
      const rpx = R * pc[3]
      for (let y = Math.max(0, Math.floor(pc[1] - rpx)); y <= Math.min(PH - 1, pc[1] + rpx); y++) {
        for (let x = Math.max(0, Math.floor(pc[0] - rpx * cam.ax)); x <= Math.min(PW - 1, pc[0] + rpx * cam.ax); x++) {
          const nx = (x + 0.5 - pc[0]) / (rpx * cam.ax), ny = (y + 0.5 - pc[1]) / rpx
          const r2 = nx * nx + ny * ny
          if (r2 > 1) continue
          const c = bodyColor(kind, nx, ny, pass * 3.7)
          const a = Math.min(1, (1 - Math.sqrt(r2)) * rpx * 1.5) // сглаженный край диска
          const o = (y * PW + x) * 3
          rgb[o] = c[0] * a; rgb[o + 1] = c[1] * a; rgb[o + 2] = c[2] * a
        }
      }
    }
  }

  // ── 3. звёзды: точки в покое, лучи от точки схода в прыжке; пыль у камеры — чувство скорости ──
  const L = streakAt(p)
  if (!inTunnel) {
    // В разгоне фиксируем исходные точки; после выхода новое небо больше не скачет назад.
    const completed = t < FIRST_JUMP ? 0 : Math.floor((t - FIRST_JUMP) / JUMP_EVERY) + (p < 0 || p >= EXIT ? 1 : 0)
    const starTime = p >= 0 && p < FLASH ? t - p : t
    const shift = starTime * CRUISE + completed * 777
    const vp = project([cp[0] + 10_000, cp[1], cp[2]], cam)!
    const settle = p >= EXIT ? 0.045 * Math.sin((p - EXIT) / 80) * Math.exp(-(p - EXIT) / 240) : 0
    for (let i = 0; i < STARS.length; i++) {
      const st = STARS[i]!
      const x = ((((st.p[0] - shift) % 520) + 780) % 520) - 260
      const a = project([x, st.p[1], st.p[2]], cam)
      if (!a || a[0] < -40 || a[0] > PW + 40 || a[1] < -40 || a[1] > PH + 40) continue
      const tw = 0.75 + 0.25 * noise(i, t / 400)
      const near = clamp01(80 / a[2])
      const br = st.b * tw * (1 + L * near * 2)
      if (p < 0) { add(a[0], a[1], st.tint, br); continue }
      const dx = a[0] - vp[0], dy = a[1] - vp[1]
      const hx = a[0] + dx * settle, hy = a[1] + dy * settle
      add(hx, hy, [0.85, 0.94, 1], br)
      if (L < 0.004 || (st.b < 0.4 && i % 4)) continue
      // Голова остаётся на звезде, гаснущий хвост растёт наружу строго по радиусу.
      const len = L * (0.3 + 2.8 * near)
      ray(hx, hy, hx + dx * len, hy + dy * len, [0.78, 0.9, 1], br * 0.65, 0)
    }
    // пыль: короткие штрихи, проносятся мимо камеры
    const dshift = t * CRUISE * 1.4
    for (let i = 0; i < (p < 0 ? DUST.length : 0); i++) {
      const d = DUST[i]!
      const x = ((((d[0] - dshift) % 80) + 120) % 80) - 40 + cam.target[0]
      const a = project([x, d[1], d[2]], cam), b = project([x + 0.735, d[1], d[2]], cam)
      if (!a || !b || a[2] > 45) continue
      ray(a[0], a[1], b[0], b[1], [0.6, 0.62, 0.68], 0.35, 0)
    }
  }

  // ── 4. корабли: игрок, враги, разрушитель на фоне ──
  const tick = Math.floor(t / 90) % 3
  const engine = hexOf(mixC(rgbOf([0xff8a3d, 0xffa64d, 0xffc46b][tick]!), [0.55, 0.75, 1], h))
  const blue = hexOf(mixC(rgbOf([0x4fb4ff, 0x7fd0ff, 0xb8e8ff][tick]!), WHITE, h * 0.7))

  // разрушитель: огромный, далеко, медленно
  const destObj: Obj = { pos: [150 - passX * 1.1, 16, -120], yaw: 0.25, pitch: -0.05, roll: 0, scale: 3.6 }
  if (!inTunnel && kind === 3) scene.draw(meshOf('destroyer'), destObj, cam, engine, blue)

  // волна боя: только в обычном полёте и не впритык к прыжку
  const k = Math.floor(t / WAVE) + seed * 7919, u = t % WAVE, w0 = t - u
  const fight = !jumpIn(w0, w0 + WAVE)
  const torpedo = k % 3 === 2
  const foeShip: Ship = imperial ? (k % 2 ? 'awing' : 'xwing') : (k % 2 ? 'interceptor' : 'tie')
  const HIT = 2_700, BOOM = 1_900

  // поза игрока: крен, уклонение от огня, бочка, тряска и рывок в прыжке
  const open = p < 0 ? 0.24 : p < CHARGE ? 0.24 * (1 - ease(p / CHARGE)) : p < EXIT ? 0 : 0.24 * ease((p - EXIT) / (JUMP_LEN - EXIT))
  const pose = jumpPose(t)
  // Перед прыжком автопилот гасит поперечную скорость и выводит корпус на курс.
  const flight = flightAt(t, fight)
  const align = p >= 0 ? 1 - ease(p / CHARGE) : 1
  const settling = p >= EXIT ? Math.sin((p - EXIT) / 110) * Math.exp(-(p - EXIT) / 260) : 0
  const vibration = p >= 0 && p < FLASH ? Math.pow(clamp01(p / STRETCH), 3) * 0.035 * Math.sin(t / 27) : 0
  const me: Obj = {
    pos: [pose.forward, flight.pos[1] * align + vibration, flight.pos[2] * align], scale: pose.scale,
    yaw: flight.yaw * align, pitch: flight.pitch * align + settling * 0.035,
    roll: p < 0 ? flight.roll : Math.atan2(Math.sin(flight.roll), Math.cos(flight.roll)) * align,
  }
  // свет от взрыва и от событий: подсвечивает корпуса рядом
  const lights: Light[] = []
  if (fight && u >= HIT && u < HIT + 900) {
    lights.push({ p: enemyPath(k, HIT, reach).pos, col: [1, 0.6, 0.25], k: 9 * Math.pow(1 - (u - HIT) / 900, 2) * (torpedo ? 1.6 : 1) })
  }
  for (const ev of events) {
    const age = t - ev.t
    if (ev.kind === 'torpedo' && age >= 650 && age < 1_300) lights.push({ p: [34, 0, -4], col: [1, 0.6, 0.25], k: 8 * (1 - (age - 650) / 650) })
    if (ev.kind === 'hit' && age >= 0 && age < 350) lights.push({ p: [2, 2, 3], col: [0.4, 1, 0.4], k: 2.5 * (1 - age / 350) })
  }

  // поле астероидов: глыбы разного размера медленно крутятся и проплывают мимо
  if (!inTunnel && kind === 4) {
    for (let i = 0; i < 26; i++) {
      const r = 1 + hash(i * 41 + pass) * 3.5
      const span2 = 260
      const x = ((((hash(i * 43 + pass) * span2 - t * CRUISE * 0.8) % span2) + span2) % span2) - 90
      const ap: V = [x, (hash(i * 47 + pass) - 0.5) * 26, -8 - hash(i * 53 + pass) * 70]
      if (Math.abs(ap[1]) < r + 3 && ap[2] > -14 && Math.abs(ap[0]) < 12) continue // не в корабль
      scene.draw(meshOf(`rock${i % 7}`), { pos: ap, yaw: t / (900 + i * 70), pitch: t / (1300 + i * 50), roll: i, scale: r }, cam, engine, blue, 1, undefined, lights)
    }
  }

  const r2 = r2At(t, me)
  let myMesh = meshOf(ship, open, r2.head, r2.brace)
  if (pose.stretch > 1.001) {
    const stretched = new Mesh()
    // Растягиваем от хвоста вперёд: хвост не должен пересекать неподвижную камеру.
    const tail = myMesh.tris.reduce((m, tri) => Math.min(m, tri.a[0], tri.b[0], tri.c[0]), Infinity)
    const stretch = ([x, y, z]: V): V => [tail + (x - tail) * pose.stretch, y, z]
    stretched.tris = myMesh.tris.map(tri => ({ ...tri, a: stretch(tri.a), b: stretch(tri.b), c: stretch(tri.c) }))
    stretched.glows = myMesh.glows.map(g => ({ ...g, p: stretch(g.p) }))
    stretched.guns = myMesh.guns.map(stretch)
    myMesh = stretched
  }
  const tunnelLit = p >= FLASH && p < EXIT
  // в туннеле корабль — тёмный силуэт с голубым контровым светом, как на фоне гиперпространства в кино
  if (!cockpit) scene.draw(myMesh, me, cam, engine, blue, tunnelLit ? 0.12 : 1, tunnelLit ? [0.15, 0.45, 1.1] : undefined, lights)

  let foeObj: Obj | null = null
  if (fight && u < HIT) {
    const f = enemyPath(k, u, reach)
    foeObj = { pos: f.pos, yaw: f.yaw, pitch: 0, roll: f.roll }
    scene.draw(meshOf(foeShip), foeObj, cam, engine, blue, 1.1, undefined, lights)
  }

  // ── 5. собрать меши поверх фона ──
  scene.resolve(rgb)
  // эффект прячется за кораблём, если корабль ближе
  const behind = (depth: number) => (x: number, y: number) => {
    const xi = Math.round(x), yi = Math.round(y)
    if (xi < 0 || xi >= PW || yi < 0 || yi >= PH) return true
    return scene.depthAt(xi, yi) < depth
  }

  // выхлоп: шлейф из каждого сопла назад по курсу, в прыжке длинный и бело-голубой
  const exhaust = (mesh: Mesh, o: Obj, len: number) => {
    for (const g of mesh.glows) {
      const a = toWorld(g.p, o), b = toWorld([g.p[0] - len, g.p[1], g.p[2]], o)
      const pa = project(a, cam), pb = project(b, cam)
      if (!pa || !pb) continue
      const c = rgbOf(g.blue ? blue : engine)
      ray(pa[0], pa[1], pb[0], pb[1], c, 0.9, 0, behind(pa[2] - 0.3))
      if (!behind(pa[2] - 0.3)(pa[0], pa[1])) add(pa[0], pa[1], c, tunnelLit ? 0.3 : 0.8) // гало сопла
    }
  }
  if (!cockpit) exhaust(myMesh, me, 1.6 + (tick === 1 ? 0.5 : 0) + h * 12)
  if (foeObj) exhaust(meshOf(foeShip), foeObj, 1.4)
  if (pose.point > 0) {
    const at = project(me.pos, cam)
    if (at) {
      add(at[0], at[1], [0.85, 0.95, 1], pose.point * 5)
      ray(at[0] - 4, at[1], at[0] + 4, at[1], [0.65, 0.85, 1], pose.point, pose.point)
    }
  }

  // ── 6. оружие ──
  const bolts: Bolt[] = []
  if (fight) {
    const H = enemyPath(k, HIT, reach).pos
    const gunAt = (i: number, tt: number) => {
      const g = myMesh.guns[i % myMesh.guns.length]!
      return toWorld(g, flightAt(w0 + tt, fight))
    }
    // свои залпы: первые мимо, последний в цель (если волна без торпеды)
    const shots = torpedo ? [1_350, 1_650, 2_000] : [1_350, 1_650, 2_000, 2_400]
    shots.forEach((ft, i) => {
      const last = !torpedo && i === shots.length - 1
      const tgt = enemyPath(k, ft + 300, reach).pos
      const miss: V = last ? [0, 0, 0] : [15, (hash(k * 31 + i) - 0.5) * 5, (hash(k * 37 + i) - 0.5) * 6]
      for (const gi of [i * 2, i * 2 + 1]) {
        bolts.push({ a: gunAt(gi, ft), b: [tgt[0] + miss[0], tgt[1] + miss[1], tgt[2] + miss[2]], t0: ft, t1: ft + (last ? 300 : 850), col: myLaser })
      }
    })
    // ответный огонь: болты врага проходят мимо нас
    for (const [i, ft] of [[0, 1_050], [1, 1_300], [2, 1_550]] as const) {
      const from = enemyPath(k, ft, reach).pos
      bolts.push({ a: from, b: [-30, 2.5 * (i - 1) + 1.5, 4 + i * 2], t0: ft, t1: ft + 700, col: theirLaser })
    }
    // протонная торпеда: дугой в цель, искрит, светится
    if (torpedo && u >= 1_800 && u < HIT) {
      const s = (u - 1_800) / (HIT - 1_800)
      const from = gunAt(0, 1_800)
      const mid: V = [(from[0] + H[0]) / 2, Math.max(from[1], H[1]) + 5, (from[2] + H[2]) / 2]
      const bez = (q: number) => lerpV(lerpV(from, mid, q), lerpV(mid, H, q), q)
      for (let j = 0; j < 14; j++) { // искрящий след
        const pt = bez(Math.max(0, s - j * 0.012))
        const pj = project([pt[0] + (hash(j + u) - 0.5) * 0.4, pt[1] + (hash(j * 3 + u) - 0.5) * 0.4, pt[2]], cam)
        if (pj) add(pj[0], pj[1], [1, 0.45, 0.2], 0.7 * (1 - j / 14))
      }
      const pt = project(bez(s), cam)
      if (pt) {
        add(pt[0], pt[1], [1, 0.95, 0.85], 3)
        for (const [dx, dy] of [[-1, 0], [1, 0], [0, -1], [0, 1], [-2, 0], [2, 0]]) add(pt[0] + dx!, pt[1] + dy!, [1, 0.35, 0.15], 1.2)
      }
    }
  }
  // турболазеры разрушителя по далёкой цели
  if (!inTunnel && kind === 3) {
    const g = meshOf('destroyer').guns
    for (let i = 0; i < 3; i++) {
      const tt = (t + i * 700) % 2_100
      const from = toWorld(g[(Math.floor((t + i * 700) / 2_100) + i) % g.length]!, destObj)
      bolts.push({ a: from, b: [from[0] + 60, from[1] + 20, from[2] + 30], t0: t - tt, t1: t - tt + 1_200, col: [0.35, 1, 0.4], abs: true })
    }
  }
  for (const bl of bolts) {
    const s = ((bl.abs ? t : u) - bl.t0) / (bl.t1 - bl.t0)
    if (s < 0 || s > 1) continue
    const dir: V = [bl.b[0] - bl.a[0], bl.b[1] - bl.a[1], bl.b[2] - bl.a[2]]
    const dl = Math.hypot(...dir) || 1
    const head = lerpV(bl.a, bl.b, s)
    const tail: V = [head[0] - (dir[0] / dl) * 3.2, head[1] - (dir[1] / dl) * 3.2, head[2] - (dir[2] / dl) * 3.2]
    const pa = project(head, cam), pb = project(tail, cam)
    if (!pa || !pb) continue
    ray(pa[0], pa[1], pb[0], pb[1], mixC(bl.col, WHITE, 0.45), 1.5, 0.5, behind(pa[2]))
  }

  // ── 7. взрыв: вспышка, огненный шар из искр, обломки, у торпеды — ударное кольцо ──
  if (fight && u >= HIT && u < HIT + BOOM) {
    const a = (u - HIT) / BOOM, sec = (u - HIT) / 1000
    const c0 = enemyPath(k, HIT, reach).pos
    const c: V = [c0[0] - sec * 6, c0[1], c0[2]] // взрыв отстаёт: мы летим дальше
    const pc = project(c, cam)
    if (pc) {
      // вспышка: диск с мягким краем, быстро растёт и гаснет
      const fr = (1.5 + 5 * Math.sqrt(a)) * pc[3] * (torpedo ? 1.4 : 1)
      const fa = Math.pow(1 - a, 2.5) * (torpedo ? 2.2 : 1.6)
      for (let y = Math.floor(pc[1] - fr); y <= pc[1] + fr; y++) for (let x = Math.floor(pc[0] - fr * cam.ax); x <= pc[0] + fr * cam.ax; x++) {
        const d = Math.hypot((x - pc[0]) / cam.ax, y - pc[1]) / (fr || 1)
        if (d <= 1.4) add(x, y, fire(d * 0.5 + a * 0.5), fa * Math.exp(-d * d * 2.5))
      }
    }
    // искры огненного шара
    const n = torpedo ? 70 : 46
    for (let i = 0; i < n; i++) {
      const th = hash(k * 1000 + i) * Math.PI * 2, ph = Math.acos(2 * hash(k * 1000 + i + 500) - 1)
      const d = (5 + hash(k * 77 + i) * 11) * sec * (1 - 0.3 * a)
      const pt = project([c[0] + Math.sin(ph) * Math.cos(th) * d, c[1] + Math.cos(ph) * d, c[2] + Math.sin(ph) * Math.sin(th) * d], cam)
      if (!pt) continue
      const life = clamp01(a * (0.8 + hash(i * 9) * 0.6))
      add(pt[0], pt[1], fire(life * 1.1), 1.4 * (1 - life))
    }
    // обломки: тёмные куски с отблеском, разлетаются
    for (let i = 0; i < 9; i++) {
      const v: V = [(hash(k * 50 + i) - 0.5) * 14, (hash(k * 51 + i) - 0.5) * 9, (hash(k * 52 + i) - 0.5) * 14]
      const pt = project([c[0] + v[0] * sec, c[1] + v[1] * sec, c[2] + v[2] * sec], cam)
      if (!pt) continue
      const glint = (Math.floor(u / 80) + i) % 4 === 0 ? 0.9 : 0.25
      add(pt[0], pt[1], [0.8, 0.8, 0.85], glint * (1 - a))
    }
    // ударное кольцо: расширяется в наклонной плоскости
    if (torpedo) {
      const rr = 1 + 16 * Math.pow(a, 0.6)
      for (let i = 0; i < 90; i++) {
        const th = (i / 90) * Math.PI * 2
        const pt = project([c[0] + Math.cos(th) * rr, c[1] + Math.sin(th) * rr * 0.25 + Math.cos(th) * rr * 0.15, c[2] + Math.sin(th) * rr], cam)
        if (pt) add(pt[0], pt[1], [0.75, 0.9, 1], 1.5 * Math.pow(1 - a, 1.5))
      }
    }
  }

  // ── 7б. события из работы Claude: инструмент — залп, правка файла — торпеда, ошибка — попадание по нам ──
  if (p < 0 || p > JUMP_LEN) for (let ei = 0; ei < events.length; ei++) {
    const ev = events[ei]!, age = t - ev.t
    if (age < 0 || age > 1_900) continue
    const aim: V = foeObj ? foeObj.pos : [reach + 25, (hash(ei) - 0.5) * 4, -10]
    if (ev.kind === 'shot' && age < 450) {
      // спаренный залп из всех пушек разом
      for (const g of myMesh.guns.slice(0, 4)) {
        const from = toWorld(g, me)
        const s1 = age / 450
        const head = lerpV(from, [aim[0] + 10, aim[1] + (hash(ei * 3) - 0.5) * 3, aim[2]], s1)
        const pa = project(head, cam), pb = project(lerpV(from, head, Math.max(0, 1 - 4 / Math.max(4, Math.hypot(head[0] - from[0], head[1] - from[1], head[2] - from[2])))), cam)
        if (pa && pb) ray(pa[0], pa[1], pb[0], pb[1], mixC(myLaser, WHITE, 0.45), 1.6, 0.5, behind(pa[2]))
      }
    }
    if (ev.kind === 'torpedo') {
      const tgt: V = [34, 0, -4]
      const from = toWorld(myMesh.guns[0]!, me)
      if (age < 650) {
        const s1 = age / 650
        const mid: V = [(from[0] + tgt[0]) / 2, from[1] + 1.2, (from[2] + tgt[2]) / 2]
        const pt = project(lerpV(lerpV(from, mid, s1), lerpV(mid, tgt, s1), s1), cam)
        if (pt) { add(pt[0], pt[1], [1, 0.95, 0.85], 3); add(pt[0] - 1, pt[1], [1, 0.35, 0.15], 1.5); add(pt[0] + 1, pt[1], [1, 0.35, 0.15], 1.5) }
      } else {
        // детонация в пустоте: вспышка и ударное кольцо
        const a = (age - 650) / 1_250
        const pc = project(tgt, cam)
        if (pc) {
          const fr = (1 + 4 * Math.sqrt(a)) * pc[3]
          for (let y = Math.floor(pc[1] - fr); y <= pc[1] + fr; y++) for (let x = Math.floor(pc[0] - fr * cam.ax); x <= pc[0] + fr * cam.ax; x++) {
            const d = Math.hypot((x - pc[0]) / cam.ax, y - pc[1]) / (fr || 1)
            if (d <= 1.4) add(x, y, fire(d * 0.5 + a * 0.5), 2 * Math.pow(1 - a, 2.5) * Math.exp(-d * d * 2.5))
          }
        }
        const rr = 1 + 14 * Math.pow(a, 0.6)
        for (let i = 0; i < 80; i++) {
          const th = (i / 80) * Math.PI * 2
          const pt = project([tgt[0] + Math.cos(th) * rr, tgt[1] + Math.sin(th) * rr * 0.25, tgt[2] + Math.sin(th) * rr], cam)
          if (pt) add(pt[0], pt[1], [0.75, 0.9, 1], 1.4 * Math.pow(1 - a, 1.5))
        }
      }
    }
    if (ev.kind === 'hit' && age < 700) {
      // болт врага бьёт в корпус: искры с места попадания и короткая вспышка
      const at = toWorld([0.5, 0.6, 0.4], me)
      if (age < 160) {
        const head = lerpV([30, 3, -6], at, age / 160)
        const pa = project(head, cam), pb = project(lerpV(head, [30, 3, -6], 0.12), cam)
        if (pa && pb) ray(pa[0], pa[1], pb[0], pb[1], mixC(theirLaser, WHITE, 0.45), 1.8, 0.5)
      } else {
        const a = (age - 160) / 540
        for (let i = 0; i < 24; i++) {
          const v: V = [(hash(ei * 70 + i) - 0.6) * 9, (hash(ei * 71 + i) - 0.3) * 7, (hash(ei * 72 + i) - 0.5) * 9]
          const pt = project([at[0] + v[0] * a, at[1] + v[1] * a - 3 * a * a, at[2] + v[2] * a], cam)
          if (pt) add(pt[0], pt[1], fire(a * 0.9), 1.6 * (1 - a))
        }
        const pc = project(at, cam)
        if (pc && a < 0.4) add(pc[0], pc[1], [1, 1, 0.9], 3 * (1 - a / 0.4))
      }
    }
  }

  // ── 7в. вид из кабины: рама фонаря, прицел, захват цели ──
  if (cockpit) {
    const strut = (x0: number, y0: number, x1: number, y1: number) => {
      const n = Math.ceil(Math.max(Math.abs(x1 - x0), Math.abs(y1 - y0) * cam.ax))
      for (let i = 0; i <= n; i++) {
        const x = Math.round(lerp(x0, x1, i / n)), y = Math.round(lerp(y0, y1, i / n))
        for (const dx of [0, 1, 2]) if (x + dx >= 0 && x + dx < PW && y >= 0 && y < PH) {
          const o = (y * PW + x + dx) * 3
          rgb[o] = 0.13; rgb[o + 1] = 0.14; rgb[o + 2] = 0.16
        }
      }
    }
    // две стойки фонаря от нижних углов вверх и нижняя приборная кромка
    strut(PW * 0.06, PH - 1, PW * 0.3, 0)
    strut(PW * 0.94, PH - 1, PW * 0.7, 0)
    for (let x = 0; x < PW; x++) for (let y = PH - Math.max(1, Math.round(PH * 0.08)); y < PH; y++) {
      const o = (y * PW + x) * 3
      rgb[o] = 0.1; rgb[o + 1] = 0.11; rgb[o + 2] = 0.12
    }
    // прицел: крест в центре
    const hud: RGB = [0.3, 1, 0.45]
    const cx = Math.round(cam.cx), cy = Math.round(cam.cy)
    for (const d of [3, 4, 5]) { add(cx - d * 2, cy, hud, 0.8); add(cx + d * 2, cy, hud, 0.8) }
    add(cx, cy - 2, hud, 0.8); add(cx, cy + 2, hud, 0.8)
    // захват: уголки вокруг врага, в момент выстрела краснеют
    if (foeObj) {
      const pf = project(foeObj.pos, cam)
      if (pf) {
        const lock = u > 2_100
        const col: RGB = lock ? [1, 0.3, 0.2] : [1, 0.75, 0.2]
        const r = Math.max(3, 3.2 * pf[3]), rx = r * cam.ax
        for (const [sx, sy] of [[-1, -1], [1, -1], [-1, 1], [1, 1]] as const) {
          for (let i = 0; i < 3; i++) { add(pf[0] + sx * rx - sx * i, pf[1] + sy * r, col, 1); add(pf[0] + sx * rx, pf[1] + sy * r - sy * i, col, 1) }
        }
      }
    }
  }

  // ── 8. вспышки прыжка: вход и выход заливают кадр белым ──
  let white = 0
  if (p >= FLASH - 50 && p < FLASH + 180) white = p < FLASH ? ease((p - FLASH + 50) / 50) : 1 - ease((p - FLASH) / 180)
  else if (p >= EXIT - 80 && p < EXIT + 160) white = p < EXIT ? ease((p - EXIT + 80) / 80) : 1 - ease((p - EXIT) / 160)
  if (white > 0) for (let i = 0; i < N * 3; i++) rgb[i] = lerp(rgb[i]!, 2.2, white)

  // ── 9. блум и анаморфные блики: яркое расплывается ореолом, огни тянут синие горизонтальные полосы ──
  bloom(rgb, buf.br, buf.tmp, PW, PH)

  // ── 10. киношная рамка: в прыжке сверху и снизу наезжают чёрные полосы ──
  if (p >= CHARGE * 0.5 && p < JUMP_LEN - 400) {
    const k = Math.min(ease((p - CHARGE * 0.5) / 600), 1 - ease((p - JUMP_LEN + 1_000) / 600))
    const bar = Math.round(k * SY)
    for (let y = 0; y < bar; y++) for (let x = 0; x < PW; x++) for (const yy of [y, PH - 1 - y]) {
      const o = (yy * PW + x) * 3
      rgb[o] = 0; rgb[o + 1] = 0; rgb[o + 2] = 0
    }
  }

  return res === 'sext' ? encodeSext(rgb, columns) : encodeQuads(rgb, columns)
}

// блум: всё ярче порога размывается коробочным фильтром (по x шире — пиксели узкие) и добавляется
function bloom(rgb: Float32Array, br: Float32Array, tmp: Float32Array, W: number, H: number) {
  const N = W * H
  let any = false
  for (let i = 0; i < N * 3; i++) { const v = rgb[i]! - 0.8; br[i] = v > 0 ? v : 0; if (v > 0) any = true }
  if (!any) return
  // скользящее окно: сумма по строке/столбцу за O(1) на пиксель
  const passX = (src: Float32Array, dst: Float32Array, r: number) => {
    for (let y = 0; y < H; y++) for (let ch = 0; ch < 3; ch++) {
      let s = 0
      for (let x = -r; x <= r; x++) if (x >= 0 && x < W) s += src[(y * W + x) * 3 + ch]!
      for (let x = 0; x < W; x++) {
        dst[(y * W + x) * 3 + ch] = s / (2 * r + 1)
        const xa = x + r + 1, xr = x - r
        if (xa < W) s += src[(y * W + xa) * 3 + ch]!
        if (xr >= 0) s -= src[(y * W + xr) * 3 + ch]!
      }
    }
  }
  const passY = (src: Float32Array, dst: Float32Array, r: number) => {
    for (let x = 0; x < W; x++) for (let ch = 0; ch < 3; ch++) {
      let s = 0
      for (let y = -r; y <= r; y++) if (y >= 0 && y < H) s += src[(y * W + x) * 3 + ch]!
      for (let y = 0; y < H; y++) {
        dst[(y * W + x) * 3 + ch] = s / (2 * r + 1)
        const ya = y + r + 1, yr = y - r
        if (ya < H) s += src[(ya * W + x) * 3 + ch]!
        if (yr >= 0) s -= src[(yr * W + x) * 3 + ch]!
      }
    }
  }
  // анаморфный блик: только очень яркое, длинная горизонтальная полоса с синим отливом
  for (let i = 0; i < N * 3; i += 3) {
    const l = (rgb[i]! + rgb[i + 1]! + rgb[i + 2]!) / 3 - 1.2
    tmp[i] = l > 0 ? l * 0.35 : 0; tmp[i + 1] = l > 0 ? l * 0.55 : 0; tmp[i + 2] = l > 0 ? l : 0
  }
  const flare = new Float32Array(tmp)
  passX(flare, tmp, 14)
  for (let i = 0; i < N * 3; i++) rgb[i] += tmp[i]! * 0.5
  passX(br, tmp, 2)
  passY(tmp, br, 1)
  passX(br, tmp, 2)
  passY(tmp, br, 1)
  for (let i = 0; i < N * 3; i++) rgb[i] += br[i]! * 0.9
}

// мягкий клип HDR → 0..1: до 0.8 линейно, выше плавно в белый
const EXPOSURE = 1.2 // общая яркость кадра
const tone = (v: number) => (v < 0.8 ? Math.max(0, v) : 0.8 + 0.2 * (1 - Math.exp(-(v - 0.8) * 4)))

// четвертьблоки: бит 1 — левый верх, 2 — правый верх, 4 — левый низ, 8 — правый низ
const QUAD = [0x20, 0x2598, 0x259d, 0x2580, 0x2596, 0x258c, 0x259e, 0x259b, 0x2597, 0x259a, 0x2590, 0x259c, 0x2584, 0x2599, 0x259f, 0x2588]
const EMPTY = 0.035 // темнее этого — пустота, сквозь неё виден фон терминала

// пиксель HDR → готовый цвет 0..1: экспозиция, сочность, мягкий клип
function graded(rgb: Float32Array, o: number): RGB {
  const r0 = rgb[o]! * EXPOSURE, g0 = rgb[o + 1]! * EXPOSURE, b0 = rgb[o + 2]! * EXPOSURE
  const l0 = (r0 + g0 + b0) / 3
  return [tone(l0 + (r0 - l0) * 1.15), tone(l0 + (g0 - l0) * 1.15), tone(l0 + (b0 - l0) * 1.15)]
}

// общий подбор для клетки из n пикселей: пустые → фон терминала, иначе лучшая пара цветов по маске
function fitCell(px: RGB[], n: number, glyph: (mask: number) => number): [number, number, number] {
  let any = 0
  for (let j = 0; j < n; j++) if (Math.max(px[j]![0], px[j]![1], px[j]![2]) > EMPTY) any |= 1 << j
  const full = (1 << n) - 1
  if (any === 0) return [0x20, DEF, DEF]
  if (any !== full) {
    // часть клетки пустая: зажжённые пиксели одним цветом, фон — терминала
    let r = 0, g = 0, b = 0, c = 0
    for (let j = 0; j < n; j++) if (any & (1 << j)) { r += px[j]![0]; g += px[j]![1]; b += px[j]![2]; c++ }
    return [glyph(any), hexOf([r / c, g / c, b / c]), DEF]
  }
  // вся клетка зажжена: перебрать сплошную и все разбиения на две группы (без зеркальных), взять лучшую
  let best = Infinity, bm = full, bf: RGB = [0, 0, 0], bb: RGB = [0, 0, 0]
  const half = 1 << (n - 1)
  for (let m = 0; m < half; m++) {
    const mask = m === 0 ? full : m
    let ar = 0, ag = 0, ab = 0, an = 0, br = 0, bg = 0, bbb = 0, bn = 0
    for (let j = 0; j < n; j++) {
      const q = px[j]!
      if (mask & (1 << j)) { ar += q[0]; ag += q[1]; ab += q[2]; an++ } else { br += q[0]; bg += q[1]; bbb += q[2]; bn++ }
    }
    const fa: RGB = [ar / an, ag / an, ab / an]
    const fb: RGB = bn ? [br / bn, bg / bn, bbb / bn] : fa
    let err = 0
    for (let j = 0; j < n; j++) {
      const ref = mask & (1 << j) ? fa : fb, q = px[j]!
      err += (q[0] - ref[0]) ** 2 + (q[1] - ref[1]) ** 2 + (q[2] - ref[2]) ** 2
    }
    if (m === 0) err -= 0.002 // при почти равной ошибке — сплошной блок
    if (err < best) { best = err; bm = mask; bf = fa; bb = fb }
  }
  return [glyph(bm), hexOf(bf), bm === full ? DEF : hexOf(bb)]
}

// секстанты 2×3: бит 1 — левый верх, 2 — правый верх, 4 — левый середина, 8 — правый середина, 16 — левый низ, 32 — правый низ
// в блоке U+1FB00 нет пустого, полного и двух половин — они берутся из обычных блоков
const sextGlyph = (m: number) => {
  if (m === 0) return 0x20
  if (m === 63) return 0x2588
  if (m === 21) return 0x258c
  if (m === 42) return 0x2590
  return 0x1fb00 + m - 1 - (m > 21 ? 1 : 0) - (m > 42 ? 1 : 0)
}

function encodeSext(rgb: Float32Array, columns: number): Uint32Array {
  const PW = columns * 2
  const out = new Uint32Array(columns * ROWS * 3)
  const px: RGB[] = Array.from({ length: 6 }, () => [0, 0, 0] as RGB)
  for (let row = 0; row < ROWS; row++) for (let cx = 0; cx < columns; cx++) {
    for (let j = 0; j < 6; j++) px[j] = graded(rgb, ((row * 3 + (j >> 1)) * PW + cx * 2 + (j & 1)) * 3)
    const [cp, fg, bg] = fitCell(px, 6, sextGlyph)
    const i = (row * columns + cx) * 3
    out[i] = cp; out[i + 1] = fg; out[i + 2] = bg
  }
  return out
}

// собрать клетки: на каждые 2×2 пикселя подобрать глиф и два цвета с минимальной ошибкой
function encodeQuads(rgb: Float32Array, columns: number): Uint32Array {
  const PW = columns * 2
  const out = new Uint32Array(columns * ROWS * 3)
  const px: RGB[] = Array.from({ length: 4 }, () => [0, 0, 0] as RGB)
  for (let row = 0; row < ROWS; row++) for (let cx = 0; cx < columns; cx++) {
    for (let j = 0; j < 4; j++) px[j] = graded(rgb, ((row * 2 + (j >> 1)) * PW + cx * 2 + (j & 1)) * 3)
    const [cp, fg, bg] = fitCell(px, 4, m => QUAD[m]!)
    const i = (row * columns + cx) * 3
    out[i] = cp; out[i + 1] = fg; out[i + 2] = bg
  }
  return out
}

// клетки в base64, как просит Raster
export const encode = (cells: Uint32Array): string => new Uint8Array(cells.buffer).toBase64()
