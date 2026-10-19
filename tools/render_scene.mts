// Кадры сцены из мода hyperspace: node tools/render_scene.mts out.raw ship cam cols t0 t1 fps
// затем python tools/to_webp.py out.raw assets/scene-<ship>.webp 200 24 fps (W = cols*2, H = 24)
import { writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { pathToFileURL } from 'node:url'
const dir = process.env.HYPERSPACE_DIR ?? homedir() + '/.claude/mods/hyperspace'
const { frame, ROWS, DEF } = await import(pathToFileURL(dir + '/hooks/frame.ts').href)

const [out, ship, cam, colsS, t0S, t1S, fpsS] = process.argv.slice(2)
const cols = +colsS!, t0 = +t0S!, t1 = +t1S!, fps = +fpsS!
const W = cols * 2, H = ROWS * 2, BG = 0x05070b
const n = Math.floor(((t1 - t0) / 1000) * fps)
const buf = new Uint8Array(n * W * H * 3)
const put = (f: number, x: number, y: number, c: number) => {
  if (c === DEF) c = BG
  const o = ((f * H + y) * W + x) * 3
  buf[o] = (c >> 16) & 255; buf[o + 1] = (c >> 8) & 255; buf[o + 2] = c & 255
}
// бит 1 — левый верх, 2 — правый верх, 4 — левый низ, 8 — правый низ
const QUAD = [0x20, 0x2598, 0x259d, 0x2580, 0x2596, 0x258c, 0x259e, 0x259b, 0x2597, 0x259a, 0x2590, 0x259c, 0x2584, 0x2599, 0x259f, 0x2588]
const MASK = new Map(QUAD.map((cp, m) => [cp, m]))
for (let f = 0; f < n; f++) {
  const cells = frame(t0 + (f * 1000) / fps, cols, ship as any, cam as any)
  for (let row = 0; row < ROWS; row++) for (let cx = 0; cx < cols; cx++) {
    const i = (row * cols + cx) * 3
    const m = MASK.get(cells[i]!) ?? 0
    for (let j = 0; j < 4; j++) put(f, cx * 2 + (j & 1), row * 2 + (j >> 1), m & (1 << j) ? cells[i + 1]! : cells[i + 2]!)
  }
}
writeFileSync(out!, buf)
console.log(JSON.stringify({ n, W, H }))
