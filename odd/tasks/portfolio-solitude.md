# Portfolio Solitude — Feature Tasks

Estilo: Omarchy-site + tema Solitude (#101315 bg, #cacccc fg, #798186 accent), JetBrains Mono, CSS puro con tokens.
Stack: Astro 7.3.x latest, Vite 7/8 (el que traiga Astro), TypeScript strict, HTML, Bun (no npm).

## Tasks
- [x] 1. Scaffold Astro 7 + TS strict con Bun (done)
  Evidencia: astro 7.3.3, vite 8.3.0 vía Astro, bun 1.4.2, `bun run build` 1 página en 300ms → dist/index.html. git init sin commit. Riesgos: typescript no como dep directa, .gitignore sin fusionar, /favicon.ico 404.
- [x] 2. Layout base + tokens Solitude + JetBrains Mono (done)
  Evidencia: Base.astro es + Header/Footer, fonts 400/500/700, global.css con container 72ch, `bun run build` 359ms ok. Deuda: .gitignore sin fusionar (va en tarea 3).
- [x] 3. Secciones portfolio dev completo (done)
  Evidencia: portfolio.ts tipado + 6 componentes + sections.css, `bun run build` 239ms ok. Deuda: mock con "Tu Nombre" pendiente de personalizar; Experience usa id="experiencia", Header no lo enlaza.
- [x] 4. Verificar build y dev server (done)
  Evidencia: `bun run build` PASS (228–414ms, 1 página estática), composición sin Tailwind PASS, `astro check` bloqueado: TS 7 nativo no expone API programática (requiere TS 6.x, ver withastro/roadmap#1321). .gitignore fusionado, .git restaurado sin commits.
  Outcome: `src/layouts/Base.astro`, `src/styles/tokens.css`, `reset.css`, fuentes locales o Google, header estilo omarchy.
  Checks: dev server renderiza, sin Tailwind.
- [ ] 3. Secciones portfolio dev completo (pending)
  Outcome: hero terminal + sobre mí, proyectos, stack, experiencia, contacto. Datos mock en `src/data/`.
  Checks: build estático, responsive, semántico.
- [ ] 4. Verificar build y dev server (pending)
  Outcome: `bun run build` + preview ok.
  Checks: evidencia de comandos.

Evidencia commits: se registran acá como work-unit commits (todavía sin commit, usuario no autorizó).
