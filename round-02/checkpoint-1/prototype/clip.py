# browser-harness < clip.py with env V, W, H, OUT (dir), FPS, DUR
import os, base64, time
V=os.environ['V']; W=int(os.environ['W']); H=int(os.environ['H']); out=os.environ['OUT']; fps=int(os.environ.get('FPS','20')); dur=float(os.environ.get('DUR','7'))
os.makedirs(out, exist_ok=True)
tab=new_tab('about:blank'); activate_tab(tab)
cdp('Emulation.setDeviceMetricsOverride', width=W, height=H, deviceScaleFactor=1, mobile=False)
goto_url(f'http://127.0.0.1:8810/?variant={V}#capture')
for _ in range(100):
    if js('window.protoReady?1:0')==1: break
    time.sleep(.1)
time.sleep(.5)
n=int(dur*fps)+1
for i in range(n):
    js(f'render({i/fps})')
    d=cdp('Page.captureScreenshot', format='jpeg', quality=88, clip={'x':0,'y':0,'width':W,'height':H,'scale':1})
    open(f'{out}/f{i:04d}.jpg','wb').write(base64.b64decode(d['data']))
print('frames', n)
