def lum(h):
    h=h.lstrip('#'); r,g,b=[int(h[i:i+2],16)/255 for i in (0,2,4)]
    f=lambda c: c/12.92 if c<=0.04045 else ((c+0.055)/1.055)**2.4
    return 0.2126*f(r)+0.7152*f(g)+0.0722*f(b)
def cr(a,b):
    la,lb=sorted([lum(a),lum(b)],reverse=True); return (la+0.05)/(lb+0.05)


if __name__ == "__main__":
    # check every text token is >= 7:1 (AAA) and control/focus tokens >= 3:1 on every surface, every theme
    import json, os, sys
    root = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
    t = json.load(open(os.path.join(root, "design-system", "tokens.json")))
    tok = {c["name"]: c["value"] for c in t["color"]["tokens"]}
    themes = [th["id"] for th in t["color"]["themes"]]
    v = lambda n, th: tok[n] if isinstance(tok[n], str) else tok[n].get(th, tok[n][themes[0]])
    surfaces = ["surface-100", "surface-200", "surface-300"]
    rules = {n: 7 for n in ("ink", "ink-muted", "link", "success", "warning", "danger")}
    rules.update({"border-control": 3, "focus-ring": 3})
    fails = 0
    for n, need in rules.items():
        worst = min((cr(v(n, th), v(s, th)), th, s) for th in themes for s in surfaces)
        ok = worst[0] >= need
        fails += not ok
        print(f"{'ok  ' if ok else 'FAIL'} {n:15} {worst[0]:5.2f}:1 (needs {need}:1; worst on {worst[2]}, {worst[1]})")
    for th in themes:
        r = cr(v("on-action", th), v("action", th))
        fails += r < 7
        print(f"{'ok  ' if r >= 7 else 'FAIL'} on-action/{th} {r:5.2f}:1")
    sys.exit(1 if fails else 0)
