# Security Policy

## Privacy model

The Worldbuilder is local-first. These properties are design rules, not options:

- **Files are the truth.** A world is stored as Markdown files with YAML front matter on
  your own device. Any database or index is derived and rebuildable.
- **Disclosure gate, default deny.** Nothing leaves the screen unless the disclosure gate
  allows it. Sending a card to a cloud model additionally requires your explicit
  confirmation per transfer.
- **Stances never leave the device.** Your position on a card (believed, rejected,
  undecided) and your conclusions are private. A shared card is content plus provenance only.
- **Agents propose, humans decide.** Agents write only via proposals; nothing an agent
  proposed counts until a human accepts it.
- **Training export is opt-in** per card.

## Supported versions

There is no release yet (pre-0.1.0). Security fixes target the default branch.

## Reporting a vulnerability

Please use GitHub private vulnerability reporting: go to the repository's **Security** tab
and choose **Report a vulnerability**. Do not open public issues for vulnerabilities.
Reports are handled as soon as possible (best effort, single maintainer).

## Repository safeguards

Secret scanning and push protection must be enabled in the repository settings.
CI additionally runs a "no real data" check, dependency audit and CodeQL.
Never commit secrets or real personal data, not even in test fixtures.
