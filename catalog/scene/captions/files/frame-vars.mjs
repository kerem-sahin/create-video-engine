#!/usr/bin/env node
// frame-vars: frame.md (the brand's STYLE.md copy) -> assets/brand.css with the CSS variables the caption and
// card scenes use. Colours become --c-<name> (ground, ink, accent, muted, surface ...); typography becomes
// --f-display/--w-display/--t-display and --f-body/... ; spacing.safe becomes --safe.
//   node frame-vars.mjs <frame.md> [--out assets/brand.css]
// Link it from index.html:  <link rel="stylesheet" href="assets/brand.css">
// Own code. Zero dependencies. Reads only the YAML frontmatter, and only the simple shapes frame.md uses.
import { readFileSync, writeFileSync, mkdirSync, realpathSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

export function parseFrame(text) {
  const m = text.match(/^---\r?\n([\s\S]*?)\r?\n---/);
  if (!m) throw new Error("no YAML frontmatter in frame.md");
  const colors = {}, type = {};
  let safe = null, section = null;
  for (const raw of m[1].split(/\r?\n/)) {
    const line = raw.replace(/\s+#.*$/, "");
    if (/^\S/.test(line)) {
      section = line.match(/^(colors|typography):/)?.[1] ?? null;
      const sp = line.match(/^spacing:\s*\{[^}]*safe:\s*"?([\d.]+%?)"?/);
      if (sp) safe = sp[1];
      continue;
    }
    if (section === "colors") {
      const c = line.match(/^\s+([\w-]+):\s*"?(#[0-9a-fA-F]{3,8})"?/);
      if (c) colors[c[1]] = c[2];
    } else if (section === "typography") {
      const t = line.match(/^\s+(\w+):\s*\{(.*)\}/);
      if (t) {
        const get = (k) => t[2].match(new RegExp(`${k}:\\s*(?:"([^"]*)"|([^,}]+))`))?.slice(1).find((x) => x !== undefined)?.trim();
        type[t[1]] = { family: get("fontFamily"), weight: get("weight"), tracking: get("tracking") };
      }
    }
  }
  return { colors, type, safe };
}

// WCAG contrast ratio of two #rrggbb colours (null if either is not a 6-digit hex)
export function contrast(a, b) {
  const lum = (h) => {
    const m = /^#?([0-9a-f]{6})$/i.exec(String(h).trim()); if (!m) return null;
    const c = [0, 2, 4].map((i) => parseInt(m[1].slice(i, i + 2), 16) / 255).map((v) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4));
    return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
  };
  const x = lum(a), y = lum(b);
  if (x === null || y === null) return null;
  return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05);
}

export function toCss({ colors, type, safe }) {
  const out = [":root {"];
  for (const [k, v] of Object.entries(colors)) out.push(`  --c-${k}: ${v};`);
  // text drawn in the accent colour must stay readable on the ground: a neon accent on paper is not
  if (colors.accent && colors.ground) {
    const r = contrast(colors.accent, colors.ground);
    out.push(`  --c-accent-text: ${r !== null && r < 3 && colors.ink ? colors.ink : colors.accent};${r !== null && r < 3 ? ` /* accent ${colors.accent} is ${r.toFixed(1)}:1 on the ground: text uses ink */` : ""}`);
  }
  for (const [k, t] of Object.entries(type)) {
    if (t.family) out.push(`  --f-${k}: "${t.family}", sans-serif;`);
    if (t.weight) out.push(`  --w-${k}: ${t.weight};`);
    if (t.tracking) out.push(`  --t-${k}: ${t.tracking};`);
  }
  if (safe) out.push(`  --safe: ${safe};`);
  out.push("}");
  return out.join("\n") + "\n";
}

if (process.argv[1] && realpathSync(fileURLToPath(import.meta.url)) === realpathSync(resolve(process.argv[1]))) {
  const [file, flag, out] = process.argv.slice(2);
  if (!file) { console.error("usage: frame-vars.mjs <frame.md> [--out assets/brand.css]"); process.exit(64); }
  const css = toCss(parseFrame(readFileSync(resolve(file), "utf8")));
  if (flag === "--out" && out) { mkdirSync(dirname(resolve(out)), { recursive: true }); writeFileSync(resolve(out), css); console.log("wrote " + resolve(out)); }
  else process.stdout.write(css);
}
