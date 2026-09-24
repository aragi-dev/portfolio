# SEO + Astro hardening — Feature Tasks (ODD)

Pedido usuario: aplicar por prioridad los gaps de las 6 skills (sin aplicar en análisis previo).
Deuda conocida (Round 12): canonical/sitemap/OG image necesitan URL de deploy.

## P1 — site + canonical + sitemap + robots (máxima prioridad, cierra Astro+SEO técnico)
- [x] 1. `astro.config.mjs` con `site` + integración `@astrojs/sitemap`
  Evidencia: site https://aragi.me + sitemap@3.7.4, build 238ms 1 página, `dist/sitemap-index.xml` + `dist/sitemap-0.xml` con `<loc>https://aragi.me/</loc>`. Sin commits.
- [x] 2. Canonical + robots con Sitemap
  Evidencia: canonical `https://aragi.me/` en `dist/index.html`, `robots.txt` con `Sitemap: https://aragi.me/sitemap-index.xml` (corregido de sitemap.xml → sitemap-index.xml según output real del build). Sin commits.

## P2 — OG/Twitter + JSON-LD + title/description
- [x] 3. OG/Twitter completos + JSON-LD Person enriquecido
  Evidencia: og:url, og:locale es_ES, og:image + twitter:image → https://aragi.me/favicon.svg (deuda declarada: falta OG 1200×630 PNG), JSON-LD con url + sameAs desde portfolio.ts (validado como JSON). Sin commits.
- [x] 4. Title/description tuning (50-60 / 150-160)
  Evidencia: title 9c→54c `Aldo Matu (ARAGI) — Desarrollador Full-Stack en México`, description 179c→156c. Defaults de Base.astro igualados. Sin commits.

## P3 — checks + verificación Bun/TS
- [x] 5. Script `check` + verificación (`bun install`, `astro check`, `tsc --noEmit`, `bun run build`)
  Evidencia: script `check` agregado a package.json; `astro check` bloqueado por upstream (TS 7.0.2 sin API programática, ver withastro/roadmap#1321 — deuda conocida); fallback `bunx tsc --noEmit` EXIT 0; `bun install` limpio (393 pkgs); `bun run build` 238ms 1 página. Sin commits.

## P4 — a11y remanente
- [x] 6. Skip-link + targets mínimos + verificación contraste
  Evidencia: skip-link `Saltar al contenido` → `#main-content`, mínimos 24px en email/social/replay (replay solo en :focus-visible), ratios 11.56/7.96/12.67/8.15:1 todos AA sin cambiar colores. Build 238ms PASS. Sin commits.

Evidencia commits: NO se commiteó (seguridad: usuario pidió aplicar, no commitear). Repo sigue sin commits (solo untracked). Pendiente autorización para branch + work-unit commits.
