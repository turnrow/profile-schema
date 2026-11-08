"""Outline a string to an SVG path with fontTools (no font dependency at render time)."""
from fontTools.ttLib import TTFont
from fontTools.pens.svgPathPen import SVGPathPen
from fontTools.pens.transformPen import TransformPen
from fontTools.pens.boundsPen import BoundsPen


def text_path(font_path, text, size, x=0.0, y=0.0, tracking=0.0):
    """Return (d, width, bounds) for text set at `size` px with baseline at y.
    tracking is in em units (e.g. 0.02)."""
    f = TTFont(font_path)
    upm = f["head"].unitsPerEm
    cmap = f.getBestCmap()
    gs = f.getGlyphSet()
    hmtx = f["hmtx"]
    s = size / upm
    pen = SVGPathPen(gs, ntos=lambda v: ("%.2f" % v).rstrip("0").rstrip("."))
    bpen = BoundsPen(gs)
    cx = x
    for ch in text:
        g = cmap[ord(ch)]
        t = (s, 0, 0, -s, cx, y)
        gs[g].draw(TransformPen(pen, t))
        gs[g].draw(TransformPen(bpen, t))
        cx += hmtx[g][0] * s + tracking * size
    width = cx - x - tracking * size
    return pen.getCommands(), width, bpen.bounds


def font_metrics(font_path):
    f = TTFont(font_path)
    os2 = f["OS/2"]
    return {"upm": f["head"].unitsPerEm, "cap": os2.sCapHeight, "x": os2.sxHeight}
