# Full ASCII visual — Feature Tasks

Decisión usuario: "full ASCII literal". Desafío de arquitecto aceptado parcial:
look full-ASCII real sin destruir a11y/SEO/perf (rects literales por párrafo =
miles de nodos, ilegible en mobile, rompe selección).
Implementación: todo lo display en tipografía pixel (Press Start 2P via
Fontsource) + wordmarks pixel + cromo ASCII (█ ▓ ▒ ░ ─ │ ┌ ┐ └ ┘) en
divisores, bordes, bullets y frames. Cuerpo en JetBrains Mono legible.

Incluye los 3 fixes del hero diagnosticados en captura 89004a83:
1. PixelField confinado a caja 72ch → full-bleed (breakout 100vw del container).
2. Wordmark flaco → escala de bloques 2x-3x (chunky como OMARCHY original).
3. Twinkle invisible → hacerlo perceptible (más % y rango de alpha).

## Tasks
- [x] 1. Fix hero: full-bleed + chunky + twinkle visible (done)
  Evidencia: breakout 100vw, PixelWordmark scale default 2, twinklers 15%
  wave 0.3-1, build PASS.
- [x] 2. Sistema ASCII global (done)
  Evidencia: Press Start 2P display en h/nav/cta/logo, AsciiDivider,
  SectionTitle en las 5 secciones, esquina ┌── en cards, bullets ▸.
  Texto real siempre en DOM (desafío full-literal documentado arriba).
- [x] 3. Verificar build y restaurar git (done)
  Evidencia: `bun run build` PASS (244ms), .git restaurado del backup3,
  sin commits. Deuda: profile.name mock; 100vw+scrollbar verificar visual.
  Outcome: Hero rompe el container a 100vw, field cubre viewport width,
  PixelWordmark con prop scale (default 2), twinkle ~15% con wave amplia.
- [ ] 2. Sistema ASCII global (pending)
  Outcome: `--font-display: 'Press Start 2P'` en tokens; h1/h2/nav/botones/
  logo en display; `AsciiDivider.astro` + bordes ASCII en cards (border-image
  o pseudo-elementos con caracteres blocks); bullets `▸`/`█`; header/footer
  con marco ASCII. Texto real siempre en DOM (seleccionable, a11y).
- [ ] 3. Verificar build y restaurar git (pending)
  Outcome: `bun run build` PASS, .git restaurado, sin commits.

## Round 2 — fidelidad al original (código omarchy-site leído en /tmp, no copiado)
Receta extraída de HeroPixelField.tsx + etch.ts + tokens solitude:
- lattice compartida anclada al slot del wordmark (cell = slotWidth/cols)
- rampa radial (rr-0.42)/0.85 al cuadrado + clear vertical (y-24)/130 min 0.16
- ruido value 2 octavas a la deriva + twinkle senoidal + umbral Bayer 8x8
- wordmark se dibuja al cargar con efecto terminal aleatorio (ttfx WASM en
  original; nuestro: laser-sweep / decrypt / wipe propios en canvas)
- field solitude: bg #080a0b, dim #2a2e30, mid #4e5457, lit #798186,
  hover #a1a7aa, crest #cccfd1; bandas wordmark proporcionales a LASER_BANDS
- [x] 4. Field receta original (done)
  Evidencia: lattice anclada al slot, Bayer+jitter, ruido 2 octavas,
  grises dim/mid en reposo, build PASS.
- [x] 5. Efecto entrada aleatorio + reveal (done)
  Evidencia: laser-sweep/decrypt/wipe 1.2-2.2s + handoff is-hidden +
  fallback 5s. Verificación visual pendiente (usuario).
- [x] 6. Paleta exacta + build PASS (done)
  Evidencia: field solitude exacto, bandas crest/hover/lit/mid/dim,
  build 237ms, .git restaurado, sin commits.

## Round 3 — hero full-screen + stamps triángulo + replay (pedido usuario)
Revisión de código propio vs original: field/reveal/handoff OK; falta altura
100dvh, click-stamps (original: logo 15x15; nuestro: triángulo) y replay
al clickear la palabra. Letterforms 5x7 se mantienen (bitmap original
deletrea OMARCHY, es su marca; el nuestro deletrea el nombre).
- [x] 7. Hero full viewport + centrado (done)
  Evidencia: min-height 100vh/100svh + flex center, canvas inset-0.
- [x] 8. Stamps triángulo + replay wordmark (done)
  Evidencia: triángulo 15x8 propio, bloom+disolvido 1.4s max 4,
  click en palabra re-ejecuta reveal aleatorio, cursor pointer.
- [x] 9. Build PASS + git (done)
  Evidencia: build 252ms, .git restaurado, sin commits.
- [ ] 8. Stamps triángulo + replay wordmark (pending)
- [ ] 9. Build PASS + git (pending)
- [ ] 5. Efecto entrada aleatorio + reveal (pending)
- [ ] 6. Paleta exacta + build PASS (pending)
