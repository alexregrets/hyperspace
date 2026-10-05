import { test, expect, mock } from 'claude-code/testing'

import { frame, hyper, ROWS } from '../hooks/frame'

// декодировать клетку кадра в символ
const charAt = (cells: Uint32Array, columns: number, x: number, row: number) =>
  String.fromCodePoint(cells[(row * columns + x) * 3]!)

test('кадр нужного размера на любом времени, корабль на месте', async () => {
  for (const ship of ['xwing', 'tie'] as const) {
    for (const t of [0, 333, 5_000, 23_100, 23_900, 60_000]) {
      const cells = frame(t, 80, ship)
      expect(cells.length).toBe(80 * ROWS * 3)
      const row = Array.from({ length: ROWS }, (_, r) => Array.from({ length: 80 }, (_, x) => charAt(cells, 80, x, r)).join(''))
      expect(row.join('')).toMatch(/[█▀▄]/)
    }
  }
})

test('звёзды двигаются, прыжок бывает', async () => {
  const a = frame(1_000, 80, 'xwing')
  const b = frame(1_500, 80, 'xwing')
  expect(Array.from(a)).not.toEqual(Array.from(b))
  expect(hyper(1_000)).toBe(0)
  expect(hyper(23_100)).toBeGreaterThan(0.5)
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
