# forge-docs

Documentation site for [Forge](https://github.com/ForgeAILab/forge) — the local-first workflow engine for coding agents.

Built with [Astro Starlight](https://starlight.astro.build). Search is powered by [Pagefind](https://pagefind.app/) — fully local, static, no external service.

## Stack

- **Astro** 5 + **Starlight** (docs framework)
- **Pagefind** (full-text search, generated at build time)
- **TypeScript** (strict)

## Content

Doc source lives in the main [forge](https://github.com/ForgeAILab/forge) repo under `docs/*.md` — that's the project's source of truth (CLAUDE.md mandates updating docs in the same change as behavior changes).

This site **mirrors** those files into `src/content/docs/` via a sync script.

### Re-syncing

```bash
# Assumes forge is checked out at ../forge
pnpm sync-docs

# Or point at any other path
FORGE_REPO=/abs/path/to/forge pnpm sync-docs
```

The script (`scripts/sync-docs.mjs`):

1. Reads each known file from `forge/docs/`
2. Strips any existing frontmatter
3. Rewrites internal `*.md` links to Starlight routes
4. Prepends Starlight frontmatter (title, description, `editUrl` back to GitHub)
5. Writes to `src/content/docs/<slug>.md`

Add new docs by extending the `FILES` map in `scripts/sync-docs.mjs` and the sidebar in `astro.config.mjs`.

## Dev

```bash
pnpm install
pnpm dev          # http://localhost:4321
pnpm build        # static output -> dist/
pnpm preview      # serve the built site (needed to test search locally)
```

> Search is only wired up in production builds — Pagefind runs in the build step. Use `pnpm preview` to verify it locally.

## Deploy

`dist/` is a fully-static directory — drop it anywhere (Vercel, Netlify, Cloudflare Pages, GitHub Pages, S3+CloudFront).

The `astro.config.mjs` sets `site: 'https://docs.forge.dev'` — change it before deploying to a different domain so the sitemap and canonical URLs are right.

## Layout

```
src/
  content/
    docs/              # mirrored from forge/docs/
      index.mdx        # landing splash (authored here, not synced)
      getting-started.md
      api.md
      architecture.md
      cli.md
      execution-logs.md
      prd.md
      release-plan.md
      release-checklist.md
      dependency-backlog.md
  styles/
    forge.css          # brand color overrides (dark theme default, flame accent)
  assets/
    forge-wordmark.png # mirrored from forge/assets/
  content.config.ts    # Starlight collection definition
public/
  logo.png
  favicon.png
scripts/
  sync-docs.mjs        # forge/docs/ → src/content/docs/
astro.config.mjs       # Starlight integration: sidebar, edit-on-GitHub, dark-default
```
