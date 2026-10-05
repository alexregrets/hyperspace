// Кадр анимации: звёзды в три слоя + корабль из полублоков. Чистая функция от времени.

export const ROWS = 5 // строк терминала под сцену (= 10 «пикселей» по вертикали)
export const DEF = 0x01000000 // цвет терминала по умолчанию

export type Ship = 'xwing' | 'tie'

// спрайты: каждая буква — пиксель своего цвета, точка — пусто
const SPRITES: Record<Ship, string[]> = {
  xwing: [
    'rrwwwwwwwwwwww==.....',
    '.www.................',
    '..wwww...............',
    '..wwwwwwwwwwwwwwwwwk.',
    'OOwwwwwwrrrwwwwwwwk..',
    '..wwww...............',
    '.www.................',
    'rrwwwwwwwwwwww==.....',
  ],
  tie: [
    'ggg.....ggg',
    'ggg.....ggg',
    'ggg.....ggg',
    'gggwwBBwggg',
    'gggwwBBwggg',
    'ggg.....ggg',
    'ggg.....ggg',
    'ggg.....ggg',
  ],
}

// палитра пикселей; O — движок, мерцает отдельно
const PALETTE: Record<string, number> = {
  w: 0xd8dde6, r: 0xd9483b, k: 0x3a3f4b, '=': 0x8a909c, g: 0x5c6370, B: 0x2b2f3a,
}

// цвет лазера: у повстанцев красный, у империи зелёный
const LASER: Record<Ship, number> = { xwing: 0xff4d3d, tie: 0x4dff6a }

// детерминированный «рандом» от целого: звёзды стоят на своих местах между кадрами
const hash = (n: number) => {
  let x = Math.imul(n ^ 0x9e3779b9, 0x85ebca6b)
  x ^= x >>> 13
  x = Math.imul(x, 0xc2b2ae35)
  return ((x ^ (x >>> 16)) >>> 0) / 0xffffffff
}

// три слоя звёзд: далёкие медленные и тусклые, близкие быстрые, яркие, со шлейфом
const LAYERS = [
  { count: 0.10, speed: 6, ch: '·', fg: 0x4a5060, trail: 0 },
  { count: 0.06, speed: 16, ch: '∙', fg: 0x8a92a6, trail: 0 },
  { count: 0.03, speed: 40, ch: '─', fg: 0xe6ecff, trail: 2 },
]

const HYPER_EVERY = 24_000 // раз в 24 с прыжок в гиперпространство
const HYPER_LEN = 1_800 // прыжок длится 1.8 с

// сила прыжка 0..1..0 по времени хода: разгон, полёт, выход
export const hyper = (t: number) => {
  const p = t % HYPER_EVERY
  const s = HYPER_EVERY - HYPER_LEN
  if (p < s) return 0
  return Math.sin(((p - s) / HYPER_LEN) * Math.PI)
}

// приглушить цвет к чёрному: a — сколько яркости оставить (0..1)
function dim(c: number, a: number) {
  const r = Math.round(((c >> 16) & 255) * a)
  const g = Math.round(((c >> 8) & 255) * a)
  const b = Math.round((c & 255) * a)
  return (r << 16) | (g << 8) | b
}

// звёзды слоя для данной ширины: строка и базовая x считаются один раз, а не каждый кадр
const starCache = new Map<number, { row: number; base: number }[][]>()
function starsFor(columns: number) {
  let s = starCache.get(columns)
  if (!s) {
    s = LAYERS.map((L, li) => {
      const n = Math.max(1, Math.round(columns * ROWS * L.count))
      return Array.from({ length: n }, (_, i) => {
        const seed = li * 10_000 + i
        return { row: Math.floor(hash(seed) * ROWS), base: hash(seed + 7777) * columns }
      })
    })
    starCache.set(columns, s)
  }
  return s
}

const CP = (ch: string) => ch.codePointAt(0)!
const DASH = CP('─'), HEAVY = CP('━')
const LAYER_CP = LAYERS.map(L => CP(L.ch))

// собрать кадр: columns × ROWS клеток, каждая — тройка [символ, цвет текста, цвет фона]
// пишет прямо в Uint32Array, без промежуточных массивов: меньше мусора на каждый кадр
export function frame(t: number, columns: number, ship: Ship): Uint32Array {
  const out = new Uint32Array(columns * ROWS * 3)
  for (let i = 0; i < out.length; i += 3) [out[i], out[i + 1], out[i + 2]] = [0x20, DEF, DEF]
  // записать клетку по индексу
  const set = (i: number, cp: number, fg: number, bg: number) => {
    out[i * 3] = cp
    out[i * 3 + 1] = fg
    out[i * 3 + 2] = bg
  }
  // поставить символ в клетку, если она в кадре
  const put = (x: number, row: number, cp: number, fg: number) => {
    if (x < 0 || x >= columns || row < 0 || row >= ROWS) return
    set(row * columns + x, cp, fg, DEF)
  }
  const h = hyper(t)
  const stars = starsFor(columns)

  // звёзды: позиция = база − скорость·время, по кругу; в прыжке скорость и шлейф растут
  LAYERS.forEach((L, li) => {
    const speed = L.speed * (1 + h * 12)
    const trail = Math.round(L.trail + h * (1 + li * 5))
    const cp = trail > 0 ? (h > 0.3 ? HEAVY : DASH) : LAYER_CP[li]!
    const shift = (speed * t) / 1000
    for (const st of stars[li]!) {
      const x = Math.floor((((st.base - shift) % columns) + columns) % columns)
      put(x, st.row, cp, L.fg)
      for (let k = 1; k <= trail; k++) put(x + k, st.row, cp, dim(L.fg, 1 - k / (trail + 1)))
    }
  })

  // корабль: два пикселя на клетку (▀ ▄ █), покачивается синусом на пиксель, в прыжке рвётся вперёд
  const sprite = SPRITES[ship]
  const w = sprite[0]!.length
  const x0 = Math.floor(columns * 0.18) + Math.round(h * 4)
  const y0 = Math.floor((ROWS * 2 - sprite.length) / 2) + Math.round(Math.sin(t / 650))
  const engine = [0xff8a3d, 0xffa64d, 0xffc46b][Math.floor(t / 90) % 3]! // мерцание движка
  // цвет пикселя спрайта в точке (x, y) кадра
  const px = (x: number, y: number) => {
    const c = sprite[y - y0]?.[x - x0]
    if (!c || c === '.') return DEF
    return c === 'O' ? engine : PALETTE[c] ?? DEF
  }
  for (let row = 0; row < ROWS; row++) {
    for (let x = Math.max(0, x0); x < Math.min(columns, x0 + w); x++) {
      const top = px(x, row * 2)
      const bot = px(x, row * 2 + 1)
      if (top === DEF && bot === DEF) continue
      const i = row * columns + x
      if (top === bot) set(i, 0x2588, top, DEF)
      else if (top === DEF) set(i, 0x2584, bot, DEF)
      else if (bot === DEF) set(i, 0x2580, top, DEF)
      else set(i, 0x2580, top, bot)
    }
  }

  // лазеры: залп каждые 1.6 с, болт летит вправо от носа; в прыжке не стреляем
  if (h === 0) {
    const bx = x0 + w + Math.floor((t % 1600) * 0.05)
    const ys = ship === 'xwing' ? [y0, y0 + 7] : [y0 + 3]
    for (const y of ys) for (let k = 0; k < 3; k++) put(bx + k, Math.floor(y / 2), HEAVY, LASER[ship])
  }
  return out
}

// клетки в base64, как просит Raster
export const encode = (cells: Uint32Array): string => new Uint8Array(cells.buffer).toBase64()
