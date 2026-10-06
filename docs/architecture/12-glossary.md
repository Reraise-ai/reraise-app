# 12. Glossary

Domain terms, including the German terms from the original product definition and the legacy
card format, are defined once in the project [glossary](../glossary.md). This page does not
repeat them. It only adds terms that are used in the architecture documentation itself.

| Term | Meaning on these pages |
| --- | --- |
| arc42 | The template this documentation follows ([arc42.org](https://arc42.org/overview)). |
| C4 | Context, containers, components, code: the diagram levels used here ([c4model.com](https://c4model.com/)). Level 1 is the [system context](./03-context-scope.md), level 2 the [container view](./05-building-blocks.md#52-level-1-container-view). |
| Container | In C4, a separately runnable or deployable unit. Here also used for a separately licensed library package with its own contract. |
| Port | One of the four interfaces through which `core` reaches the outside: `StorageAdapter`, `SourceConnector`, `ModelConnector`, `DisclosureGate` ([ADR-0005](../adr/0005-universal-adapter-architecture.md)). |
| Adapter | An implementation of a port for one store, source or model. |
| Conformance kit | `packages/conformance`, the test kit every `StorageAdapter` must pass. |
| Egress | Anything leaving the screen: a context package, an MCP response, a model or Jev call, an export. Every egress path calls the disclosure gate. |
| Target, target class | The audience of an egress: `screen`, `local_model`, `cloud_model` or `demo`. An MCP connection is registered with one target class. |
| Canonical object | A domain object in the product's English model, as opposed to a store's raw file. Egress serialises canonical objects only. |
| Patch write | A write that changes only the fields the product changed and leaves every other byte of the store file verbatim. |
| Write path, write channel | The single sanctioned way to write into a store: validate, lock, write. "The owner store's write channel" is that store's own implementation. |
| Derived index | Any search index, graph cache or vector store built from the files; deletable and rebuildable. |
| Walking skeleton | Milestone M1: the thinnest end-to-end path, everything real, nothing pretty. |
| Vertical slice | One M2+ pull request that adds UI, API, adapter and tests for one capability. |
| Level 1, Level 2 | Fast typed answers and the deliberate board ([ADR-0015](../adr/0015-two-thinking-levels.md)). |
| Jev | An external, cloud-only Level 1 decision service, connected through a `ModelConnector` stub behind the gate. |
| OD-n | An open architecture decision listed in [section 9.2](./09-decisions.md#92-open-decisions). |
| RK-n, TD-n | A risk or technical-debt entry in [section 11](./11-risks-debt.md). |
| QS-n | A quality scenario in [section 10](./10-quality.md#102-quality-scenarios). |
