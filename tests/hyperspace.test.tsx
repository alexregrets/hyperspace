import { test, expect, mock } from 'claude-code/testing'

import { toWorld } from '../hooks/three'

import { CAMS, cameraAt, frame, flightAt, r2At, hyper, jumpPose, jumpTime, JUMP_LEN, killsAt, ROWS, SHIPS } from '../hooks/frame'

// декодировать клетку кадра в символ
const charAt = (cells: Uint32Array, columns: number, x: number, row: number) =>
  String.fromCodePoint(cells[(row * columns + x) * 3]!)

const BLOCKS = /[▘▝▀▖▌▞▛▗▚▐▜▄▙▟█]/g
const rowsOf = (cells: Uint32Array, columns: number) =>
  Array.from({ length: ROWS }, (_, r) => Array.from({ length: columns }, (_, x) => charAt(cells, columns, x, r)).join(''))

test('кадр нужного размера на любом времени, каждый корабль и каждая камера', async () => {
  for (const ship of SHIPS) for (const cam of CAMS) {
    for (const t of [0, 1_800, 3_000, 9_000, 13_500, 17_000, 21_000, 60_000]) {
      const cells = frame(t, 80, ship, cam)
      expect(cells.length).toBe(80 * ROWS * 3)
      expect(rowsOf(cells, 80).join('').match(BLOCKS)?.length ?? 0).toBeGreaterThan(30)
    }
  }
})

test('у каждого корабля свой 3D-силуэт, бочка и качка не выносят его из кадра', async () => {
  const seen = new Set<string>()
  for (const ship of SHIPS) seen.add(rowsOf(frame(500, 80, ship, 'side'), 80).join('|').replace(/[^▘▝▀▖▌▞▛▗▚▐▜▄▙▟█]/g, ' '))
  expect(seen.size).toBe(SHIPS.length)
  for (const ship of SHIPS) for (const t of [650 * 1.57, 3_400, 3_700, 650 * 4.71]) {
    const hull = rowsOf(frame(t, 80, ship, 'side'), 80).map(r => r.slice(0, 40)).join('')
    expect(hull.match(BLOCKS)?.length ?? 0).toBeGreaterThan(30)
  }
})

test('звёзды двигаются, камера режет планы, прыжок бывает', async () => {
  expect(Array.from(frame(1_000, 80, 'xwing'))).not.toEqual(Array.from(frame(1_500, 80, 'xwing')))
  expect(cameraAt(1_000, 'auto', 160).name).not.toBe(cameraAt(8_000, 'auto', 160).name)
  expect(cameraAt(1_000, 'top', 160).name).toBe('top')
  expect(hyper(1_000)).toBe(0)
  expect(hyper(17_000)).toBe(1)
  expect(jumpTime(17_000)).toBeGreaterThan(0)
})

test('прыжок как в кино: туннель заливает кадр, после выхода снова космос', async () => {
  // Рывок действительно уводит корабль вдаль и сжимает его перед вспышкой.
  const departing = jumpPose(14_500), point = jumpPose(14_690)
  expect(departing.stretch).toBeGreaterThan(1)
  expect(point.forward).toBeGreaterThan(departing.forward + 200)
  expect(point.scale).toBeLessThan(0.15)
  // После выходной вспышки корабль приходит из точки, слегка перелетает и тормозит.
  expect(jumpPose(20_250).forward).toBeGreaterThan(500)
  expect(jumpPose(20_800).forward).toBeLessThan(30)
  expect(jumpPose(21_100).forward).toBeLessThan(0)
  expect(jumpPose(21_400).forward).toBe(0)
  expect(jumpTime(12_000 + JUMP_LEN)).toBe(-1)
  // Пул буферов и порядок рендера не должны менять один и тот же кадр; только BMP.
  const saved = Array.from(frame(14_500, 72, 'xwing', 'auto', { res: 'quad' }))
  frame(20_700, 200, 'falcon')
  expect(Array.from(frame(14_500, 72, 'xwing', 'auto', { res: 'quad' }))).toEqual(saved)
  expect(saved.filter((_, i) => i % 3 === 0).every(cp => cp <= 0xffff)).toBe(true)
  const cols = 72
  const cellsOf = (t: number) => {
    const c = frame(t, cols, 'xwing')
    return Array.from({ length: cols * ROWS }, (_, i) => String.fromCodePoint(c[i * 3]!))
  }
  // туннель без дыр; пустыми остаются только киношные полосы сверху и снизу
  expect(cellsOf(17_000).slice(cols, cols * (ROWS - 1)).filter(ch => ch === ' ').length).toBe(0)
  const calm = cellsOf(25_000)
  expect(calm.filter(ch => ch === ' ').length).toBeGreaterThan(cols * ROWS * 0.4) // в покое космос пустой
})

test('секстанты: тот же кадр в 2×3, символы из блока U+1FB00', async () => {
  const c = frame(2_000, 80, 'xwing', 'side', { res: 'sext' })
  expect(c.length).toBe(80 * ROWS * 3)
  let sext = 0
  for (let i = 0; i < 80 * ROWS; i++) if (c[i * 3]! >= 0x1fb00 && c[i * 3]! <= 0x1fb3b) sext++
  expect(sext).toBeGreaterThan(20)
})

test('работа Claude видна в сцене: залп, торпеда, попадание меняют кадр; сбитые считаются', async () => {
  const quiet = frame(30_400, 80, 'xwing', 'side')
  for (const kind of ['shot', 'torpedo', 'hit'] as const) {
    const busy = frame(30_400, 80, 'xwing', 'side', { events: [{ t: 30_150, kind }] })
    expect(Array.from(busy)).not.toEqual(Array.from(quiet))
  }
  expect(killsAt(0)).toBe(0)
  expect(killsAt(11_000)).toBe(2)
})

test('в терминале рисуется сцена, на десктопе — обычный спиннер с фразой', async ($, on) => {
  mock.clock(on)
  let engineWord = ''
  on('ui.render', { component: 'Spinner' }, ($, e) => {
    engineWord = e.props.word
    const { Text } = $.ui.resolve(e)
    return <Text>{e.props.word}</Text>
  })
  const props = { word: 'Sauteing', message: null, suffix: '…', mode: 'thinking' as const }
  const term = await $.ui.mount({ plugin: 'hyperspace', surface: 'terminal', component: 'Spinner', props, viewport: { columns: 100, rows: 30 } as never })
  expect(await term.find({ type: 'Raster' })).toBeDefined()
  expect(engineWord).toBe('')
  await term.unmount()
  const desk = await $.ui.mount({ plugin: 'hyperspace', surface: 'desktop', component: 'Spinner', props })
  expect(engineWord).not.toBe('Sauteing')
  await desk.unmount()
})

test('кинематика: нос следует траектории, уклонение плавное, R2 стабилизирует голову', async () => {
  for (const t of [900, 1_200, 1_500, 1_900, 2_050, 6_700]) {
    const a = flightAt(t - 1, true), b = flightAt(t + 1, true), o = flightAt(t, true)
    const nose = toWorld([1, 0, 0], o).map((v, i) => v - o.pos[i]!)
    const v = [0.06, b.pos[1] - a.pos[1], b.pos[2] - a.pos[2]]
    const dot = nose.reduce((sum, n, i) => sum + n * v[i]!, 0) / Math.hypot(...v)
    expect(dot).toBeGreaterThan(0.999)
  }
  for (const edge of [1_150, 2_100]) {
    const a = flightAt(edge - 1, true), b = flightAt(edge + 1, true)
    expect(Math.abs(a.roll - b.roll)).toBeLessThan(0.01)
  }
  // Поворот головы компенсирует поворот корпуса, а наклон остаётся в пределах подвеса.
  const level = r2At(1_500, { yaw: 0, pitch: 0 })
  const tilted = r2At(1_500, { yaw: 0.2, pitch: 0.1 })
  expect(tilted.head).toBeLessThan(level.head)
  expect(tilted.brace).toBeLessThan(level.brace)
  for (const t of [1_500, 14_500, 17_000, 20_400]) expect(Math.abs(r2At(t).brace)).toBeLessThan(0.17)
})
