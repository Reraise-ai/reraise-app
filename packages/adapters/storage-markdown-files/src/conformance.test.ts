// SPDX-License-Identifier: Apache-2.0
// Copyright The Worldbuilder contributors
//
// The reference adapter passes the StorageAdapter conformance kit (ADR-0005, M1-02) against a
// temporary copy of the synthetic Hormuz store. The kit assumes a store without cards (it
// expects an empty list after rejected drafts), so the cards of the copy are left out here;
// hormuz.test.ts runs the adapter over the complete example store.

import { cp, readFile, readdir } from 'node:fs/promises';
import path from 'node:path';
import { describeStorageAdapterConformance } from '@worldbuilder/conformance';
import {
  newId,
  cleanupAfterAll,
  copyHormuz,
  openStore,
  tempDir,
  writeCardFile,
} from './testing/store.js';

cleanupAfterAll();

async function findFile(dir: string, id: string): Promise<string> {
  const walk = async (d: string): Promise<string | undefined> => {
    for (const e of await readdir(d, { withFileTypes: true })) {
      const p = path.join(d, e.name);
      if (e.isDirectory()) {
        if (e.name === '_archive') continue;
        const found = await walk(p);
        if (found) return found;
      } else if (e.name.endsWith('.md') && (await readFile(p, 'utf8')).includes(`id: ${id}`)) {
        return p;
      }
    }
    return undefined;
  };
  const file = await walk(path.join(dir, 'cards'));
  if (!file) throw new Error(`no file for ${id}`);
  return file;
}

describeStorageAdapterConformance('markdown-files', async () => {
  const dir = await copyHormuz({ cards: false });
  const adapter = await openStore(dir);
  return {
    adapter,
    reopen: () => openStore(dir),
    relocate: async () => {
      const moved = await tempDir();
      await cp(dir, moved, { recursive: true });
      return openStore(moved);
    },
    raw: async (id) => readFile(await findFile(dir, id), 'utf8'),
    seed: {
      legacyCard: async () => {
        const id = newId();
        await writeCardFile(
          dir,
          'legacy-topic.md',
          `---\nid: ${id}\ntype: topic\ntitle: Legacy topic\n---\n\nOld.\n`,
        );
        return id;
      },
      cardWithForeignFields: async () => {
        const id = newId();
        await writeCardFile(
          dir,
          'foreign-fields.md',
          [
            '---',
            '# kept: a comment the product does not own',
            `id: ${id}`,
            'format: 2',
            "x-store-field:   'kept   verbatim'",
            'type: claim',
            'title:    Original title   # trailing comment',
            'layer: said',
            'originSystem: Example store',
            'author: human',
            'x-other:',
            '  nested: [1, 2]',
            '---',
            '',
            'Body.',
            '',
          ].join('\n'),
        );
        return id;
      },
    },
  };
});
