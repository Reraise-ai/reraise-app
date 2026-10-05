# Weltenbauer

> Das LLM ist austauschbar. Die persönliche Welt nicht. Das Board ist der Ort, an dem aus der Welt eine Lage wird – und aus der Lage eine Entscheidung, deren Ergebnis die Welt erfahrener macht.

Weltenbauer ist ein local-first Werkzeug, mit dem ein Mensch sein Wissen, seine Erfahrungen und seine Haltungen als strukturierten Graph aus typisierten Karten aufbaut. Jede Information bleibt als BELEGT, GESAGT, GEGLAUBT oder ERFAHRUNG erkennbar und wird nie mit einer anderen Ebene vermischt. Auf einem Board mit Leitfrage wird daraus eine konkrete Lage: Akteure, Züge, Belege und Widersprüche werden gelesen und geprüft. Daraus entsteht eine Entscheidung mit eigener Prognose und Review-Termin. Das Ergebnis fließt als Erfahrung zurück, und die Welt wird dadurch erfahrener. KI-Systeme arbeiten als Sparringspartner über eine MCP-Schnittstelle. Sie schlagen nur Geisterkarten vor und setzen nie eine Haltung. Das LLM lässt sich jederzeit austauschen, weil die Welt beim Nutzer liegt.

**Status: Konzeptphase.** Es gibt noch keinen Produktivcode. Die Designentscheidungen stehen, der Klick-Prototyp validiert die Board-UX.

## Wegweiser

| Dokument | Inhalt |
|---|---|
| [docs/01-vision.md](docs/01-vision.md) | Problem, Kernidee, Abgrenzung, Denkkreislauf, vier Schichten |
| [docs/02-ux-board.md](docs/02-ux-board.md) | Board-UX: Prinzipien, visuelle Grammatik, Phasen, Linsen, Inbox, KI-Aktionen, zwei durchgespielte Szenarien |
| [docs/03-datenmodell.md](docs/03-datenmodell.md) | Entitäten als TypeScript-Interfaces, Provenienz-Algorithmus, Event-Log, JSON-Beispiel |
| [docs/04-architektur.md](docs/04-architektur.md) | Systembild, Monorepo, Speicher, MCP-Server, Kontextpaket, Ingest, Plattform-Ausblick |
| [docs/05-roadmap.md](docs/05-roadmap.md) | Phasen 0–4, Fertig-Kriterien, offene Owner-Entscheidungen |

Empfohlene Lesereihenfolge: 01, dann 02 (Herzstück), danach 03 bis 05 nach Bedarf.

## Prototyp

Der Klick-Prototyp zur Validierung der Board-UX liegt unter [`prototype/board.html`](prototype/board.html) (Datei herunterladen, im Browser öffnen). Screenshots: [`prototype/screenshots/`](prototype/screenshots/). Er arbeitet mit erfundenen Beispieldaten aus den Szenarien in [docs/02-ux-board.md](docs/02-ux-board.md).
