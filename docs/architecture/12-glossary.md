# 12. Glossary

Domain terms, including the German terms from the original product definition and the legacy
card format, are defined once in the project [glossary](../glossary.md). This page does not
repeat them. It only adds terms that are used in the architecture documentation itself.

| Term | Meaning on these pages |
| --- | --- |
| arc42 | The template this documentation follows ([arc42.org](https://arc42.org/overview)). |
| C4 | Context, containers, components, code: the diagram levels used here ([c4model.com](https://c4model.com/)). Level 1 is the [system context](./03-context-scope.md), level 2 the [container view](./05-building-blocks.md#52-level-1-container-view). |
| Container | In C4, a separately runnable or deployable unit. Here also used for a separately licensed library package with its own contract. |
| Port | One of the six interfaces through which `core` reaches the outside: `StorageAdapter`, `SourceConnector`, `ModelConnector`, `Level1Engine` ([ADR-0035](../adr/0035-level1-engine-socket.md)), `DisclosureGate` ([ADR-0005](../adr/0005-universal-adapter-architecture.md)) and `LocalStateStore` for device-only state ([ADR-0030](../adr/0030-local-state-on-the-device.md)). |
| Adapter | An implementation of a port for one store, source or model. |
| Conformance kit | `packages/conformance`, the test kit every `StorageAdapter` must pass. |
| Egress | Anything leaving the screen: a context package, an MCP response, a model or Jev call, an export. Every egress path calls the disclosure gate. |
| Target, target class | The audience of an egress: `screen`, `local_model`, `cloud_model`, `demo` or `share` (other people, [ADR-0036](../adr/0036-conclusions-are-private.md)). An MCP connection is registered with one target class, `local_model` or `cloud_model`. |
| Canonical object | A domain object in the product's English model, as opposed to a store's raw file. Egress serialises canonical objects only. |
| Patch write | A write that changes only the fields the product changed and leaves every other byte of the store file verbatim. |
| Write path, write channel | The single sanctioned way to write into a store: validate, lock, write. "The owner store's write channel" is that store's own implementation. |
| stdio bridge | The command `worldbuilder mcp --stdio` that connects stdio-only MCP clients to the running service; it holds no state and never writes ([ADR-0029](../adr/0029-process-topology.md)). |
| Gate rule | A disclosure rule in `gate-rules.yaml` that allows or denies a card for a target ([ADR-0031](../adr/0031-gate-rules-and-confirmation-binding.md)). Not to be confused with a `Rule` card. |
| Rule card (`Rule`) | A user-authored decision rule evaluated by the Rules panel (fired or not fired, no score, [ADR-0013](../adr/0013-rules-panel-replaces-barometer.md)). Unrelated to gate rules. |
| State directory | The per-user directory for device-only state (proposals, stances, gate log, gate rules) ([ADR-0030](../adr/0030-local-state-on-the-device.md)). |
| Derived index | Any search index, graph cache or vector store built from the files; deletable and rebuildable. |
| Walking skeleton | Milestone M1: the thinnest end-to-end path, everything real, nothing pretty. |
| Vertical slice | One M2+ pull request that adds UI, API, adapter and tests for one capability. |
| Level 1, Level 2 | Fast per-player predictions from a `Level1Engine` and the deliberate board ([ADR-0015](../adr/0015-two-thinking-levels.md), [ADR-0035](../adr/0035-level1-engine-socket.md)). |
| Jev | An external, cloud-only Level 1 decision service; one `Level1Engine` adapter among several, always behind the gate. |
| OD-n | An architecture question raised by this documentation, open or resolved by an ADR, listed in [section 9.2](./09-decisions.md#92-open-decisions). |
| RK-n, TD-n | A risk or technical-debt entry in [section 11](./11-risks-debt.md). |
| QS-n | A quality scenario in [section 10](./10-quality.md#102-quality-scenarios). |
