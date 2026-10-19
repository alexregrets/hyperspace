// Мини-3D: low-poly меши кораблей, камера и софтверный растеризатор с z-буфером и сглаживанием.
// Схема как у termcade (github.com/mlekhi/termcade): треугольники → перспектива → z-буфер → свет → пиксели.
// Мир: x — курс корабля (вперёд), y — вверх, z — правый борт. Корабль игрока всегда в начале координат.

export type V = [number, number, number]
// треугольник: цвет 0xRRGGBB, либо ENGINE / BLUE — светящиеся сопла, цвет подставит кадр
type Tri = { a: V; b: V; c: V; col: number }
export const ENGINE = -1
export const BLUE = -2

// меш: треугольники + точки сопел (откуда выхлоп) и пушек (откуда лазер)
export class Mesh {
  tris: Tri[] = []
  glows: { p: V; blue: boolean }[] = []
  guns: V[] = []
  // треугольник и четырёхугольник (две половинки)
  tri(a: V, b: V, c: V, col: number) { this.tris.push({ a, b, c, col }) }
  quad(a: V, b: V, c: V, d: V, col: number) { this.tri(a, b, c, col); this.tri(a, c, d, col) }
  // плоский многоугольник веером от первой точки (выпуклый или звёздный относительно неё)
  poly(ps: V[], col: number) { for (let i = 1; i < ps.length - 1; i++) this.tri(ps[0]!, ps[i]!, ps[i + 1]!, col) }
  // кусок «трубы» между двумя сечениями одинаковой длины; cap — цвет торца (-3 — без торца)
  loft(r0: V[], r1: V[], col: number, cap0 = -3, cap1 = -3) {
    const n = r0.length
    for (let i = 0; i < n; i++) this.quad(r0[i]!, r0[(i + 1) % n]!, r1[(i + 1) % n]!, r1[i]!, col)
    if (cap0 !== -3) this.poly(r0, cap0)
    if (cap1 !== -3) this.poly(r1, cap1)
  }
  // прямоугольная призма из сечения в сечение по оси x: [x, cy, cz, полувысота, полуширина]
  beam(a: number[], b: number[], col: number, capA = col, capB = col) {
    const rect = ([x, y, z, hy, hz]: number[]): V[] => [[x!, y! - hy!, z! - hz!], [x!, y! + hy!, z! - hz!], [x!, y! + hy!, z! + hz!], [x!, y! - hy!, z! + hz!]]
    this.loft(rect(a), rect(b), col, capA, capB)
  }
  // коробка по двум углам
  box(x0: number, x1: number, y0: number, y1: number, z0: number, z1: number, col: number) {
    const cy = (y0 + y1) / 2, cz = (z0 + z1) / 2, hy = (y1 - y0) / 2, hz = (z1 - z0) / 2
    this.beam([x0, cy, cz, hy, hz], [x1, cy, cz, hy, hz], col)
  }
  // тело вращения вокруг оси (0 — x, 1 — y, 2 — z): профиль [радиус, координата вдоль оси], n граней
  lathe(axis: 0 | 1 | 2, at: V, prof: [number, number][], n: number, col: number, phase = 0, capEnds = true) {
    const ring = ([r, h]: [number, number]): V[] => Array.from({ length: n }, (_, i) => {
      const a = phase + (i / n) * Math.PI * 2
      const u = Math.cos(a) * r, v = Math.sin(a) * r
      const p: V = axis === 0 ? [h, u, v] : axis === 1 ? [u, h, v] : [u, v, h]
      return [p[0] + at[0], p[1] + at[1], p[2] + at[2]]
    })
    for (let i = 0; i < prof.length - 1; i++) {
      const last = i === prof.length - 2
      this.loft(ring(prof[i]!), ring(prof[i + 1]!), col, capEnds && i === 0 ? col : -3, capEnds && last ? col : -3)
    }
  }
  // шар вокруг оси x: n меридианов, m параллелей
  ball(at: V, r: number, col: number, n = 10, m = 6) {
    const prof: [number, number][] = []
    for (let i = 0; i <= m; i++) { const a = (i / m) * Math.PI; prof.push([Math.max(0.001, Math.sin(a) * r), -Math.cos(a) * r]) }
    this.lathe(0, at, prof, n, col, 0, false)
  }
  // применить преобразование ко всему, что добавлено начиная с отметки
  map(mark: { t: number; g: number; u: number }, f: (v: V) => V) {
    for (let i = mark.t; i < this.tris.length; i++) {
      const t = this.tris[i]!
      t.a = f(t.a); t.b = f(t.b); t.c = f(t.c)
    }
    for (let i = mark.g; i < this.glows.length; i++) this.glows[i]!.p = f(this.glows[i]!.p)
    for (let i = mark.u; i < this.guns.length; i++) this.guns[i] = f(this.guns[i]!)
  }
  mark() { return { t: this.tris.length, g: this.glows.length, u: this.guns.length } }
}

// ── палитра: как на плёнке — тёплый белый, грязно-серый, полосы эскадрилий ──
const HULL = 0xd9d6cf, HULL2 = 0xb9b6ae, GREY = 0x8a8c90, DARK = 0x45484e, GLASS = 0x1c2633
const RED = 0xc23a2e, YELLOW = 0xd9a520, R2BLUE = 0x2f5fc4, TIEPANEL = 0x3a404c, TIEFRAME = 0x8a909a, TIEGREY = 0x858a94

// X-wing: open — угол раскрытия S-foil в радианах
export function xwing(open: number, headYaw = 0, headBrace = 0): Mesh {
  const m = new Mesh()
  // фюзеляж: короб сзади, длинный клин носа, красные полосы на носу
  m.beam([-6, 0, 0, 0.75, 0.8], [-1.2, 0, 0, 0.85, 0.85], HULL, GREY)
  m.beam([-1.2, 0, 0, 0.85, 0.85], [6.6, -0.15, 0, 0.28, 0.32], HULL, HULL, GREY)
  m.beam([2.2, -0.05, 0, 0.6, 0.64], [2.9, -0.07, 0, 0.56, 0.6], RED)
  m.beam([3.3, -0.08, 0, 0.53, 0.57], [3.7, -0.09, 0, 0.5, 0.54], RED)
  // кабина: тёмный фонарь с перемычкой
  m.beam([-1.6, 0.95, 0, 0.12, 0.55], [1.4, 0.6, 0, 0.05, 0.35], GLASS)
  m.box(-0.3, -0.1, 0.8, 1.15, -0.5, 0.5, GREY)
  // R2-D2 утоплен в гнездо за фонарём: видны плечи и купол, ноги внутри фюзеляжа.
  // Крупные синие панели и тёмный глаз читаются и после четвертьблоков.
  m.lathe(1, [-2.6, 0.82, 0], [[0.57, 0], [0.57, 0.12], [0.49, 0.16]], 10, DARK)
  m.lathe(1, [-2.6, 0.96, 0], [[0.47, 0], [0.47, 0.38]], 10, 0xe3e6e8)
  m.box(-2.14, -2.1, 1.01, 1.28, -0.25, 0.25, R2BLUE)
  m.box(-3.1, -3.06, 1.04, 1.2, -0.3, 0.3, R2BLUE)
  const headMark = m.mark()
  m.lathe(1, [0, 0, 0], [[0.5, 0], [0.5, 0.12], [0.46, 0.3], [0.32, 0.48], [0.001, 0.55]], 12, 0xbfcbd6)
  m.lathe(1, [0, 0, 0], [[0.505, 0], [0.505, 0.1]], 12, R2BLUE)
  // Четыре широких сектора на куполе; без мелких точек и случайного блеска.
  for (let i = 0; i < 4; i++) {
    const a = i * Math.PI / 2 + 0.18, b = a + 0.7
    const ring = (r: number, y: number, th: number): V => [r * Math.cos(th), y, r * Math.sin(th)]
    m.quad(ring(0.465, 0.3, a), ring(0.465, 0.3, b), ring(0.325, 0.48, b), ring(0.325, 0.48, a), R2BLUE)
  }
  m.box(0.38, 0.51, 0.16, 0.36, -0.24, 0.24, R2BLUE) // рамка основного глаза
  m.box(0.5, 0.55, 0.18, 0.34, -0.15, 0.15, 0x08121e) // оптика, не светящийся фонарь
  m.box(-0.52, -0.47, 0.13, 0.28, -0.15, 0.15, 0x273c69) // задний проектор
  m.map(headMark, ([x, y, z]) => {
    const co = Math.cos(headYaw), si = Math.sin(headYaw)
    const hx = x * co + z * si, hz = -x * si + z * co
    const cb = Math.cos(headBrace), sb = Math.sin(headBrace)
    return [-2.6 + hx * cb - y * sb, 1.34 + hx * sb + y * cb, hz]
  })
  // четыре крыла: строятся справа-сверху, потом наклоняются и отражаются
  for (const up of [1, -1]) for (const side of [1, -1]) {
    const k = m.mark()
    m.quad([-5.6, 0, 0.8], [-1.6, 0, 0.8], [-2.8, 0, 5.4], [-5.2, 0, 5.4], HULL2)
    m.quad([-5.6, -0.14, 0.8], [-5.2, -0.14, 5.4], [-2.8, -0.14, 5.4], [-1.6, -0.14, 0.8], HULL2)
    m.box(-4.4, -3.2, 0.0, 0.05, 3.6, 5.2, RED)
    m.lathe(0, [0, up * 0.55, 1.55], [[0.5, -5.9], [0.58, -5.4], [0.58, -1.6], [0.35, -0.9]], 8, GREY, Math.PI / 8)
    m.lathe(0, [0, up * 0.55, 1.55], [[0.4, -5.95], [0.4, -5.92]], 8, ENGINE, Math.PI / 8)
    m.glows.push({ p: [-6, up * 0.55, 1.55], blue: false })
    m.lathe(0, [0, 0, 5.55], [[0.2, -5], [0.2, 0.5]], 6, DARK)
    m.lathe(0, [0, 0, 5.55], [[0.09, 0.5], [0.09, 5.6], [0.15, 5.7], [0.15, 6.2]], 6, GREY)
    m.guns.push([6.3, 0, 5.55])
    const c = Math.cos(open), s = Math.sin(open)
    m.map(k, ([x, y, z]) => [x, y * c + z * s * up, (-y * s * up + z * c) * side])
  }
  return m
}

// Y-wing: кабина-капсула впереди, перекладина и две длинные гондолы двигателей
export function ywing(): Mesh {
  const m = new Mesh()
  m.beam([-1.5, 0, 0, 0.8, 0.9], [3.2, 0, 0, 0.75, 0.85], HULL, GREY)
  m.beam([3.2, 0, 0, 0.75, 0.85], [5.6, -0.2, 0, 0.3, 0.4], HULL, HULL, GREY)
  m.beam([1.4, 0.1, 0, 0.78, 0.88], [2.0, 0.1, 0, 0.78, 0.88], YELLOW) // жёлтая полоса Золотой эскадрильи
  m.beam([2.6, 0.55, 0, 0.25, 0.6], [4.3, 0.4, 0, 0.08, 0.45], GLASS)
  m.lathe(1, [3.0, 0.8, 0], [[0.3, 0], [0.25, 0.35], [0.001, 0.4]], 6, DARK) // ионная турель
  m.box(-6.5, -1.5, -0.35, 0.35, -0.45, 0.45, 0x9a9890) // хребет без обшивки
  m.box(-4.5, -3.2, -0.4, 0.4, -4.2, 4.2, HULL2) // перекладина крыла
  m.lathe(1, [-3.6, 0.4, 0], [[0.38, 0], [0.38, 0.3], [0.001, 0.5]], 8, 0xdfe4ea) // астродроид
  for (const side of [1, -1]) {
    const z = side * 4.2
    m.lathe(0, [0, 0, z], [[0.45, -7.4], [0.62, -6.9], [0.62, -1.2], [0.5, 0.2], [0.3, 0.8]], 8, HULL2, Math.PI / 8)
    m.lathe(0, [0, 0, z], [[0.5, -7.45], [0.5, -7.42]], 8, ENGINE, Math.PI / 8)
    m.box(-6.6, -5.9, -0.66, 0.66, z - 0.66, z + 0.66, DARK) // кольцо сопла
    m.glows.push({ p: [-7.5, 0, z], blue: false })
  }
  m.guns.push([5.8, -0.2, 0.2], [5.8, -0.2, -0.2])
  return m
}

// A-wing: плоский клин с двумя бортовыми двигателями и красными полосами
export function awing(): Mesh {
  const m = new Mesh()
  const top: V[] = [[4.6, 0.35, 0], [-3.2, 0.55, 2.4], [-3.4, 0.55, 0], [-3.2, 0.55, -2.4]]
  const bot: V[] = [[4.6, -0.2, 0], [-3.2, -0.35, 2.4], [-3.4, -0.35, 0], [-3.2, -0.35, -2.4]]
  m.poly([top[0]!, top[1]!, top[2]!], HULL); m.poly([top[0]!, top[2]!, top[3]!], HULL)
  m.poly([bot[0]!, bot[1]!, bot[2]!], HULL2); m.poly([bot[0]!, bot[2]!, bot[3]!], HULL2)
  m.quad(top[0]!, top[1]!, bot[1]!, bot[0]!, HULL2); m.quad(top[0]!, top[3]!, bot[3]!, bot[0]!, HULL2)
  m.quad(top[1]!, top[3]!, bot[3]!, bot[1]!, GREY)
  // красные шевроны на носу
  for (const s of [1, -1]) m.poly([[3.6, 0.42, 0], [1.2, 0.47, s * 0.9], [0.4, 0.49, s * 1.25], [2.9, 0.44, 0]], RED)
  m.beam([-0.6, 0.6, 0, 0.3, 0.55], [1.6, 0.45, 0, 0.05, 0.3], GLASS)
  for (const s of [1, -1]) {
    m.lathe(0, [0, 0.05, s * 2.55], [[0.42, -4.4], [0.55, -4.0], [0.55, -0.8], [0.25, 0.3]], 8, HULL2, Math.PI / 8)
    m.lathe(0, [0, 0.05, s * 2.55], [[0.42, -4.45], [0.42, -4.42]], 8, ENGINE, Math.PI / 8)
    m.glows.push({ p: [-4.5, 0.05, s * 2.55], blue: false })
    m.guns.push([0.5, -0.1, s * 2.95])
  }
  return m
}

// TIE-истребитель: шар-кабина с круглым окном, пилоны, две шестигранные панели
export function tie(): Mesh {
  const m = new Mesh()
  cockpit(m)
  for (const side of [1, -1]) {
    const k = m.mark()
    m.lathe(2, [0, 0, 0], [[0.55, 1.2], [0.42, 1.8], [0.42, 3.3], [0.75, 3.6]], 8, 0x5b6069)
    m.lathe(2, [0, 0, 0], [[0.6, 3.55], [4.3, 3.55], [4.3, 3.8], [0.6, 3.8]], 6, TIEPANEL, Math.PI / 2)
    m.lathe(2, [0, 0, 0], [[4.15, 3.5], [4.45, 3.5], [4.45, 3.85], [4.15, 3.85]], 6, TIEFRAME, Math.PI / 2)
    for (let i = 0; i < 6; i++) spoke(m, Math.PI / 2 + (i / 6) * Math.PI * 2, 4.2)
    m.map(k, ([x, y, z]) => [x, y, z * side])
  }
  m.guns.push([1.4, -0.75, 0.35], [1.4, -0.75, -0.35])
  return m
}

// TIE-перехватчик: та же кабина, панели-кинжалы с вырезом спереди, пушки на остриях
export function interceptor(): Mesh {
  const m = new Mesh()
  cockpit(m)
  const blade: [number, number][] = [[-0.5, 0], [0.6, 0.7], [3.6, 4.3], [-0.6, 4.0], [-1.7, 0.9], [-1.7, -0.9], [-0.6, -4.0], [3.6, -4.3], [0.6, -0.7]]
  for (const side of [1, -1]) {
    const k = m.mark()
    m.lathe(2, [0, 0, 0], [[0.55, 1.2], [0.42, 1.8], [0.42, 3.1], [0.7, 3.4]], 8, 0x5b6069)
    for (const z of [3.4, 3.62]) {
      const ps = blade.map(([x, y]) => [x, y, z] as V)
      // веер от центра: точки 1..8 по кругу, замыкаем последней с первой
      for (let i = 1; i < ps.length; i++) m.tri(ps[0]!, ps[i]!, ps[i === ps.length - 1 ? 1 : i + 1]!, TIEPANEL)
    }
    for (let i = 1; i < blade.length; i++) {
      const [x0, y0] = blade[i]!, [x1, y1] = blade[i === blade.length - 1 ? 1 : i + 1]!
      m.quad([x0, y0, 3.38], [x1, y1, 3.38], [x1, y1, 3.64], [x0, y0, 3.64], TIEFRAME)
    }
    for (const a of [Math.PI * 0.27, -Math.PI * 0.27, Math.PI * 0.62, -Math.PI * 0.62]) spoke(m, a, 3.4, 3.36, 3.66)
    m.guns.push([3.7, 4.3, 3.5], [3.7, -4.3, 3.5])
    m.map(k, ([x, y, z]) => [x, y, z * side])
  }
  return m
}

// общая кабина TIE: шар, окно-восьмиугольник, два ионных сопла сзади
function cockpit(m: Mesh) {
  m.ball([0, 0, 0], 1.55, TIEGREY, 12, 8)
  m.lathe(0, [0, 0, 0], [[0.95, 1.2], [0.95, 1.32], [0.75, 1.42]], 8, 0x3a3e46, Math.PI / 8)
  m.lathe(0, [0, 0, 0], [[0.62, 1.43], [0.001, 1.45]], 8, GLASS, Math.PI / 8)
  for (const z of [-0.45, 0.45]) {
    m.lathe(0, [0, 0, z], [[0.22, -1.62], [0.22, -1.5]], 6, ENGINE)
    m.glows.push({ p: [-1.65, 0, z], blue: false })
  }
}

// ребро панели TIE от центра под углом a длиной r, с обеих сторон панели
function spoke(m: Mesh, a: number, r: number, z0 = 3.48, z1 = 3.87) {
  const ex = Math.cos(a) * r, ey = Math.sin(a) * r
  const nx = -Math.sin(a) * 0.09, ny = Math.cos(a) * 0.09
  for (const z of [z0, z1]) m.quad([nx, ny, z], [ex + nx, ey + ny, z], [ex - nx, ey - ny, z], [-nx, -ny, z], TIEFRAME)
}

// Сокол тысячелетия: диск, жвалы, кабина-труба по борту, тарелка радара, голубая дуга двигателя
export function falcon(): Mesh {
  const m = new Mesh()
  m.lathe(1, [0, 0, 0], [[0.001, 0.72], [2.2, 0.66], [3.7, 0.5], [4.6, 0.18], [4.75, -0.05], [4.55, -0.3], [3.6, -0.55], [0.001, -0.62]], 24, 0xc9c7c0, 0, false)
  // пластины обшивки по верху: тёмные секторы, как грязные заплатки на модели
  for (let i = 0; i < 6; i++) {
    const a0 = (i / 6) * Math.PI * 2 + 0.3, a1 = a0 + 0.35
    const p = (r: number, a: number, y: number): V => [Math.cos(a) * r, y, Math.sin(a) * r]
    m.quad(p(2.4, a0, 0.67), p(3.6, a0, 0.53), p(3.6, a1, 0.53), p(2.4, a1, 0.67), 0x9c9a92)
  }
  for (const z of [1, -1]) m.beam([2.8, 0, z * 1.05, 0.3, 0.62], [7.4, 0, z * 1.0, 0.24, 0.55], 0xbebcb4, GREY, DARK)
  m.box(3.0, 4.2, -0.3, 0.1, -0.45, 0.45, DARK)
  m.beam([1.0, 0.05, -3.6, 0.32, 0.55], [3.0, 0.05, -4.35, 0.3, 0.4], 0xbebcb4)
  m.lathe(0, [0, 0.05, -4.55], [[0.48, 1.2], [0.52, 4.4], [0.42, 5.2], [0.2, 5.55]], 8, 0xc9c7c0, 0, true)
  m.lathe(0, [0, 0.05, -4.55], [[0.43, 5.18], [0.22, 5.54]], 8, GLASS)
  m.lathe(1, [0, 0, 0], [[0.7, 0.68], [0.6, 0.95], [0.001, 1.0]], 10, GREY)
  m.box(0.2, 1.6, 0.85, 0.95, -0.22, -0.12, DARK)
  m.box(0.2, 1.6, 0.85, 0.95, 0.12, 0.22, DARK)
  m.lathe(1, [-0.6, 0, 2.6], [[0.12, 0.6], [0.12, 1.05], [0.95, 1.2], [0.001, 1.35]], 10, 0xd6d4cc)
  for (let i = 0; i <= 8; i++) {
    const a = Math.PI * (0.78 + (i / 8) * 0.44)
    const a2 = Math.PI * (0.78 + ((i + 1) / 8) * 0.44)
    const p = (r: number, y: number, aa: number): V => [Math.cos(aa) * r, y, Math.sin(aa) * r]
    if (i < 8) m.quad(p(4.8, -0.15, a), p(4.8, 0.2, a), p(4.8, 0.2, a2), p(4.8, -0.15, a2), BLUE)
    if (i % 2 === 0) m.glows.push({ p: [Math.cos(a) * 4.85, 0.02, Math.sin(a) * 4.85], blue: true })
  }
  m.guns.push([0.9, 1.0, 0], [7.5, 0, 1], [7.5, 0, -1])
  return m
}

// Звёздный разрушитель для фона: клин, ступенчатая надстройка, мостик с двумя шарами, синие сопла
export function destroyer(): Mesh {
  const m = new Mesh()
  const C = 0xa7aab0, C2 = 0x878a91
  const nose: V = [16, 0, 0], l: V = [-10, 0, 8.5], r: V = [-10, 0, -8.5], keel: V = [-10, -3.2, 0], keelN: V = [16, -0.4, 0]
  m.tri(nose, l, r, C) // верхняя палуба
  m.quad(nose, keelN, keel, l, C2); m.quad(nose, keelN, keel, r, C2) // днище к килю
  m.poly([l, r, keel], 0x5d6067) // корма
  // траншея по палубе и ступени надстройки
  m.box(-6, 12, 0.0, 0.18, -0.35, 0.35, 0x6d7076)
  m.box(-10, -1, 0, 1.1, -4.2, 4.2, C)
  m.box(-9.6, -4, 1.1, 2.0, -2.8, 2.8, C)
  m.box(-9.2, -6.5, 2.0, 2.9, -1.6, 1.6, C)
  m.box(-8.7, -7.9, 2.9, 4.4, -0.45, 0.45, C2) // шея мостика
  m.box(-9.0, -7.6, 4.4, 4.9, -2.6, 2.6, C) // мостик
  for (const z of [-1.6, 1.6]) m.ball([-8.3, 5.3, z], 0.42, 0xbfc2c8, 6, 4)
  for (const z of [-2.4, 0, 2.4]) {
    m.lathe(0, [0, 0.4, z], [[0.75, -10.15], [0.75, -10.1]], 8, BLUE)
    m.glows.push({ p: [-10.3, 0.4, z], blue: true })
  }
  // турболазеры вдоль борта: точки, откуда бьют зелёные залпы
  for (const s of [1, -1]) for (const x of [-3, 2, 7]) m.guns.push([x, 0.2, s * (8.5 - (x + 10) * 8.5 / 26)])
  return m
}

// астероид: шар, вершины которого сдвинуты шумом — бугристая глыба; seed — своя форма
export function asteroid(seed: number): Mesh {
  const m = new Mesh()
  m.ball([0, 0, 0], 1, 0x6e655c, 9, 6)
  const h = (x: number) => { const v = Math.sin(x * 12.9898 + seed * 78.233) * 43758.5453; return v - Math.floor(v) }
  // одинаковые точки сдвигаются одинаково: швов между гранями нет
  m.map({ t: 0, g: 0, u: 0 }, ([x, y, z]) => {
    const k = 0.7 + 0.5 * h(Math.round(x * 50) * 3 + Math.round(y * 50) * 7 + Math.round(z * 50) * 13)
    return [x * k * 1.25, y * k * 0.9, z * k]
  })
  return m
}

// ── камера и проекция ──

export type Cam = {
  target: V // куда смотрит, мировые координаты
  azim: number; elev: number; roll: number // откуда смотрит: вокруг вертикали, сверху, завал горизонта
  dist: number // расстояние до цели
  fy: number // пикселей на единицу по вертикали на расстоянии цели
  ax: number // во сколько раз пиксель уже, чем выше: 2 у четвертьблоков, 4/3 у секстантов
  cx: number; cy: number // где цель на экране, в пикселях
}
// поза объекта в мире: где стоит, как повёрнут, во сколько раз больше
export type Obj = { pos: V; yaw: number; pitch: number; roll: number; scale?: number }

// повернуть точку модели позой объекта и поставить в мир
export function toWorld(p: V, o: Obj): V {
  const k = o.scale ?? 1
  let [x, y, z] = [p[0] * k, p[1] * k, p[2] * k]
  let c = Math.cos(o.roll), s = Math.sin(o.roll);
  [y, z] = [y * c - z * s, y * s + z * c]
  c = Math.cos(o.pitch); s = Math.sin(o.pitch);
  [x, y] = [x * c - y * s, x * s + y * c]
  c = Math.cos(o.yaw); s = Math.sin(o.yaw);
  [x, z] = [x * c + z * s, -x * s + z * c]
  return [x + o.pos[0], y + o.pos[1], z + o.pos[2]]
}

// мировая точка → система камеры: X вправо, Y вверх, Z к зрителю (камера в Z = dist)
export function toCam(p: V, c: Cam): V {
  let x = p[0] - c.target[0], y = p[1] - c.target[1], z = p[2] - c.target[2]
  let co = Math.cos(c.azim), si = Math.sin(c.azim);
  [x, z] = [x * co + z * si, -x * si + z * co]
  co = Math.cos(c.elev); si = Math.sin(c.elev);
  [y, z] = [y * co - z * si, y * si + z * co]
  co = Math.cos(c.roll); si = Math.sin(c.roll);
  [x, y] = [x * co - y * si, x * si + y * co]
  return [x, y, z]
}

// обратный поворот: направление из системы камеры в мир (для лучей туннеля)
export function camDirToWorld(d: V, c: Cam): V {
  let [x, y, z] = d
  let co = Math.cos(-c.roll), si = Math.sin(-c.roll);
  [x, y] = [x * co - y * si, x * si + y * co]
  co = Math.cos(-c.elev); si = Math.sin(-c.elev);
  [y, z] = [y * co - z * si, y * si + z * co]
  co = Math.cos(-c.azim); si = Math.sin(-c.azim);
  [x, z] = [x * co + z * si, -x * si + z * co]
  return [x, y, z]
}

// мировая позиция камеры
export const camPos = (c: Cam): V => {
  const d = camDirToWorld([0, 0, c.dist], c)
  return [c.target[0] + d[0], c.target[1] + d[1], c.target[2] + d[2]]
}

const NEAR = 0.6
// проекция точки системы камеры в пиксели экрана: [x, y, глубина, масштаб] или null за камерой
export function projCam(q: V, c: Cam): [number, number, number, number] | null {
  const depth = c.dist - q[2]
  if (depth < NEAR) return null
  const k = (c.dist / depth) * c.fy
  return [c.cx + q[0] * k * c.ax, c.cy - q[1] * k, depth, k]
}
export const project = (p: V, c: Cam) => projCam(toCam(p, c), c)

// ── растеризация мешей в общий z-буфер с под-пикселями ──

export const SS = 2 // 2×2 под-пикселя на пиксель
export type Light = { p: V; col: [number, number, number]; k: number }
const LIGHT: V = (() => { const v: V = [-0.35, 0.75, 0.55]; const l = Math.hypot(...v); return [v[0] / l, v[1] / l, v[2] / l] })()


// буфер сцены: под-пиксели с глубиной и цветом; одна штука на кадр, все меши в неё
export class Scene {
  w: number; h: number; W: number; H: number
  zb: Float32Array; cb: Uint32Array
  constructor(w: number, h: number) {
    this.w = w; this.h = h
    this.W = w * SS; this.H = h * SS
    this.zb = new Float32Array(this.W * this.H).fill(Infinity)
    this.cb = new Uint32Array(this.W * this.H)
  }

  // обнулить буфер для нового кадра (буферы живут между кадрами: меньше мусора)
  reset() { this.zb.fill(Infinity) }

  // нарисовать меш объекта o камерой c; tint — общая яркость, env — цвет контрового света окружения,
  // lights — точечные источники (взрывы, лазеры): позиция, цвет 0..1, сила
  draw(mesh: Mesh, o: Obj, c: Cam, engine: number, blue: number, tint = 1, env?: [number, number, number], lights: Light[] = []) {
    const { W, H } = this
    const cp = camPos(c)
    mesh.tris.forEach((t, ti) => {
      const wa = toWorld(t.a, o), wb = toWorld(t.b, o), wc = toWorld(t.c, o)
      // нормаль в мире, развёрнутая к камере: полигоны двусторонние
      const ux = wb[0] - wa[0], uy = wb[1] - wa[1], uz = wb[2] - wa[2]
      const vx = wc[0] - wa[0], vy = wc[1] - wa[1], vz = wc[2] - wa[2]
      let nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx
      const nl = Math.hypot(nx, ny, nz) || 1
      nx /= nl; ny /= nl; nz /= nl
      let ex = cp[0] - wa[0], ey = cp[1] - wa[1], ez = cp[2] - wa[2]
      const el = Math.hypot(ex, ey, ez) || 1
      ex /= el; ey /= el; ez /= el
      let ndv = nx * ex + ny * ey + nz * ez
      if (ndv < 0) { nx = -nx; ny = -ny; nz = -nz; ndv = -ndv }
      let col: number
      if (t.col === ENGINE) col = engine
      else if (t.col === BLUE) col = blue
      else {
        // Ламберт + блик по Блинну + контровой свет по краю; рябь по граням — панели обшивки
        const lam = Math.max(0, nx * LIGHT[0] + ny * LIGHT[1] + nz * LIGHT[2])
        let hx = LIGHT[0] + ex, hy = LIGHT[1] + ey, hz = LIGHT[2] + ez
        const hl = Math.hypot(hx, hy, hz) || 1
        const spec = Math.pow(Math.max(0, (nx * hx + ny * hy + nz * hz) / hl), 28) * 0.45
        const rim = Math.pow(1 - ndv, 3) * 0.22
        const grain = 0.9 + 0.12 * (((ti * 2654435761) >>> 0) % 997) / 997
        const base = ((0.3 + 0.95 * lam + rim) * grain + spec) * tint
        let lr = base, lg = base, lb = base
        if (env) { const e = Math.pow(1 - ndv, 2) * 1.4; lr += env[0] * e; lg += env[1] * e; lb += env[2] * e }
        for (const L of lights) {
          const dx = L.p[0] - wa[0], dy = L.p[1] - wa[1], dz = L.p[2] - wa[2]
          const d = Math.hypot(dx, dy, dz) || 1
          const k = Math.max(0, (nx * dx + ny * dy + nz * dz) / d) * L.k / (1 + d * d * 0.01)
          lr += L.col[0] * k; lg += L.col[1] * k; lb += L.col[2] * k
        }
        const ch = (sh: number, f: number) => Math.min(255, Math.round(((t.col >> sh) & 255) * f))
        col = (ch(16, lr) << 16) | (ch(8, lg) << 8) | ch(0, lb)
      }
      const A = project(wa, c), B = project(wb, c), C = project(wc, c)
      if (!A || !B || !C) return
      const ax = A[0] * SS, ay = A[1] * SS, bx = B[0] * SS, by = B[1] * SS, cx = C[0] * SS, cy = C[1] * SS
      const area = (bx - ax) * (cy - ay) - (by - ay) * (cx - ax)
      if (Math.abs(area) < 1e-6) return
      const x0 = Math.max(0, Math.floor(Math.min(ax, bx, cx)))
      const x1 = Math.min(W - 1, Math.ceil(Math.max(ax, bx, cx)))
      const y0 = Math.max(0, Math.floor(Math.min(ay, by, cy)))
      const y1 = Math.min(H - 1, Math.ceil(Math.max(ay, by, cy)))
      const bias = t.col < 0 ? 0.05 : 0 // сопла чуть выигрывают z-тест у корпуса вокруг
      for (let y = y0; y <= y1; y++) {
        const py = y + 0.5
        for (let x = x0; x <= x1; x++) {
          const px = x + 0.5
          const w0 = ((bx - px) * (cy - py) - (by - py) * (cx - px)) / area
          const w1 = ((cx - px) * (ay - py) - (cy - py) * (ax - px)) / area
          const w2 = 1 - w0 - w1
          if (w0 < 0 || w1 < 0 || w2 < 0) continue
          const z = w0 * A[2] + w1 * B[2] + w2 * C[2] - bias
          const i = y * W + x
          if (z < this.zb[i]!) { this.zb[i] = z; this.cb[i] = col }
        }
      }
    })
  }

  // свернуть под-пиксели поверх фонового буфера rgb (float 0..1+, 3 канала на пиксель)
  resolve(rgb: Float32Array) {
    const { W, w, h } = this
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      let r = 0, g = 0, b = 0, n = 0
      for (let sy = 0; sy < SS; sy++) for (let sx = 0; sx < SS; sx++) {
        const i = (y * SS + sy) * W + x * SS + sx
        if (this.zb[i] === Infinity) continue
        const c = this.cb[i]!
        r += (c >> 16) & 255; g += (c >> 8) & 255; b += c & 255; n++
      }
      if (!n) continue
      // корпус в тени не должен становиться «пустотой» терминала: минимальная яркость
      const lift = Math.max(0, 14 - Math.max(r, g, b) / n)
      r += lift * n; g += lift * n; b += lift * n * 1.2
      const a = n / (SS * SS), o = (y * w + x) * 3
      rgb[o] = rgb[o]! * (1 - a) + (r / n / 255) * a
      rgb[o + 1] = rgb[o + 1]! * (1 - a) + (g / n / 255) * a
      rgb[o + 2] = rgb[o + 2]! * (1 - a) + (b / n / 255) * a
    }
  }

  // глубина ближайшего под-пикселя в пикселе (для того, чтобы эффекты прятались за кораблём)
  depthAt(x: number, y: number) {
    let d = Infinity
    for (let sy = 0; sy < SS; sy++) for (let sx = 0; sx < SS; sx++) {
      const v = this.zb[(y * SS + sy) * this.W + x * SS + sx]!
      if (v < d) d = v
    }
    return d
  }
}
