// @ts-check
import { defineConfig } from 'astro/config'
import starlight from '@astrojs/starlight'

export default defineConfig({
  site: 'https://forgeailab.github.io',
  base: '/forge-docs/',
  trailingSlash: 'always',
  integrations: [
    starlight({
      title: 'Forge',
      logo: {
        light: './src/assets/forge-wordmark-light.png',
        dark: './src/assets/forge-wordmark-dark.png',
        replacesTitle: true,
      },
      favicon: '/favicon.png',
      description:
        'The local-first workflow engine for coding agents. Run Claude Code, Codex, Gemini through a real task lifecycle — isolated worktrees, CI gates, review, merge.',
      social: {
        github: 'https://github.com/ForgeAILab/forge',
      },
      editLink: {
        baseUrl: 'https://github.com/ForgeAILab/forge/edit/main/docs/',
      },
      customCss: ['./src/styles/forge.css'],
      head: [
        {
          tag: 'meta',
          attrs: { name: 'theme-color', content: '#0B0F14' },
        },
        {
          // Default to dark theme on first visit (user can still switch).
          tag: 'script',
          content: `(function(){try{var k='starlight-theme';if(!localStorage.getItem(k)){document.documentElement.dataset.theme='dark';localStorage.setItem(k,'dark');}}catch(e){}})();`,
        },
      ],
      // Pagefind ships built-in (search enabled by default).
      sidebar: [
        {
          label: 'Get started',
          items: [
            { label: 'Introduction', slug: 'index' },
            { label: 'Getting started', slug: 'getting-started' },
          ],
        },
        {
          label: 'Reference',
          items: [
            { label: 'REST API & MCP tools', slug: 'api' },
            { label: 'forge-ctl CLI', slug: 'cli' },
            { label: 'Execution logs', slug: 'execution-logs' },
          ],
        },
        {
          label: 'Internals',
          items: [
            { label: 'Architecture', slug: 'architecture' },
          ],
        },
      ],
      components: {
        ThemeSelect: './src/components/ThemeToggle.astro',
      },
    }),
  ],
})
