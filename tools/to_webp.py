import sys, numpy as np
from PIL import Image
raw, out, W, H, fps = sys.argv[1], sys.argv[2], int(sys.argv[3]), int(sys.argv[4]), int(sys.argv[5])
a = np.fromfile(raw, np.uint8).reshape(-1, H, W, 3)
a = a.repeat(8, axis=1).repeat(4, axis=2)        # субпиксель терминала: 4 широкий, 8 высокий
frames = [Image.fromarray(f) for f in a]
if out.endswith(".png"):                          # контактный лист: каждый 30-й кадр
    pick = frames[::30]; sheet = Image.new("RGB", (pick[0].width, pick[0].height * len(pick)))
    for i, f in enumerate(pick): sheet.paste(f, (0, i * f.height))
    sheet.save(out)
else:
    frames[0].save(out, save_all=True, append_images=frames[1:], duration=round(1000 / fps), loop=0, quality=72, method=6)
import os; print(out, len(frames), os.path.getsize(out) // 1024, "KB")
