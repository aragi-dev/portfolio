# ARAGI — Portfolio

Portfolio single-page de **ARAGI (Aldo Matu)**, desarrollador Full-Stack en México.
Estética de terminal **Solitude**: canvas pixel-field + desintegración por scroll,
wordmarks **ARAGI** / **INFO**.

Deploy: **https://aragi.me**

## Stack

| Paquete | Versión congelada |
| :------ | :---------------- |
| bun | 1.4.2 |
| astro | 7.3.3 |
| @astrojs/sitemap | 3.7.4 |
| @astrojs/check | 0.9.10 |
| @types/bun | 1.4.2 |
| typescript | 7.0.2 |
| vite (transitivo vía Astro) | 8.3.0 |
| ttfx (vendoreado) | 0.3.2 |

> Versiones exactas sin `^` + `bun.lock` commiteado = proyecto congelado.

El motor de efectos `ttfx` está vendoreado sin modificar bajo `public/ttfx/`
(build wasm + `LICENSE` y `NOTICE` originales).

## Cómo levantarlo

```sh
bun install        # instala dependencias exactas según bun.lock
bun dev            # servidor local en localhost:4321
bun run build      # build de producción a ./dist/
bun preview        # previsualiza el build local
bun run check      # astro check (ver nota conocida)
```

## Estructura

```text
src/
├── pages/        # index.astro (única ruta)
├── components/   # Hero, InfoSection, PixelField, PixelGlyph
├── layouts/      # Base.astro
├── lib/          # aragi-bitmap, dom-raster, glyph-bitmaps, palette, ttfx-bridge
├── data/         # portfolio.ts (perfil ARAGI)
└── styles/       # global, tokens, reset, hero-pixel
public/
└── ttfx/         # motor ttfx vendoreado (wasm + LICENSE + NOTICE)
```

## Créditos

- **Equipo de Omarchy** — motor [ttfx](https://github.com/omacom/ttfx) (MIT)
  y las letras A/R trazadas del wordmark de
  [omarchy.org](https://omarchy.org) (ver `src/lib/aragi-bitmap.ts`).
- **ChrisBuilds** — [TerminalTextEffects](https://github.com/ChrisBuilds/terminaltexteffects)
  original, del cual ttfx es un port a Rust.
- **Equipo de Astro** — el framework.

## Nota conocida

`astro check` está bloqueado por upstream: TypeScript 7 ya no expone API
programática (`withastro/roadmap#1321`). Fallback mientras tanto:

```sh
bunx tsc --noEmit
```
