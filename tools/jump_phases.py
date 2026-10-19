"""python tools/jump_phases.py preview/jump.raw preview/jump-phases.png
The raw sequence is 100 columns / quad / 11–23 s / 15 fps, as in render_scene.mts.
Dense 400 ms sampling plus individual 67 ms frames around lurch and exit.
"""
import sys
import numpy as np
from PIL import Image, ImageDraw

a = np.fromfile(sys.argv[1], np.uint8).reshape(-1, 24, 200, 3)
times = sorted(set([11 + i * .4 for i in range(30)] +
                   [14.3333 + i / 15 for i in range(9)] +
                   [20.1333 + i / 15 for i in range(10)]))
indices = sorted(set(min(len(a) - 1, max(0, round((t - 11) * 15))) for t in times))
w, h, label, cols = 800, 192, 24, 3
sheet = Image.new('RGB', (w * cols, (h + label) * ((len(indices) + cols - 1) // cols)), '#090d16')
d = ImageDraw.Draw(sheet)
for i, index in enumerate(indices):
    x, y = i % cols * w, i // cols * (h + label)
    t = 11 + index / 15
    p = t - 12
    phase = ('cruise' if p < 0 or p >= 10 else 'charge / radial acceleration' if p < 2.35
             else 'ship lurch -> point' if p < 2.7 else 'entry flash' if p < 2.88
             else 'tunnel' if p < 8.12 else 'exit flash' if p < 8.36 else 'rays collapse / braking')
    d.text((x + 8, y + 5), f'{t:.3f} s | jump {p:+.3f} s | {phase}', fill='#d5e9ff')
    sheet.paste(Image.fromarray(a[index].repeat(8, axis=0).repeat(4, axis=1)), (x, y + label))
sheet.save(sys.argv[2])
print(sys.argv[2], len(indices), 'labelled frames')
