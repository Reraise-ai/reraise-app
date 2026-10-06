// SPDX-License-Identifier: Apache-2.0
// Copyright The Worldbuilder contributors
import { readdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { withMermaid } from 'vitepress-plugin-mermaid';

const repo = 'https://github.com/Reraise-ai/reraise-app';

// The ADR sidebar is generated from docs/adr/NNNN-*.md so a new ADR needs no config change.
const adrDir = fileURLToPath(new URL('../adr/', import.meta.url));
const adrItems = readdirSync(adrDir)
  .filter((f) => /^\d{4}-.*\.md$/.test(f))
  .sort()
  .map((f) => {
    const heading = /^# (.+)$/m.exec(readFileSync(adrDir + f, 'utf8'));
    const title = heading ? heading[1].replace(/^ADR-/, 'ADR-') : f;
    return { text: title, link: `/adr/${f.replace(/\.md$/, '')}` };
  });

export default withMermaid({
  title: 'The Worldbuilder',
  description:
    'A personal layer between you and any model or agent: cards with provenance, a board for decisions, files as the truth.',
  lang: 'en',
  base: '/Worldbuilder/',
  cleanUrls: true,
  lastUpdated: false,
  // Dead links fail the build.
  ignoreDeadLinks: false,
  // Links to schemas/, examples/ and prototype/ live outside docs/ and use absolute GitHub URLs.
  head: [['meta', { name: 'theme-color', content: '#0d1722' }]],
  themeConfig: {
    nav: [
      { text: 'Product', link: '/product/vision' },
      { text: 'Tutorials', link: '/tutorials/' },
      { text: 'How-to', link: '/how-to/' },
      { text: 'Reference', link: '/reference/' },
      { text: 'Explanation', link: '/explanation/' },
      { text: 'Architecture', link: '/architecture/' },
      { text: 'ADRs', link: '/adr/' },
      { text: 'Roadmap', link: '/roadmap' },
    ],
    sidebar: {
      '/product/': [
        {
          text: 'Product',
          items: [
            { text: 'Vision', link: '/product/vision' },
            { text: 'Board UX', link: '/product/board-ux' },
            { text: 'Scenarios', link: '/product/scenarios' },
            { text: 'Concept v1 notes', link: '/product/concept-v1-notes' },
          ],
        },
      ],
      '/tutorials/': [{ text: 'Tutorials', items: [{ text: 'Overview', link: '/tutorials/' }] }],
      '/how-to/': [{ text: 'How-to guides', items: [{ text: 'Overview', link: '/how-to/' }] }],
      '/reference/': [
        {
          text: 'Reference',
          items: [
            { text: 'Overview', link: '/reference/' },
            { text: 'Card format v2', link: '/reference/card-format' },
            { text: 'Glossary', link: '/glossary' },
          ],
        },
      ],
      '/explanation/': [
        {
          text: 'Explanation',
          items: [
            { text: 'Overview', link: '/explanation/' },
            { text: 'Why layers never merge', link: '/explanation/layers-never-merge' },
            {
              text: 'Provenance and independence',
              link: '/explanation/provenance-and-independence',
            },
            { text: 'Why the LLM is replaceable', link: '/explanation/llm-is-replaceable' },
          ],
        },
      ],
      '/architecture/': [{ text: 'Architecture', items: [{ text: 'Overview', link: '/architecture/' }] }],
      '/adr/': [
        {
          text: 'Architecture decisions',
          items: [{ text: 'ADR log', link: '/adr/' }, ...adrItems],
        },
      ],
      '/glossary': [
        {
          text: 'Reference',
          items: [
            { text: 'Overview', link: '/reference/' },
            { text: 'Card format v2', link: '/reference/card-format' },
            { text: 'Glossary', link: '/glossary' },
          ],
        },
      ],
      '/roadmap': [
        {
          text: 'Project',
          items: [
            { text: 'Roadmap', link: '/roadmap' },
            { text: 'Verification', link: '/verification' },
          ],
        },
      ],
      '/verification': [
        {
          text: 'Project',
          items: [
            { text: 'Roadmap', link: '/roadmap' },
            { text: 'Verification', link: '/verification' },
          ],
        },
      ],
    },
    socialLinks: [{ icon: 'github', link: repo }],
    editLink: {
      pattern: `${repo}/edit/main/docs/:path`,
      text: 'Edit this page on GitHub',
    },
    search: { provider: 'local' },
    outline: [2, 3],
    footer: {
      message: 'Documentation licensed under Apache-2.0. The application is AGPL-3.0-or-later.',
      copyright: 'Copyright The Worldbuilder contributors',
    },
  },
});
