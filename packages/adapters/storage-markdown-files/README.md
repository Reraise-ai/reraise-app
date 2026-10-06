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

Licence: Apache-2.0.
