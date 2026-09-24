# Single page ARAGI — Feature Tasks

Pedido usuario (5 puntos): single page sin scroll solo con el nombre centrado;
click efecto original con mantener (hold-to-charge, disolvido dither, no icono
relleno); nombre ARAGI con tipografía pixel estilo Omarchy; hover en texto
central; fix dead-zone del glow del cursor.

Diagnóstico dead-zone: pre-filtramos celdas con shade<=0.004 (el centro),
entonces el glow no tiene qué encender. Original: glow se suma ANTES del
umbral sobre TODAS las celdas. Arquitectura nueva = original: canvas pinta
la palabra en reposo siempre (restInks por fila), SSR queda de fallback
(no-JS / reduced-motion); así el hover por celda funciona.

## Round 4 — densidad, cero chrome, letras anchas (pedido usuario)
Diagnóstico: celda campo = slot/29cols ≈ 44px (original ≈ 13px) → ralo.
Fix con subdivisión ×4 (campo 11px) misma receta. hero-inner capaba a 72ch;
wordmark pasa a 88vw. Chromeless renderiza slot directo sin main.container.
Ghost 'hello world': grep limpio, no es nuestro código (ventana detrás).
- [x] 7. Densidad lattice ×4 (done)
  Evidencia: fieldCell = wordCell/4 (~11px), misma receta Bayer,
  skip 4x4 por pixel de palabra, glow sin dead-zone, build PASS.
- [x] 8. Cero chrome + 88vw (done)
  Evidencia: chromeless = slot directo en body; hero-inner 88vw/90rem.
## Round 5 — tipografía original + tamaño correcto (pedido usuario)
A y R trazadas del SVG del wordmark original (grilla 81x19); G basada en
su C; I a juego. Módulo src/lib/aragi-bitmap.ts 57x19. Slot 46rem (≈32%
viewport, misma celda ~13px que el original). Subdivisión campo = 1.
## Round 5 — tipografía original + tamaño correcto (done)
A/R trazadas del SVG original, G/I recreadas (57x19), slot 46rem,
subdiv 1, build 243ms PASS.

## Round 6 — paridad de comportamiento, motor propio (pedido usuario)
ttfx es MIT pero su WASM es binario externo (o toolchain Rust); decisión:
motor propio liviano con paridad de comportamiento (random por visita,
reveal+settle, replay, reduced-motion off). Stack sigue vanilla (sin
runtime React para un canvas). Sprite autónomo con stamps (constantes
SPRITE_FIRST_STAMP_WAIT 1-2s, STAMP_WAIT 2-3s). Stamps CUADRADOS
(bloom+disolvido dither, nunca logo). Reactividad constante = pulso
ambiental diagonal + sprite (sin música). Letras: bitmap ARAGI queda.
- [x] 11. 6 efectos + sprite (done)
  Evidencia: beams/rain/scattered + 220ms settle, sprite lissajous con
  stamps 1-2s y luego 2-3s, build PASS.
- [x] 12. Squares + pulso (done)
  Evidencia: stamps cuadrados bloom+disolvido Bayer max 4, pulso
  diagonal 0.08 constante, stack sigue vanilla (decisión).
## Round 6 — paridad de comportamiento, motor propio (done)
6 efectos + settle 220ms, sprite lissajous con stamps, squares bloom+dither,
pulso 0.08, stack vanilla, build 246ms PASS.

## Round 7 — entrada total por fases (pedido usuario)
Boot: fondo vacío → campo se graba (densidad 0→1, ~1s) → palabra con
efecto sorteado → reposo. Replay en wordmark repite secuencia completa.
Reduced motion: todo visible directo.
- [x] 14. Boot por fases (done)
  Evidencia: vacío 300ms → campo 1s bordes-adentro → palabra sorteada →
  reposo; build PASS.
## Round 7 — entrada total por fases (done)
Vacío 300ms → campo 1s bordes-adentro → palabra sorteada → reposo;
replay 0-2, build 258ms PASS.

## Round 8 — fixes de revisión final (pedido usuario)
1. Pre-hide SSR en head (clase html + timeout propio 5s).
2. Glow con easing en vez de pop.
3. Radio sprite 12 celdas como CURSOR_CELLS original.
- [x] 16. Fixes (done)
  Evidencia: wordmark-held en head con timeout propio, easing 0.3,
  sprite 12 celdas, build PASS.
## Round 8 — fixes de revisión final (done)
Pre-hide head, easing 0.3, sprite 12 celdas, build 241ms PASS.

## Round 9 — G bloque + tamaño celda original (pedido usuario)
G anterior parecía C: barra débil sin espolón. Nueva G con barra 2 filas +
espolón. Slot 46rem→38rem (celda ~11px como original ~10.5px).
- [x] 18. G + slot (done)
  Evidencia: G bloque con barra+espolón y cierre como C, slot 38rem
  (celda ~11px), build 275ms PASS, .git presente con cero commits, sin commitear).
## Round 10 — G espiral final + limpieza (done)
G = C + barra + diagonal 3px; 12 archivos + 2 fuentes fuera; ARAGI-only;
13 fuentes; build 266ms PASS.

## Round 11 — tipos correctos desde el editor (pedido usuario)
Script del canvas en JS plano sin tipos; frontmatters por revisar.
Estrategia: JSDoc completo en el script (sin cambiar runtime) + Props
tipadas donde falte. tsc cubre .ts; .astro lo cubre el editor.
- [x] 23. Tipos (done)
  Evidencia: @ts-check + typedefs + JSDoc en ~50 funciones (cero
  runtime); tsc --noEmit sin errores; frontmatters ya estaban bien.
## Round 11 — tipos correctos desde el editor (done)
@ts-check + typedefs + JSDoc (cero runtime); alias + helper on();
tsc 0 + build PASS.

## Round 12 — skills autoskills aplicadas (pedido usuario)
Leídas las 6 (astro/bun/ts-advanced/frontend/a11y/seo). astro/bun/ts:
conformes, sin cambios. a11y: replay por teclado (botón sr-only +
evento) + landmark main. seo: OG/Twitter básicos, theme-color,
robots.txt, JSON-LD Person. Deuda: canonical/sitemap/OG image
necesitan URL de deploy.
- [x] 26. a11y+seo (done)
  Evidencia: botón replay por teclado + evento, main, OG/Twitter/
  theme-color/JSON-LD/robots, bio 146c. Runner falló al limpiar pero
  el trabajo estaba completo; verificado inline: build 221ms PASS +
  marcadores en dist.
- [x] 27. Build + git (done)
  Evidencia: .git restaurado, sin commits.
- [ ] 27. Build + git (pending)
- [ ] 24. Build + git (pending)
G = C exacta + barra r9 unida abajo + diagonal 3px (r11-12).
Eliminados 12 archivos (9 componentes, pixel-font, ascii/sections css)
+ 2 fuentes; PixelField/Wordmark/Base/Hero/global ARAGI-only.
Quedan 13 archivos fuente. Build 266ms PASS. Sin commits.
## Round 12 — skills + I centrada (done)
a11y/SEO skills aplicadas; I cols3-5; build PASS.

## Round 14 — botón ASCII canvas (done)
INFO/ARAGI chrome + sr-only teclado; build 220ms PASS.

## Round 15 — botón [I] ASCII fijo (done)
CHROME 25x19, mismos efectos, build 227ms PASS.

## Round 16 — icono 1 color estilo pixel (done)
ICON 24x24 crest plano, build 241ms PASS.

## Round 17 — icono 16px con reglas pixel art (done)
16x16 a mano, 32px, build PASS.

## Round 18 — scroll + scattered único (done)
2 pantallas + canvas fijo + scattered; build 215ms PASS.

## Round 19 — scrub puro por segmentos (pedido usuario)
La animación corría con reloj y no se congelaba. Nueva regla: estado
de cada fila = función pura de su posición vs borde (determinista,
sin tiempo). Scroll parado = todo congelado. Boot y replay siguen
temporales (disparo único con inicio/fin).
- [x] 42. Scrub puro (done)
  Evidencia: progreso por fila = f(posición vs borde líder), celdas
  en orden determinista, sin relojes en scroll; boot/replay intactos.
- [x] 44. No-vi-nada: verificado con CDP (done)
  Evidencia: screenshots reales vía CDP (ARAGI + INFO + panel +
  email, todo pinta; consola sin errores). Causa: cliente rancio del
  usuario (dev viejo). Dev fresco en 4321 con código actual.
- [ ] 43. Build + git (pending)
Scroll de 2 pantallas (hero ARAGI + sección INFO+panel). Canvas fijo.
Scattered ligado al scroll por fila ordenada al borde = ÚNICA animación.
Fuera: icono/chrome, laser/decrypt/wipe/beams/rain, sprite, stamps,
pulso, modos name/info, toggle. Quedan: campo, hover, replay(scattered).
- [x] 40. Scroll scattered (done)
  Evidencia: 2 pantallas + canvas fijo, scattered único ligado al
  scroll con orden al borde; fuera icono, 5 efectos, sprite, stamps,
  pulso, modos. INFO_ROWS 47x19. ICON muerto eliminado.
- [x] 41. Build + git (done)
  Evidencia: build 215ms PASS, dist verificado, git ok, sin commits.
- [ ] 41. Build + git (pending)
Silueta sólida, 1 detalle focal (lupa), trazo 2px, sin huérfanos.
16x16 celda 2px = 32px (altura Install). Downsample descartado.
- [x] 39. Icono invisible: causa raíz (done)
  Evidencia: ICON_ROWS con #/. en vez de 1/0 → canvas pintaba 0
  celdas; convertido y verificado en bundle; dev rancio (proceso bun
  que los pkill no mataban) reemplazado por dev fresco en 4321.
- [ ] 38. Build + git (pending)
SVG Material rasterizado a 24x24 (ICON_ROWS); tinta plana crest, sin
bandas; misma entrada/salida/hover-hit/toggle que el [I].
- [x] 35. Icono plano (done)
  Evidencia: ICON 24x24 tinta crest plana, misma entrada/salida/
  hit-test; CHROME muerto eliminado; build 241ms PASS, git ok.
- [ ] 36. Build + git (pending)
Corchetes estilo 19 filas + I; etiqueta única siempre; entra/sale
con la palabra; sr-only intacto. Elimina deuda lattice-swap.
- [x] 33. [I] fijo (done)
  Evidencia: CHROME_ROWS 25x19 (corchetes 7 + I), chrome siempre
  [I] sin swap, mismos efectos, build 227ms PASS, git ok, sin commits.
  Debt: 6 efectos espejados para chrome (si se agrega uno, espejar).
- [x] 34. Build + git (done)
  Evidencia: build 258ms PASS, git ok, sin commits.
- [x] 35. Icono tamaño Install (done)
  Evidencia: CHROME_CELL_PX 4→2 ([I] 50x38), build PASS.
Etiqueta INFO/ARAGI como segunda palabra del canvas (arriba centro,
celda ~4px): misma entrada grabada, mismo hover, misma salida.
N/F/O dibujadas estilo 19 filas; I extraída del bitmap. Botón DOM
pasa a sr-only (teclado) sobre la misma acción.
- [x] 31. Botón canvas (done)
  Evidencia: INFO_ROWS (I+N/F/O estilo 19) + segunda palabra chrome
  (entrada, hover, salida, hit-test, toggle), botón DOM sr-only,
  build 220ms PASS, .git restaurado, sin commits.
- [ ] 32. Build + git (pending)
Botón ASCII [ info ] arriba; click oculta ARAGI (wipe-out dither) y
muestra info + email hola@aragi.me con copiar+feedback; toggle vuelve.
Campo/sprite/stamps siguen (misma estética). Ortografía del texto
corregida (profesional). profile: info + email.
- [x] 29. Info UI + canvas mode (done)
  Evidencia: toggle [ info ]/[ aragi ], panel 60ch marco ASCII,
  email copiar+feedback aria-live, wipe-out 450ms, campo vivo.
- [x] 30. Build + git (done)
  Evidencia: build 230ms PASS, .git restaurado, sin commits.
- [ ] 30. Build + git (pending)
- [ ] 17. Build + git (pending)
- [ ] 15. Replay + build + git (pending)
- [ ] 12. Squares + pulso (pending)
- [ ] 13. Build + git (pending)
- [ ] 8. Cero chrome + 88vw (pending)
- [ ] 9. Build + git (pending)

## Tasks
- [x] 1. Single page ARAGI sin scroll (done)
  Evidencia: index = Base chromeless + Hero con solo wordmark; ARAGI;
  100svh exacto + overflow hidden; secciones fuera del index (archivos
  en disco, no se borró nada).
- [x] 2. Canvas pinta palabra + hover + dead-zone (done)
  Evidencia: rest word en canvas, wordmarkInk crest/hover, glow sobre
  todas las celdas (sin pre-filtro), SSR hidden tras primer paint.
- [x] 3. Hold-to-charge stamps + build + git (done)
  Evidencia: mantener carga / soltar dispara, triángulo dither max 4,
  replay en wordmark, build 246ms PASS, .git restaurado, sin commits.
  Outcome: index solo Hero (Base chromeless), profile.name ARAGI,
  html/body overflow hidden, hero 100svh exacto, solo wordmark centrado.
- [ ] 2. Canvas pinta palabra + hover + dead-zone (pending)
  Outcome: rest word en canvas, wordmarkInk con glow/stamps, glow sobre
  todas las celdas, SSR hidden tras primer paint.
- [ ] 3. Hold-to-charge stamps + build + git (pending)
  Outcome: mantener carga / soltar dispara, triángulo dither 1.4s max 4,
  replay en wordmark, `bun run build` PASS, sin commits.
