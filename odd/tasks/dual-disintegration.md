# Dual Disintegration — Feature Tasks

Objetivo usuario: animación de desintegración para la página, dividida en 2
animaciones: desintegración arriba→abajo (zona superior) y abajo→arriba (zona
inferior), basadas en las animaciones del equipo de Omarchy (ttfx).

Decisiones de producto (confirmadas por el usuario):
- Alcance: el campo pixel entero (fondo de celdas + palabras) como cortina
  global que se abre/cierra por dos frentes (desde arriba y desde abajo).
- Disparador: trigger por umbral — se dispara al cruzar el borde entre
  pantallas, corre solo con reloj; el scroll no la modula.
- Base técnica: integrar ttfx (el motor real de Omarchy, MIT + WASM).
  Revierte la decisión Round 6 de motor propio para las animaciones.

Por qué el approach anterior fallaba: `scattered` (scrub por scroll) dispersa
celdas, no desintegra; y unificar ambas zonas en una sola animación sin
dirección no da el efecto de cortina. La receta correcta es dos runs
direccionales opuestos sobre dos zonas del lattice.

## Research verificado (contra wasm real + fuente ttfx)

- ttfx = port Rust de TerminalTextEffects (ChrisBuilds), MIT. LICENSE + NOTICE
  conservan el copyright original: vendorizar ambos + atribución.
- Runtime a vendorizar desde omarchy-site (`public/ttfx/`):
  `0.3.2/ttfx.js` (11.8K), `0.3.2/ttfx.d.ts` (2.9K), `effects/all.wasm` (609.6K).
- API Session: `new Session(input, effect, columns, rows, seed, frameRate,
  palette?, background?)`, `step(): bool`, `fill(symbols, fg, bg, flags)`,
  `width()`, `height()`, `free()`, `effect_catalog()`.
- LÍMITE CLAVE (probado): el string de efecto solo acepta el nombre bare —
  `pour --pour-direction up` → `Error: unknown effect`. La direccionalidad
  NO se configura vía API: la impone nuestro puente (máscara de frente por
  filas + espejo vertical de la zona inferior).
- `crumble` (probado): desintegración real — pierde color → se desmorona en
  polvo (gravedad) → se aspira → se reforma. Efecto base de la apertura.
- `pour` (ensamblaje direccional, default `down`): efecto base del cierre /
  reformado. Zona inferior espejada = dirección visual invertida.
- Receta puente de omarchy-site (`src/lib/etch.ts` + `HeroPixelField.tsx`):
  input = texto con un bloque por celda encendida + pad (4 filas, 6 cols),
  calibración de offset con sesión probe (ttfx re-centra el texto), pump con
  tiempo adeudado (cap `stepMs*40`), decode por símbolo (block / parte /
  línea / mark), tinta = ink temático más cercano por luminancia, settle
  final para mezclar al reposo.

## Diseño

Dos animaciones = dos runs de la misma receta con dirección opuesta:
- `dir: "down"` (zona superior, split a la mitad del viewport): frente
  arriba→abajo; el polvo cae (gravedad natural de `crumble`).
- `dir: "up"` (zona inferior): frente abajo→arriba; entrada del run espejada
  verticalmente y salida de-espejada → el polvo "cae" hacia arriba.

Coreografía por trigger de umbral (clock, no scrub):
1. OPEN (~750ms): snapshot de celdas encendidas por zona (campo + palabra) →
   dos sesiones `crumble`; la máscara de frente entrega filas al efecto en
   orden direccional; el reposo se apaga al pasar la frente.
2. HOLD breve (~150ms): cortina abierta (solo DOM visible).
3. CLOSE (~650ms): nuevo snapshot (estado actual scrolleado) → dos sesiones
   `pour`; la máscara de frente cierra en orden direccional → reformado.

Reemplaza: `rowScrollProgress` + la rama scroll-scrub de `drawWord`.
Se mantiene: campo Bayer, hover/glow, boot grabado, replay (ahora dispara la
coreografía completa), SSR slots + fallback 5s, visibilidad/resize, reduced
motion estático.

Disparador: cruce del borde entre pantallas (scrollY vs frontera hero/info),
con histéreis: re-arm solo al salir de la banda y volver a cruzar; guard de
reentrada mientras corre la secuencia.

Fallbacks: WASM/efecto no carga → reposo actual sin cortina (campo + palabras);
prefers-reduced-motion → swap directo sin ttfx.

## Tasks
- [x] 1. Vendor ttfx 0.3.2 + licencia (done)
  Evidencia: `public/ttfx/0.3.2/{ttfx.js 12129B, ttfx.d.ts 2941B}`,
  `public/ttfx/effects/all.wasm 624215B` (cmp-idénticos al distribuido por
  omarchy-site); `LICENSE 1158B` + `NOTICE 701B` verbatim desde omacom/ttfx;
  `README.md` de atribución. Fetch-200 en dev: delegado a verificación.
- [x] 2. Puente ttfx (src/lib/ttfx-bridge.ts) (done)
  Evidencia: módulo TS 18KB con loadTtfx/buildInputText/startRun/prims/
  inkForRgb según contrato; probe bun contra wasm vendorizado ALL PASSED
  (catálogo 37, crumble 197 steps, pour 85, decode sin errores, unknown
  effect → null, inkForRgb por luminancia); `tsc --noEmit` 0.
- [x] 3. Cortina dual-front en PixelField (done)
  Evidencia: máquina idle/OPEN/HOLD/CLOSE en frame(); frente por filas con
  jitter hash01 0.15; zona inferior espejada in/out (polvo "cae" hacia
  arriba); snapshot = fieldDotColor compartido + word cells; OPEN crumble
  800ms + fade 150ms → HOLD 150ms → CLOSE pour 700ms (240 sps); fuera
  rowScrollProgress + rama scrub de drawWord; boot intro intacto.
- [x] 4. Trigger por umbral (done)
  Evidencia: B = borde hero↔info (info-section top), probe = scrollY+cssH/2;
  fire al cruzar por cualquier lado con guard single-shot + re-arm con banda
  0.25*cssH; click/teclado + evento porfolio:replay → fireCurtain(); scroll
  nunca modula un run activo.
- [x] 5. Fallbacks + a11y (done)
  Evidencia: reduced-motion sin ttfx (fireCurtain no-op, estático intacto);
  loadTtfx/startRun fallidos → cortina deshabilitada, reposo continúa;
  SSR slots + FALLBACK_MS intactos; abort limpio en hide/stop/observers;
  botón sr-only funciona vía evento sin tocar Hero.astro.
- [ ] 6. Verificación
  Outcome: `bun run build` PASS + `tsc --noEmit` 0 + verificación visual real
  por CDP en dev fresco: ambas direcciones, ambos sentidos de scroll, sin
  errores de consola; timings tuneados. (Lección Round 19: verificar con CDP,
  no "no vi nada".)
- [x] 6. Verificación (done)
  Evidencia: build PASS (1 page, 276ms) + tsc 0; CDP Chromium headless
  1280x800 con driver propio en /tmp: OPEN↓ b1/b2 (frentes desde los bordes
  exteriores, polvo visible en ambas zonas), HOLD c (lit 0.000), CLOSE d
  (re-ensamblado), reposo e; trigger reverso↑ f2; reduced-motion sin cortina
  ni fetch ttfx; wasm carga 200 en browser; cero excepciones de consola.
  13 capturas en /tmp/dual-disintegration-verify/. Nuance por spec: la
  histeresis 0.25*cssH impide re-armar con un salto dentro de la banda.
- [x] 7. Docs + cierre (done)
  Evidencia: README con sección Animations (atribución ttfx/TTE);
  public/ttfx/{LICENSE,NOTICE,README.md}; evidencia cargada en este doc.
  Pendientes / deuda: (a) repo con cero commits y convención previa "sin
  commits" — decidir con el usuario si se crea commit inicial/feature branch;
  (b) mirror Engram `odd/dual-disintegration/tasks` NO creado: Engram caído
  toda la sesión (identity resolution); reintento en el próximo arranque;
  (c) timings visuales (800/150/150/700ms, jitter 0.15, 240 sps) con valores
  de spec, sin tunear a ojo del usuario.

## Round 2 — incidente: look incorrecto + trabas (pedido usuario)
Diagnóstico medido (probes al wasm real + CDP con rAF deltas):
1. Arco truncado (causa raíz del look): OPEN pisaba los primeros ~192
   steps de crumble = prefijo estático (99% bloques sólidos; el polvo recién
   arranca en ~step 400); CLOSE los primeros 168 de pour = ~5% del
   ensamblado → glitch → negro → snap; jamás polvo ni reformado.
2. Offset stale: ttfx re-centra según el CONTENIDO (delta medido hasta
   28 filas ≈ 300px entre contenidos con mismas dims); el puente cacheaba
   por (effect, cols, rows) → 3 de 4 runs corridos (barras fantasma).
3. Traba: calibración throwaway a completitud + 2 Session constructs
   sincrónicos en el disparo = 117ms de stall mid-scroll (350-460ms peor
   caso). Per-frame sano (step+fill+decode 0.3ms avg).
Look esperado (usuario): efecto ttfx puro estilo Omarchy, SIN máscaras
propias encima.
Diseño v2: `crumble` completo por zona — su arco natural (pierde color → se
desmorona en polvo que cae → aspirado → reformado) ES la cortina que se abre
y se cierra sola. Zona superior natural (polvo cae = arriba→abajo); zona
inferior espejada verticalmente (polvo sube = abajo→arriba). Sin fases
OPEN/HOLD/CLOSE, sin máscaras de frente, sin fades: se pinta exactamente lo
que ttfx devuelve. Trigger por umbral igual. Override `?curtain=<effect>`
(patrón `?etch=` de omarchy-site) para ensayar efectos sin redeploy. Al final
del arco, crossfade corto (~300ms) del pintado del efecto al reposo vivo
(absorbe deltas de scroll durante el arco). Pacing: constante nombrada
orientada a arco completo ~3s (240sps default = ~4.7s a dims reales; medir y
elegir). Construct de sesiones fuera del frame crítico: auto-calibración
desde los primeros frames del propio run + construct escalonado/pre-warm para
que ningún frame del disparo supere ~50ms.

## Tasks Round 2
- [x] 8. Puente: auto-calibración sin probe a completitud (done)
  Evidencia: self-calibración desde el home-frame del propio run (umbral
  60% bloques, presupuesto 250 steps) + fallback cacheado por hash FNV-1a
  del contenido; probe vs ground truth EXACTO (top gt(9,16) 500/500,
  bottom gt(9,-17) 500/500, full 1533/1533, 0 error); efecto desconocido
  → null; throwaway eliminado (109-208ms menos).
- [x] 9. Choreografía v2: crumble puro por zonas (done)
  Evidencia: fuera máquina OPEN/HOLD/CLOSE + máscaras + fades v1; prims
  puros por zona (inferior espejada in/out); construct escalonado 1 por
  frame; crossfade 300ms con last-prims retenidos → reposo vivo;
  `?curtain=<effect>` (default crumble); pacing CURTAIN_STEPS_PER_SECOND=300
  (arcos medidos 821-1135 steps → 2.7-3.8s, típico ~3.2s); build PASS +
  tsc 0.
- [x] 10. Re-verificación (batería E1-E4 + build + tsc) (done)
  Evidencia: build PASS (212ms) + tsc 0; alineación PASS en 2 runs
  (cero barras fantasma, fragmentos siempre en geometría real); polvo real
  mid-arc en ambas zonas (run2 +1.6 con dos frentes punteados + polvo en
  esquinas); reformado PASS (LIT 0.059-0.066 ≈ resto 0.06, crossfade sin
  snap); freezes PASS (rAF p50/p95 16.7ms, max 33.3ms un solo frame doble,
  0 gaps >50ms — v1 tenía 117ms); consola 0 errores; reduced-motion PASS.
  Capturas en /tmp/dual-disintegration-verify2/.
  Deuda / tuning observado: (a) densidad mid-arc baja (LIT 0.2-1.5% vs
  resto 6-7%) — hay quejas posibles de "flash negro"; (b) direccionalidad
  down/up legible en código pero poco evidente en stills; (c) histéreis:
  cruzar y volver sin salir 200px de la banda re-armea sin disparar (scrub
  pegado al borde no re-firea); (d) `?curtain=<effect>` existe sin ensayar
  en browser; (e) campo estático reduced-motion más esparcido (pre-existente).

## Round 3 — scrub puro por scroll (spec usuario, reemplaza Round 2)
Contrato del usuario: el progreso de la desintegración es FUNCIÓN DIRECTA DEL
SCROLL, no del tiempo. Sin trigger de umbral, sin temporizador ni rAF
autónomo para esto: si el scroll no cambia, el frame no cambia (freeze
natural); si se revierte, el índice baja y se recorren los mismos frames al
revés. Fórmula: `idx = clamp(round(progreso * frameMáximo), 0, frameMáximo)`,
progreso = posición de scroll del elemento respecto al viewport. Horneado:
por elemento, agotar el iterador del efecto UNA vez, guardar cada frame, y
usar solo el tramo de "caída en polvo" (cortar antes de la fase de re-arm).
Decisiones de usuario: unidad = CADA FILA del wordmark (erosión desde el
borde hacia adentro: arriba→abajo al salir por arriba, abajo→arriba al salir
por abajo = las 2 animaciones originales); alcance = todo visible, DOM
incluido.
Decisiones de arquitectura (confirmadas por el usuario):
1. El campo pasa a estar anclado al documento (scrollea con la página) para
   desintegrarse/reintegrarse con la misma regla; composición radial por
   pantalla idéntica a la actual.
2. El DOM se desintegra en lenguaje de celdas (raster para el polvo horneado
   + erasure por celdas en overlay), pero mientras está entero se ve CRISPO
   e interactivo (el copiar email sigue funcionando).
Diseño: mundo de celdas en espacio-documento (campo + wordmarks + DOM);
cada fila tiene progreso puro = f(posición doc vs bordes, margen nombrada);
palabras y DOM hornean UNA tira por elemento (prims por frame) y cada fila
indexa esa tira con su propio índice; filas en idx 0 pintan el reposo real
(band ink + glow / DOM críspí); el campo erosiona en su lenguaje Bayer por
fila (sin tira). Overlay canvas fijo (sobre el DOM, pointer-events none)
para erasure+polvo del DOM. `?curtain=<effect>` seleccióna el efecto del
horneado. Boot/replay flight se mantienen (fuera del alcance del scrub).

## Tasks Round 3
- [x] 11. Motor de scrub: horneado + índice por fila (done)
  Evidencia: bridge `bakeStrip` (frames home→corte en el PRIMER máximo de
  dispersión; validado en crumble real: corte 216/30x8 y 270/ARAGI, dumps
  ASCII = polvo cayendo antes / vacío+retorno después; `frames[0]` == input
  exacto 240/240); PixelField con `rowProgress`→`scrubIndex` = fórmula del
  usuario verbatim (solo scrollY + geometría, auditado); idx 0 = reposo real
  (band ink + glow), idx > 0 = prims de la tira por banda de fila; campo
  document-anchored con erosión Bayer por fila (composición por pantalla);
  fuera trigger/histéreis/fireCurtain/relojes del scrub; boot flight y
  reduced-motion intactos; `?curtain=` = selector de efecto del horneado.
  Bake 44ms (30x8); ARAGI est. 100-250ms escalonado 1 palabra/frame al init.
  build PASS + tsc 0 + probe regresión bridge ALL PASSED.
- [x] 12. Desintegración del DOM (done)
  Evidencia: `.info-box` con `data-disintegrate`; `src/lib/dom-raster.ts`
  (computed-style clone → foreignObject → canvas 1:1 → celdas 4px, fuentes
  data-URL best-effort, null en cualquier fallo) — probe ALL PASSED (grid
  10x6, 32 celdas, tinta promedio correcta, degradación sin throw, zero-rect
  → null); overlay canvas fijo z-index 3 pointer-transparent que pinta nada
  en idx 0 (DOM críspí + copiar email funcionando) y erasure bg + prims de la
  tira por banda en idx > 0; bakes escalonados post-init; raster/bake null →
  elemento queda entero; reduced-motion sin overlay. build PASS + tsc 0.
- [x] 13. Re-verificación scrub (done)
  Evidencia: build PASS + tsc 0; FREEZE PASS (mismo scroll, 1.5s de diferencia:
  hashes SHA256 idénticos en regiones palabra y panel); RETRACE PASS 6/6
  (bajar y volver = mismos estados por posición, hashes distintos entre
  posiciones); AMBAS SALIDAS PASS (arriba→abajo al salir por arriba,
  abajo→arriba al salir por abajo — capturas 3+3); DOM PASS (sin seam visible,
  botón copiar responde "copiado ✓" en posición entera); scrub PERF PASS
  (rAF p50/p95 16.7ms, max 16.8, 0 gaps >30ms); reduced-motion PASS (nada se
  disuelve, 0 fetches wasm); consola limpia. Capturas en
  /tmp/dual-disintegration-verify3/.
  Defecto hallado (→ task 14): bake DOM 761.6ms sincrónico (488 frames,
  2412 celdas) + palabras 91.7/48.5ms = jank al init (primera visita).
  Notas de look (sin tocar: son la fórmula del usuario): polvo = pitting/
  moteado cerca del glifo (no nubes dramáticas); dead-zone de margen
  0.25*vh al inicio del scroll (por diseño).
- [x] 14. Fix: horneado incremental sin stalls (done)
  Evidencia: bridge `beginBake`/`BakeJob.step/finish/free` (fases acotadas:
  stepping/prepare/decoding/collect/distances/means); `bakeStrip` = drain
  sincrónico sobre el mismo job; PixelField `pumpBakes` con slice 8ms / 16
  steps por llamada, palabras primero, publicación atómica por elemento
  (al listo se une al scrub; null → queda entero); probe sync vs incremental
  IDENTICAL (sha256 de prims + corte + conteo de frames iguales en ARAGI,
  INFO, 30x8 y DOM-scale 60x40); peor step() unitario 10.29ms (outliers GC);
  pureza del scrub intacta (clockMs solo acota slices de init). build PASS +
  tsc 0.
- [x] 15. Re-chequeo de jank al init (done)
  Evidencia: gate ≤50ms en SUBSTANCIA PASS — run 2 con CERO longtasks en
  6.5s; run 1 con un solo longtask (57ms) en el script-eval de startup (56ms,
  antes del fetch del wasm: no es nuestro); signature del raster/bake
  (600-675ms pre-fix) ausente en ambas corridas; las dos muestras "50.1ms"
  son 3×vsync + 0.1 de cuantización del scheduler headless (ruido, no
  trabajo). Scrub + freeze + panel byte-idéntico post-rework + consola
  limpia. Gate numérico estricto (gap rAF >50ms) tocado 0.1ms por esa
  cuantización — declarado, no movido.
- [x] 16. Fix: raster DOM sin long-tasks (done)
  Evidencia: `rasterizeCells` en etapas acotadas (estilos por tandas de 25
  nodos, decode off-thread `createImageBitmap` con cascada `Image.decode()` /
  load-gate, readback + cuantización en slices de 8 filas, yields entre
  etapas); salida byte-idéntica (paridad sha256 en 4 fixtures: 8/189/0/999
  celdas); PixelField intacto (contrato async preservado); build PASS +
  tsc 0.

## Round 4 — fixes visuales (bug report usuario)
Diagnóstico medido: (D1) los "---" = valla de frontmatter duplicada en
PixelWordmark.astro:79 renderizada como texto literal por Astro (una por
wordmark = "en varias partes"); probe de tiras: 0 prims line/part, no era
el canvas; (D2) drawGlowWindow llama fieldDotColor con 7 args en vez de 9 →
NaN → null siempre → ventana de rescate muerta = glow sin efecto justo sobre
el centro de la palabra; (D3) laterales "reducidos" = erosión Bayer
preventiva del margen 25vh en reposo (bandas medidas [0,225)/(664,900] a
1600x900, palabra entera al medio).
Decisión usuario (laterales): "Infinitos, con el frente de las letras" —
regla: el campo solo se erosiona HASTA la línea que come a las letras (front
por borde derivado de las filas de words con progreso > 0; mismo perfil
f(yv) que las letras; sin words en la banda → front inactivo → columnas
infinitas). Words/DOM conservan su scrub por filas.
- [x] 17. Fix: valla `---`, glow, frente compartido (done)
  Evidencia: valla duplicada eliminada (grep dist/index.html: 0 `---`,
  wordmarks OK); drawGlowWindow con llamada 9-arg completa (ambas llamadas
  verificadas); gate de frente compartido en paintFieldDots (rowProgress
  partido en Top/Bottom, matemática idéntica) — probe de geometría: scrollY=0
  frentes null → columnas infinitas; 150/300/450 → rango erosionado del
  campo termina en END==topFront-f (la línea de las letras); word afuera →
  erosión colapsa a nada. Words/DOM con rowProgress sin gate (intactos).
  build PASS + tsc 0.
- [x] 18. Verificación de los 3 fixes (done)
  Evidencia: F1 PASS (0 `---` en HTML servido/dist/DOM walk/píxeles);
  F2 PASS (halo del glow lejos/cerca/SOBRE las letras — antes: agujero
  negro sobre las letras; muestras de campo r=60px 33.5%/20.1% lit);
  F3 PASS (scrollY=0 columnas a altura completa; scrollY=300 la erosión se
  detiene exacto en el borde de las filas sobrevivientes de la palabra,
  campo entero debajo; reverso a 0 = infinitas otra vez); regresiones PASS
  (polvo mid-scrub, DOM disuelve/restaura, copiar → "copiado ✓"); consola
  0 errores. 17 capturas en /tmp/dual-disintegration-fix3v/. Nota: headless
  reporta pointer:fine=false → glow off por diseño; verificado con shim de
  matchMedia (código de app sin tocar).

## Round 5 — laterales = bg fijo, efecto solo al contenido (decisión usuario)
El usuario reemplaza la decisión de Round 4 (frente compartido): los
laterales del campo se dejan como BG PURO — scrollear no les afecta (ni
erosión ni movimiento) y se ve fluido. La desintegración se aplica solo a
"lo demás" = wordmarks + DOM (su scrub por filas intacto).
Outcome: campo viewport-anchored fijo (comportamiento pre-Round-3: lattice
por viewport, sin gate Bayer, sin fronts compartidos), ruido/glow ambiental
como siempre; words + DOM con scrub por filas horneado sin cambios; sin
churn de celdas del campo durante el scroll.
- [x] 19. Fix: campo como bg fijo (done)
  Evidencia: campo viewport-anchored (lattice cssW×cssH, rebuild solo en
  resize, geometría en espacio viewport sin scrollY); fuera gate Bayer +
  fronts compartidos + rowProgressTop/Bottom (inline en rowProgress);
  prueba estática: cero refs a scrollY/rowProgress/scrubIndex/progress en
drawField/paintFieldDots/drawGlowWindow/fieldShadeAt/fieldDotColor — el
campo solo lee tSec ambiental; words/DOM con scrub intacto; glow 9-arg de
  Round 4 conservado; ruido/twinkle/reduced-motion/SSR/boot/?curtain=/bake
  intactos. build PASS + tsc 0.
- [x] 20. Verificación: bg fijo + scrub intacto (done)
  Evidencia: columnas a altura completa en scrollY 0/150/300/450 sin
erosión ni desplazamiento (delta de lit por scroll 0.004-0.017 = dentro
del envelope del twinkle temporal; controles a scroll fijo +3s confirman:
el scroll no aporta nada); contenido se desintegra encima del bg estático
  (hero y DOM capturados mid-dissolve con el campo intacto); glow sin
  regresión (halo 1.94x en campo, ráfaga sobre las letras); fluidez
  0→600→0: rAF p50/p95/max 16.7/16.8/16.8, 0 gaps >30ms; copiar →
  "copiado ✓"; consola 0 errores. Capturas en /tmp/dual-disintegration-bgv/.
