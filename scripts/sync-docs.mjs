#!/usr/bin/env node
/**
 * Sync markdown from forge/docs/ into forge-docs/src/content/docs/.
 *
 * Source of truth for docs lives next to the code in the main forge
 * repo (CLAUDE.md mandates updating `docs/*.md` in the same change as
 * behavior changes). This script copies those files in, prepending a
 * Starlight frontmatter block based on a per-file map.
 *
 * Usage:
 *   node scripts/sync-docs.mjs                 # uses ../forge/docs
 *   FORGE_REPO=/abs/path/forge node scripts/sync-docs.mjs
 */

import { promises as fs } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const ROOT = path.resolve(__dirname, '..')
const DEFAULT_SOURCE = path.resolve(ROOT, '../forge/docs')
const SOURCE = process.env.FORGE_REPO
  ? path.join(process.env.FORGE_REPO, 'docs')
  : DEFAULT_SOURCE
const DEST = path.join(ROOT, 'src', 'content', 'docs')

// Astro `base` path. Must match astro.config.mjs `base`.
// Author-written markdown links don't get the base prefix automatically
// (only Starlight's own UI links do), so we bake it in during sync.
const BASE = '/forge-docs'

/**
 * Map: source filename → { slug, title, description }
 * Slug becomes the URL path under /docs.
 */
const FILES = {
  'getting-started.md': {
    slug: 'getting-started',
    title: 'Getting started',
    description: 'Install Forge, configure agents, and drive a task from todo to done.',
  },
  'api.md': {
    slug: 'api',
    title: 'REST API & MCP tools',
    description: 'HTTP endpoints, pagination, SSE events, and the seven MCP tools.',
  },
  'cli.md': {
    slug: 'cli',
    title: 'forge-ctl CLI',
    description: 'Subcommands, daemon link, scripted runs.',
  },
  'execution-logs.md': {
    slug: 'execution-logs',
    title: 'Execution logs',
    description: 'JSONL log schema and chat-history reconstruction.',
  },
  'architecture.md': {
    slug: 'architecture',
    title: 'Architecture',
    description: 'Crate graph, task state machine, workflow engine, database.',
  },
}

async function exists(p) {
  try {
    await fs.access(p)
    return true
  } catch {
    return false
  }
}

function stripExistingFrontmatter(body) {
  if (!body.startsWith('---')) return body
  const end = body.indexOf('\n---', 3)
  if (end === -1) return body
  return body.slice(end + 4).replace(/^\s*\n/, '')
}

function rewriteLinks(body) {
  // Forge's docs cross-link as ./getting-started.md or ../docs/api.md.
  // Strip .md extensions and prepend the Astro base so links resolve to
  // /forge-docs/<slug>/ on the deployed site.
  const slugRename = { 'execution-logs': 'execution-logs' }
  const route = (slug) => `${BASE}/${slugRename[slug] ?? slug}/`
  return body
    .replace(/\]\(\.\/([\w-]+)\.md(#[^)]*)?\)/g, (_, slug, hash = '') => `](${route(slug)}${hash})`)
    .replace(/\]\((\w[\w-]*)\.md(#[^)]*)?\)/g, (_, slug, hash = '') => `](${route(slug)}${hash})`)
    .replace(/\]\(\.\.\/CHANGELOG\.md\)/g, '](https://github.com/ForgeAILab/forge/blob/main/CHANGELOG.md)')
    .replace(/\]\(\.\.\/CONTRIBUTING\.md\)/g, '](https://github.com/ForgeAILab/forge/blob/main/CONTRIBUTING.md)')
    .replace(/\]\(\.\.\/Makefile\)/g, '](https://github.com/ForgeAILab/forge/blob/main/Makefile)')
    .replace(/\]\(\.\.\/LICENSE\)/g, '](https://github.com/ForgeAILab/forge/blob/main/LICENSE)')
}

async function main() {
  console.log(`▸ source: ${SOURCE}`)
  console.log(`▸ dest:   ${DEST}`)

  if (!(await exists(SOURCE))) {
    console.error(`\n✖ Source not found: ${SOURCE}`)
    console.error('  Set FORGE_REPO=/abs/path/to/forge or clone forge alongside forge-docs.\n')
    process.exit(1)
  }

  await fs.mkdir(DEST, { recursive: true })

  let copied = 0
  let missing = 0
  for (const [filename, meta] of Object.entries(FILES)) {
    const src = path.join(SOURCE, filename)
    const dest = path.join(DEST, `${meta.slug}.md`)
    if (!(await exists(src))) {
      console.warn(`  ⚠ missing in source: ${filename}`)
      missing += 1
      continue
    }
    const raw = await fs.readFile(src, 'utf8')
    const body = rewriteLinks(stripExistingFrontmatter(raw))
    const frontmatter = [
      '---',
      `title: ${JSON.stringify(meta.title)}`,
      `description: ${JSON.stringify(meta.description)}`,
      `editUrl: https://github.com/ForgeAILab/forge/edit/main/docs/${filename}`,
      '---',
      '',
    ].join('\n')
    await fs.writeFile(dest, frontmatter + body)
    console.log(`  ✓ ${filename} → ${meta.slug}.md`)
    copied += 1
  }

  console.log(`\n✓ Synced ${copied} file(s)${missing ? `, ${missing} missing` : ''}.`)
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
