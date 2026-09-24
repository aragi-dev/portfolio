# Remove code comments — Feature Tasks

Objective: eliminar los comentarios explicativos del código fuente porque el proyecto está terminado y se ven mal.

Problem: el código acumula ~1380 líneas de comentarios en 16 archivos (explicaciones, JSDoc descriptivo, notas de arquitectura) que ensucian la lectura del código final.

Why: pedido directo del usuario — código terminado, quiere presentación limpia.

Scope:
- src/components/Hero.astro
- src/components/PixelField.astro
- src/components/InfoSection.astro
- src/components/PixelGlyph.astro
- src/layouts/Base.astro
- src/lib/aragi-bitmap.ts
- src/lib/ttfx-bridge.ts
- src/lib/dom-raster.ts
- src/lib/glyph-bitmaps.ts
- src/lib/palette.ts
- src/data/portfolio.ts
- src/styles/tokens.css
- src/styles/reset.css
- src/styles/global.css
- src/styles/hero-pixel.css
- src/env.d.ts

Constraints:
- NO cambiar runtime ni comportamiento — solo borrar comentarios.
- Preservar directivas de máquina necesarias: `/// <reference ... />` en env.d.ts y `// @ts-check` donde exista (afecta al type-check, no es comentario decorativo).
- Preservar JSDoc que tipa (typedef/param/returns/type) SOLO si quitarlo rompe `astro check`; si no rompe, se elimina también por pedido del usuario. El worker lo verifica con el check.
- No borrar código comentado sin confirmar que es código muerto — si hay, eliminarlo también (sigue siendo limpieza).
- No tocar dist/, node_modules/, .astro/.

TDD mode: off (limpieza sin comportamiento). Source: project config (no test runner configurado para esto). Runner funcional: `bun run build` + `bun run check` (astro check).

Delivery strategy: single-pr (limpieza pequeña, un solo commit en rama feature).

## Tasks
- [x] 1. Strip comments en componentes + layout (Hero, PixelField, InfoSection, PixelGlyph, Base)
  Evidencia: build PASS 237ms (padre) / 223ms (verifier); grep solo allow-list (ts-check, reference, vite-ignore, https, xmlns, /<\// regex); PixelField 11+/654- (recortes de trailing y casts JSDoc).
- [x] 2. Strip comments en lib + data + styles + env (aragi-bitmap, ttfx-bridge, dom-raster, glyph-bitmaps, palette, portfolio, css, env.d.ts)
  Evidencia: `git diff --stat` 15 files +54/-1270; los 54 + verificados por el padre: recortes identicos sin comentario (`const X; // c` -> `const X;`, `case 0x..: // c` -> `case 0x..:`, `/** @type */ (x)` -> `(x)`); cero logica nueva; env.d.ts sin cambios.

Progress: completo, sin commit (rama chore/remove-code-comments).
Verification evidence:
- writer: build PASS ~460ms; check FAIL ambiental preexistente (astro check 0.9.10 vs TS 7.0.2, aborta en constructor antes de diagnosticos).
- padre spot-check: build PASS 237ms; grep 15 hits solo allow-list; 54 inserciones auditadas una por una, todas recortes.
- verifier independiente (gentle-ai-verify): partial-pass — build PASS, grep PASS, PixelField cero +; dejo sin verificar global de 54+ que el padre cerro arriba; check no re-ejecutado por constraint de comandos exactos.
- assess nativo: unassessable -> tratado como high -> writer self-verify + verifier independiente, ambos cumplidos.
Next step: usuario revisa `git diff`; si aprueba, commitea en la rama (no commiteado por politica). Futuro: re-ejecutar `bun run check` con TS 6.x; si salen implicit-any en PixelField sin tipos, restaurar JSDoc minimo.
