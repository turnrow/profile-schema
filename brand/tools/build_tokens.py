"""tokens.json -> tokens.css (custom properties, light + dark) and tokens.dtcg.json (W3C format).

Usage: python3 tools/build_tokens.py   (run from the repo root)
tokens.json is the single source; never edit the generated files by hand.
"""
import json, os

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SRC = os.path.join(ROOT, "design-system", "tokens.json")
t = json.load(open(SRC))
themes = [th["id"] for th in t["color"]["themes"]]
first = themes[0]


def val(tok, theme):
    v = tok["value"]
    return v if isinstance(v, str) else v.get(theme, v[first])


lines = [f"/* {t['name']} — generated from tokens.json by tools/build_tokens.py. Do not edit. */", ""]

for fnt in t["type"]["fonts"]:
    lines += ["@font-face {",
              f"  font-family: \"{fnt['family']}\";",
              f"  src: url(\"../{fnt['file']}\") format(\"woff2\");",
              f"  font-weight: {fnt['weight']};",
              f"  font-style: {fnt.get('style', 'normal')};",
              "  font-display: swap;", "}"]
lines.append("")


def color_block(theme):
    return [f"  --{c['name']}: {val(c, theme)};" for c in t["color"]["tokens"]]


lines += [":root {", f"  color-scheme: light dark;"]
for k, stack in t["type"]["families"].items():
    lines.append(f"  --font-{k}: {stack};")
for fam in ("spacing", "radius", "size"):
    for tok in t[fam]["tokens"]:
        lines.append(f"  --{tok['name']}: {tok['value']};")
lines.append("}")
lines += ["", "/* light is the default */", ":root, [data-theme=\"light\"] {", "  color-scheme: light;"] + color_block("light") + ["}"]
lines += ["", "/* dark: follows the OS unless a page forces light */",
          "@media (prefers-color-scheme: dark) {", "  :root:not([data-theme=\"light\"]) {", "    color-scheme: dark;"]
lines += ["  " + l for l in color_block("dark")] + ["  }", "}"]
lines += ["[data-theme=\"dark\"] {", "  color-scheme: dark;"] + color_block("dark") + ["}", ""]

# type classes
lines.append("/* type styles: sizes are rem so they follow the reader's browser setting */")
for g in t["type"]["groups"]:
    for s in g["styles"]:
        fam = s.get("family", g["family"])
        decl = [f"font-family: var(--font-{fam})", f"font-size: {s['fontSize']}",
                f"line-height: {s['lineHeight']}", f"font-weight: {s['fontWeight']}"]
        if "letterSpacing" in s:
            decl.append(f"letter-spacing: {s['letterSpacing']}")
        lines.append(f".{s['name']} {{ " + "; ".join(decl) + "; }")
lines += ["", "@media (min-width: 48rem) {", "  .display { font-size: 3.5rem; }", "  .heading-1 { font-size: 2.5rem; }", "}", ""]
lines += [":focus-visible { outline: var(--focus-width) solid var(--focus-ring); outline-offset: var(--focus-width); }", ""]

open(os.path.join(ROOT, "design-system", "tokens.css"), "w").write("\n".join(lines))

# W3C design tokens format, for Style Dictionary, Tokens Studio, etc.
d = {"color": {}, "font": {"family": {}}, "spacing": {}, "radius": {}, "size": {}}
for c in t["color"]["tokens"]:
    d["color"][c["name"]] = {"$type": "color", "$value": val(c, "light"), "$description": c["usage"],
                             "$extensions": {"com.turnrow.themes": {th: val(c, th) for th in themes}}}
for k, v in t["type"]["families"].items():
    d["font"]["family"][k] = {"$type": "fontFamily", "$value": v}
for fam in ("spacing", "radius", "size"):
    for tok in t[fam]["tokens"]:
        d[fam][tok["name"]] = {"$type": "dimension", "$value": tok["value"], "$description": tok["usage"]}
d["typography"] = {}
for g in t["type"]["groups"]:
    for s in g["styles"]:
        d["typography"][s["name"]] = {"$type": "typography", "$value": {
            "fontFamily": "{font.family.%s}" % s.get("family", g["family"]), "fontSize": s["fontSize"],
            "lineHeight": s["lineHeight"], "fontWeight": s["fontWeight"]}}
json.dump(d, open(os.path.join(ROOT, "design-system", "tokens.dtcg.json"), "w"), indent=2)
print("wrote design-system/tokens.css and tokens.dtcg.json")
