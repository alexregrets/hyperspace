"""python tools/flight_preview.py preview/flight.raw preview/flight-r2.png"""
import sys
import numpy as np
from PIL import Image, ImageDraw
a = np.fromfile(sys.argv[1], np.uint8).reshape(-1, 24, 200, 3)
indices = [0, 12, 18, 24, 30, 36, 42, 48, 60, 90, 120, 150]
w, h, label = 800, 192, 24
sheet = Image.new('RGB', (w * 3, (h + label) * 4), '#090d16')
d = ImageDraw.Draw(sheet)
for i, index in enumerate(indices):
    x, y = i % 3 * w, i // 3 * (h + label)
    d.text((x + 8, y + 5), f'{index / 15:.2f} s | X-wing side | flight / mounted R2-D2', fill='#d5e9ff')
    sheet.paste(Image.fromarray(a[index].repeat(8, axis=0).repeat(4, axis=1)), (x, y + label))
sheet.save(sys.argv[2])
