"""Rasterise the generated SVGs to PNG and ICO. Usage: export.py <svgdir> <outdir>"""
import os, subprocess, sys
from PIL import Image
src, out = sys.argv[1], sys.argv[2]
png = os.path.join(out, "png"); ico = os.path.join(out, "ico")
os.makedirs(png, exist_ok=True); os.makedirs(ico, exist_ok=True)

def r(svg, dst, w=None, h=None):
    a = ["rsvg-convert", os.path.join(src, svg), "-o", dst]
    if w: a += ["-w", str(w)]
    if h: a += ["-h", str(h)]
    subprocess.run(a, check=True)

# app icon, every size people ask for
for s in (16, 32, 48, 64, 128, 180, 192, 256, 512, 1024):
    base = "favicon-16.svg" if s == 16 else "favicon.svg" if s == 32 else "profile-schema-icon.svg"
    r(base, f"{png}/profile-schema-icon-{s}.png", w=s)
r("profile-schema-icon.svg", f"{png}/apple-touch-icon.png", w=180)
for s in (192, 512):
    r("profile-schema-icon.svg", f"{png}/android-chrome-{s}.png", w=s)
for s in (512, 1024):
    r("profile-schema-icon-mono.svg", f"{png}/profile-schema-icon-mono-{s}.png", w=s)
for v in ("light", "dark", "black", "white"):
    for s in (256, 512):
        r(f"profile-schema-mark-{v}.svg", f"{png}/profile-schema-mark-{v}-{s}.png", h=s)
for v in ("light", "dark", "mono-light", "mono-dark"):
    for h in (128, 256):
        r(f"profile-schema-lockup-{v}.svg", f"{png}/profile-schema-lockup-{v}-{h}h.png", h=h)
for v in ("light", "dark", "black", "white"):
    r(f"profile-schema-wordmark-{v}.svg", f"{png}/profile-schema-wordmark-{v}-1200w.png", w=1200)

# ICO: hand-tuned small sizes inside
def multi(name, sizes):
    imgs = [Image.open(f"{png}/profile-schema-icon-{s}.png").convert("RGBA") for s in sizes]
    big = imgs[-1]
    big.save(os.path.join(ico, name), format="ICO", sizes=[(s, s) for s in sizes], append_images=imgs[:-1])
multi("favicon.ico", (16, 32, 48))
multi("profile-schema.ico", (16, 32, 48, 64, 128, 256))
print("ok")
