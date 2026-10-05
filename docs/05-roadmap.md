# 05 – Roadmap

Ausbauplan in fünf Phasen. Jede Phase hat konkreten Umfang und ein überprüfbares "fertig wenn"-Kriterium. Verweise: UX in [02-ux-board.md](02-ux-board.md), Datenmodell in [03-datenmodell.md](03-datenmodell.md), Technik in [04-architektur.md](04-architektur.md).

Inhalt: [1 Überblick](#1-überblick) · [2 Phasen](#2-phasen) · [3 Bewusst nicht in Phase 1](#3-bewusst-nicht-in-phase-1) · [4 Offene Owner-Entscheidungen](#4-offene-owner-entscheidungen)

## 1. Überblick

| Phase | Name | Kernergebnis | Neu im Datenmodell |
|---|---|---|---|
| 0 | Klick-Prototyp | Board-UX mit zwei echten Szenarien validiert | nichts (statische Daten) |
| 1 | Meine Welt + Board | Karten, Schichten, Haltungen, Inbox-Ingest, Board mit drei Linsen, MCP lesend und propose | Card, Statement, Stance, Relation, World, Board, Eventlog |
| 2 | Entscheiden + Nachhalten | Entscheidungen, Prognosen, Reviews, Quellenprofile, Barometer | Prediction, Decision, Experience-Serien, SourceProfile, Snapshot |
| 3 | Mehrere Welten + Regeln | Welt-Overlays, Regeln aus Entscheidungen, "Was würde ich tun?" | Rule, mehrere Memberships |
| 4 | Plattform | Teilen, Signatur, Föderation, gemeinsame Provenienz | Federation-Felder aktiv, Schlüssel |

Reihenfolge ist zwingend: Jede Phase baut auf dem Log und den Karten der vorigen auf. Das Datenmodell enthält schon ab Phase 1 die Felder für Phase 4 (ULID, `origin`, `author`, `visibility`), damit keine Migration der Wahrheit nötig ist.

## 2. Phasen

### Phase 0: Klick-Prototyp

**Ziel:** Prüfen, ob das Board-Konzept (Leitfrage, Phasen, Linsen, Schichten, Triage) für echte Fragen trägt, bevor Produktivcode entsteht.

**Umfang**
- Statisches Klick-Prototyp [`prototype/board.html`](../prototype/board.html), ohne Server, mit Beispieldaten aus den Szenarien in [02](02-ux-board.md#11-szenario-a-geopolitik-iran-und-die-strasse-von-hormus).
- Bildschirmaufbau wie in [02, Abschnitt 3](02-ux-board.md#3-bildschirmaufbau): Prämissen-Leiste, Phasenleiste, Leinwand, Seitenleisten, Fremdkörper-Ablage.
- Visuelle Grammatik der Schichten (BELEGT, GESAGT, GEGLAUBT, Erfahrung, Geisterkarte).
- Mindestens die Linsen Spielfeld, Zeitachse und Evidenzwand mit Klick durch die Szenarien.
- Inbox-Triage mit den Schnellaktionen.
- Szenario A (Geopolitik) und Szenario B (Mallorca) vollständig durchklickbar.

**Fertig wenn**
1. Der Owner kann beide Szenarien allein durchklicken und jede Phase in eigenen Worten erklären.
2. Die offenen UX-Fragen aus [02, Abschnitt 13](02-ux-board.md#13-offene-ux-fragen-für-den-prototyp) sind beantwortet und Änderungswünsche in die Docs eingearbeitet.
3. Der Owner hat **eine echte eigene Frage** (nicht aus den Szenarien) auf Papier oder im Prototyp durchgespielt und danach entschieden, ob das Konzept trägt.
4. Die Entscheidung zum ersten Pilot-Szenario (Owner-Entscheidung 1) ist gefallen.

**Nicht in Phase 0:** Datenhaltung, Server, LLM, Login, Persistenz.

### Phase 1: Meine Welt + Board

**Ziel:** Eine Person kann eine Welt aufbauen, Informationen einspeisen, ein Board zu einer Leitfrage bestücken und lesen, und ein KI-Agent kann die Welt über MCP nutzen.

**Umfang**
1. **Monorepo-Gerüst** ([04, Abschnitt 3](04-architektur.md#3-monorepo-struktur)): `core`, `store`, `llm`, `context`, `ingest`, `mcp`, `apps/server`, `apps/web`. Lint für Abhängigkeitsregeln, CI mit Tests.
2. **`core`:** Typen und zod-Schemas für Card (Typen: Akteur, Ereignis, Aussage, Quelle, Erfahrung, Prämisse, Thema), Stance, Relation, World, Membership, Board, Event. Funktionen `layerOf`, `originRoots`, `independence`. Alle Invarianten aus [03, Abschnitt 14](03-datenmodell.md#14-invarianten) als Tests.
3. **`store`:** SQLite mit Ereignislog, Projektionen, FTS5, sqlite-vec, Blob-Ablage, Rebuild, JSON-Export und Markdown-Ansicht, Import.
4. **Eine Welt** mit Prämissen, Mitgliedschaften (Rolle, Gewicht, Notiz).
5. **Karten und Schichten:** Karten anlegen, bearbeiten, archivieren. BELEGT/GESAGT/ERFAHRUNG sichtbar. Haltungen (Stance) mit Zustimmung, Konfidenz, Gewicht, Begründung und Historie.
6. **Beziehungen** mit den Typen `supports`, `contradicts`, `cites`, `belongs-to`, `influences`, `depends-on`, `interest-in`, `says-vs-does`, `allied-with`, `in-conflict-with`.
7. **Provenienz:** Anzeige "4 Karten · 1 unabhängiger Ursprung".
8. **Inbox-Ingest:** URL, Text, Transkript (TXT/VTT/SRT), PDF. Extraktion zu Geister-Aussagen mit Sprecher und Fundstelle. Triage mit den Schnellaktionen (übernehmen, verwerfen, stützt, widerspricht, Haltung setzen; "Prognose markieren" legt in Phase 1 eine einfache Prognose-Notiz ohne Auflösung an, siehe Phase 2).
9. **Schnellerfassung** (Text, mobil im Browser), Sprache optional über Browser-Diktat.
10. **Board:** Anlegen mit Pflicht-Leitfrage, Prämissen-Leiste, Phasenleiste (Marker), Seitenleisten "Was deine Welt weiß" und Inbox, Karten-Detail, Fremdkörper-Ablage, Linsen **Spielfeld**, **Zeitachse**, **Evidenzwand** und freie Leinwand ([02, Abschnitt 5](02-ux-board.md#5-die-vier-linsen)). Layout wird je Linse gespeichert.
11. **KI-Sparring light:** "Lage lesen" und "Was fehlt?" als Geisterkarten. (Die anderen Aktionen folgen mit Phase 2/3.)
12. **MCP-Server** lesend und propose: `world_list`, `context_for`, `cards_search`, `card_get`, `board_get`, `propose_cards` ([04, Abschnitt 6](04-architektur.md#6-mcp-server)). Sicherheitstest: kein Agent kann eine aktive Karte oder Stance schreiben.
13. **LLM-Adapter** für Claude und Ollama (OpenAI folgt als dritter Adapter, wenn Zeit bleibt).
14. **Kontextpaket** wie in [04, Abschnitt 7](04-architektur.md#7-kontextpaket-pipeline) mit Golden-File-Tests.
15. **Prämissen-Barometer als Zählung** (Ursprünge je Schicht) in der Evidenzwand, ohne Quellenprofile.

**Fertig wenn**
1. Der Owner hat **eine echte Frage** (Pilot-Szenario) im Board mit mindestens 30 Karten aus mindestens drei Quellen bearbeitet, davon mindestens eine per Podcast-/Artikel-Ingest.
2. Jede Aussage zeigt ihre Schicht, jeder Zähler lässt sich per Klick in Schichten zerlegen.
3. Ein externer Agent (Claude Desktop über MCP) kann `context_for` aufrufen und bekommt ein Paket, in dem Schicht, Sprecher, Unabhängigkeit und Haltung je Aussage stehen. Eine Beispielantwort des Agenten vermischt die Schichten nachweislich nicht.
4. Der Agent kann über `propose_cards` Geisterkarten anlegen, die in der Inbox erscheinen. Der Sicherheitstest "Agent schreibt nur Geister" ist grün.
5. Rebuild-Test grün: Projektionen aus dem Log neu aufgebaut ergeben denselben Zustand.
6. Export als JSON und Markdown lässt sich in einem neuen Bestand wieder importieren und ergibt dieselbe Welt.
7. Die Welt läuft vollständig lokal; mit Ollama als Adapter funktioniert Ingest ohne Cloud (Qualität darf schlechter sein).

### Phase 2: Entscheiden + Nachhalten

**Ziel:** Der Kreislauf schließt sich: Entscheidung, Prognose, Review, Ergebnis wird Erfahrung. Quellen erhalten Profile.

**Umfang**
1. **Prognose-Karten** mit Urheber (Quelle, Akteur oder ich), Wahrscheinlichkeit (Zahl oder Wort), Auflösungsdatum, Kriterium, Ergebnis.
2. **Entscheidungskarte** mit Optionen, Pro/Contra-Karten, Bedingungen, Ausschluss, Prioritäten, Begründung, eigener Prognose, Review-Datum. Linse **Entscheidung**.
3. **Snapshots** von Boards (bei Entscheidung und auf Wunsch) und Review-Ansicht "damals gegen heute".
4. **Review-Erinnerungen** (in der App, optional E-Mail oder Kalenderdatei `.ics`), Review-Flow nach [02, Abschnitt 10](02-ux-board.md#10-nachhalte--und-review-flow).
5. **Erfahrungskarten und Serien** aus Reviews und Schnellerfassung.
6. **Quellenprofile** mit allen Dimensionen ([03, Abschnitt 12](03-datenmodell.md#12-sourceprofile-abgeleitet)), Brier-Score, Profilansicht (Radar plus Tabelle), n-Schwelle.
7. **Prämissen-Barometer** mit Schichtgewichtung und Haltungsverlauf; Konfidenz-Vorschläge nach Reviews (nur als Geister).
8. **KI-Aktionen** "Advocatus Diaboli", "Nächster Zug von X?" (mit Spieltheorie und Strategem-Hypothesen), "Was fehlt?" vollständig.
9. **MCP:** `decision_rules_for` (liefert in Phase 2 Entscheidungsvergleiche, Regeln folgen in Phase 3), `source_profile_get`, `prediction_log` (nur Geist).
10. **Zeitreise:** Board "Stand: Datum".

**Fertig wenn**
1. Eine reale Entscheidung des Owners wurde mit Prognose und Review-Datum angelegt und der Review am Termin tatsächlich durchgeführt (oder, bei langem Horizont, ein Review einer kurzfristigen Teilprognose).
2. Der Review aktualisiert nachweislich mindestens ein Quellenprofil (Treffer, Brier-Score), eine Prämisse (Konfidenzvorschlag) und erzeugt eine Erfahrungskarte.
3. Das Quellenprofil zeigt Dimensionen getrennt und "zu wenig Daten", wenn n < 5. Es gibt keine Gesamtnote.
4. Die Haltung zum Zeitpunkt der Prognose ist aus der Historie abrufbar. "Wert des Widerspruchs" wird berechnet.
5. Ein Snapshot lässt sich öffnen und zeigt Barometer und Haltungen wie am Entscheidungstag.

### Phase 3: Mehrere Welten + Regeln

**Ziel:** Das System lernt aus den eigenen Entscheidungen und hält Perspektiven getrennt.

**Umfang**
1. **Mehrere Welten** und **Welt-Overlays:** dieselbe Karte in mehreren Welten mit eigener Rolle, Gewicht, Notiz. Ein Board kann Prämissen einer zweiten Welt temporär zuschalten.
2. **Regeln:** Regel-Karten aus Entscheidungen und Erfahrungen verdichten (System schlägt vor, Mensch formuliert und übernimmt). Bedingungen strukturiert (`numeric`, `cardExists`, `manual`).
3. **Regelstatistik** aus `RuleApplied` und Review-Ergebnissen.
4. **"Was würde ich tun?"**: Regeln auf eine Entscheidung anwenden, Ergebnis als Geister-Empfehlung mit Regelverweisen, Verstößen und Lücken.
5. **`decision_rules_for`** vollständig (Bedingungsprüfung gegen Fakten und Karten).
6. **Dubletten- und Konsistenzhilfen:** ähnliche Karten zusammenführen vorschlagen (nie automatisch), widersprüchliche Regeln erkennen.
7. **Eigene Kartentypen** (`custom:*`) über eine einfache Schema-Oberfläche.
8. **Tauri-Hülle** nur, wenn die Owner-Entscheidung 2 es verlangt.

**Fertig wenn**
1. Mindestens zwei Welten mit überlappenden Karten laufen parallel, und dieselbe Karte erscheint in beiden mit unterschiedlicher Rolle.
2. Aus mindestens drei realen Entscheidungen wurde eine Regel verdichtet. Sie hat eine Trefferstatistik.
3. "Was würde ich tun?" liefert bei einer neuen Entscheidung eine Empfehlung, die der Owner anhand der Regelverweise nachvollziehen kann, und zeigt, wo keine Regel greift.
4. Eine falsche oder veraltete Regel lässt sich zurückziehen (Status `retired`), ohne die Historie zu verlieren.

### Phase 4: Plattform

**Ziel:** Teilen und gemeinsame Provenienz, ohne zentrale Instanz ([04, Abschnitt 10](04-architektur.md#10-plattform-ausblick)).

**Umfang**
1. Schlüsselpaar pro Nutzer, Inhalts-Hash und Signatur für teilbare Karten.
2. Freigabe kartenweise mit Vorschau; Haltungen standardmäßig privat.
3. Import fremder Karten als `federated` mit Beleg-Link auf den Autor.
4. Provenienz und Unabhängigkeit über Nutzergrenzen (gleicher Hash = gleicher Ursprung).
5. Austausch über Datei/Link und Relay, optional gehostetes Verzeichnis (je nach Owner-Entscheidung 5).
6. Rückzug freigegebener Karten (`CardRetracted`).
7. Gemeinsame Welten oder gemeinsame Karten-Sammlungen für kleine Gruppen.
8. Szenario "Mallorca mit Mara" aus [02](02-ux-board.md#12-szenario-b-mallorca-wohnung-x-in-palma) als Abnahmetest.

**Fertig wenn**
1. Zwei Nutzer auf getrennten Rechnern tauschen einzelne Karten aus. Signaturprüfung schlägt bei Manipulation an.
2. Dieselbe Quelle (gleicher Hash) wird bei beiden als **ein** Ursprung gezählt.
3. Keine Haltung eines Nutzers erreicht den anderen, solange sie nicht ausdrücklich freigegeben wurde (Test).
4. Ein zurückgezogener Beitrag wird beim Empfänger als zurückgezogen markiert.

## 3. Bewusst nicht in Phase 1

Was Phase 1 ausdrücklich **nicht** enthält, damit sie fertig wird:

| Nicht enthalten | Wann stattdessen |
|---|---|
| Prognosen mit Auflösung, Entscheidungskarten, Review, Snapshots | Phase 2 |
| Quellenprofile, Brier-Score, Radar | Phase 2 (Daten werden in Phase 1 schon korrekt erfasst) |
| Linse Entscheidung | Phase 2 |
| Regeln, "Was würde ich tun?", mehrere Welten, Overlays | Phase 3 |
| Advocatus Diaboli, "Nächster Zug von X?", Strategem- und Spieltheorie-Hypothesen | Phase 2 |
| Tauri-Desktop-Hülle, Installer | Phase 3 oder später |
| Schreibende MCP-Tools außer `propose_cards`, Agent-Rechteverwaltung | nie als aktives Schreiben (Sicherheitsregel); Verfeinerung in Phase 3 |
| Teilen, Signatur, Föderation, Konten, Hub | Phase 4 |
| Synchronisierung zwischen eigenen Geräten | nach Phase 4 prüfen (Log ist dafür geeignet) |
| Echtzeit-Zusammenarbeit | nicht geplant |
| Audio-Transkription im eigenen Prozess | später; Phase 1 nimmt Transkripte oder Browser-Diktat |
| Mobile App | nicht geplant; Schnellerfassung und Inbox funktionieren im mobilen Browser |
| Automatisches Auflösen von Prognosen oder Widersprüchen | nie vorgesehen |
| Automatisches Setzen von Haltungen durch KI | nie vorgesehen |
| Eigenes Embedding-Training, Fine-Tuning | nicht vorgesehen |
| Import aus Notion/Obsidian/Evernote | später, über Dateiimport und Ingest |
| Mehrsprachige Oberfläche | später; Phase 1 ist deutsch |

## 4. Offene Owner-Entscheidungen

Nur echte Entscheidungen, die der Owner treffen muss. Alles andere ist im Brief und in den Docs gesetzt.

| # | Frage | Optionen | Empfehlung | Entscheidung nötig vor |
|---|---|---|---|---|
| 1 | **Erstes Pilot-Szenario** | Geopolitik (Iran/Hormus) oder Mallorca (Wohnung X) | **Geopolitik zuerst.** Sie fordert die Spielfeld-Linse, Aussage-vs-Handlung und das Prämissen-Barometer, also die neuen Teile der UX. Mallorca direkt danach, weil es die Entscheidungs-UX, Regeln und Erfahrungen prüft. Falls bei Mallorca ein echter Termin drängt (Angebotsfrist), Mallorca zuerst. | Abschluss Phase 0 |
| 2 | **Desktop-Hülle (Tauri) in Phase 1?** | Tauri von Anfang an, oder Browser auf `localhost` | **Browser auf localhost.** Spart Aufwand, Server und UI bleiben unverändert. Tauri später ohne Umbau. | Start Phase 1 |
| 3 | **Standard-LLM für den Ingest** (Kosten gegen Privatsphäre) | Cloud-Modell (stärker, Geld, Daten verlassen den Rechner), lokales Modell über Ollama (privat, schwächer, braucht Hardware) | **Cloud-Modell als Standard für öffentliche Quellen (Podcasts, Artikel), lokal wählbar für private Notizen und Erfahrungen** (Konfiguration `privacy.cloud_allowed_purposes`). Vor der Entscheidung 20 Beispiel-Abschnitte mit beiden Modellen extrahieren und Qualität vergleichen. | Mitte Phase 1 |
| 4 | **Haltungs-Skala** | −2..+2 Zustimmung **und** 0–100 % Konfidenz, oder nur eines von beiden | **Beides, getrennt** (so im Datenmodell). Die UI blendet in der Schnellansicht nur ein Feld ein (Zustimmung) und Konfidenz optional. Begründung: Ohne Konfidenz ist "unsicher" nicht von "unentschieden" zu unterscheiden. | Start Phase 1 (Schema) |
| 5 | **Teilen in Phase 4** | Reine Föderation (Peers, Relays), oder zusätzlich optional gehosteter Hub | **Reine Föderation als Kern, Hub nur als optionales Verzeichnis ohne Wahrheitshoheit**, falls das Finden von Mitnutzern sonst zu schwer ist. Entscheiden erst bei Beginn von Phase 4, die Phasen 1 bis 3 bleiben davon unberührt. | Start Phase 4 |

Weitere Punkte, die **keine** Owner-Entscheidung sind, sondern bei der Umsetzung geklärt werden (Details in den Docs):
- Zeitreise-Implementierung (Replay gegen Versionsspalten), siehe [04, Abschnitt 4](04-architektur.md#4-speicher).
- Schichtgewichte im Barometer (Standardwerte in [03, Abschnitt 6.4](03-datenmodell.md#6-provenienz-und-unabhängigkeit)), anpassbar.
- Auswahl des Embedding-Modells (Konfiguration, austauschbar, Neu-Einbetten per Job).
