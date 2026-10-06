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
    const title = heading ? heading[1] : f;
    return { text: title, link: `/adr/${f.replace(/\.md$/, '')}` };
  });

// GitHub-style heading slugs ("## 8. Seats and agents" becomes "8-seats-and-agents"), so a link
// works the same on GitHub and on the site. scripts/check-doc-anchors.mjs verifies every anchor.
function githubSlug(text: string): string {
  return text
    .trim()
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s_-]/gu, '')
    .replace(/\s/g, '-');
}

export default withMermaid({
  title: 'The Worldbuilder',
  description:
    'A personal layer between you and any model or agent: cards with provenance, a board for decisions, files as the truth.',
  lang: 'en',
  base: '/Worldbuilder/',
  // The ADR index is README.md so that GitHub renders it; the site serves it at /adr/.
  rewrites: { 'adr/README.md': 'adr/index.md' },
  markdown: { anchor: { slugify: githubSlug } },
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
      '/architecture/': [
        {
          text: 'Architecture (arc42)',
          items: [
            { text: 'Overview', link: '/architecture/' },
            { text: '1. Introduction and goals', link: '/architecture/01-introduction-goals' },
            { text: '2. Constraints', link: '/architecture/02-constraints' },
            { text: '3. Context and scope', link: '/architecture/03-context-scope' },
            { text: '4. Solution strategy', link: '/architecture/04-solution-strategy' },
            { text: '5. Building blocks', link: '/architecture/05-building-blocks' },
            { text: '6. Runtime view', link: '/architecture/06-runtime' },
            { text: '7. Deployment view', link: '/architecture/07-deployment' },
            { text: '8. Crosscutting concepts', link: '/architecture/08-crosscutting' },
            { text: '9. Architecture decisions', link: '/architecture/09-decisions' },
            { text: '10. Quality requirements', link: '/architecture/10-quality' },
            { text: '11. Risks and technical debt', link: '/architecture/11-risks-debt' },
            { text: '12. Glossary', link: '/architecture/12-glossary' },
          ],
        },
      ],
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
