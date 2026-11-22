---
version: 1
name: "real G's — podcast taste (example)"
brand: real-gs
updated: 2026-11-22
colors:
  ground: "#0a0c0a"
  surface: "#111411"
  ink: "#FFFFFF"
  muted: "#A0AEC0"
  accent: "#39FF14"
typography:
  display: { fontFamily: "Bricolage Grotesque", weight: 800, tracking: "-0.02em" }
  body:    { fontFamily: "Inter", weight: 600 }
spacing: { safe: "10%" }
motion:
  ease: { enter: "power3.out", exit: "power2.in" }
format: { aspect: "16:9", length: [600, 1800], fps: 30, min_text_px: 48 }
podcast: { look: "ink-sketch", background: "assets/cover.png", accent_alt: "#fc3c44", lang: "tr",
  hosts: [ {id: "A", name: "Sunucu A", tag: "real G's"}, {id: "B", name: "Sunucu B", tag: "real G's"} ] }
---

Example brand for the podcast-scenes proof only. A real studio writes this block during setup; switch `look` to "clean" for the plain look.
