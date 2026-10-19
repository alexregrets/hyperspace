import { test, expect, mock } from 'claude-code/testing'

import { CAMS, cameraAt, frame, hyper, jumpTime, killsAt, ROWS, SHIPS } from '../hooks/frame'

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
