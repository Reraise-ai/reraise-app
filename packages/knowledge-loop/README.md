# @worldbuilder/knowledge-loop

The knowledge loop of The Worldbuilder ([ADR-0039](../../docs/adr/0039-knowledge-loop-receipts.md)
to [ADR-0043](../../docs/adr/0043-digest-atlas-regeneration.md)), as pure functions plus the
small `wb` command line:

- receipts: `createKnowledgeReceipt`, `createWriteBackReceipt` (ids, hashes, codes and times,
  never content);
- the receipt log: `checkChain`, `buildEntry`, `ReceiptLog` over an injected `ReceiptLogPort`,
  and `fileReceiptLogPort` for `<state>/receipt-log.jsonl`;
- the verifier: `verifyReceipts(taskRecords, logLines)`, fail closed;
- usage metrics: `computeUsageMetrics(ledger, { now, week?, targets? })`;
- memory routing: `routeMemory(item)`, deterministic rules `rules:v1`;
- the atlas digest: `buildDigest`, `renderDigestMarkdown`, `checkDigestPage`.

`wb receipts verify`, `wb digest` and `wb metrics` read files only and never contact the
service. Commands, options and exit codes: [docs/reference/wb-cli.md](../../docs/reference/wb-cli.md).

The service (`services/api`) wires these functions into the MCP tools and the Board API; this
package has no service code and imports no AGPL package.

Licence: Apache-2.0.
