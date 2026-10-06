# @worldbuilder/training-export

JSONL export of decision traces for opted-in cards
([ADR-0017](../../docs/adr/0017-decision-card-and-training-export.md),
[ADR-0039](../../docs/adr/0039-knowledge-loop-receipts.md)).

`buildTrainingRecord(input)` builds one `TrainingExportRecord` for a decision card with
`training: true` and a known outcome, or says why it is skipped. Cards that did not opt in never
appear, not even by id; the record validates against `training-export-record.schema.json` and
passes the `training-opt-in` cross-check of `pnpm validate:schemas`. `toJsonl(records)` writes
the lines. The builder is pure: the export itself is decided by the disclosure gate under
`cloud_model` semantics with a per-export confirmation, in the service.

Licence: Apache-2.0.
