# @worldbuilder/local-state

Implements the `LocalStateStore` port of `@worldbuilder/core` ([ADR-0030](../../docs/adr/0030-local-state-on-the-device.md)):
proposals, stances, the gate decision log and the gate rules, as plain files in the per-user
state directory. Licence: Apache-2.0.

- `resolveStateDir` picks the per-OS default (or an explicit path); `assertStateDirSafe`
  refuses a directory inside a store root or a Git working tree (symbolic links followed).
- `createLocalStateStore` opens the store. Writes are atomic (temp file + rename); ids are ULIDs.
- The gate log never holds card content and rotates at 10 MB, keeping 5 files.
- `loadGateRules` validates `gate-rules.yaml` against the contract schema and fails closed
  ([ADR-0031](../../docs/adr/0031-gate-rules-and-confirmation-binding.md)).
