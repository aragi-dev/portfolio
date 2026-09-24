# Hero Pixel Omarchy — Feature Tasks

Replica la firma del hero de omarchy.org con técnica propia (sin copiar assets):
técnica original = SVG de `<rect>` píxeles como máscara CSS sobre gradiente vertical
en 5 bandas + campo de píxeles (canvas "etch") de fondo.

Decisiones usuario: wordmark = nombre en pixel (lee `profile.name`), fondo sutil animado.

## Tasks
- [x] 1. Wordmark pixel del nombre + gradiente Solitude (done)
  Evidencia: pixel-font.ts 5x7 propio + PixelWordmark.astro (mask sobre 5 bandas),
  h1 sr-only, dist contiene pixel-wordmark y mask-image.
- [x] 2. Fondo PixelField canvas sutil animado (done)
  Evidencia: PixelField.astro (~4px, densidad radial, twinkle 7% rAF,
  reduced-motion + IntersectionObserver + visibilitychange).
- [x] 3. Integrar hero y verificar build (done)
  Evidencia: `bun run build` PASS (262ms, 1 página). Nota: /tmp se limpió y se
  perdió el .git vacío (cero commits) → `git init` fresco, sin pérdida.
  Deuda: profile.name sigue mock "Tu Nombre" — el wordmark se actualiza solo
  al poner el nombre real.
  Outcome: `src/lib/pixel-font.ts` (bitmap 5x7 A-Z 0-9 Ñ espacio guión),
  `src/components/PixelWordmark.astro` (SVG rects como mask sobre gradiente
  5 bandas Solitude: #d9dbdc → #9fa5a9 → #798186 → #565d60 → #343d41),
  h1 sr-only por a11y, wordmark aria-hidden.
- [ ] 2. Fondo PixelField canvas sutil animado (pending)
  Outcome: `src/components/PixelField.astro`, píxeles 4px, densidad radial
  (más denso en bordes), twinkle sutil con rAF, respeta
  prefers-reduced-motion, pausa offscreen/oculto, pointer-events none.
- [ ] 3. Integrar hero y verificar build (pending)
  Outcome: Hero reescrito (field bg + prompt + wordmark + rol/bio/CTAs),
  `src/styles/hero-pixel.css`, `bun run build` PASS, sin Tailwind, sin commits.

Evidencia commits: sin autorización de commits, no commitear.
