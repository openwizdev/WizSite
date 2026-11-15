import json
from PIL import Image, ImageDraw
L = Image.open('/code/WizSite/art/citadel-lights.webp').split()[3]
d = json.load(open('/code/proto/windows.json'))
def score(p, q):
    s = 0
    for i in range(41):
        x = p[0] + (q[0]-p[0])*i/40; y = p[1] + (q[1]-p[1])*i/40
        s += L.getpixel((min(2399, int(x)), min(1349, int(y))))
    return s / 41
lines = []
for b in d['strips']:
    x0, y0, x1, y1, n = b
    w, h = x1 - x0, y1 - y0
    if w < 140: continue
    if h > w * 0.75: continue
    m = 6
    cands = [((x0+m, y0+m), (x1-m, y1-m)), ((x0+m, y1-m), (x1-m, y0+m)), ((x0, (y0+y1)/2), (x1, (y0+y1)/2))]
    best = max(cands, key=lambda c: score(*c))
    sc = score(*best)
    if sc < 60: continue
    lines.append([round(best[0][0]), round(best[0][1]), round(best[1][0]), round(best[1][1]), round(sc)])
print(len(lines), 'lines')
for l in lines: print(l)
json.dump(lines, open('/code/proto/www/lines.json', 'w'))
C = Image.open('/code/WizSite/art/citadel.webp').convert('RGB'); dr = ImageDraw.Draw(C)
for i, l in enumerate(lines):
    dr.line(l[:4], fill=(255, 0, 255), width=4); dr.text((l[0], l[1]-14), str(i), fill=(255, 255, 255))
C.resize((1200, 675)).save('/tmp/lines.png')
