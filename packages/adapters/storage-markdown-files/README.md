# @worldbuilder/storage-markdown-files

The reference `StorageAdapter`: a folder of Markdown cards with YAML front matter in the
[card format](../../../docs/reference/card-format.md). Files are the truth
([ADR-0006](../../../docs/adr/0006-files-are-the-truth.md)); the index is derived in memory
([ADR-0033](../../../docs/adr/0033-derived-index-reference-adapter.md)).

```ts
import { MarkdownFilesAdapter } from '@worldbuilder/storage-markdown-files';

const store = await MarkdownFilesAdapter.open('examples/hormuz');
const id = await store.create(draft, 'human'); // returns the canonical ULID
await store.patch(id, { title: 'New title' }); // rewrites that one field, nothing else
store.close(); // stops the file watcher
```

Options: `createIfMissing`, `watch` (default `true`), `rescanIntervalMs`, `debounceMs`, `lock`
(`timeoutMs`, `staleMs`, `pollMs`). See [Adapter interfaces](../../../docs/reference/adapters.md)
for the layout and the guarantees. It passes `describeStorageAdapterConformance` from
`@worldbuilder/conformance`.

Archived versions are kept as `_archive/<stem>.v<n>.md` next to the card, where `<stem>` is the
file name without `.md`.

Conformance note: the kit's `believedCard` and `assessmentOnlyCard` seeds (legacy stance
mappings, ADR-0008) are optional and not provided here, so those two tests are skipped for this
adapter. The reference format has no legacy stance fields. Adapters of stores that do (the owner
store's adapter) must provide both seeds and implement `readLegacyStance`.

Licence: Apache-2.0.
