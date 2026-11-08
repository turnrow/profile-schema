"""Generate the profile-schema brand SVGs from constructed geometry.

Every logo file is generated here. To change the mark, change the constants
below and re-run; never hand-edit an output SVG.

Construction (512-unit tile):
  * three concentric rings share one centre; each ring is a left semicircle,
    horizontal tangents, a rounded corner, then 60-degree diagonals to a tip
  * rings are true offsets of one another (circle radius, corner radius and
    diagonal all move by the ring pitch), so every diagonal is parallel
  * the outer ring closes in a point; the inner two are cut by a horizontal
    gap on the axis, which reads as nested chevrons
  * the person glyph sits on the shared centre
"""
import math, os, sys

sys.path.insert(0, os.path.dirname(__file__))
from textpath import text_path

OUT = sys.argv[1] if len(sys.argv) > 1 else "out"
FONT_WORD = sys.argv[2] if len(sys.argv) > 2 else "sarpanch-700.woff2"

# ---- palette (sampled from the concept art, then fixed) --------------------
NAVY = "#023341"      # tile / ink
TEAL = "#00a89f"      # gradient start (bottom-left)
MINT = "#b8f2dc"      # gradient end (top-right)
CREAM = "#f7f6ee"     # person glyph
WHITE = "#ffffff"
INK_DARK_BG = "#e6f6f1"  # wordmark on dark grounds

# ---- geometry ---------------------------------------------------------------
TILE = 512
TILE_R = 112          # tile corner radius
S = 1.0               # scale of the mark inside the tile
CX, CY = 248.0, 256.0  # unscaled centre (before scale about tile centre)
W = 24.5              # ring stroke
PITCH = 42.5          # ring centreline pitch
R0 = 118.0            # innermost ring centreline radius
RC0 = 60.0            # innermost corner radius
KX = CX + 15.0        # corner centre x (shared by all rings)
ALPHA = math.radians(55)  # diagonal angle from horizontal
GAP = 28.0            # tip gap on the inner rings
N_RINGS = 3

HEAD_R = 41.0
HEAD_DY = -36.0       # head centre relative to ring centre
BODY_W = 138.0
BODY_H = 58.0
BODY_TOP = 14.0       # body top relative to ring centre


def f(v):
    return ("%.2f" % v).rstrip("0").rstrip(".")


def sc(x, y):
    """scale about the tile centre"""
    return 256 + (x - 256) * S, 256 + (y - 256) * S


def ring_path(d_off, closed):
    """centre-line path of the ring offset by d_off from the innermost."""
    R = R0 + d_off
    rc = RC0 + d_off
    ky = CY - R0 + RC0
    n = (math.sin(ALPHA), -math.cos(ALPHA))
    # tangent point on top corner circle
    tx, ty = KX + rc * n[0], ky + rc * n[1]
    c = n[0] * KX + n[1] * ky + rc
    tip_x = (c - n[1] * CY) / n[0]
    # bottom (mirror about CY)
    kyb = 2 * CY - ky
    bx, by = tx, 2 * CY - ty
    p = lambda x, y: "%s %s" % tuple(f(v) for v in sc(x, y))
    r_s, rc_s = R * S, rc * S
    if closed:
        d = (
            f"M{p(tip_x, CY)} L{p(tx, ty)} "
            f"A{f(rc_s)} {f(rc_s)} 0 0 0 {p(KX, CY - R)} "
            f"L{p(CX, CY - R)} "
            f"A{f(r_s)} {f(r_s)} 0 0 0 {p(CX, CY + R)} "
            f"L{p(KX, CY + R)} "
            f"A{f(rc_s)} {f(rc_s)} 0 0 0 {p(bx, by)} Z"
        )
    else:
        # open: start/stop at the gap edge on the diagonals
        h = GAP / 2
        # point on top diagonal at y = CY - h
        gx = tip_x - h / math.tan(ALPHA)
        d = (
            f"M{p(gx, CY - h)} L{p(tx, ty)} "
            f"A{f(rc_s)} {f(rc_s)} 0 0 0 {p(KX, CY - R)} "
            f"L{p(CX, CY - R)} "
            f"A{f(r_s)} {f(r_s)} 0 0 0 {p(CX, CY + R)} "
            f"L{p(KX, CY + R)} "
            f"A{f(rc_s)} {f(rc_s)} 0 0 0 {p(bx, by)} "
            f"L{p(gx, CY + h)}"
        )
    return d, tip_x


def person_path():
    hx, hy = sc(CX, CY + HEAD_DY)
    hr = HEAD_R * S
    head = (f"M{f(hx - hr)} {f(hy)} a{f(hr)} {f(hr)} 0 1 0 {f(2*hr)} 0 "
            f"a{f(hr)} {f(hr)} 0 1 0 {f(-2*hr)} 0Z")
    # shoulders: half-ellipse dome on a softly rounded base
    bw, bh = BODY_W * S, BODY_H * S
    x0, y0 = sc(CX - BODY_W / 2, CY + BODY_TOP + BODY_H)
    rx, ry = bw / 2, bh
    cr = 10 * S
    body = (f"M{f(x0 + cr)} {f(y0)} "
            f"a{f(cr)} {f(cr)} 0 0 1 {f(-cr)} {f(-cr)} "
            f"A{f(rx)} {f(ry - cr)} 0 0 1 {f(x0 + bw)} {f(y0 - cr)} "
            f"a{f(cr)} {f(cr)} 0 0 1 {f(-cr)} {f(cr)}Z")
    return head + " " + body


def gap_clip(idp):
    """everything except a horizontal band on the axis, right of the corner centre"""
    x0, _ = sc(KX, CY)
    _, y0 = sc(0, CY - GAP / 2)
    _, y1 = sc(0, CY + GAP / 2)
    return (f'<clipPath id="{idp}c"><path clip-rule="evenodd" d="M-64 -64H640V640H-64Z '
            f'M{f(x0)} {f(y0)}H640V{f(y1)}H{f(x0)}Z"/></clipPath>')


def mark_group(ring_paint, person_fill, idp, rings=N_RINGS, width=W):
    stroke = (f'fill="none" stroke="{ring_paint}" stroke-width="{f(width * S)}" '
              f'stroke-linejoin="miter" stroke-miterlimit="4"')
    outer, _ = ring_path((rings - 1) * PITCH, True)
    inner = [ring_path(k * PITCH, True)[0] for k in range(rings - 2, -1, -1)]
    parts = [f'<path d="{outer}" {stroke}/>',
             f'<g clip-path="url(#{idp}c)">' + "".join(f'<path d="{d}" {stroke}/>' for d in inner) + "</g>",
             f'<path d="{person_path()}" fill="{person_fill}"/>']
    return "\n  ".join(parts)


def gradient(idp):
    # bottom-left teal to top-right mint
    return gap_clip(idp) + (f'<linearGradient id="{idp}g" x1="64" y1="448" x2="448" y2="64" gradientUnits="userSpaceOnUse">'
            f'<stop offset="0" stop-color="{TEAL}"/><stop offset="1" stop-color="{MINT}"/></linearGradient>')


def svg(w, h, body, title, vb=None, extra_defs=""):
    vb = vb or f"0 0 {f(w)} {f(h)}"
    return (f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="{vb}" width="{f(w)}" height="{f(h)}" '
            f'role="img" aria-labelledby="t">\n  <title id="t">{title}</title>\n'
            f'  {("<defs>" + extra_defs + "</defs>") if extra_defs else ""}\n  {body}\n</svg>\n')


def icon_body(variant, idp="ps-"):
    tile = f'<rect width="{TILE}" height="{TILE}" rx="{TILE_R}" fill="{NAVY}"/>'
    if variant == "color":
        return gradient(idp), tile + "\n  " + mark_group(f"url(#{idp}g)", CREAM, idp)
    if variant == "mono":
        return gap_clip(idp), tile + "\n  " + mark_group(WHITE, WHITE, idp)
    raise ValueError


def mark_only(variant, idp="ps-"):
    """no tile; for placing directly on a ground"""
    if variant == "light":   # on light grounds
        return gap_clip(idp), mark_group(NAVY, NAVY, idp)
    if variant == "dark":    # on dark grounds
        return gradient(idp), mark_group(f"url(#{idp}g)", CREAM, idp)
    if variant == "black":
        return gap_clip(idp), mark_group("#000", "#000", idp)
    if variant == "white":
        return gap_clip(idp), mark_group("#fff", "#fff", idp)


def bbox_mark():
    _, tip = ring_path((N_RINGS - 1) * PITCH, True)
    outer = R0 + (N_RINGS - 1) * PITCH + W / 2
    tip_edge = tip + (W / 2) / math.sin(ALPHA)
    x0, y0 = sc(CX - outer, CY - outer)
    x1, y1 = sc(tip_edge, CY + outer)
    return x0, y0, x1, y1


def favicon():
    """2 rings, heavier strokes: legible at 16-32 px."""
    global R0, PITCH, RC0
    saved = (R0, PITCH, RC0)
    R0, PITCH, RC0 = 128.0, 66.0, 64.0
    defs = gradient("fv-")
    tile = f'<rect width="{TILE}" height="{TILE}" rx="{TILE_R}" fill="{NAVY}"/>'
    parts = []
    st = f'fill="none" stroke="url(#fv-g)" stroke-width="{f(40 * S)}" stroke-linejoin="miter" stroke-miterlimit="4"'
    parts.append(f'<path d="{ring_path(PITCH, True)[0]}" {st}/>')
    parts.append(f'<g clip-path="url(#fv-c)"><path d="{ring_path(0, True)[0]}" {st}/></g>')
    global HEAD_R, BODY_W, BODY_H
    s2 = (HEAD_R, BODY_W, BODY_H)
    HEAD_R, BODY_W, BODY_H = 48.0, 160.0, 66.0
    parts.append(f'<path d="{person_path()}" fill="{CREAM}"/>')
    HEAD_R, BODY_W, BODY_H = s2
    R0, PITCH, RC0 = saved
    return defs, tile + "\n  " + "\n  ".join(parts)


def favicon_small():
    """one ring, heavy stroke: for 16 px only."""
    global R0, RC0, HEAD_R, BODY_W, BODY_H, HEAD_DY, BODY_TOP
    saved = (R0, RC0, HEAD_R, BODY_W, BODY_H, HEAD_DY, BODY_TOP)
    R0, RC0 = 168.0, 110.0
    HEAD_R, BODY_W, BODY_H, HEAD_DY, BODY_TOP = 58.0, 196.0, 80.0, -44.0, 22.0
    tile = f'<rect width="{TILE}" height="{TILE}" rx="{TILE_R}" fill="{NAVY}"/>'
    st = f'fill="none" stroke="url(#fs-g)" stroke-width="64" stroke-linejoin="miter" stroke-miterlimit="4"'
    body = tile + f'\n  <path d="{ring_path(0, True)[0]}" {st}/>\n  <path d="{person_path()}" fill="{CREAM}"/>'
    (R0, RC0, HEAD_R, BODY_W, BODY_H, HEAD_DY, BODY_TOP) = saved
    return gradient("fs-"), body


def write(name, content):
    os.makedirs(OUT, exist_ok=True)
    with open(os.path.join(OUT, name), "w") as fh:
        fh.write(content)


def main():
    T = "profile-schema"
    d, b = icon_body("color"); write("profile-schema-icon.svg", svg(512, 512, b, T, extra_defs=d))
    d, b = icon_body("mono"); write("profile-schema-icon-mono.svg", svg(512, 512, b, T, extra_defs=d))
    d, b = favicon(); write("favicon.svg", svg(512, 512, b, T, extra_defs=d))
    d, b = favicon_small(); write("favicon-16.svg", svg(512, 512, b, T, extra_defs=d))

    x0, y0, x1, y1 = bbox_mark()
    pad = 0
    vb = f"{f(x0-pad)} {f(y0-pad)} {f(x1-x0+2*pad)} {f(y1-y0+2*pad)}"
    mw, mh = x1 - x0, y1 - y0
    for v in ("light", "dark", "black", "white"):
        d, b = mark_only(v, f"m{v}-")
        write(f"profile-schema-mark-{v}.svg", svg(mw, mh, b, T, vb=vb, extra_defs=d))

    # wordmark: outlined Sarpanch 700, lowercase, as the concept
    size = 200
    dpath, ww, bnd = text_path(FONT_WORD, T, size, 0, 0, tracking=-0.01)
    bx0, by0, bx1, by1 = bnd
    wvb = f"{f(bx0)} {f(by0)} {f(bx1-bx0)} {f(by1-by0)}"
    for v, col in (("light", NAVY), ("dark", INK_DARK_BG), ("black", "#000"), ("white", "#fff")):
        write(f"profile-schema-wordmark-{v}.svg",
              svg(bx1 - bx0, by1 - by0, f'<path d="{dpath}" fill="{col}"/>', T, vb=wvb))

    # horizontal lockup: tile icon + wordmark. icon height H; x-height-ish
    # wordmark sized so its lowercase body = 42% of tile, baseline on tile
    # centre + half x-height (optically centred on the person glyph axis)
    H = 512
    gapx = 0.16 * H
    wscale = (2.6 * H) / (bx1 - bx0)
    # vertical: centre the wordmark's x-height band on the tile centre
    from textpath import font_metrics
    m = font_metrics(FONT_WORD)
    xh = m["x"] / m["upm"] * size * wscale
    base = H / 2 + xh / 2
    tx = H + gapx
    total_w = tx + (bx1) * wscale
    top = min(0, base + by0 * wscale)
    bottom = max(H, base + by1 * wscale)
    for v, col, icon in (("light", NAVY, "color"), ("dark", INK_DARK_BG, "color"),
                          ("mono-light", NAVY, "mono"), ("mono-dark", "#fff", "mono")):
        d, b = icon_body(icon, f"l{v}-")
        if v == "mono-dark":
            # white tile reversed: navy tile still reads on dark; keep navy tile, white rings
            pass
        word = (f'<g transform="translate({f(tx)} {f(base)}) scale({f(wscale)})">'
                f'<path d="{dpath}" fill="{col}"/></g>')
        body = b + "\n  " + word
        write(f"profile-schema-lockup-{v}.svg",
              svg(total_w, bottom - top, body, T, vb=f"0 {f(top)} {f(total_w)} {f(bottom-top)}", extra_defs=d))
    print("written to", OUT)


if __name__ == "__main__":
    main()
