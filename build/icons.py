# -*- coding: utf-8 -*-
"""生成 PWA 图标：蓝色渐变圆角方块 + 白色「专」字"""
import os
from PIL import Image, ImageDraw, ImageFont

OUT = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', 'site', 'icons')
os.makedirs(OUT, exist_ok=True)

def find_font():
    cands = [
        r'C:\Windows\Fonts\msyhbd.ttc',
        r'C:\Windows\Fonts\msyh.ttc',
        r'C:\Windows\Fonts\simhei.ttf',
        r'C:\Windows\Fonts\simsun.ttc',
    ]
    for c in cands:
        if os.path.exists(c):
            return c
    return None

FONT = find_font()
print('字体:', FONT)

def gradient(size, c1=(59, 110, 245), c2=(30, 64, 175)):
    """对角线渐变"""
    img = Image.new('RGB', (size, size), c1)
    px = img.load()
    for y in range(size):
        for x in range(size):
            t = (x + y) / (2.0 * size - 2)
            r = int(c1[0] + (c2[0] - c1[0]) * t)
            g = int(c1[1] + (c2[1] - c1[1]) * t)
            b = int(c1[2] + (c2[2] - c1[2]) * t)
            px[x, y] = (r, g, b)
    return img

def make_icon(size, radius_ratio=0.22, maskable=False, text='专'):
    S = size * 4  # 超采样，抗锯齿
    base = gradient(S)
    # 圆角遮罩
    mask = Image.new('L', (S, S), 0)
    d = ImageDraw.Draw(mask)
    if maskable:
        # maskable 图标：安全区域内绘制，外圈纯色铺满
        d.rectangle([0, 0, S, S], fill=255)
    else:
        r = int(S * radius_ratio)
        d.rounded_rectangle([0, 0, S - 1, S - 1], radius=r, fill=255)
    img = Image.new('RGBA', (S, S), (0, 0, 0, 0))
    img.paste(base, (0, 0), mask)

    # 绘制文字
    if FONT:
        # maskable 时文字缩小到安全区（80%）
        scale = 0.46 if not maskable else 0.36
        fsize = int(S * scale)
        try:
            font = ImageFont.truetype(FONT, fsize)
        except Exception:
            font = ImageFont.load_default()
        dr = ImageDraw.Draw(img)
        bbox = dr.textbbox((0, 0), text, font=font)
        tw, th = bbox[2] - bbox[0], bbox[3] - bbox[1]
        x = (S - tw) / 2 - bbox[0]
        y = (S - th) / 2 - bbox[1]
        # 轻微阴影
        dr.text((x + S * 0.006, y + S * 0.006), text, font=font, fill=(0, 0, 30, 70))
        dr.text((x, y), text, font=font, fill=(255, 255, 255, 255))

    return img.resize((size, size), Image.LANCZOS)

specs = [
    ('icon-192.png', 192, 0.22, False),
    ('icon-512.png', 512, 0.22, False),
    ('icon-maskable.png', 512, 0.22, True),
    ('apple-touch-icon.png', 180, 0.22, False),
    ('favicon-64.png', 64, 0.22, False),
]
for name, size, rr, mk in specs:
    img = make_icon(size, rr, mk)
    p = os.path.join(OUT, name)
    img.save(p, 'PNG', optimize=True)
    print('生成 %-24s %dx%d  %d bytes' % (name, size, size, os.path.getsize(p)))

# 生成 favicon.ico
img = make_icon(64, 0.22, False)
img.save(os.path.join(OUT, 'favicon.ico'), sizes=[(16, 16), (32, 32), (48, 48), (64, 64)])
print('生成 favicon.ico')
