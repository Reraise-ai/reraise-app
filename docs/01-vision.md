# 01 – Vision

> Das LLM ist austauschbar. Die persönliche Welt nicht.

## Problem

Wer komplexe Lagen beurteilt (Geopolitik, Geldanlage, Immobilienkauf), arbeitet mit Material aus vielen Quellen: Podcasts, Artikel, Gespräche, eigene Erfahrungen. Daraus entstehen vier konkrete Probleme.

1. **Ebenen verschwimmen.** Aus "Analyst X behauptet Y" wird im Kopf "Y stimmt". Was belegt ist, was nur gesagt wurde und was ich selbst glaube, liegt in derselben Notiz.
2. **Scheinbare Bestätigung.** Fünf Artikel sagen dasselbe. Meist gehen sie auf eine einzige Quelle zurück, aber es fühlt sich wie Konsens an.
3. **Kein Lernen aus Entscheidungen.** Prognosen und Entscheidungen werden nicht festgehalten. Nach drei Monaten weiß niemand mehr, wer wann was erwartet hat und ob es eintrat. Quellen können deshalb nicht fair bewertet werden.
4. **KI ohne Gedächtnis und ohne Disziplin.** Chatbots kennen weder meine Erfahrungen noch meine Regeln. Sie mischen Fakten, Meinungen und Vermutungen zu glatten Antworten. Was ich ihnen erzähle, ist beim Anbieterwechsel weg.

## Kernidee

Weltenbauer baut für jeden Nutzer eine **persönliche Welt**: einen Graph aus typisierten Karten, in dem die Herkunft und der epistemische Status jeder Information sichtbar bleiben (BELEGT, GESAGT, GEGLAUBT, ERFAHRUNG; Details in [03-datenmodell.md](03-datenmodell.md)).

Aus der Welt entsteht auf einem **Board** eine **Lage** zu einer Leitfrage. Das Board führt durch Lesen, Prüfen, Entscheiden und Nachhalten. Das Ergebnis jeder Entscheidung wird erfasst und verändert die Welt: Prognose-Treffer der Quellen, Konfidenz der Prämissen, Regel-Statistiken und neue Erfahrungskarten.

KI ist Sparringspartner. Sie liest die Welt über ein strukturiertes Kontextpaket ([04-architektur.md](04-architektur.md)) und schlägt Karten vor. Der Mensch übernimmt oder verwirft.

## Abgrenzung

| Weltenbauer ist kein ... | Weil ... |
|---|---|
| **Chatbot** | Der Chat ist flüchtig und liefert Antworten ohne Struktur. Weltenbauer hält Wissen als Karten fest. Der Chat ist höchstens ein Werkzeug am Rand (KI-Sparring im Board). |
| **Wiki / Notiz-Tool** | Ein Wiki speichert Text. Weltenbauer speichert Aussagen mit Sprecher, Fundstelle, Schicht, Haltung und Beziehungen. Es rechnet damit (Unabhängigkeit, Barometer, Quellenprofil). |
| **Second Brain** | Ein Second Brain sammelt alles und hofft auf Auffindbarkeit. Weltenbauer ist auf Entscheidungen ausgerichtet: Jedes Board hat eine Leitfrage und endet in einer Handlung mit Review. |
| **Fine-Tuning / Memory eines Modells** | Modellgewichte oder anbieterseitiges Gedächtnis binden den Nutzer an einen Anbieter und sind nicht prüfbar. Die Welt liegt als lokale Datei beim Nutzer, ist exportierbar und für jedes Modell lesbar. |

## Der Denkkreislauf

```
   Erfahrung ──► Karte ──► Welt ──► Board ──► Analyse ──► Entscheidung ──► Handlung ──► Ergebnis
       ▲                                                                                  │
       └──────────────────────────────────────────────────────────────────────────────────┘
```

| Schritt | Was passiert | Wo im Produkt |
|---|---|---|
| Erfahrung | Erlebtes, Gehörtes, Gelesenes | Schnellerfassung, Inbox |
| Karte | Typisiertes Element mit Schicht und Herkunft | Karten, Aussagen |
| Welt | Karten in einer Perspektive mit Prämissen | Welt, Seitenleiste "Was deine Welt weiß" |
| Board | Konkrete Lage zu einer Leitfrage | Board, Phasen 1–2 |
| Analyse | Lesen, Prüfen, Widersprüche, Hypothesen | Linsen, Barometer, Phasen 3–4 |
| Entscheidung | Optionen, Begründung, Prognose, Review-Termin | Phase 5 |
| Handlung | Geschieht außerhalb des Systems | – |
| Ergebnis | Review am Termin, Erfahrungskarte | Phase 6, schließt den Kreis |

## Vier Schichten

| Schicht | Inhalt | Dokument |
|---|---|---|
| **1. Persönliche Welt** | Karten, Aussagen, Erfahrungen, Haltungen, Beziehungen, Provenienz. Local-first, Wahrheit ist ein Append-only-Log. | [03](03-datenmodell.md), [04](04-architektur.md) |
| **2. Entscheidungswelt** | Prämissen, Prognosen, Entscheidungen, Regeln, Quellenprofile. Macht aus Wissen überprüfbare Handlung. | [03](03-datenmodell.md), [05](05-roadmap.md) |
| **3. Board / UX** | Leitfrage, Phasen, Linsen, Inbox, KI-Sparring. Der Ort, an dem der Mensch arbeitet. | [02](02-ux-board.md) |
| **4. Plattform** | Später: Teilen einzelner Karten, Signatur, Föderation, gemeinsame Provenienz. Kein zentraler Wahrheitsschiedsrichter. | [04, Abschnitt Plattform](04-architektur.md) |

Die Schichten sind nur hier nummeriert und bauen aufeinander auf. Nicht zu verwechseln mit den epistemischen Schichten (BELEGT/GESAGT/GEGLAUBT), die auf jeder Karte sichtbar sind.

## Leitplanken

- Die Welt gehört dem Nutzer: lokale Datei, jederzeit exportierbar.
- Kein Anbieter-Lock: LLM, Embedding-Modell und Oberfläche sind austauschbar.
- KI schreibt nie in die Welt und setzt nie eine Haltung.
- Es gibt keinen einzelnen Glaubwürdigkeitswert für Quellen, nur ein Profil getrennter Dimensionen.
