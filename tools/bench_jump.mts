// node tools/bench_jump.mts — 200 columns, quad; phase means and p95 in ms.
import { performance } from 'node:perf_hooks'
import { frame } from '../hooks/frame.ts'

const phases = [
  ['cruise', 10_000, 11_000], ['acceleration', 12_000, 14_350],
  ['lurch', 14_350, 14_700], ['tunnel', 15_400, 20_100],
  ['exit', 20_200, 21_400],
] as const
for (const [phase, start, end] of phases) {
  for (let i = 0; i < 80; i++) frame(start + (end - start) * i / 80, 200, 'xwing', 'auto', { res: 'quad' })
  const times: number[] = []
  for (let i = 0; i < 300; i++) {
    const t = start + (end - start) * i / 300
    const before = performance.now()
    frame(t, 200, 'xwing', 'auto', { res: 'quad' })
    times.push(performance.now() - before)
  }
  times.sort((a, b) => a - b)
  console.log(JSON.stringify({ phase, columns: 200, frames: times.length,
    mean: +(times.reduce((a, b) => a + b) / times.length).toFixed(3),
    p95: +times[Math.floor(times.length * 0.95)]!.toFixed(3), max: +times.at(-1)!.toFixed(3) }))
}
