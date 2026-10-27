#!/usr/bin/env python
# -*- coding: utf-8 -*-
"""
角色图一键处理工具
------------------------------------------------------------------
把老师找来的角色图片，自动去掉纯色背景，裁剪到内容边界，
统一输出成游戏用的透明 PNG，放到 baozi-game/images/ 里。

用法（把图片放进本脚本同级的 input/ 目录，或指定任意路径）：
    python make_avatars.py 熊大.jpg 熊二.jpg 光头强.jpg 蹦蹦.jpg

规则：
  1. 文件名必须包含下面 KEYWORDS 里的关键字之一，用来判断它是哪个角色；
  2. 自动识别四角背景色，把相近颜色变成透明（容错值可改 --tol）；
  3. 去掉周围空边、按最大 700px 缩放，输出 RGBA PNG。

输出：
    xiongda.png / xionger.png / guangtouqiang.png / bengbeng.png
（文件名与 js/scene.js 里 skin.imgSrc 对应，放进 images/ 就自动生效）
"""
import os, sys, glob
from PIL import Image

KEYWORDS = [
    ('xiongda',        ['熊大']),
    ('xionger',        ['熊二']),
    ('guangtouqiang',  ['光头强']),
    ('bengbeng',       ['蹦蹦']),
]

OUT_DIR = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', 'images')
MAX_SIZE = 700


def to_rgba_remove_bg(im, tol=60):
    """按四角背景色做泛色取反（flood fill），把背景变透明"""
    im = im.convert('RGBA')
    w, h = im.size
    px = im.load()
    # 采样四角颜色
    corners = [px[0, 0], px[w - 1, 0], px[0, h - 1], px[w - 1, h - 1]]
    bg = tuple(sum(c[i] for c in corners) // 4 for i in range(3))

    def near(c, ref):
        return abs(c[0] - ref[0]) + abs(c[1] - ref[1]) + abs(c[2] - ref[2]) <= tol

    # BFS 从边缘扩散，只吃掉连通的背景
    seen = [[False] * w for _ in range(h)]
    stack = [(x, y) for x in range(w) for y in (0, h - 1)] + [(x, y) for y in range(h) for x in (0, w - 1)]
    stack = [(x, y) for x, y in stack if near(px[x, y][:3], bg)]
    while stack:
        x, y = stack.pop()
        if x < 0 or y < 0 or x >= w or y >= h or seen[y][x]:
            continue
        if not near(px[x, y][:3], bg):
            continue
        seen[y][x] = True
        stack.extend([(x + 1, y), (x - 1, y), (x, y + 1), (x, y - 1)])

    for y in range(h):
        for x in range(w):
            if seen[y][x]:
                px[x, y] = (0, 0, 0, 0)
    return im


def trim_and_resize(im, max_size=MAX_SIZE, report=None):
    if im.mode == 'RGBA':
        # 透明像素常带白色 RGB，按 alpha 通道取内容边界
        a = im.getchannel('A').point(lambda v: 255 if v > 12 else 0)
        bbox = a.getbbox()
    else:
        bbox = im.getbbox()
    if report is not None:
        report.append(bbox)
    if bbox:
        im = im.crop(bbox)
    w, h = im.size
    scale = min(1.0, max_size / float(max(w, h)))
    if scale < 1.0:
        im = im.resize((int(w * scale), int(h * scale)), Image.LANCZOS)
    return im


def already_transparent(im):
    """四角都是透明的图视为已抠好，无需再去背"""
    if im.mode not in ('RGBA', 'LA'):
        return False
    w, h = im.size
    a = im.convert('RGBA').getchannel('A')
    return all(a.getpixel(p) < 12 for p in [(0, 0), (w - 1, 0), (0, h - 1), (w - 1, h - 1)])


def main():
    files = sys.argv[1:]
    if not files:
        files = sorted(glob.glob(os.path.join(os.path.dirname(os.path.abspath(__file__)), 'input', '*.*')))
    if not files:
        print('用法： python make_avatars.py 熊大.jpg 熊二.jpg 光头强.jpg 蹦蹦.jpg')
        sys.exit(1)

    os.makedirs(OUT_DIR, exist_ok=True)
    for f in files:
        name = os.path.basename(f)
        key = None
        for k, words in KEYWORDS:
            if any(w in name for w in words):
                key = k
                break
        if not key:
            print('跳过（文件名缺少角色关键字：熊大/熊二/光头强/蹦蹦）：', name)
            continue
        im = Image.open(f)
        reports = []
        if already_transparent(im):
            im = im.convert('RGBA')   # 已是透明底，直接用，避免误伤角色身上的白色部分
        else:
            im = to_rgba_remove_bg(im)
        im = trim_and_resize(im, report=reports)
        bbox = reports[0] if reports else None
        if bbox:
            print('  裁剪框(原图坐标):', bbox)
        out = os.path.join(OUT_DIR, key + '.png')
        im.save(out)
        alpha_ratio = sum(1 for p in im.getdata() if p[3] > 25) / float(im.size[0] * im.size[1])
        print('%s -> %s  (%dx%d, 前景占比 %.0f%%)' % (name, os.path.basename(out), im.size[0], im.size[1], alpha_ratio * 100))


if __name__ == '__main__':
    main()
