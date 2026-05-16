// @ts-check
import { defineConfig } from 'astro/config'
import starlight from '@astrojs/starlight'

export default defineConfig({
  site: 'https://forgeailab.github.io',
  base: '/docs/',
  trailingSlash: 'always',
  integrations: [
    starlight({
      title: 'Forge',
      logo: {
        light: './src/assets/forge-wordmark-transparent-small-dark.png',
        dark: './src/assets/forge-wordmark-transparent-small-light.png',
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
          label: 'Concepts',
          items: [
            { label: 'Overview', slug: 'concepts' },
            { label: 'Agents', slug: 'concepts/agents' },
            { label: 'Tasks', slug: 'concepts/tasks' },
            { label: 'Workspaces', slug: 'concepts/workspaces' },
            { label: 'Workflows', slug: 'concepts/workflows' },
            { label: '— How workflows work', slug: 'concepts/workflows/how-it-works' },
            { label: '— Gates and retries', slug: 'concepts/workflows/gates' },
            { label: '— Defining a workflow', slug: 'concepts/workflows/defining' },
            { label: 'Review & merge', slug: 'concepts/review-and-merge' },
            { label: 'Subtasks & dependencies', slug: 'concepts/subtasks-and-dependencies' },
            { label: 'Lifecycle hooks', slug: 'concepts/hooks' },
            { label: 'Chat & follow-ups', slug: 'concepts/chat-and-follow-ups' },
            { label: 'Knowledge', slug: 'concepts/knowledge' },
            { label: 'External issues', slug: 'concepts/external-issues' },
            { label: 'Notifications', slug: 'concepts/notifications' },
            { label: 'Auth & users', slug: 'concepts/auth' },
            { label: 'MCP for agents', slug: 'concepts/mcp' },
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
      expressiveCode: {
        // Force a single dark theme so code blocks are never rendered
        // in the default blue-tinted github-light theme in light mode.
        themes: ['github-dark'],
      },
      components: {
        ThemeSelect: './src/components/ThemeToggle.astro',
      },
    }),
  ],
})
