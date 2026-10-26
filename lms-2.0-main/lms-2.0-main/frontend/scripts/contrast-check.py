"""Contrast gate for tokens.css (NFR-024): every preset x light/dark, WCAG 2.x ratios.
Usage: python contrast-check.py path/to/tokens.css   (exit 1 on any failure). No dependencies."""
import re, sys

def lum(h):
    h = h.lstrip('#'); r, g, b = [int(h[i:i + 2], 16) / 255 for i in (0, 2, 4)]
    f = lambda c: c / 12.92 if c <= 0.03928 else ((c + 0.055) / 1.055) ** 2.4
    return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b)

def cr(a, b):
    la, lb = lum(a), lum(b); return (max(la, lb) + 0.05) / (min(la, lb) + 0.05)

# (foreground token, background token, minimum ratio). 7 = body text, 4.5 = large text / UI, 3 = non-text UI.
PAIRS = [("text", "bg", 7), ("text", "surface", 7), ("text-muted", "bg", 7), ("text-muted", "surface", 7),
         ("accent-text", "bg", 7), ("accent-text", "surface", 7),
         ("accent-contrast", "accent", 4.5), ("danger-contrast", "danger", 4.5), ("accent", "bg", 3),
         ("danger-text", "bg", 7), ("danger-text", "surface", 7), ("success", "bg", 4.5), ("warning", "bg", 4.5),
         ("danger", "bg", 4.5), ("danger", "surface", 4.5),
         ("text", "danger-bg", 7), ("text", "success-bg", 7), ("text", "warning-bg", 7),
         ("danger-text", "danger-bg", 4.5), ("success", "success-bg", 4.5), ("warning", "warning-bg", 4.5)]
PAIRS += [(fg, f"tint-{i}", mn) for i in (1, 2, 3, 4) for fg, mn in (("text", 7), ("text-muted", 7), ("accent-text", 4.5))]

def main(path):
    css = open(path, encoding="utf-8").read()
    blocks = re.findall(r'\[data-preset="(\w+)"\]\s*\{(.*?)\n\}', css, re.S)
    fails = checked = 0
    for name, body in blocks:
        light, dark = {}, {}
        for tok, l, d in re.findall(r"--color-([\w-]+):\s*light-dark\((#[0-9A-Fa-f]{6}),\s*(#[0-9A-Fa-f]{6})\)", body):
            light[tok] = l; dark[tok] = d
        for mode, t in (("light", light), ("dark", dark)):
            for fg, bg, mn in PAIRS:
                if fg not in t or bg not in t:
                    fails += 1; print(f"MISSING {name}/{mode}: --color-{fg} or --color-{bg}"); continue
                r = cr(t[fg], t[bg]); checked += 1
                if r < mn:
                    fails += 1; print(f"FAIL {name}/{mode}: {fg} on {bg} = {r:.2f} < {mn}")
    print(f"{len(blocks)} presets, {checked} pairs checked, {fails} failures")
    return 1 if fails or not blocks else 0

if __name__ == "__main__":
    sys.exit(main(sys.argv[1] if len(sys.argv) > 1 else "tokens.css"))
