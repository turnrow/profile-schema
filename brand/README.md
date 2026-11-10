# Profile Schema brand and design system

The brand and design system for **Profile Schema**, a Turnrow Solution: one JSON source of truth for a person's professional record, with sources, competing claims, confidence, review status and per-field visibility, rendered to JSON Resume, schema.org JSON-LD, LinkedIn and more. It covers the logo, color, type, spacing and the accessibility, dark-mode, mobile-first and localization rules that every Profile Schema surface follows. The legal name, Turnrow Solutions Group LLC, goes in document text such as footers and licenses, never in the logo.

The mark is a person inside three nested rings that point forward: one profile, described in layers, moving through a system. It is drawn from constructed geometry. The rings are true offsets of one another, every diagonal sits at 55°, and the inner two rings open into chevrons on the axis.

## Principles

- **Legible before clever.** Text meets WCAG **AAA** contrast (7:1) on every surface, in both themes. The type family, Atkinson Hyperlegible, was designed for readers with low vision.
- **Small screen first.** Every size, gutter and layout starts at the phone and steps up at `48rem`.
- **Two themes, no afterthought.** Light and dark are equal citizens. Each color token has both values, and each pair has been checked.
- **Built for every locale.** Nothing assumes English, left-to-right text or a fixed text length.
- **Precise, not decorative.** Hairline structure, generous space and one gradient, used only in the mark.

## Logo

| Asset | Use it for |
|---|---|
| `profile-schema-icon.svg` | App icon, avatar, social profile picture. The default mark. |
| `profile-schema-icon-mono.svg` | One-color contexts: single-ink print, embossing, system tray. |
| `profile-schema-lockup-light.svg` / `-dark.svg` | Headers, README banners, docs sites, slides. Light means "for a light ground". |
| `profile-schema-lockup-mono-light.svg` / `-mono-dark.svg` | The same lockup with the one-color icon. |
| `profile-schema-mark-light.svg` / `-dark.svg` | The mark without its tile, placed straight on a ground. |
| `profile-schema-mark-black.svg` / `-white.svg` | Single-ink production: laser engraving, stamps, fax. |
| `profile-schema-wordmark-*.svg` | The name alone, where the icon already appears nearby. |
| `favicon.svg`, `favicon-16.svg`, `favicon.ico` | Browser tabs. These are simplified on purpose (two rings, then one) so they stay legible at 32 px and 16 px. |

**Clear space.** Keep a margin of at least one quarter of the icon's height on every side of the icon or lockup.

**Minimum sizes.** Full icon: 48 px. Below that, use the favicon cuts. Lockup: 32 px tall on screen, 10 mm in print. Wordmark: 20 px tall.

**Do not:** recolor the rings outside the supplied variants; add shadows, outlines or glows; rotate or mirror the mark (it points right in every locale, including right-to-left ones); stretch the wordmark; set the name in live Sarpanch in place of the outlined wordmark; or place the color mark on a mid-tone photo. Use the mono version there.

**Writing the name.** In prose, titles and UI copy the product is **Profile Schema**, and its full form is **Profile Schema, a Turnrow Solution** (use it once per piece, in a title, footer or about line). The lowercase, hyphenated `profile-schema` appears only in the logo wordmark and in code: the npm package `@turnrow/profile-schema`, file names and URLs. Never "ProfileSchema", "Profile-Schema" or "PS". The name is not translated or transliterated; "a Turnrow Solution" may be translated.

**Alt text.** Use "Profile Schema" for the icon, mark and lockup. When the logo is a link home, use "Profile Schema home".

## Color

The brand colors are `brand-navy` (the tile), the `brand-teal` → `brand-mint` gradient (the rings, bottom-left to top-right) and `brand-cream` (the person). The gradient belongs to the mark. Do not use it on buttons, backgrounds or text.

Interface color comes from role tokens, and each one has a light and a dark value:

- `surface-100` page, `surface-200` raised (cards, code), `surface-300` inset and hover.
- `ink` for text, `ink-muted` for secondary text, `link` for links (always underlined).
- `action` with `on-action` for primary buttons.
- `border-control` for the edges of inputs and controls (3:1 or better), `hairline` for decorative dividers only.
- `focus-ring` for the visible focus outline: 2 px wide, 2 px offset, on every focusable element.
- `success`, `warning` and `danger`. Each is always paired with an icon or a word, never color alone.

Every text token is at least **7:1** on all three surfaces in both themes. The tightest pairings are on `surface-300`: `ink-muted` in dark at 7.4:1, `link` in light at 7.7:1, and `danger` in dark at 7.9:1. `tools/contrast.py` re-checks them. `brand-teal` and `brand-mint` are decorative and are never used for text on light grounds.

## Typography

- **Atkinson Hyperlegible Next** (variable, weights 200–800, with italics) for all interface and document text.
- **Atkinson Hyperlegible Mono** for code, schema keys and values.
- **Sarpanch Bold** only inside the wordmark, which ships as outlines so it never depends on the font loading.

Sizes are in `rem`, so they follow the reader's browser setting. Body text is 17 px (`1.0625rem`) at a 1.6 line height, and running text is capped at `measure` (70 characters), as WCAG 1.4.8 asks. `display` and `heading-1` step up from `48rem` wide. Do not use text smaller than `caption` (14 px).

## Space and shape

The spacing scale is a 4 px rhythm: `space-1` (4) through `space-16` (64). On mobile, page gutters and card padding use `space-4`. From `48rem` they use `space-6`.

Corners: `radius-sm` for inputs, `radius-md` for buttons and cards, `radius-lg` for dialogs, `radius-pill` for badges. `radius-icon` (21.875%) is reserved for squares that frame the mark. Touch targets are at least `target-min` (44 px), as WCAG 2.5.5 (AAA) requires.

## Dark mode

`tokens.css` follows `prefers-color-scheme` by default. A page can force a theme with `data-theme="light"` or `data-theme="dark"` on `<html>`. For logos, use the `-dark` files on dark grounds, and swap them with a `<picture>` element and a `prefers-color-scheme` source (see `brand/head-snippet.html`). If your app has its own theme switch, swap the logo `src` from the same state, because the media query only reads the operating-system setting.

## Localization

- Set `lang` and `dir` on `<html>`, and lay out with logical properties (`margin-inline-start`, `padding-block`, `inset-inline-end`), so right-to-left locales mirror without extra CSS.
- Leave room for text to grow by 40% or more. Never fix the width of a button or label to fit its English text.
- Put no words in images other than the wordmark.
- Format dates, numbers and lists with `Intl`, and never build sentences by concatenating strings.
- The Atkinson faces cover Latin and Latin Extended. For other scripts, the font stacks fall back to the system UI face, then Noto. Test with real strings in every launch locale.
- The logo never mirrors, and the product name is never translated.

## Files in this folder

```
svg/                    master artwork (generated; never hand-edit)
png/                    raster exports: app icons, apple-touch-icon, android-chrome, lockups
ico/                    favicon.ico (16/32/48) and profile-schema.ico (16–256)
design-system/
  tokens.json           the source of truth for color, type, space, radius and size
  tokens.css            generated custom properties, light + dark
  tokens.dtcg.json      generated W3C-format tokens (Style Dictionary, Tokens Studio)
fonts/                  woff2 files and their OFL licenses
head-snippet.html       favicons, manifest, theme-color and tokens.css for a web page's <head>
site.webmanifest
tools/                  build_brand.py, export.py, build_tokens.py, contrast.py
```

The npm package doesn't ship this folder (it isn't in `package.json` `files`), so it adds nothing to installs.

## Regenerating

Run from this folder:

```sh
python3 tools/build_brand.py svg fonts/Sarpanch-Bold.woff2   # logos
python3 tools/export.py svg .                                # PNG and ICO (writes the full size set)
python3 tools/build_tokens.py                                # tokens.css and tokens.dtcg.json
python3 tools/contrast.py                                    # fails if any color pair drops below AAA
```

To change the logo, change the constants in `tools/build_brand.py` and re-run. Do not edit an SVG by hand. The scripts need Python 3 with `fonttools`, `brotli` and `Pillow`, plus `rsvg-convert`.
