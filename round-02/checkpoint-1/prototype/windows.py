# Find lit windows and lit conveyor strips in citadel-lights (2400x1350) -> JSON boxes; make a dark citadel.
import json
from PIL import Image, ImageFilter
L = Image.open('/code/WizSite/art/citadel-lights.webp').convert('RGBA')
C = Image.open('/code/WizSite/art/citadel.webp').convert('RGBA')
S = 2
a = L.split()[3].resize((L.width // S, L.height // S)).point(lambda v: 255 if v > 90 else 0)
a = a.filter(ImageFilter.MaxFilter(3))
W, H = a.size; px = a.load(); seen = bytearray(W * H); boxes = []
for y in range(H):
    for x in range(W):
        if px[x, y] and not seen[y * W + x]:
            st = [(x, y)]; seen[y * W + x] = 1; x0 = x1 = x; y0 = y1 = y; n = 0
            while st:
                cx, cy = st.pop(); n += 1
                x0, x1, y0, y1 = min(x0, cx), max(x1, cx), min(y0, cy), max(y1, cy)
                for nx, ny in ((cx+1, cy), (cx-1, cy), (cx, cy+1), (cx, cy-1)):
                    if 0 <= nx < W and 0 <= ny < H and px[nx, ny] and not seen[ny * W + nx]:
                        seen[ny * W + nx] = 1; st.append((nx, ny))
            if n >= 6:
                boxes.append([x0 * S, y0 * S, (x1 + 1) * S, (y1 + 1) * S, n])
wins = [b for b in boxes if (b[2]-b[0]) < 70 and (b[3]-b[1]) < 90]
strips = [b for b in boxes if (b[2]-b[0]) >= 70]
print(len(boxes), 'components;', len(wins), 'windows;', len(strips), 'strips/large')
json.dump({'windows': wins, 'strips': strips}, open('/code/proto/windows.json', 'w'))
# Dark citadel: where lights alpha is strong, replace brass with dim navy keeping the engraving's luminance.
la = L.split()[3]; out = C.copy(); op = out.load(); lp = la.load()
for y in range(C.height):
    for x in range(C.width):
        v = lp[x, y]
        if v > 20:
            r, g, b, al = op[x, y]
            lum = (r * 3 + g * 6 + b) / 10
            k = min(1, v / 160)
            nr, ng, nb = int(lum * .16 + 10), int(lum * .22 + 16), int(lum * .42 + 34)
            op[x, y] = (int(r*(1-k)+nr*k), int(g*(1-k)+ng*k), int(b*(1-k)+nb*k), al)
out.save('/code/proto/citadel-dark.webp', quality=82, method=6)
out.crop((700, 650, 1500, 1100)).save('/tmp/darkcrop.png')
