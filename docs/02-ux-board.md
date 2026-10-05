# 02 – Board und UX

Das Board ist das Herzstück von Weltenbauer. Hier wird aus der persönlichen Welt (siehe [01-vision.md](01-vision.md)) eine Lage zu einer Leitfrage, und aus der Lage eine Entscheidung. Dieses Dokument beschreibt, was der Mensch sieht und tut. Die zugrunde liegenden Objekte stehen in [03-datenmodell.md](03-datenmodell.md), die technische Umsetzung in [04-architektur.md](04-architektur.md).

Alle Namen, Zahlen, Zitate und Ereignisse in den Szenarien dieses Dokuments sind **erfundene Beispieldaten** zur Illustration. Sie sind keine Fakten, keine Prognose und keine Anlage- oder Kaufberatung.

Inhalt: [Gestaltungsprinzipien](#1-gestaltungsprinzipien) · [Visuelle Grammatik](#2-visuelle-grammatik) · [Bildschirmaufbau](#3-bildschirmaufbau) · [Die sechs Phasen](#4-die-sechs-phasen) · [Linsen](#5-die-vier-linsen) · [Inbox-Triage](#6-inbox-triage) · [KI-Aktionen](#7-ki-aktionen) · [Quellenprofil](#8-quellenprofil-ansicht) · [Schnellerfassung](#9-schnellerfassung) · [Nachhalten](#10-nachhalte--und-review-flow) · [Szenario A](#11-szenario-a-geopolitik-iran-und-die-strasse-von-hormus) · [Szenario B](#12-szenario-b-mallorca-wohnung-x-in-palma) · [Offene UX-Fragen](#13-offene-ux-fragen-für-den-prototyp)

---

## 1. Gestaltungsprinzipien

Jedes Prinzip ist als Prüfregel für Designentscheidungen und für Coding-Agents formuliert.

1. **Schichten nie verschmelzen.** Eine Karte zeigt immer, ob sie BELEGT, GESAGT, GEGLAUBT oder ERFAHRUNG ist. Es gibt keine Ansicht, keinen Zähler und keine KI-Zusammenfassung, die Schichten ohne Aufschlüsselung addiert. Prüfregel: Jede Zahl auf dem Board muss sich per Klick in ihre Schichten zerlegen lassen.
2. **KI schlägt vor, Mensch übernimmt.** Jede KI-Ausgabe erscheint als Geisterkarte (gestrichelt) mit Begründung und den verwendeten Karten. Erst "Übernehmen" macht sie zu einer echten Karte. KI darf nie eine Haltung (GEGLAUBT) setzen. Prüfregel: Es gibt keinen Codepfad, in dem ein Agent eine Karte mit Status `active` anlegt.
3. **Jedes Board hat eine Leitfrage.** Ohne Leitfrage lässt sich ein Board nicht anlegen. Die Leitfrage steht immer sichtbar oben und steuert Vorschläge, Kontextpakete und die Relevanz der Karten. Prüfregel: Ein Board ohne Frage ist ein Fehlerzustand, kein Leerzustand.
4. **Widerspruch ist wertvoll, nicht Fehler.** Widersprüche (zwischen Aussagen, zwischen Aussage und Handlung, zwischen Quelle und mir) werden hervorgehoben und nie automatisch aufgelöst. Sie bekommen ein eigenes Symbol und eine eigene Liste. Prüfregel: Kein "Konflikt beheben"-Button.
5. **Prämissen sind sichtbar und angreifbar.** Die Prämissen der Welt stehen dauerhaft oben. Das Board zeigt, was sie stützt und schwächt. Eine Prämisse darf nie verschwinden, nur weil sie unbequem wird.
6. **Passt es nicht, bleibt es sichtbar.** Informationen, die nicht ins Modell passen, kommen in die Fremdkörper-Ablage. Sie werden nicht verworfen und nicht zwangsweise einsortiert.
7. **Herkunft vor Menge.** Zähler zeigen Ursprünge, nicht Karten: "4 Karten · 1 unabhängiger Ursprung". Die Menge der Karten ist nie ein Argument.
8. **Phasen führen, erzwingen nicht.** Die Phasenleiste zeigt den Arbeitsfluss und den Stand. Der Mensch springt frei zwischen Phasen. Das System weist hin ("Phase 5 ohne Prognose?"), blockiert aber nicht.
9. **Ein Schritt, eine Geste.** Häufige Handlungen (übernehmen, verwerfen, stützt, widerspricht, Prognose markieren) sind Ein-Klick- oder Tastaturaktionen. Texteingabe ist nur nötig, wo der Mensch selbst etwas denken muss (Begründung, Haltung).
10. **Unsicherheit zeigen, nie glätten.** Fehlende Daten zeigen "zu wenig Daten (n=3)" statt einer Zahl. Quellen bekommen Profile, keine Sterne.
11. **Das Board ist eine Linse, keine Kopie.** Dieselben Karten erscheinen in jeder Linse. Positionen sind Layout und verändern keine Inhalte.
12. **Alles ist rückverfolgbar.** Jede Karte, jede Beziehung und jede Haltungsänderung hat Herkunft (wer, wann, womit) und lässt sich im Verlauf ansehen (Append-only-Log, siehe [03](03-datenmodell.md#10-ereignislog)).

## 2. Visuelle Grammatik

### 2.1 Schichten auf der Karte

| Schicht | Rahmen | Marker | Farbe | Pflichtangabe auf der Karte |
|---|---|---|---|---|
| **BELEGT** | durchgezogen, doppelte Linie | Siegel-Icon oben links | neutral (Grau/Schwarz) | Beleg-Link (Quelle + Fundstelle) |
| **GESAGT** | einfach, mit Sprechblasen-Ecke unten links | Avatar und Name des Sprechers | neutral, Sprecherfarbe nur am Avatar | Sprecher, Fundstelle, Datum |
| **GEGLAUBT** | wie die Karte, plus Haltungsstreifen | Konfidenzbalken am unteren Rand | "meine Tinte" (eine persönliche Akzentfarbe, Standard: Tiefblau) | Zustimmung, Konfidenz, Datum |
| **ERFAHRUNG** | einfach, Rand mit Zählpunkten | Zähler "4 von 5" und Ergebnispunkte | eigene Farbe (Grün/Ocker) | Anzahl Versuche, Ergebnisse |
| **Geisterkarte** | gestrichelt, 60 % Deckkraft | Funken-Icon, Begründungszeile | transparent | Begründung + verwendete Karten |
| **Hypothese** (Denkwerkzeug) | gestrichelt, Schraffur | Fragezeichen-Icon | transparent | Werkzeug (z. B. Strategem Nr. 3) |

GEGLAUBT ist keine Eigenschaft der Aussage, sondern eine Auflage darüber. Eine Aussage-Karte (BELEGT oder GESAGT) erhält einen Haltungsstreifen in "meiner Tinte", sobald ich eine Haltung gesetzt habe. Eine Aussage kann also gleichzeitig "gesagt von X" und "von mir zu 70 % geglaubt" sein, und beides ist sichtbar.

```
 BELEGT                  GESAGT                    ERFAHRUNG               GEISTERKARTE
+=======================+ +-----------------------+ +-----------------------+ +- - - - - - - - - - - -+
|[Siegel] AUSSAGE       | | AUSSAGE               | | ERFAHRUNG             | : AUSSAGE (Vorschlag)   :
| "Tankerverkehr -12 %  | | "Wir schliessen die   | | Hedge vor Wahl        | : "..."                 :
|  im Hafen, Okt. 2026" | |  Strasse nicht."      | | * * * * o   4 von 5   | :                        :
| Beleg: Hafenstatistik | |                       | | 2019-2025             | : Warum: stuetzt Praemisse:
|  (Bsp.) S. 4          | +--\ (A) Iran-Sprecher  | |                       | : Basis: 3 Karten        :
+=======================+     12.09.2026          | +-----------------------+ : [Uebernehmen][Verwerfen]:
 [========--] meine Haltung  Podcast 41:20                                    +- - - - - - - - - - - - -+
 Konfidenz 80 %, Zustimmung +1
```

Die Haltung steht unter der Karte in "meiner Tinte" als Balken (Länge = Konfidenz) mit Vorzeichen (Zustimmung −2..+2). Hat eine Karte keine Haltung, fehlt der Balken. Er wird nie mit einem Standardwert gefüllt.

### 2.2 Beziehungen auf der Leinwand

| Beziehungstyp | Linie | Beschriftung |
|---|---|---|
| stützt | durchgezogen, grün, Pfeil | Pfeilspitze zur gestützten Karte |
| widerspricht | durchgezogen, rot, beidseitig | Doppelpfeil |
| stammt-von / zitiert | dünn, grau, Punktpfeil nach "Ursprung" | Provenienzkette |
| Aussage-vs-Handlung | rot, gezackt, Blitz-Symbol in der Mitte | "sagt X, tut Y" |
| Bündnis, Konflikt, Abhängigkeit | Linienstärke = Gewicht, Bündnis blau, Konflikt rot, Abhängigkeit gestrichelt mit Pfeil zum Abhängigen | Spielfeld-Linse |
| beeinflusst, Interesse-an | dünn, Pfeil, Beschriftung | Pfeil vom Akteur zum Gegenstand |

Beziehungen können ebenfalls Geisterbeziehungen sein (gestrichelt). Eine Beziehung kann eine eigene Haltung tragen ("ich glaube die Abhängigkeit zu 60 %").

### 2.3 Abzeichen und Zähler

| Abzeichen | Bedeutung |
|---|---|
| `4 Karten · 1 Ursprung` | Provenienz: Anzahl Karten und Anzahl unabhängiger Ursprungswurzeln |
| Blitz | Aussage-vs-Handlung-Widerspruch |
| Waage | Widerspruch zwischen Karten (Relation `contradicts`) |
| Uhr | Prognose offen, mit Auflösungsdatum |
| Haken / Kreuz / Halb | Prognose eingetreten / nicht eingetreten / teilweise |
| Interessen-Icon | Sprecher hat erkennbares Eigeninteresse am Inhalt (Relation `interest-in`) |
| Zahnrad | Regel greift (Regel-Karte passt auf die Lage) |

## 3. Bildschirmaufbau

```
+------------------------------------------------------------------------------------------------------+
| WELT: Geopolitik & Depot [v]      Stand: heute [v]        [+ Schnellerfassung]                       |
| PRAEMISSEN: [Geopolitik schlaegt Maerkte  ###-- 2 stuetzt / 1 schwaecht] [+2 weitere]                |
| LEITFRAGE: Eskaliert Iran an der Strasse von Hormus in 3 Monaten - und was heisst das fuers Depot?   |
+------------------------------------------------------------------------------------------------------+
| PHASEN: (1)Fragen > (2)Bestuecken > (3)Lesen > (4)Pruefen > (5)Entscheiden > (6)Nachhalten           |
| LINSE:  [Spielfeld]  Zeitachse  Evidenzwand  Entscheidung  Freie Leinwand                            |
+------------------------+--------------------------------------------------+--------------------------+
| WAS DEINE WELT WEISS   | LEINWAND (Linse: Spielfeld)                      | KARTEN-DETAIL            |
| [Welt]  [Inbox (3)]    |                                                  | Aussage   GESAGT         |
| ---------------------- |  +-----------+  Konflikt  +-----------+          | Sprecher: Iran-Minister  |
| Vorschlaege (Geister)  |  | USA       |<==========>| Iran      |          | Fundstelle: Podcast 41:20|
| - - - - - - - - - - -  |  | Zug: ...  |     (Blitz)| Zug: ...  |          | ----------------------   |
| : Akteur Saudi-Arab. : |  +-----------+            +-----------+          | MEINE HALTUNG            |
| : Regel: Oel-Absich. : |        |  Abhaengig            |                 | Zustimmung  [-2..+2]     |
| : Erf.: Oelpreis 2022: |        v                       v                 | Konfidenz   [0..100%]    |
| - - - - - - - - - - -  |  +-----------+            +-----------+          | Begruendung: ________    |
| ---------------------- |  | Saudi-Ar. |            | China     |          | ----------------------   |
| INBOX-TRIAGE           |  | Zone      |            | Zone      |          | Herkunft: 4 Karten,      |
| > Folge 112 (14 Aussg.)|  +-----------+            +-----------+          |   1 unabh. Ursprung      |
| [uebernehm.][verwerfen]|  Zeitachse unten (Zuege, Datum) ........         | ----------------------   |
| [stuetzt][widerspr.]   |  --o-----o-------o---------o----------->         | KI-SPARRING              |
| [Prognose markieren]   |                                                  | [Lage lesen]             |
| ---------------------- |  FREMDKOERPER-ABLAGE                             | [Advocatus Diaboli]      |
| Quellen > Profil       |  [Hafenstreik Dubai] [Satellitenbild ?]          | [Naechster Zug von X?]   |
|                        |  (passt nicht ins Modell, bleibt sichtbar)       | [Was fehlt?]             |
+------------------------+--------------------------------------------------+--------------------------+
| STATUS: Barometer 3 Praemissen | Widersprueche 2 | Offene Prognosen 1 | Geisterkarten 2              |
+------------------------------------------------------------------------------------------------------+
```

*(Sonderzeichen im Wireframe sind aus Layoutgründen ASCII. In der echten UI stehen dort Icons.)*

### 3.1 Bereiche

| Bereich | Position | Inhalt | Immer sichtbar? |
|---|---|---|---|
| **Kopfzeile** | oben | Weltauswahl, Zeitstand ("Stand: heute" oder Snapshot-Datum), Schnellerfassung | ja |
| **Prämissen-Leiste** | oben | Prämissen der Welt als Chips mit Barometer-Mini (gestützt/geschwächt). Klick öffnet die Evidenz der Prämisse. | ja |
| **Leitfrage** | oben, unter den Prämissen | Die Frage des Boards, editierbar. Änderungen erzeugen eine Version, damit der Frageverlauf sichtbar bleibt. | ja |
| **Phasenleiste** | unter dem Kopf | Sechs Phasen, aktuelle markiert, erledigte mit Haken. Rechts davon der Linsen-Umschalter. | ja |
| **Linke Seitenleiste** | links | Zwei Reiter: **Was deine Welt weiß** (Vorschläge als Geisterkarten, nach Relevanz zur Leitfrage) und **Inbox** (neue Informationen zur Triage). Darunter Verknüpfung zu Quellenprofilen. | einklappbar |
| **Leinwand** | Mitte | Karten und Beziehungen in der aktiven Linse. Unten die **Fremdkörper-Ablage** als Streifen. | ja |
| **Rechte Seitenleiste** | rechts | Zwei Reiter: **Karten-Detail** (Inhalt, Schicht, Haltung, Beziehungen, Herkunft, Verlauf) und **KI-Sparring** (Aktionen, Antworten als Geisterkarten). | einklappbar |
| **Statuszeile** | unten | Barometer-Zusammenfassung, Zahl der Widersprüche, offene Prognosen, offene Geisterkarten, anstehende Reviews | ja |

### 3.2 Verhalten

- **Auswahl** einer Karte füllt das Karten-Detail. Das Detail zeigt in fester Reihenfolge: Typ und Schicht, Inhalt, Fundstelle/Sprecher, meine Haltung (bearbeitbar), Beziehungen, Herkunftskette, Verlauf.
- **Ziehen** aus der linken Seitenleiste auf die Leinwand übernimmt eine Geisterkarte und pinnt sie ans Board. Das Pinnen einer bestehenden Karte ist keine Kopie, sondern ein Verweis.
- **Fremdkörper-Ablage:** Karte dorthin ziehen oder Kontextmenü "Passt nicht". Es entsteht eine Markierung am Board-Eintrag (`parked: true`), keine Löschung. Die Ablage zeigt pro Eintrag ein Alter, damit alte Fremdkörper wieder auffallen.
- **Tastatur:** `J/K` nächste/vorige Inbox-Aussage, `Ü` übernehmen, `V` verwerfen, `S` stützt, `W` widerspricht, `P` Prognose markieren, `N` Schnellerfassung.
- **Tablet/Handy:** Seitenleisten werden Schubladen, die Leinwand bleibt einlinsig. Inbox-Triage und Schnellerfassung sind mobil voll nutzbar, die Leinwandbearbeitung ist ab Tablet vorgesehen.

## 4. Die sechs Phasen

Die Phasen sind ein sichtbarer Arbeitsfluss. Das Board merkt sich die aktuelle Phase (`board.phase`), der Mensch darf sie jederzeit wechseln. Pro Phase beschreibt dieser Abschnitt vier Dinge: was der Mensch sieht, was er tut, was das System tut, was im Datenmodell entsteht. Event-Namen verweisen auf [03, Abschnitt Ereignislog](03-datenmodell.md#10-ereignislog).

### Phase 1: Fragen

| | |
|---|---|
| **Was sieht der Mensch** | Leere Leinwand mit einem Eingabefeld für die Leitfrage, Weltauswahl, darunter die Prämissen der gewählten Welt als Chips. Hinweise zu guten Leitfragen ("Eine Frage mit Zeithorizont und Handlung: Was passiert bis wann, und was heißt das für mich?"). |
| **Was tut er** | Formuliert die Leitfrage, wählt die Welt, bestätigt oder pausiert Prämissen für dieses Board, setzt optional einen Zeithorizont (z. B. 3 Monate). |
| **Was macht das System** | Prüft die Leitfrage auf Länge und Fragezeichen, schlägt auf Wunsch zwei Schärfungen als Geisterfragen vor ("Welches Ereignis zählt als Eskalation?"). Berechnet im Hintergrund erste relevante Karten (Embedding-Suche zur Leitfrage) und legt sie als Vorschläge in die linke Seitenleiste. |
| **Was entsteht im Datenmodell** | `Board` mit `guidingQuestion`, `worldId`, `horizon`, `phase: 'ask'`. Events: `BoardCreated`, `GuidingQuestionSet`. Noch keine Karten. |

### Phase 2: Bestücken

| | |
|---|---|
| **Was sieht der Mensch** | Links **Was deine Welt dazu weiß**: Geisterkarten, gruppiert nach Akteure, Aussagen, Erfahrungen, Regeln, frühere Entscheidungen, jeweils mit Kurzbegründung ("passt, weil Akteur Iran in 5 Karten vorkommt"). Reiter **Inbox** mit neuen Informationen (Podcast, Artikel, Notiz, PDF) und deren extrahierten Aussagen. |
| **Was tut er** | Zieht Vorschläge aufs Board oder verwirft sie. Fügt neue Informationen per URL, Transkript, PDF oder Schnellnotiz hinzu und triagiert die extrahierten Aussagen (siehe [Inbox-Triage](#6-inbox-triage)). Legt fehlende Akteure selbst an. |
| **Was macht das System** | Hybride Suche (Embeddings plus Graph-Nachbarschaft plus bereits gepinnte Karten), sortiert nach Relevanz zur Leitfrage. Greifende Regeln werden mit Zahnrad markiert. Der Ingest extrahiert Aussagen mit Sprecher und Zeitstempel und erkennt Duplikate gegenüber bestehenden Karten. |
| **Was entsteht im Datenmodell** | `BoardItem`-Einträge (Verweise auf Karten) im Board. Übernommene Geisterkarten werden `active` (`GhostAccepted`). Neue Quelle: `Source`-Karte, daraus Statement-Karten. Zugehörigkeit zur Welt: `Membership`. Events: `InboxItemIngested`, `CardProposed`, `GhostAccepted`, `GhostDismissed`, `BoardItemPinned`. |

### Phase 3: Lesen (Spielfeld)

| | |
|---|---|
| **Was sieht der Mensch** | Standardlinse Spielfeld: Akteure als Zonen mit **Spielerkarte** (Interessen, Fähigkeiten, Abhängigkeiten, rote Linien). Darunter eine Zeitleiste mit Zügen. Beziehungslinien (Bündnis, Abhängigkeit, Konflikt). Blitz-Symbole an Aussage-vs-Handlung-Widersprüchen. |
| **Was tut er** | Füllt Spielerkarten aus (oder übernimmt Vorschläge dafür), ordnet Züge den Akteuren zu, zieht Beziehungen, markiert Widersprüche, setzt Haltungen zu Aussagen ("glaube ich zu 40 %"). Wechselt in die Zeitachse, um Sagen und Tun gegenüberzustellen. |
| **Was macht das System** | Schlägt Beziehungen und Spielerkarten-Inhalte als Geisterelemente vor (immer mit Fundstelle). Erkennt potenzielle Aussage-vs-Handlung-Paare (gleicher Akteur, Aussage und späterer Zug zum selben Gegenstand) und schlägt sie als Geisterbeziehung vor. Berechnet laufend Provenienz ("4 Karten · 1 Ursprung"). |
| **Was entsteht im Datenmodell** | `Relation`-Einträge (`allied-with`, `in-conflict-with`, `depends-on`, `says-vs-does`, `interest-in`, `influences`), `Event`-Karten für Züge, Updates an Akteur-Karten (`interests`, `capabilities`, `dependencies`, `redLines`), `Stance`-Einträge mit Historie. Events: `CardUpdated`, `RelationAdded`, `StanceSet`. |

### Phase 4: Prüfen

| | |
|---|---|
| **Was sieht der Mensch** | **Prämissen-Barometer**: pro Prämisse und Annahme gestützt/geschwächt, aufgeschlüsselt nach Schicht und Unabhängigkeit. **Evidenzwand** als Linse. **Fremdkörper-Ablage**. KI-Hypothesen (Spieltheorie, 36 Strategeme) als schraffierte Hypothesen-Karten. |
| **Was tut er** | Prüft pro Prämisse die stützenden und schwächenden Karten, verschiebt Karten zwischen den Spalten, markiert Prognosen ("Das ist eine überprüfbare Erwartung"), räumt die Fremdkörper-Ablage auf (einsortieren, Prämisse infrage stellen oder liegen lassen), übernimmt oder verwirft Hypothesen. |
| **Was macht das System** | Berechnet das Barometer (Gewichtung nach Schicht und Unabhängigkeit, Algorithmus in [03, Abschnitt Provenienz](03-datenmodell.md#6-provenienz-und-unabhängigkeit)). Zeigt dazu immer die Rohzahlen. Bietet KI-Aktionen "Advocatus Diaboli" und "Was fehlt?" an. Liefert Hypothesen-Karten mit Werkzeugname, Begründung und verwendeten Karten. |
| **Was entsteht im Datenmodell** | `Relation` vom Typ `supports`/`contradicts` zwischen Karten und Prämissen, `Prediction`-Karten (aus markierten Aussagen), Hypothesen-Karten als `Statement` mit `kind: 'hypothesis'` und Sprecher `tool` (Geister bis zur Übernahme, zählen nicht im Barometer), `parked`-Markierungen. Events: `RelationAdded`, `PredictionMade`, `BoardItemParked`. |

Hinweis: Ein übernommener KI-Vorschlag ist nie GEGLAUBT. Der Mensch muss die Haltung getrennt setzen, siehe Prinzip 2.

### Phase 5: Entscheiden

| | |
|---|---|
| **Was sieht der Mensch** | Linse Entscheidung: Optionen nebeneinander als Spalten. Pro Option verlinkte Pro- und Contra-Karten mit Schicht und Unabhängigkeit. Darüber greifende Regeln (Zahnrad) und ähnliche frühere Entscheidungen. Unten Felder für Auslöser, Bedingungen, Ausschlusskriterien, Prioritäten, eigene Prognose, Review-Datum. |
| **Was tut er** | Legt die Entscheidungskarte aus dem Board an ("Entscheidung aus diesem Board"), definiert Optionen, zieht Pro/Contra-Karten in die Spalten, gewichtet Prioritäten, formuliert die Begründung, wählt eine Option, erfasst seine **eigene Prognose** (mit Wahrscheinlichkeit und Auflösungskriterium) und setzt das Review-Datum. |
| **Was macht das System** | Füllt auf Wunsch Pro/Contra als Geisterkarten vor. Bietet "Was würde ich nach meinen Regeln tun?" (Regeln werden angewandt, Ergebnis ist eine Geister-Empfehlung mit Regelverweisen, keine Entscheidung). Prüft Vollständigkeit: Prognose vorhanden? Review-Datum gesetzt? Ausschlusskriterien gegen gewählte Option geprüft? Hinweise, keine Blockade. Erzeugt einen **Snapshot** des Boards zum Entscheidungszeitpunkt. |
| **Was entsteht im Datenmodell** | `Decision`-Karte (Optionen, gewählte Option, Bedingungen, Ausschlusskriterien, Begründung als Kartenlinks, Prioritäten), `Prediction` (Urheber "ich"), `Snapshot`, geplanter Review (`ReviewScheduled`). Events: `DecisionMade`, `PredictionMade`, `SnapshotTaken`, `ReviewScheduled`. |

### Phase 6: Nachhalten

| | |
|---|---|
| **Was sieht der Mensch** | Am Review-Datum eine Erinnerung (in der App, optional per E-Mail oder Kalendereintrag). Das Review-Board zeigt den Snapshot der Entscheidung neben dem heutigen Stand. Offene Prognosen mit Auflösungsdatum. |
| **Was tut er** | Beantwortet: "Was ist passiert?" Erfasst das Ergebnis je Prognose (eingetreten / nicht / teilweise, mit Notiz und Beleg), bewertet das Entscheidungsergebnis, formuliert eine Lehre in einem Satz, ändert bei Bedarf Haltungen. |
| **Was macht das System** | Aktualisiert Prognose-Treffer der Quellen (Brier-Score), Konfidenz-Vorschlag für Prämissen, Regel-Statistik (Regel angewandt, Treffer/Fehler). Schlägt eine **Erfahrungskarte** als Geister vor. Schlägt vor, eine Regel zu verdichten, wenn sich ein Muster zeigt (ab Phase 3). Zeigt die Differenz "Haltung damals" gegen "Ergebnis". |
| **Was entsteht im Datenmodell** | `PredictionResolved`, `DecisionReviewed` (Ergebnis plus Lehre), `Experience`-Karte (aus Entscheidung), neue `Stance`-Versionen, aktualisierte `SourceProfile`-Projektionen und Regel-Statistik. Der Kreislauf ist geschlossen: Das Ergebnis ist Erfahrung für künftige Boards. |

## 5. Die vier Linsen

Alle Linsen zeigen dieselben Karten und Beziehungen. Sie unterscheiden sich in der räumlichen Grammatik. Die freie Leinwand ist die Basis, auf der der Mensch Karten frei verschieben kann. Jede Linse hat ihr eigenes gespeichertes Layout (siehe `Board.layouts` in [03](03-datenmodell.md#9-board-linse-layout-snapshot)). Beim Wechsel der Linse gehen keine Positionen anderer Linsen verloren.

### 5.1 Spielfeld

Frage: **Wer sind die Spieler, was wollen sie, was können sie, wovon hängen sie ab?**

- Jeder Akteur ist eine Zone mit Spielerkarte. Züge liegen als kleine Karten innerhalb der Zone des handelnden Akteurs.
- Linien zwischen Zonen: Bündnis (blau), Konflikt (rot), Abhängigkeit (gestrichelt, Pfeil zum Abhängigen).
- Aussagen liegen am Zonenrand, Aussage-vs-Handlung-Widersprüche tragen einen Blitz.
- Ein Klick auf die Spielerkarte klappt Interessen, Fähigkeiten, Abhängigkeiten und rote Linien aus.

```
+------------------------------------------------------------------------------+
|  SPIELFELD                                                                   |
|  +--------------------+         Konflikt          +--------------------+     |
|  | USA                |<=========================>| IRAN               |     |
|  | Interessen: ...    |                  (Blitz)  | Interessen: ...    |     |
|  | Rote Linien: ...   |                           | Abhaengig: Exporte |     |
|  | [Zug] [Zug]        |                           | [Zug] [Aussage]    |     |
|  +--------------------+                           +--------------------+     |
|         |  Buendnis                                       ^ Abhaengig        |
|  +--------------------+                           +--------------------+     |
|  | ISRAEL             |                           | CHINA              |     |
|  +--------------------+                           +--------------------+     |
|                        +--------------------+                                |
|                        | SAUDI-ARABIEN      |  (alle Zonen mit Spielerkarte) |
|                        +--------------------+                                |
+------------------------------------------------------------------------------+
```

### 5.2 Zeitachse

Frage: **Was ist wann passiert, und was wurde dazu gesagt?**

- Zwei Spuren: oben **Aussagen** (GESAGT), unten **Handlungen/Züge** (meist BELEGT). Die Spuren sind je Akteur filterbar.
- Eine Aussage-vs-Handlung-Beziehung ist ein roter Bogen mit Blitz zwischen den Spuren.
- Eine senkrechte Linie "Heute" und eine rechts davon liegende "Review/Auflösung" zeigen den Prognosehorizont. Prognosen sind Uhr-Marker.

```
+------------------------------------------------------------------------------+
|  ZEITACHSE   Filter: [alle Akteure v]                          Heute |  Ende |
|                                                                      |  3 Mon|
|  AUSSAGEN  --o-----------o----------------o----------------------   |       |
|            Iran:       USA:             China:                       |       |
|            "keine       "alle Optionen   "Dialog"                    |       |
|             Schliessung" auf dem Tisch"                              |       |
|                 \__ Blitz                                            |       |
|                    \                                                 |       |
|  HANDLUNGEN --------x----------x----------------x---------------     |   (Uhr)
|                 Manoever    Flottenverlegung  Oelkaeufe              |  Prognose
|              12.09.        20.09.            28.09.                  |       |
+------------------------------------------------------------------------------+
```

### 5.3 Evidenzwand

Frage: **Was stützt die Prämisse, was schwächt sie, wie unabhängig ist das jeweils?**

- Oben die Prämisse oder Annahme (eine pro Wand, wechselbar). Links stützende, rechts widersprechende Karten, jeweils nach Schicht gruppiert (BELEGT zuerst).
- Zusammengehörige Karten (gleiche Ursprungswurzel) werden zu einem **Ursprungsstapel** gebündelt: "4 Karten · 1 Ursprung". Ein Stapel zählt im Barometer einmal.
- Unten das Barometer als Zählung (nicht als Urteil).

```
+------------------------------------------------------------------------------+
|  PRAEMISSE: "Geopolitik schlaegt Maerkte"            meine Konfidenz 70 %    |
+--------------------------------------+---------------------------------------+
|  STUETZEND                           |  WIDERSPRECHEND                       |
|  BELEGT                              |  BELEGT                               |
|   [Siegel] Oelpreis +9 % nach ...    |   (leer)                              |
|  GESAGT                              |  GESAGT                               |
|   [Stapel: 4 Karten, 1 Ursprung]     |   [A] Analyst X: "Zentralbank        |
|   [A] Analyst Y: "Risikopraemie..."  |        dominiert, nicht Politik"      |
|  ERFAHRUNG                           |  ERFAHRUNG                            |
|   [3 von 4] Hedge 2022 half          |   [1 von 4] 2024 Eskalation, Markt    |
|                                      |        ohne Reaktion                  |
+--------------------------------------+---------------------------------------+
|  BAROMETER  stuetzend: 3 Ursprung(e) (1 belegt, 1 gesagt, 1 Erfahrung)       |
|             schwaechend: 2 Ursprung(e) (1 gesagt, 1 Erfahrung)               |
|             [Rohzahlen] [Gewichtung aendern]                                 |
+------------------------------------------------------------------------------+
```

### 5.4 Entscheidung

Frage: **Welche Optionen habe ich, was spricht wofür und wogegen, was sagen meine Regeln?**

- Eine Spalte pro Option, mit Pro/Contra-Karten (verlinkt, nicht kopiert) und deren Schicht.
- Oben eine Regelzeile: greifende Regeln mit Zahnrad, ohne Entscheidung abzunehmen.
- Unten das Entscheidungsformular (Auslöser, Bedingungen, Ausschluss, Prognose, Review).

```
+------------------------------------------------------------------------------+
|  ENTSCHEIDUNG   Auslöser: Angebot bis 30.11.                                 |
|  Regeln: [Zahnrad] R1 "Kaufe nur unter 4.000 EUR/m2 ..."  Status: erfuellt   |
+--------------------+--------------------+-------------------+----------------+
|  OPTION A          |  OPTION B          |  OPTION C         |  + Option      |
|  Kaufen, 480 k     |  Verhandeln 450 k  |  Nicht kaufen     |                |
+--------------------+--------------------+-------------------+----------------+
|  PRO               |  PRO               |  PRO              |                |
|   [Karte] [Karte]  |   [Karte]          |   [Karte]         |                |
|  CONTRA            |  CONTRA            |  CONTRA           |                |
|   [Karte]          |   [Karte] [Karte]  |   [Karte]         |                |
+--------------------+--------------------+-------------------+----------------+
|  Gewaehlt: B   Ausschluss: Umlage > 15.000 EUR   Meine Prognose: 50 %        |
|  Review: 30.11.2026                    [Entscheiden und Snapshot anlegen]    |
+------------------------------------------------------------------------------+
```

### 5.5 Freie Leinwand

Basis ohne vorgegebene Struktur. Karten frei platzierbar, Beziehungen als Linien. Dient zum Denken und als Rückfall, wenn keine Linse passt. Die Phasen und alle Seitenleisten funktionieren hier identisch.

## 6. Inbox-Triage

Die Inbox sammelt neue Informationen, bevor sie Teil der Welt werden. Nichts in der Inbox ist Weltwissen.

```
Quelle hinzufuegen (URL / Transkript / PDF / Notiz / Sprachmemo)
        |
        v
Ingest (siehe 04): Text holen -> in Abschnitte teilen -> LLM extrahiert Aussagen
        |            je Aussage: Inhalt, Sprecher, Fundstelle (Zeitstempel/Seite), Datum, Aussageart
        v
Abgleich: Duplikat? Zitiert bekannte Quelle? Sprecher = bekannter Akteur?
        |
        v
INBOX-ITEM "Folge 112 - 14 Aussagen"
        |
        v   pro Aussage eine Schnellaktion (Tastatur: J/K blaettern)
  +-----------------------------------------------------------------+
  | "Wir haben kein Interesse an einer Schliessung."                |
  | Sprecher: Iran-Sprecher (Bsp.)   Podcast 41:20   Datum 12.09.   |
  | Aehnlich: 2 Karten  | Interesse: Sprecher hat Eigeninteresse    |
  |                                                                 |
  | [Uebernehmen] [Verwerfen] [Stuetzt Praemisse v] [Widerspricht v]|
  | [Prognose markieren] [Haltung setzen] [Fremdkoerper]            |
  +-----------------------------------------------------------------+
```

| Aktion | Wirkung | Datenmodell |
|---|---|---|
| **Übernehmen** | Aussage wird aktive GESAGT-Karte der Welt, ohne weitere Verknüpfung. | Status `ghost` → `active`, `Membership` in der Welt |
| **Verwerfen** | Aussage wird verworfen. Die Verwerfung bleibt im Log, damit der Ingest nicht dieselbe Aussage erneut vorschlägt. | `GhostDismissed` |
| **Stützt Prämisse** | Übernehmen plus Beziehung `supports` zur gewählten Prämisse (Dropdown, Standard: die zuletzt gewählte). | Karte, `Relation`, kein `Stance` |
| **Widerspricht** | Übernehmen plus Beziehung `contradicts` zur Prämisse oder einer Karte. | Karte, `Relation` |
| **Prognose markieren** | Übernehmen und Prognose-Karte anlegen: Dialog für Wahrscheinlichkeit (auch Wortskala), Auflösungsdatum, Auflösungskriterium. Urheber ist der Sprecher. | `Prediction`-Karte, `Relation` `derived-from` |
| **Haltung setzen** | Übernehmen und sofort Zustimmung, Konfidenz, Begründung erfassen (optional). | `StanceSet` |
| **Fremdkörper** | Übernehmen und im Board in die Fremdkörper-Ablage legen. | `parked` |

Regeln der Triage:
- Die Triage setzt nie eine Haltung ohne Eingabe des Menschen. "Stützt Prämisse" ist eine Beziehung, keine Zustimmung.
- Ein Item mit offenen Aussagen bleibt in der Inbox, bis alle Aussagen entschieden sind. Eine Sammelaktion "Rest verwerfen" gibt es, aber sie verlangt eine Bestätigung.
- Die Inbox zeigt pro Item die Zahl der Aussagen, wie viele bereits Duplikate sind und welche Sprecher unbekannt sind (Sprecher-Zuordnung ist ebenfalls eine Schnellaktion: "Das ist Akteur Iran").

## 7. KI-Aktionen

Die KI ist **Sparringspartner, nie Orakel**. Sie erreicht die Welt über das Kontextpaket ([04, Kontextpaket](04-architektur.md#7-kontextpaket-pipeline)). Jede Antwort besteht aus Geisterkarten, jede mit Begründung und den verwendeten Karten. Die Antwort enthält nie eine Haltung.

| Aktion | Zweck | Eingabe | Ausgabe (als Geisterkarten) |
|---|---|---|---|
| **Lage lesen** | Zusammenfassung der Lage in der aktiven Linse | Board-Karten, Prämissen, Beziehungen | Eine Zusammenfassung als Text-Geisterkarte, jeder Satz mit Kartenverweisen und Schichtangabe ("laut GESAGT-Karte ..."). Offene Widersprüche als eigene Punkte. |
| **Advocatus Diaboli** | Stärkstes Gegenargument zur aktuellen Haltung oder Prämisse | gewählte Prämisse/Karte plus meine Haltung | Gegenargument-Karten mit Begründung, plus Hinweis, welche Karten der Welt es stützen würden und welche fehlen. |
| **Nächster Zug von X?** | Mögliche Züge eines Akteurs | Spielerkarte von X, Züge, Aussagen, Abhängigkeiten, rote Linien | 2 bis 4 Hypothesen-Karten (je mit Anlass, Voraussetzung, Gegenindiz), optional mit Werkzeug (Spieltheorie, Strategem). Keine Wahrscheinlichkeit, wenn der Mensch keine verlangt. |
| **Was würde ich tun?** | Anwendung meiner Regeln auf die Entscheidung | Entscheidungskarte, greifende Regeln, frühere Entscheidungen | Geister-Empfehlung "Nach Regel R1 und R3: Option B", mit Regelverweisen, Verstößen und Ausnahmen. Kennzeichnet, wo keine Regel greift. |
| **Was fehlt?** | Lücken im Modell | Board, Prämissen, Leitfrage | Geisterkarten vom Typ Frage/Quelle: "Zu Akteur China gibt es keine BELEGT-Karte", "Keine Gegenstimme zur Prämisse", "Prognose ohne Auflösungskriterium". |

Gemeinsame Regeln:
- Eine Geisterkarte zeigt immer: **Warum** (ein Satz), **Basis** (verwendete Karten als Links), **Typ** (Vorschlag/Hypothese/Frage), **Modell** (welches LLM, für Reproduzierbarkeit).
- Eine Geisterkarte, die eine Behauptung über die Welt macht ohne Kartenbasis, wird als "ohne Basis aus Modellwissen" markiert und kann nur als Hypothese übernommen werden, nie als Aussage mit Schicht.
- Der Mensch kann pro Geisterkarte: übernehmen, bearbeiten und übernehmen, verwerfen, "nicht mehr vorschlagen".

## 8. Quellenprofil-Ansicht

Quellen erhalten ein **Profil getrennter Dimensionen**, nie einen einzelnen Glaubwürdigkeitswert. Die Ansicht öffnet sich aus jeder Quellenkarte und aus dem Reiter "Quellen". Berechnung und Brier-Score: [03, SourceProfile](03-datenmodell.md#12-sourceprofile-abgeleitet).

```
+------------------------------------------------------------------------------+
|  QUELLE: Podcast "Lagebild" (Beispiel)            Gast/Autor: Dr. Beispiel   |
+------------------------------------------+-----------------------------------+
|  PROFIL (Radar)                          |  TABELLE                          |
|                                          |  Dimension           Wert    n    |
|            Trefferquote                  |  Trefferquote        62 %    13   |
|                /\                        |  Brier-Score         0,21    13   |
|     Unabh. __/    \__ Themenkompetenz    |  (Referenz 0,25 = Muenzwurf)      |
|           |   \  /   |                   |  Themenkompetenz                  |
|  Qualitaet|    \/    | Uebereinstimmung  |    Geopolitik        70 %    7    |
|           |__ /  \ __|  mit meiner Welt  |    Maerkte           40 %    5    |
|              /    \                      |  Uebereinstimmung    68 %    41   |
|    Wert des Widerspruchs   Abweichung    |  Abweichung          32 %    41   |
|                                          |  Wert d. Widerspruchs 3 von 5  5  |
|  (nicht als Sterne, nicht als Summe)     |  Qualitaet (belegt)  22 %    41   |
|                                          |  Unabhaengigkeit     1,8     41   |
+------------------------------------------+-----------------------------------+
|  Offene Prognosen: 2   Aufgeloeste: 13  [Liste]   Hinweis: n<5 = "zu wenig"  |
+------------------------------------------------------------------------------+
```

Dimensionen:

| Dimension | Frage | Anzeige |
|---|---|---|
| Trefferquote | Wie oft traf eine aufgelöste Prognose zu, wie gut kalibriert (Brier)? | Prozent, Brier-Score, n |
| Themenkompetenz | Treffer je Thema | Tabelle je Thema, n |
| Übereinstimmung mit meiner Welt | Wie oft deckt sich die Quelle mit meiner Haltung? (privat, nur aus meinen Haltungen berechnet) | Prozent, n |
| Abweichung | Wo weicht sie von mir ab? | Liste der Abweichungen, mit Link |
| Wert des Widerspruchs | Wie oft lag die Quelle richtig, wo ich falsch lag? | "3 von 5" mit Liste der Fälle |
| Quellenqualität | Wie oft belegt sie Aussagen (BELEGT) gegenüber bloßem Behaupten (GESAGT)? | Anteil belegt, n |
| Unabhängigkeit | Wie viele eigenständige Ursprünge liefert sie, wie viel ist abgeschrieben? | Verhältnis Ursprünge pro Aussage |

Regeln: Dimensionen mit n < 5 zeigen "zu wenig Daten" statt eines Werts. Jede Zahl ist antippbar und führt zu den zugrunde liegenden Karten. Es gibt keine Sortierung "beste Quelle". Sortiert werden darf nach einer gewählten Dimension.

## 9. Schnellerfassung

Ziel: **Erfahrungen und Notizen mit minimaler Reibung erfassen**, vor allem mobil und per Sprache.

```
 +------------------------+     +------------------------+
 |  Schnellerfassung      |     |  Zugeordnet?           |
 |                        |     |                        |
 |  [ Mikrofon (halten) ] |     |  Typ:  (o) Erfahrung   |
 |                        |     |        ( ) Notiz       |
 |  oder tippen:          |     |        ( ) Aussage von |
 |  +------------------+  |     |            [____]      |
 |  | Heute Verhandlung|  |     |  Welt: Mallorca [v]    |
 |  | mit Maklerin ... |  |     |  Ergebnis: [gut][mix]  |
 |  +------------------+  |     |           [schlecht]   |
 |                        |     |  [Speichern] [Spaeter] |
 |  [Foto/PDF anhaengen]  |     +------------------------+
 |  [Senden an Inbox]     |
 +------------------------+
```

Ablauf:
1. Der Mensch spricht oder tippt, ohne Typ zu wählen. Das Ergebnis landet sofort in der Inbox (nichts geht verloren, auch ohne Klassifikation).
2. Das System schlägt Typ, Welt, beteiligte Akteure und Ergebnis als Geisterfelder vor. Eine Erfahrung wird als solche erkannt, wenn Ich-Form und Ergebnis erkennbar sind ("Ich habe ... gemacht, es hat ...").
3. Bei Erfahrungen erscheint der **Serienvorschlag**: "Gleiche Art Erfahrung gefunden (Verhandlung mit Maklern, 4 frühere). Zur Serie hinzufügen?" Damit entsteht der Zähler "4 von 5".
4. Der Mensch bestätigt mit einem Klick oder verschiebt es auf später. Unklassifizierte Notizen bleiben als Inbox-Items mit Alter sichtbar.

Weitere Eingänge: Teilen-Menü des Handys (URL, Text), Browser-Lesezeichen, Datei in den Inbox-Ordner ziehen, E-Mail-Weiterleitung (optional, später). Alle landen in derselben Inbox.

## 10. Nachhalte- und Review-Flow

Der Review ist der Schritt, der aus Entscheidungen Erfahrung macht. Er soll in unter fünf Minuten erledigt sein.

```
Review-Datum erreicht
        |
        v
Erinnerung:  "Review: 'Kaufe ich Wohnung X?' (Entschieden am 30.11.2026)"
        |
        v
Schritt 1  Was ist passiert?   Freitext + optional Belege (Karten/Quellen)
        |
        v
Schritt 2  Prognosen aufloesen  Liste der offenen Prognosen dieser Entscheidung:
        |                       je Prognose [eingetreten] [nicht] [teilweise] [offen lassen]
        |                       (auch Prognosen anderer Quellen, die am Board markiert waren)
        v
Schritt 3  Ergebnis bewerten    Entscheidung im Rueckblick: [gut] [gemischt] [schlecht] [noch offen]
        |                       Lehre in einem Satz (optional, empfohlen)
        v
Schritt 4  Haltungen anpassen   System zeigt: Praemissen mit neuem Barometer, Karten mit
        |                       "Haltung damals" vs. Ergebnis. Mensch setzt neue Stance (optional)
        v
Schritt 5  Uebernahme           Geisterkarten: Erfahrungskarte, Regelstatistik, Quellenprofil-Updates
                                [Alles uebernehmen] oder einzeln
```

Regeln:
- **Prognosen werden eigenständig aufgelöst.** Läuft das Auflösungsdatum einer Prognose ab, ohne dass ein Ergebnis erfasst ist, erscheint sie in der Statuszeile als überfällig. Sie gilt erst als aufgelöst, wenn der Mensch das Ergebnis erfasst (bei nicht verfügbarer Information: Status `void`, wird nicht in Scores gezählt).
- **Haltung damals bleibt erhalten.** Die Haltungshistorie ist Grundlage des Quellenprofils ("Wert des Widerspruchs") und der Kalibrierung. Eine Haltungsänderung überschreibt nie, sie fügt eine Version hinzu.
- **Der Mensch bewertet seine Entscheidung nach Prozess und Ergebnis getrennt** (Optionsfeld "Gute Entscheidung, schlechtes Ergebnis" ist ausdrücklich möglich).
- **Die Erfahrungskarte** enthält: Situation (Link auf die Entscheidung), was erwartet wurde, was passiert ist, Lehre, Serienbezug. Sie speist künftige Vorschläge ("Erfahrung: 2022 Öl-Absicherung").

## 11. Szenario A: Geopolitik, Iran und die Straße von Hormus

> **Alle Daten in diesem Szenario sind erfunden.** Namen von Sendungen, Gästen, Zitate, Daten, Zahlen und Depotwerte dienen nur der Illustration. Sie beschreiben kein reales Ereignis und sind keine Anlageberatung. Heutiges Datum im Beispiel: 05.10.2026.

**Ausgangslage:** Die Welt "Geopolitik & Depot" existiert bereits mit drei Prämissen:
- P1 "Geopolitik schlägt Märkte" (meine Haltung: Zustimmung +1, Konfidenz 70 %)
- P2 "Staaten handeln nach Interessen, nicht nach Rhetorik" (+2, 80 %)
- P3 "Ölpreisschocks wirken innerhalb von Wochen auf mein Depot" (+1, 55 %)

Das Depot (erfunden): 60 % Welt-ETF, 10 % Energieaktien, 8 % Gold, 22 % Liquidität.

### Schritt 1: Fragen

Der Nutzer legt ein Board an und gibt die Leitfrage ein:

> **Eskaliert Iran an der Straße von Hormus in den nächsten 3 Monaten – und was heißt das für mein Depot?**

Das System schlägt eine Schärfung vor (Geisterfrage): "Was zählt als Eskalation?" Der Nutzer übernimmt eine Definition als Auflösungskriterium für später: *Eskalation = militärischer Zwischenfall mit Schäden oder Toten an Handelsschiffen in der Straße von Hormus laut mindestens zwei unabhängigen Ursprüngen ODER Verkehrsunterbrechung über 24 Stunden.* Horizont: bis 05.01.2027. Die drei Prämissen erscheinen oben in der Prämissen-Leiste.

*Daten:* `Board` mit Leitfrage, `horizon`, Phase `ask`.

### Schritt 2: Bestücken

**Was deine Welt dazu weiß** schlägt als Geisterkarten vor:
- Akteure: USA, Iran, China, Israel, Saudi-Arabien (bereits als Akteure in der Welt angelegt; Saudi-Arabien als Vorschlag mit Begründung "kommt in 3 Karten zu Ölförderung vor").
- Erfahrung: "Ölpreisschock 2022: Absicherung half" (Serie 3 von 4).
- Regel: "Bei Eskalationsmeldungen nicht am ersten Tag handeln" (Trefferstatistik 5 von 6 angewandt).

Der Nutzer zieht Iran, USA, China, Israel auf die Leinwand, nimmt Saudi-Arabien über "Übernehmen" auf und lässt die Erfahrung und die Regel in der Seitenleiste liegen.

**Inbox, Podcast-Ingest:** Er fügt die URL der Folge "Lagebild #112" (erfunden) hinzu. Der Ingest holt das Transkript, extrahiert 14 Aussagen mit Sprecher und Zeitstempel. Zwei Beispiele aus der Inbox:

| # | Aussage (erfunden) | Sprecher | Fundstelle | Hinweis des Systems |
|---|---|---|---|---|
| 3 | "Iran hat kein Interesse an einer Schließung der Meerenge." | Sprecher des iranischen Außenministeriums (Zitat im Podcast) | Podcast 41:20, Aussage vom 12.09.2026 | Sprecher bekannter Akteur: Iran. Zitiert eine Pressekonferenz. |
| 7 | "Eine Eskalation innerhalb von drei Monaten ist sehr wahrscheinlich." | Dr. Beispiel (Gast) | Podcast 58:05 | Verwendet Wahrscheinlichkeitswort "sehr wahrscheinlich". Eigeninteresse: Gast verkauft Beratung zu Energiehedging (Relation `interest-in`, als Geister). |

Triage per Tastatur:
- Aussage 3: **Übernehmen**, Sprecher Iran bestätigt. Beziehung zu P2 bleibt offen.
- Aussage 7: **Prognose markieren.** Dialog: Urheber Dr. Beispiel, Wahrscheinlichkeitswort "sehr wahrscheinlich" wird zu 80 % abgebildet (der Nutzer bestätigt oder ändert), Auflösungsdatum 05.01.2027, Kriterium wie oben. Es entsteht eine `Prediction`-Karte.
- Die weiteren Aussagen: acht verworfen, drei übernommen, eine als **Fremdkörper** markiert: "Streik im Hafen von Dubai" (passt in keine Prämisse).

Der Nutzer sieht außerdem beim Gast-Inhalt: **4 Karten · 1 unabhängiger Ursprung**. Vier Aussagen aus dem Bestand ("Iran schließt die Meerenge nicht") gehen auf denselben Agenturtext zurück (Quelle `Nachrichtenagentur Beispiel`). Sie zählen später im Barometer einmal.

*Daten:* `Source` (Podcast), 14 `Statement`-Karten als Geister, 5 übernommen (`GhostAccepted`), 9 verworfen (`GhostDismissed`), `Prediction` (Autor `source`), `Relation` `cites` von drei Artikeln auf die Agenturmeldung.

### Schritt 3: Lesen (Spielfeld)

Linse Spielfeld. Der Nutzer füllt die **Spielerkarten**:

| Akteur | Interessen | Fähigkeiten | Abhängigkeiten | Rote Linien (Beispiel) |
|---|---|---|---|---|
| Iran | Sanktionslockerung, Ölexporte, regionaler Einfluss | Seeminen, Raketen, Schnellboote | Exporterlöse über Hormus, Käufer China | Angriff auf Kernanlagen, Blockade der Exporthäfen |
| USA | Freie Seewege, Ölpreis niedrig, Verbündete schützen | Flottenpräsenz, Sanktionen | Ölimporte gering, Verbündete abhängig | Tote unter Truppen, vollständige Sperrung |
| China | Energiezufuhr, Absatzmärkte, Einfluss | Handel, UN-Veto | Öl aus der Region (hoch) | Gefährdung eigener Tanker |
| Israel | Abschreckung Irans | Luftwaffe, Geheimdienst | US-Unterstützung | Iranische Atomwaffe |
| Saudi-Arabien | Ölpreis, Sicherheit der Exporte | Förderkapazität, Pipelines | Hormus für Teile der Exporte | Angriff auf Förderanlagen |

Die Beziehungen werden gezogen: USA und Israel Bündnis (blau), Iran und USA Konflikt (rot), China hängt von Iran-Öl ab (gestrichelt, Pfeil zu China), Saudi-Arabien hängt von Hormus ab.

**Aussage-vs-Handlung-Widerspruch:** Wechsel auf die Zeitachse. Spur Aussagen: Iran-Sprecher am 12.09.2026 "kein Interesse an Schließung" (GESAGT). Spur Handlungen: 20.09.2026 Marinemanöver mit Minenlegeübung in der Meerenge, belegt durch Satellitenbild-Auswertung eines Instituts (BELEGT, Beleg-Link zur Quelle, Seite 3). Der Ingest hatte die Paarung als Geisterbeziehung vorgeschlagen, der Nutzer übernimmt sie: **Blitz** zwischen beiden. Er setzt zu Aussage 3 die Haltung: Zustimmung −1, Konfidenz 60 %, Begründung "Manöver spricht dagegen, aber Manöver ist auch Abschreckung."

Die KI-Aktion "Lage lesen" liefert eine Geisterzusammenfassung, jeder Satz mit Kartenverweis und Schichtangabe, zum Beispiel: "Laut GESAGT-Karte (Iran-Sprecher, 12.09.) kein Interesse an Schließung. Gleichzeitig laut BELEGT-Karte (Satellitenauswertung) Minenlegeübung am 20.09. Aussage und Handlung widersprechen sich (Blitz)."

*Daten:* Akteur-Karten aktualisiert, 4 `Relation`-Typen (`allied-with`, `in-conflict-with`, `depends-on`), `Relation` `says-vs-does` zwischen Aussage und Ereignis, `Stance` auf Aussage 3.

### Schritt 4: Prüfen

**Prämissen-Barometer.** Der Nutzer wechselt zur Evidenzwand für P2 "Staaten handeln nach Interessen, nicht nach Rhetorik":
- Stützend: der Widerspruch Aussage-vs-Handlung (der Handlungsteil BELEGT), Erfahrung "2019 Rhetorik und Handeln klafften auseinander" (1 Erfahrungspunkt).
- Schwächend: eine GESAGT-Karte eines Analysten "Iran folgt öffentlichen Ankündigungen meist".
- Barometer: stützend 2 Ursprünge (1 belegt, 1 Erfahrung), schwächend 1 Ursprung (gesagt). Die Rohzahlen und die Gewichtung stehen daneben, ein Gesamturteil gibt es nicht.

**Fremdkörper-Ablage.** "Streik im Hafen von Dubai" liegt dort. Das System fragt bei "Was fehlt?" nach, ob der Streik mit Handelsrouten zusammenhängt. Der Nutzer lässt ihn bewusst liegen und notiert "evtl. relevant für Lieferketten".

**Strategem-Hypothese.** Der Nutzer wählt "Nächster Zug von China?" mit Werkzeug Strategeme. Die KI liefert **Hypothesen-Karten** (gestrichelt, schraffiert):
- "**Möglich:** Strategem Nr. 3 'Mit fremdem Messer töten'. China hält sich zurück und lässt Iran den Druck auf die USA und Saudi-Arabien aufbauen, ohne selbst Position zu beziehen."
  Begründung: China hängt von Iran-Öl ab, äußert sich nicht, USA binden Kräfte. Basis: Spielerkarte China, Beziehung `depends-on`, zwei Aussagen. Gegenindiz (von der KI mitgeliefert): "Chinesische Tanker wären selbst betroffen."
- "**Möglich:** Strategem Nr. 6 'Lärm im Osten, Angriff im Westen'. Das Manöver in der Meerenge lenkt von anderer Aktivität ab." Basis: nur eine Karte, daher Hinweis "dünne Basis".

Der Nutzer übernimmt die erste Hypothese als Hypothese (keine Haltung), verwirft die zweite. Beide bleiben im Barometer unberücksichtigt, weil sie Hypothesen sind. Der **Advocatus Diaboli** auf P1 liefert ein Gegenargument ("Märkte haben vergangene Hormus-Drohungen kaum eingepreist") mit zwei Karten der Welt, die es stützen. Der Nutzer legt dazu eine Haltung an: Zustimmung 0, Konfidenz 40 %.

*Daten:* `Relation` `supports`/`contradicts`, Hypothesen als `Statement`-Karten mit `kind: 'hypothesis'`, `parked`-Markierung, neue `Stance`-Version auf P1 (Historie: 70 % → 60 %).

### Schritt 5: Entscheiden

Aus dem Board entsteht die Entscheidungskarte. Linse Entscheidung, Optionen (erfunden, keine Empfehlung):

| | Option A | Option B | Option C |
|---|---|---|---|
| **Beschreibung** | Depot unverändert lassen | Gold von 8 % auf 12 % erhöhen (aus Liquidität) | Energieaktien von 10 % auf 5 % reduzieren |
| **Pro** | Keine Kosten; Regel "Nicht am ersten Tag handeln" | Gold als Absicherung; Erfahrung 2022 (3 von 4) | Verringert die Ölpreis-Sensitivität des Depots (P3) |
| **Contra** | P3 sagt Auswirkung auf Depot | Liquidität sinkt | Energieaktien würden von Eskalation profitieren |

Der Nutzer wählt **Option B**. Bedingung: Umsetzung gestaffelt in zwei Schritten. Ausschlusskriterium: "Keine Umschichtung, wenn Goldpreis bereits mehr als 15 % über seinem Jahresdurchschnitt." Prioritäten: Verlustbegrenzung vor Rendite.

Die KI-Aktion "Was würde ich nach meinen Regeln tun?" liefert eine Geister-Empfehlung: "Regel R7 'Nicht am ersten Tag handeln' trifft zu: Umsetzung in zwei Schritten ist konform. Keine Regel gegen Gold vorhanden."

**Eigene Prognose** (Urheber: ich): "Es kommt bis 05.01.2027 zu keiner Eskalation nach Definition." Wahrscheinlichkeit für Eskalation: 30 % (also 70 % für Nicht-Eskalation). **Review-Datum:** 05.01.2027. Das System legt einen **Snapshot** an: Board-Stand, Barometer, Haltungen, Quellenbasis zum 05.10.2026.

Im Entscheidungsformular steht die Prognose von Dr. Beispiel (80 % Eskalation) und die des Nutzers (30 %) nebeneinander im Entscheidungsformular. Das ist beabsichtigt: Die Abweichung wird später auswertbar.

*Daten:* `Decision` (Optionen, gewählte B, Bedingungen, Ausschluss, Begründungskarten), `Prediction` (Autor `self`, p=0,30), `Snapshot`, Event `ReviewScheduled`.

### Schritt 6: Nachhalten (am 05.01.2027, erfundenes Ergebnis)

Die Erinnerung erscheint. Der Nutzer erfasst: "Es gab Drohgebärden und zwei Zwischenfälle ohne Schäden. Keine Verkehrsunterbrechung über 24 Stunden." Beide Prognosen werden aufgelöst: **nicht eingetreten** (Kriterium nicht erfüllt).

Das System berechnet (Brier-Score je Prognose, o = 0 für "nicht eingetreten"):
- Dr. Beispiel: p = 0,80, Brier = (0,80 − 0)² = **0,64**. Schlechter als der Münzwurf-Referenzwert 0,25.
- Nutzer: p = 0,30, Brier = (0,30 − 0)² = **0,09**.

Im Quellenprofil von "Lagebild" sinkt die Trefferquote auf 12 von 21 und die Themenkompetenz Geopolitik leicht. Der **Wert des Widerspruchs** steigt nicht: Der Nutzer wich ab (30 % gegen 80 %) und lag richtig, die Quelle lag falsch. Die Entscheidung bewertet der Nutzer als "gemischt": Die Gold-Erhöhung war Absicherung gegen etwas, das nicht eintrat, aber nach seinem Prozess begründet. Die Lehre: "Wahrscheinlichkeitswörter von Quellen mit Beratungsinteresse niedriger gewichten."

Das System schlägt drei Geisterkarten vor: eine **Erfahrungskarte** ("Absicherung gegen Eskalation, gestaffelt, Ergebnis: Kosten gering, Eskalation blieb aus"), eine Serienzuordnung (jetzt "3 von 5" bei Absicherungen, die sich auszahlten), und einen Regel-Update (Regel R7 angewandt: Treffer). Der Nutzer übernimmt alle. P1 erhält einen Konfidenzvorschlag (−5 %), den der Nutzer ablehnt: "Ein Fall genügt nicht." Der Kreislauf ist geschlossen. Die Welt ist erfahrener.

## 12. Szenario B: Mallorca, Wohnung X in Palma

> **Alle Daten in diesem Szenario sind erfunden.** Wohnung, Preise, Personen, Gespräche und Regeln dienen nur der Illustration. Sie sind keine Kaufberatung und keine Marktaussage. Der zweite Nutzer ("Mara") ist ein Ausblick auf die Plattform (Phase 4) und existiert in Phase 1 nicht.

**Ausgangslage:** Die Welt "Immobilien Mallorca" hat zwei Prämissen:
- P1 "Substanz und Gemeinschaftskosten schlagen Lage-Hype" (+2, 75 %)
- P2 "Ich halte mindestens 10 Jahre" (als Annahme, +2, 90 %)

Die Welt enthält Erfahrungskarten, Kontakte und eine Regel:
- **Erfahrung (Serie):** "Kauf ohne Prüfung der Eigentümerprotokolle", Lissabon 2019, Ergebnis: Sonderumlage 12.000 € (schlecht), Zähler 1 von 1 negativ.
- **Erfahrung (Serie):** "Preisverhandlung mit Maklern", 4 Versuche, 2 mal 4 bis 6 % Nachlass (Zähler 2 von 4).
- **Kontakte (Akteure):** Maklerin Carla (Interesse: Provision, Doppelrolle), Anwalt Dr. Beispiel, Bekannter Tom (wohnt in der Nachbarschaft).
- **Regel R1:** *"Kaufe nur unter 4.000 €/m² in Lagen mit ganzjähriger Mietnachfrage und ohne beschlossene oder absehbare Sanierungsumlage, außer die Umlage ist im Preis abgezogen."* Trefferstatistik: angewandt 3, Treffer 2, offen 1.

### Schritt 1: Fragen

Leitfrage: **Kaufe ich Wohnung X in Palma für 480.000 €?** Horizont: Angebotsfrist 30.11.2026. Das Board zeigt oben P1 und P2.

### Schritt 2: Bestücken

Die linke Seitenleiste schlägt vor (Geisterkarten, mit Begründung): Erfahrung Lissabon 2019 ("gleiche Frage: Gemeinschaftskosten"), Regel R1 (Zahnrad: "greift auf Preis pro Quadratmeter"), Akteure Carla, Tom, Dr. Beispiel. Der Nutzer pinnt alle.

Er fügt über Schnellerfassung und Inbox hinzu:
1. **Exposé (PDF)** von Carla: 125 m², 480.000 €, Gemeinschaftskosten 310 €/Monat, "Preise in Santa Catalina steigen jährlich um etwa 8 %".
2. **Sprachmemo** nach der Besichtigung: "Treppenhaus feucht, Fassade sieht älter aus, Tom sagt, die Fassade wird eh gemacht."
3. **Nota simple** (Grundbuchauszug, PDF) von Dr. Beispiel.

Der Ingest extrahiert Aussagen. Die Triage zeigt:

| Aussage | Schicht nach Übernahme | Anmerkung |
|---|---|---|
| "125 m², Baujahr 1974" (Exposé) | GESAGT (Sprecher Carla) | Exposé ist Dokument der Verkäuferseite, kein Beleg. |
| "480.000 € Preis" | GESAGT (Carla) | Angebot, nicht überprüfbar. |
| "Belastung: keine Hypothek eingetragen" (Nota simple) | **BELEGT** (Beleg: Nota simple, S. 2) | Registerauszug. |
| "Preise steigen jährlich um etwa 8 %" | GESAGT (Carla), Interesse-an: Provision | Prognose-Kandidat. |
| "Die Fassade wird eh gemacht" (Memo) | GESAGT (Tom) | Hörensagen über Dritte. Ungeprüft. |
| "Treppenhaus feucht" (Memo) | GESAGT (Sprecher: ich), Art Beobachtung | Eigene Beobachtung ohne Beleg. Mit Foto als Beleg würde sie BELEGT. |

Beim Übernehmen setzt der Nutzer: 8 %-Aussage → **Prognose markieren** (Urheber Carla, Auflösung 30.11.2028, Kriterium "Veröffentlichte Preisstatistik für Santa Catalina zeigt Anstieg ≥ 8 % p. a."), und eine Haltung dazu: Zustimmung −1, Konfidenz 70 %, Begründung "Maklerin hat Eigeninteresse." Provenienz: Die Aussage "Fassade wird gemacht" stammt von Tom, der laut Memo "beim Nachbarn gehört" hat: Kette Tom → Nachbar, **1 Ursprung** (Nachbar, nicht verifizierbar).

### Schritt 3: Lesen

Linse Spielfeld mit Akteuren: Käufer (ich), Verkäufer, Maklerin Carla, Gemeinschaft der Eigentümer, Gemeinde/Stadt (Ortsplanung). Spielerkarten:
- Verkäufer: Interesse Verkauf zu Höchstpreis, Fähigkeit Preis halten, Abhängigkeit keine Eile (unbekannt).
- Carla: Interesse Provision, Fähigkeit Verkäufer lenken, rote Linie unbekannt.
- Gemeinschaft: Interesse Gebäudeerhalt, Fähigkeit Umlagen beschließen.

Zeitachse: "Besichtigung 02.10.", "Eigentümerversammlung 14.11. (noch ausstehend)", "Angebotsfrist 30.11." Ein **Widerspruch** entsteht: Carla sagt mündlich "Die Gemeinschaft ist gesund", das Exposé nennt "Fassadensanierung geplant" ohne Betrag. Beides ist GESAGT, daher Waage-Symbol (`contradicts`) und kein Blitz, weil keine Handlung beteiligt ist. Das Barometer zu P1 zeigt noch kein Material zu Gemeinschaftskosten.

### Schritt 4: Prüfen

Evidenzwand P1 "Substanz und Gemeinschaftskosten schlagen Lage-Hype":
- Stützend: Erfahrung Lissabon (0 von 1: Kauf ohne Prüfung → Umlage), eigene Beobachtung "Treppenhaus feucht".
- Schwächend: Aussage Carla "Lage steigt 8 % jährlich" (GESAGT, Interesse).
- **Was fehlt?** liefert Geisterkarten: "Keine BELEGT-Karte zu beschlossenen Umlagen", "Protokolle der letzten drei Eigentümerversammlungen anfordern", "Keine Gegenstimme zu Carlas Preisentwicklung".

**Regel R1 prüfen:** Das System rechnet: 480.000 € / 125 m² = **3.840 €/m²**, also unter 4.000 €/m² (Bedingung 1 erfüllt). Bedingung "ganzjährige Mietnachfrage": keine Karte vorhanden (offen). Bedingung "keine absehbare Sanierungsumlage": Fassade wird laut Tom gemacht, ungeprüft (nicht erfüllt/unbekannt). Ergebnis in der Regel-Zeile: **"1 von 3 Bedingungen belegt, 1 unbekannt, 1 wahrscheinlich verletzt."**

Hier braucht es kein Strategem. Der Nutzer startet den **Advocatus Diaboli** auf die eigene Neigung zum Kauf. Die KI liefert als Gegenargument die Erfahrung Lissabon und zeigt, dass die Prämisse P1 (Substanz vor Lage) gegen den Kauf spricht, solange Protokolle fehlen.

### Schritt 5: Entscheiden

Optionen:

| | A: Kaufen für 480.000 € | B: Mit Bedingungen verhandeln (450.000 €, Zusage Protokolle) | C: Nicht kaufen |
|---|---|---|---|
| **Pro** | Preis unter 4.000 €/m² (R1, 1 Bedingung); Lage | Regelkonform bei Umlageabzug; Erfahrung "Nachlass 4–6 %" (2 von 4) | Keine Fehlentscheidung bei fehlender Prüfung |
| **Contra** | Umlage-Risiko (Lissabon-Erfahrung); Carla Doppelinteresse | Verkäufer könnte abspringen | Marktchance verpasst (Carla, GESAGT) |

Gewählt: **B**. Bedingungen: Protokolle der letzten drei Eigentümerversammlungen vor Angebot, Betrag der Fassadenumlage geklärt. **Ausschlusskriterium:** beschlossene oder bezifferte Umlage über 15.000 € ohne Preisabzug. Der Mensch setzt die Begründung als Karten-Links (Erfahrung Lissabon, R1-Prüfung, Nota simple).

**Eigene Prognose:** "Verkäufer akzeptiert bis 30.11.2026 einen Preis von höchstens 455.000 €." Wahrscheinlichkeit 45 %. Zweite Prognose: "Es wird keine Sonderumlage über 5.000 € in den ersten 24 Monaten fällig." Wahrscheinlichkeit 60 %. **Review-Datum:** 30.11.2026 (erste), 30.11.2028 (zweite). Snapshot am 05.10.2026.

### Schritt 6: Nachhalten (30.11.2026, erfundenes Ergebnis)

Verkäufer lehnt 455.000 € ab, bietet 468.000 € bei Zusage der Protokolle. Der Nutzer erfasst: Prognose 1 **nicht eingetreten** (Brier (0,45 − 0)² = 0,2025). Die Protokolle zeigen: Fassadenumlage 11.000 € beschlossen, im neuen Preis nicht berücksichtigt. Ausschlusskriterium greift nicht (unter 15.000 €), aber R1-Bedingung "keine Umlage ohne Preisabzug" ist verletzt. Er legt ein Folge-Board mit neuer Entscheidungskarte an und entscheidet sich dort für ein Angebot von 457.000 € nach Abzug der Umlage. Die **Erfahrungskarte** "Protokolle vor Angebot angefordert: hat 11.000 € Umlage sichtbar gemacht" (Serie "Protokolle prüfen", jetzt 2 von 2 hilfreich) wird übernommen. Die Regel R1 erhält eine Verfeinerung als Vorschlag: "Umlage immer vom Preis abziehen." Carlas 8-%-Prognose bleibt offen bis 2028.

### Ausblick: Austausch mit einem zweiten Nutzer (Phase 4)

Mara, eine Bekannte des Nutzers, hat in derselben Gemeinschaft 2024 eine Wohnung gekauft. Beide nutzen Weltenbauer. **Dieser Abschnitt beschreibt Phase 4, er ist in Phase 1 nicht umgesetzt.**

1. Der Nutzer teilt kartenweise: die Karte "Nota simple" und die Karte "Aussage Carla: Preise steigen 8 %". Seine Haltungen dazu bleiben privat.
2. Mara teilt ihre Erfahrungskarte "Fassadenumlage 2024: 9.800 € in der Gemeinschaft" (signiert, mit eigenem Beleg: Protokoll). Ihre Konfidenz und Notizen bleiben privat.
3. Beim Import prüft das System die Inhaltsadresse: Maras Nota simple hat denselben Hash wie die des Nutzers. Das System erkennt "gleiche Quelle" und zählt sie als **einen** Ursprung. Maras Erfahrung ist ein eigener Ursprung (Zeuge: Mara).
4. Die Karte "Fassadenumlage 2024" erscheint beim Nutzer als **GESAGT (Sprecher: Mara)** mit Beleg-Link auf ihre Karte, markiert "Erfahrung von Mara". Er setzt eine eigene Haltung ("Zustimmung +2, Konfidenz 85 %, kenne Mara, Protokoll liegt bei").
5. Die Barometer-Anzeige: "2 unabhängige Ursprünge (ich, Mara) für Umlage in dieser Gemeinschaft".
6. Maras Haltung zu Carlas Aussage bleibt für den Nutzer unsichtbar, außer Mara teilt sie bewusst.

Vollständige Mechanik: [04, Plattform-Ausblick](04-architektur.md#10-plattform-ausblick).

## 13. Offene UX-Fragen für den Prototyp

Diese Fragen soll der Klick-Prototyp ([prototype/board.html](../prototype/board.html)) mit den beiden Szenarien beantworten. Sie sind Prüfaufgaben, keine Owner-Entscheidungen (die stehen in [05](05-roadmap.md#4-offene-owner-entscheidungen)).

1. Tragen Spielerkarten die Spielfeld-Linse, oder braucht es eine Akteursseite?
2. Ist das Barometer als Zählung (Ursprünge je Schicht) verständlich ohne Gesamtwert?
3. Reicht die Ein-Klick-Triage für 14 Aussagen in unter fünf Minuten?
4. Wird die Trennung "Beziehung stützt" und "Haltung glaube ich" in der Triage verstanden?
5. Wie viel Layout pro Linse wird tatsächlich manuell gepflegt?
