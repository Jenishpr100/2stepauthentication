#!/usr/bin/env python3
"""Optional dev tool: renders question images from questions.json ("latex" field)
into public/q/ (needs matplotlib), then rebuilds standalone.html.
Run: python3 build.py"""
import base64, json, os, re

ROOT = os.path.dirname(os.path.abspath(__file__))
P = lambda *a: os.path.join(ROOT, *a)
SCALE = 3  # PNGs are rendered at 3x for sharpness; JSON stores CSS size

questions = json.load(open(P('questions.json'), encoding='utf-8'))

try:
    import matplotlib
    matplotlib.use('Agg')
    import matplotlib.pyplot as plt
    from PIL import Image
    matplotlib.rcParams['mathtext.fontset'] = 'cm'
    os.makedirs(P('public', 'q'), exist_ok=True)
    for n, q in enumerate(questions, 1):
        rel = f'q/{n:02d}.png'
        fig = plt.figure(figsize=(0.1, 0.1))
        fig.text(0, 0, q['latex'], fontsize=21, color='black')
        fig.savefig(P('public', rel), dpi=96 * SCALE, transparent=True,
                    bbox_inches='tight', pad_inches=0.05)
        plt.close(fig)
        w, h = Image.open(P('public', rel)).size
        q.update(image=rel, w=round(w / SCALE), h=round(h / SCALE))
    json.dump(questions, open(P('questions.json'), 'w', encoding='utf-8'), indent=2, ensure_ascii=False)
    print(f'rendered {len(questions)} images')
except ImportError:
    print('matplotlib not installed: keeping existing images')

# ---- standalone.html ----
read = lambda *a: open(P(*a), encoding='utf-8').read()
demo = []
for q in questions:
    b64 = base64.b64encode(open(P('public', q['image']), 'rb').read()).decode()
    demo.append({k: q[k] for k in ('question', 'answer', 'explanation', 'w', 'h')}
                | {'image': 'data:image/png;base64,' + b64})
data = json.dumps(demo, ensure_ascii=False).replace('</', '<\\/')

html = read('public', 'index.html')
html = html.replace('<link rel="stylesheet" href="style.css">', '<style>\n' + read('public', 'style.css') + '</style>')
html = html.replace('<script src="theme.js"></script>', '<script>\n' + read('public', 'theme.js') + '</script>')
html = html.replace('<script src="app.js"></script>',
    '<script>window.DEMO=true;window.DEMO_QUESTIONS=' + data + ';</script>\n'
    '<script>\n' + read('checker.js') + '</script>\n<script>\n' + read('public', 'app.js') + '</script>')
open(P('standalone.html'), 'w', encoding='utf-8').write(html)
print('built standalone.html')
