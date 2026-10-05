# 03 – Datenmodell

Dieses Dokument definiert alle Entitäten als TypeScript-Interfaces. Es ist die Vorlage für `packages/core` (Typen plus zod-Schemas, siehe [04-architektur.md](04-architektur.md#3-monorepo-struktur)). Die UX, die diese Objekte erzeugt, steht in [02-ux-board.md](02-ux-board.md).

Inhalt: [1 Grundregeln](#1-grundregeln) · [2 Gemeinsame Typen](#2-gemeinsame-typen) · [3 Card](#3-card-basis) · [4 Kartentypen](#4-kartentypen-schemata) · [5 Aussage, Haltung, Erfahrung](#5-aussage-haltung-stance-und-erfahrung) · [6 Provenienz](#6-provenienz-und-unabhängigkeit) · [7 Relation](#7-relation) · [8 Welt](#8-welt-mitgliedschaft-prämisse) · [9 Board](#9-board-linse-layout-snapshot) · [10 Ereignislog](#10-ereignislog) · [11 Prognose, Entscheidung, Regel](#11-prognose-entscheidung-regel) · [12 SourceProfile](#12-sourceprofile-abgeleitet) · [13 Beispiel](#13-kompaktes-beispiel-als-json) · [14 Invarianten](#14-invarianten)

## 1. Grundregeln

1. **Wahrheit ist das Ereignislog** (Abschnitt 10). Alle hier beschriebenen Objekte sind Projektionen daraus, gespeichert in materialisierten Tabellen. Ein Objekt ändert sich nur, indem ein Ereignis angehängt wird.
2. **IDs sind ULIDs** (26 Zeichen, zeitlich sortierbar, global eindeutig ohne Zentrale). Jede Entität hat eine ID. Es gibt keine Autoinkrement-IDs.
3. **Jede Entität trägt `origin`, `author` und `visibility`** (Typ `Authorship`). In Phase 1 sind das Pflichtfelder mit einem Nutzer, sie werden aber so befüllt, dass die Plattform (Phase 4) ohne Migration anschließt.
4. **Schichten bleiben getrennt.** BELEGT und GESAGT sind Eigenschaften einer Aussage (abgeleitet aus ihren Feldern). GEGLAUBT ist ein eigenes Objekt (`Stance`). ERFAHRUNG ist ein eigener Kartentyp. Es gibt kein Feld, das diese Ebenen mischt.
5. **Abgeleitete Werte werden nicht von Hand gespeichert.** Schicht, Unabhängigkeit, Barometer, Quellenprofil und Regelstatistik sind berechnete Sichten (mit Cache in Projektionen).
6. **KI-Objekte sind Geister**, bis ein Mensch sie übernimmt (`status: 'ghost'`).

Hinweis zur Zählung der Ebenen: Die Produktsprache kennt **drei epistemische Schichten** (BELEGT, GESAGT, GEGLAUBT) und **Erfahrung als eigene Evidenzart**. Im Kontextpaket ([04](04-architektur.md#7-kontextpaket-pipeline)) tragen Evidenzeinträge deshalb `layer: 'BELEGT' | 'GESAGT' | 'ERFAHRUNG'`, und die Haltung steht als eigenes Feld `myStance` (GEGLAUBT) daneben.

## 2. Gemeinsame Typen

```ts
export type ULID = string;            // 26 Zeichen Crockford-Base32, z. B. "01JBM9S346Q3D25VT4F5V37E3S"
export type ISODateTime = string;     // "2026-10-05T08:30:00Z"
export type ISODate = string;         // "2026-10-05"

/** Ungenaue Zeitangaben: Aussagen kennen oft nur den Monat. */
export interface FuzzyDate {
  value: ISODate | ISODateTime;
  precision: 'year' | 'month' | 'day' | 'datetime';
}

/** Wie ein Objekt in die Welt kam. */
export type Origin =
  | 'human'      // vom Menschen angelegt oder bearbeitet
  | 'ai'         // von einem LLM erzeugt (Ingest, Sparring), nur als Geist
  | 'agent'      // von einem externen Agenten über MCP vorgeschlagen
  | 'import'     // aus Datei/Export importiert
  | 'federated'; // von einem anderen Nutzer geteilt (Phase 4)

/** Wer es erzeugt hat. Nutzer-ID in Phase 1 lokal, in Phase 4 ein öffentlicher Schlüssel. */
export interface AuthorRef {
  kind: 'user' | 'agent' | 'model' | 'remote';
  id: string;                 // user: ULID | agent: Name | model: z. B. "claude-sonnet" | remote: Public-Key-Fingerprint
  label?: string;
}

export type Visibility =
  | 'private'   // nur ich (Standard für alles, immer für Stance)
  | 'world'     // in einer geteilten Welt sichtbar (Phase 4)
  | 'shared'    // an benannte Personen freigegeben (Phase 4)
  | 'public';   // öffentlich (Phase 4)

export interface Authorship {
  origin: Origin;
  author: AuthorRef;
  visibility: Visibility;
}

/** Plattform-Felder, in Phase 1 leer, aber im Schema vorhanden. */
export interface Federation {
  contentHash?: string;       // SHA-256 über kanonische Inhaltsfelder (Abschnitt 6 und 04)
  signature?: string;         // Signatur des Autors über contentHash
  remote?: { authorKey: string; originalId: ULID; receivedAt: ISODateTime };
}

export interface Timestamps { createdAt: ISODateTime; updatedAt: ISODateTime }
```

## 3. Card (Basis)

Eine Karte ist ein typisiertes Element. Der Typ bestimmt das Schema von `data`.

```ts
export type BuiltinCardType =
  | 'actor' | 'event' | 'statement' | 'source' | 'experience'
  | 'premise' | 'prediction' | 'decision' | 'rule' | 'topic';

export type CardType = BuiltinCardType | `custom:${string}`; // erweiterbar, siehe CardTypeDefinition

export type CardStatus =
  | 'ghost'      // KI-/Agenten-Vorschlag, noch nicht Teil der Welt
  | 'active'
  | 'archived';  // nicht gelöscht, aus Vorschlägen ausgeblendet

export interface CardBase<T extends CardType, D> extends Authorship, Federation, Timestamps {
  id: ULID;
  type: T;
  title: string;               // Kurzname, <= 120 Zeichen
  summary?: string;            // optional, Markdown
  data: D;                     // Schema abhängig vom Typ (Abschnitt 4, 5, 11)
  status: CardStatus;
  topicIds: ULID[];            // Verweise auf Topic-Karten
  tags: string[];
  ghost?: GhostMeta;           // nur wenn status === 'ghost'
  schemaVersion: number;       // Version des Typ-Schemas
}

export interface GhostMeta {
  reason: string;              // "Warum schlage ich das vor?" (Pflicht)
  basisCardIds: ULID[];        // verwendete Karten (Pflicht, darf leer sein = "ohne Basis aus Modellwissen")
  proposedBy: AuthorRef;
  proposedAt: ISODateTime;
  model?: string;              // verwendetes LLM
  targetBoardId?: ULID;        // Board, in dem der Vorschlag entstand
  dismissedAt?: ISODateTime;   // Verwerfung bleibt im Log (kein erneutes Vorschlagen)
}

export type Card =
  | CardBase<'actor', ActorData>
  | CardBase<'event', EventData>
  | CardBase<'statement', StatementData>
  | CardBase<'source', SourceData>
  | CardBase<'experience', ExperienceData>
  | CardBase<'premise', PremiseData>
  | CardBase<'prediction', PredictionData>
  | CardBase<'decision', DecisionData>
  | CardBase<'rule', RuleData>
  | CardBase<'topic', TopicData>
  | CardBase<`custom:${string}`, Record<string, unknown>>;

/** Erweiterbarkeit: Nutzer können eigene Kartentypen definieren. */
export interface CardTypeDefinition {
  type: CardType;
  label: string;                         // "Akteur"
  icon: string;
  schemaVersion: number;
  schema: unknown;                       // zod-Schema (Laufzeit), serialisiert als JSON-Schema im Export
  fields: FieldHint[];                   // Anzeige- und Formularhinweise
  allowedRelations?: RelationType[];     // Einschränkung, optional
  builtin: boolean;
}

export interface FieldHint {
  key: string;
  label: string;
  widget: 'text' | 'markdown' | 'select' | 'number' | 'date' | 'cardRef' | 'cardRefList' | 'list';
  required?: boolean;
  options?: string[];
}
```

## 4. Kartentypen (Schemata)

Hier die einfachen Typen. Aussage, Haltung und Erfahrung stehen in Abschnitt 5, Prognose, Entscheidung und Regel in Abschnitt 11.

### 4.1 Akteur

```ts
export interface ActorData {
  kind: 'person' | 'state' | 'organization' | 'group' | 'other';
  aliases: string[];
  /** Spielerkarte (Board-Phase 3) */
  interests: PlayerEntry[];       // was der Akteur will
  capabilities: PlayerEntry[];    // was der Akteur kann
  dependencies: PlayerEntry[];    // wovon er abhängt
  redLines: PlayerEntry[];        // was er nicht hinnimmt
  notes?: string;
}

/** Jeder Eintrag der Spielerkarte ist belegbar. */
export interface PlayerEntry {
  id: ULID;
  text: string;
  basisCardIds: ULID[];           // Aussagen/Quellen, aus denen das folgt (leer = eigene Einschätzung)
  targetCardId?: ULID;            // z. B. Abhängigkeit von Akteur oder Gegenstand
  weight?: 1 | 2 | 3 | 4 | 5;
}
```

Eigene Einschätzungen in der Spielerkarte ("China hängt stark vom Iran-Öl ab") sind Haltung, nicht Beleg. Die Oberfläche markiert Einträge ohne `basisCardIds` in "meiner Tinte".

### 4.2 Ereignis / Zug

```ts
export interface EventData {
  kind: 'move' | 'occurrence';       // move: ein Akteur handelt, occurrence: es geschieht etwas
  occurredAt: FuzzyDate;
  endedAt?: FuzzyDate;
  actors: { actorId: ULID; role: 'agent' | 'target' | 'affected' | 'observer' }[];
  isAction: true;                    // Ereignisse sind Handlungen, nicht Aussagen (Aussagen sind Statements)
  evidence: Evidence[];              // wenn nicht leer: Ereignis ist BELEGT
  location?: string;
}
```

### 4.3 Quelle

```ts
export type SourceKind =
  | 'podcast' | 'video' | 'article' | 'book' | 'paper'
  | 'document'      // Dokument/Original (Vertrag, Auszug, Pressemitteilung)
  | 'dataset'       // Daten
  | 'registry'      // Register-/Amtsauszug
  | 'recording'     // Originalaufnahme
  | 'person'        // mündliche Quelle
  | 'institution'
  | 'note';         // eigene Notiz

export interface SourceData {
  kind: SourceKind;
  url?: string;
  publisher?: string;
  authorActorId?: ULID;              // Autor/Host als Akteur
  publishedAt?: FuzzyDate;
  /** Lokale Kopie: Inhalt per Hash adressiert (Datei liegt im Blob-Store neben der SQLite-Datei). */
  blob?: { sha256: string; mime: string; bytes: number; textSha256?: string };
  transcript?: { language: string; hasTimestamps: boolean };
  /** Für Provenienz: ein Beleg-fähiges Original? (document, dataset, registry, recording) */
  isPrimaryMaterial: boolean;
}

/** Fundstelle in einer Quelle. */
export interface Locator {
  kind: 'timestamp' | 'page' | 'paragraph' | 'url-fragment' | 'row';
  value: string;                      // "41:20" | "S. 4" | "#abschnitt-3" | "Zeile 118"
}

/** Ein Beleg zeigt auf Original-Material. Nicht leer = BELEGT. */
export interface Evidence {
  sourceId: ULID;                     // Source-Karte mit isPrimaryMaterial === true
  locator: Locator;
  note?: string;
}
```

### 4.4 Prämisse / Annahme

```ts
export interface PremiseData {
  text: string;                       // "Geopolitik schlägt Märkte"
  kind: 'premise' | 'assumption';     // Prämisse: Grundsatz der Welt. Annahme: für ein Board.
  /** Welche Aussage ist, was ich glaube, steht in Stance, nicht hier. */
}
```

Prämissen stehen in `World.premises` (Abschnitt 8). Ihr Barometer ist abgeleitet (Abschnitt 6.4), die Konfidenz in meiner Haltung ist eine `Stance` auf der Prämissen-Karte.

### 4.5 Thema

```ts
export interface TopicData {
  name: string;                       // "Geopolitik", "Immobilien Mallorca"
  parentTopicId?: ULID;
}
```

Themen dienen der Quellenprofil-Dimension "Themenkompetenz" und der Filterung.

## 5. Aussage, Haltung (Stance) und Erfahrung

### 5.1 Aussage (Statement), das Atom des Wissens

```ts
export type StatementKind =
  | 'claim'          // Behauptung über die Welt
  | 'announcement'   // Ankündigung/Absichtserklärung
  | 'forecast'       // enthält eine Erwartung (Kandidat für Prediction)
  | 'observation'    // eigene Beobachtung (Sprecher: ich)
  | 'hypothesis';    // KI-/Werkzeug-Hypothese (zählt nicht im Barometer)

export type Speaker =
  | { kind: 'actor'; cardId: ULID }
  | { kind: 'source'; cardId: ULID }          // z. B. Zeitung als Sprecher
  | { kind: 'self' }                          // ich selbst, als Beobachter oder Zeuge (keine Haltung!)
  | { kind: 'tool'; tool: string; model?: string }; // Denkwerkzeug, z. B. "strategem:3"

export interface StatementData {
  content: string;                  // Inhalt, eine Behauptung pro Karte
  kind: StatementKind;
  speaker: Speaker;                 // Pflicht
  citation: Citation | null;        // Fundstelle: Pflicht, außer speaker.kind in ['self','tool']
  statedAt: FuzzyDate;              // wann gesagt
  evidence: Evidence[];             // Beleg-Links; nicht leer => Schicht BELEGT
  verbatim: boolean;                // wörtliches Zitat oder sinngemäß
  language?: string;
  extraction?: { model: string; chunkRef: string; confidence?: number }; // wenn aus Ingest
}

export interface Citation {
  sourceId: ULID;                   // Quelle, in der die Aussage gefunden wurde
  locator: Locator;
}
```

**Schicht ableiten (`layerOf`)**

| Bedingung | Schicht |
|---|---|
| `evidence.length > 0` und jeder Beleg zeigt auf `isPrimaryMaterial` | BELEGT |
| sonst, Sprecher und Fundstelle vorhanden | GESAGT |
| `speaker.kind === 'self'` ohne Beleg | GESAGT (Sprecher "ich", Anzeige "Eigene Beobachtung") |
| `kind === 'hypothesis'` | GESAGT mit Hypothesen-Markierung, nie im Barometer |

BELEGT sagt: Es gibt ein Original, auf das man zeigen kann. Es sagt nicht, dass der Inhalt wahr ist. GEGLAUBT ist keine Schicht der Aussage, sondern die separate `Stance` (5.2).

### 5.2 Haltung (Stance), GEGLAUBT

```ts
export type Agreement = -2 | -1 | 0 | 1 | 2;   // -2 lehne klar ab ... +2 stimme klar zu

export interface Stance extends Federation {
  id: ULID;
  target: { kind: 'card' | 'relation'; id: ULID };
  ownerId: ULID;                    // Nutzer; Haltungen gehören immer einem Menschen
  agreement: Agreement;             // Zustimmung
  confidence: number;               // 0..100 (Prozent): wie sicher bin ich mir
  weight: 1 | 2 | 3 | 4 | 5;        // Relevanz dieser Karte für meine Lage (Standard 3)
  rationale: string;                // Begründung (darf leer sein, wird aber im UI erfragt)
  setAt: ISODateTime;
  supersedes: ULID | null;          // Vorgänger-Stance => Historie als verkettete Liste
  origin: 'human';                  // Typ erzwingt: nur der Mensch setzt Haltungen
  visibility: 'private' | 'shared'; // Standard 'private'; 'shared' nur bewusst, einzeln
  boardId?: ULID;                   // Board, in dem die Haltung gesetzt wurde (Kontext)
}
```

Regeln:
- **Nur `origin: 'human'`.** Die Validierung in `packages/core` und jeder Schreibpfad lehnen Stances mit anderem Ursprung ab. Auch ein Agent mit Nutzerrechten kann keine Stance setzen (siehe [04, Sicherheitsregel](04-architektur.md#6-mcp-server)).
- **Versioniert.** Eine Änderung erzeugt eine neue Stance mit `supersedes` auf die vorige. Die aktuelle Haltung ist die Stance ohne Nachfolger. Die Historie ist Grundlage für Kalibrierung und "Wert des Widerspruchs".
- **Zustimmung und Konfidenz sind getrennt** (Empfehlung zur offenen Entscheidung 4, siehe [05](05-roadmap.md#4-offene-owner-entscheidungen)): Zustimmung = Richtung und Stärke ("−1: eher falsch"), Konfidenz = Sicherheit des Urteils. Eine Haltung "0 bei 90 %" heißt "sicher unentschieden".
- Haltungen auf Prämissen und Beziehungen sind erlaubt (`target.kind: 'relation'`).

### 5.3 Erfahrung (Experience)

Erfahrung ist eigene Evidenzart: "Ich habe X getan, es ging so aus". Sie ist weder GESAGT noch BELEGT, sondern erlebt. Zähler fassen gleichartige Erfahrungen zu einer Serie zusammen.

```ts
export type ExperienceOutcome = 'worked' | 'failed' | 'mixed' | 'open';

export interface ExperienceData {
  what: string;                     // "Verhandlung mit Makler, Anker 6 % unter Angebot"
  situation: string;                // Kontext
  period: { from: FuzzyDate; to?: FuzzyDate };
  outcome: ExperienceOutcome;
  count: number;                    // wie oft (Standard 1; "5x" bei gebündelter Erfassung)
  successes: number;                // davon geglückt (0..count)
  seriesId: ULID | null;            // Serie, zu der sie zählt
  lesson?: string;
  evidence?: Evidence[];            // optional: Belege zur Erfahrung (Fotos, Belege)
  linkedCardIds: ULID[];            // Entscheidung, Akteure, Themen
  fromDecisionId?: ULID;            // wenn aus einem Review entstanden
}

/** Serie: gleichartige Erfahrungen. Die Zähler sind abgeleitet. */
export interface ExperienceSeries extends Authorship, Timestamps {
  id: ULID;
  name: string;                     // "Preisverhandlung mit Maklern"
  topicIds: ULID[];
  // abgeleitet (Projektion): tries = Σ count, successes = Σ successes, "2 von 4"
}
```

Eine Erfahrung, die auf einer Entscheidung beruht, erzeugt der Review-Flow (siehe [02, Abschnitt 10](02-ux-board.md#10-nachhalte--und-review-flow)).

## 6. Provenienz und Unabhängigkeit

### 6.1 Idee

Viele Karten gehen auf dieselbe Wurzel zurück. Fünf Artikel, die dieselbe Agenturmeldung abschreiben, sind ein Ursprung. Unabhängigkeit ist die Zahl **verschiedener Ursprungswurzeln**. Die UI zeigt: "4 Karten · 1 unabhängiger Ursprung".

### 6.2 Kanten und Wurzeln

Provenienz läuft über Relationen vom Typ `cites` (Richtung: abgeleitet → Original, siehe Abschnitt 7). Zusätzlich verweist jede Aussage über `citation.sourceId` auf ihre Fundquelle, und Quellen können einander zitieren.

```ts
/** Eltern eines Knotens in der Provenienzkette. Leer => Knoten ist ein Blatt (Wurzelkandidat). */
function parents(n: Card, g: Graph): Card[] {
  const explicit = g.outgoing(n.id, 'cites').map(r => g.card(r.to));
  if (explicit.length) return explicit;                     // ausdrückliche Herkunft schlägt Fundstelle
  if (n.type === 'statement' && n.data.citation) return [g.card(n.data.citation.sourceId)];
  return [];
}
```

### 6.3 Algorithmus-Skizze

```ts
type RootKey = string;

/** Schlüssel einer Ursprungswurzel. Gleiche Schlüssel = gleicher Ursprung. */
function rootKey(leaf: Card, firstStatement: StatementCard): RootKey {
  if (leaf.type === 'source') {
    const s = leaf.data;
    // Originalmaterial: nach Inhalt identifiziert (Hash), auch über Nutzergrenzen hinweg (Phase 4)
    if (s.isPrimaryMaterial) return `doc:${s.blob?.sha256 ?? leaf.id}`;
    // Medium (Podcast, Artikel, Video ...) ist nur Träger: der Sprecher der Ursprungsaussage ist die Wurzel
    const sp = firstStatement.data.speaker;
    if (sp.kind === 'actor' || sp.kind === 'source') return `speaker:${sp.cardId}`;
    return `src:${leaf.id}`;
  }
  if (leaf.type === 'statement') {
    const sp = leaf.data.speaker;
    if (sp.kind === 'self') return `self:${leaf.id}`;       // eigene Beobachtung: eigener Ursprung
    if (sp.kind === 'tool') return `tool:${sp.tool}`;
    return `speaker:${sp.cardId}`;
  }
  if (leaf.type === 'experience') return `exp:${leaf.id}`;  // jede Erfahrung ist ein eigener Zeuge
  return `card:${leaf.id}`;
}

/** Wurzeln einer Karte. Zyklen werden erkannt und zu einer Wurzel zusammengefasst. */
function originRoots(start: StatementCard | ExperienceCard, g: Graph): Set<RootKey> {
  const roots = new Set<RootKey>();
  const visited = new Set<ULID>();
  const stack: Card[] = [start];
  while (stack.length) {
    const n = stack.pop()!;
    if (visited.has(n.id)) continue;                       // Zyklenschutz
    visited.add(n.id);
    const ps = parents(n, g);
    if (ps.length === 0) roots.add(rootKey(n, start as StatementCard));
    else stack.push(...ps);
  }
  if (roots.size === 0) {                                  // reiner Zyklus: eine gemeinsame Wurzel
    roots.add(`cycle:${[...visited].sort()[0]}`);
  }
  return roots;
}

export interface IndependenceResult {
  cards: number;                                           // Zahl der Karten
  roots: number;                                           // Zahl unterschiedlicher Wurzeln
  groups: Map<RootKey, ULID[]>;                            // Ursprungsstapel: Wurzel -> Karten
  unknownOrigin: ULID[];                                   // Karten ohne Fundstelle (zählen je als eigene Wurzel, aber markiert)
}

export function independence(cardIds: ULID[], g: Graph): IndependenceResult {
  const groups = new Map<RootKey, ULID[]>();
  for (const id of cardIds) {
    for (const k of originRoots(g.card(id), g)) {
      groups.set(k, [...(groups.get(k) ?? []), id]);
    }
  }
  return { cards: cardIds.length, roots: groups.size, groups, unknownOrigin: findUnknown(cardIds, g) };
}
```

Festlegungen:
- Eine Karte mit mehreren Wurzeln (kombiniert zwei Originale) trägt zu jeder Wurzel bei.
- Mehrere Aussagen desselben Sprechers (auch in verschiedenen Medien) sind **ein** Ursprung. Verschiedene Medien erhöhen die Unabhängigkeit nicht, wenn alle denselben Akteur zitieren.
- Dasselbe Originaldokument (gleicher Hash) ist **ein** Ursprung, auch wenn mehrere Karten darauf zeigen.
- Unbekannte Herkunft (keine Fundstelle) wird nicht stillschweigend zusammengelegt, sondern als eigene Wurzel gezählt und in `unknownOrigin` markiert. Die UI zeigt dort "Herkunft ungeklärt", damit die Unabhängigkeit nicht überschätzt wird.
- Die Berechnung ist deterministisch und cachebar (Projektion `provenance_roots`, Invalidierung bei neuen `cites`-Relationen).

### 6.4 Prämissen-Barometer (Gewichtung)

Das Barometer zählt Ursprünge, nicht Karten, getrennt nach stützend und schwächend, und gewichtet nach Schicht.

```ts
export const LAYER_WEIGHT = {            // Standardwerte, in den Einstellungen änderbar, nie versteckt
  BELEGT: 1.0,
  ERFAHRUNG: 0.8,
  GESAGT: 0.4,
} as const;

export interface BarometerSide {
  roots: number;                         // Zahl unabhängiger Ursprünge
  byLayer: { BELEGT: number; ERFAHRUNG: number; GESAGT: number };
  weighted: number;                      // Σ Gewicht der stärksten Schicht je Wurzel
  groups: Map<RootKey, { cardIds: ULID[]; layer: keyof typeof LAYER_WEIGHT }>;
}

export interface BarometerResult {
  premiseId: ULID;
  supporting: BarometerSide;
  weakening: BarometerSide;
  excluded: ULID[];                      // Hypothesen, Geister: zählen nicht
  // bewusst KEIN Feld "net" oder "verdict": die UI zeigt beide Seiten nebeneinander
}
```

Ablauf: Alle aktiven Karten mit `supports`/`contradicts` auf die Prämisse (direkt oder über Ketten ≤ 2 Schritte), ohne Hypothesen und Geister, werden nach `originRoots` gruppiert. Je Wurzel zählt die **stärkste** Schicht der Gruppe einmal. `weighted` ist die Summe der Schichtgewichte. Die Zahlen sind Orientierung, keine Wahrscheinlichkeit.

## 7. Relation

```ts
export type RelationType =
  | 'supports'          // A stützt B
  | 'contradicts'       // A widerspricht B (symmetrisch)
  | 'cites'             // A stammt von / zitiert B (A abgeleitet, B Original)
  | 'belongs-to'        // A gehört zu B (Teil von, Mitglied von, Thema)
  | 'influences'        // A beeinflusst B
  | 'depends-on'        // A ist abhängig von B
  | 'interest-in'       // Akteur A hat Interesse an B (auch Eigeninteresse an einer Aussage)
  | 'says-vs-does'      // Aussage A widerspricht Handlung B (Blitz)
  | 'allied-with'       // Akteur A ist verbündet mit B (symmetrisch)
  | 'in-conflict-with'  // Akteur A im Konflikt mit B (symmetrisch)
  | 'derived-from';     // Karte A (z. B. Prognose) entstand aus Karte B (z. B. Aussage)

export interface Relation extends Authorship, Federation, Timestamps {
  id: ULID;
  type: RelationType;
  from: ULID;                         // Karten-ID
  to: ULID;                           // Karten-ID
  status: 'ghost' | 'active' | 'archived';
  weight?: 1 | 2 | 3 | 4 | 5;         // Stärke (Linienstärke)
  note?: string;
  basisCardIds: ULID[];               // woraus diese Beziehung folgt
  ghost?: GhostMeta;
  // Haltung zur Beziehung: Stance mit target.kind === 'relation'
}
```

| Typ | Erlaubte Paare (von → nach) | Richtung | Zählt für Barometer | Zählt für Provenienz |
|---|---|---|---|---|
| `supports` | Aussage/Erfahrung/Ereignis → Prämisse/Aussage/Prognose/Option | gerichtet | ja | nein |
| `contradicts` | Aussage/Erfahrung/Ereignis ↔ Prämisse/Aussage | symmetrisch | ja (schwächend) | nein |
| `cites` | Aussage/Quelle → Aussage/Quelle | gerichtet (abgeleitet → Original) | nein | ja |
| `belongs-to` | beliebig → Thema/Akteur/Quelle | gerichtet | nein | nein |
| `influences` | Akteur/Ereignis → Akteur/Ereignis/Thema | gerichtet | nein | nein |
| `depends-on` | Akteur → Akteur/Thema | gerichtet | nein | nein |
| `interest-in` | Akteur/Quelle → Aussage/Thema/Ereignis | gerichtet | nein | nein, aber Warnhinweis an der Aussage |
| `says-vs-does` | Aussage → Ereignis | gerichtet | ja (stützt oft "Interessen vor Rhetorik") | nein |
| `allied-with` | Akteur ↔ Akteur | symmetrisch | nein | nein |
| `in-conflict-with` | Akteur ↔ Akteur | symmetrisch | nein | nein |
| `derived-from` | Prognose/Hypothese → Aussage | gerichtet | nein | nein |

Symmetrische Typen werden einmal gespeichert (`from < to` nach ULID-Ordnung), um Dubletten zu vermeiden. Die Validierung prüft die erlaubten Paare. Eigene Relationstypen sind in Phase 1 nicht vorgesehen (nur `custom:`-Kartentypen).

## 8. Welt, Mitgliedschaft, Prämisse

Eine Welt ist eine **Linse, keine Kopie**. Karten sind Eigentum des Bestands, die Welt wählt sie über Mitgliedschaften aus.

```ts
export interface World extends Authorship, Federation, Timestamps {
  id: ULID;
  name: string;
  description?: string;
  premises: PremiseRef[];              // immer Teil jedes Kontextpakets
  defaultLens: LensKind;
  archived: boolean;
}

export interface PremiseRef {
  cardId: ULID;                        // Karte vom Typ 'premise'
  position: number;                    // Reihenfolge in der Prämissen-Leiste
  active: boolean;                     // pausiert = nicht im Kontextpaket, Pause bleibt sichtbar
  pausedReason?: string;
}

/** Eine Karte kann in mehreren Welten sein, jeweils mit eigenem Kontext. */
export interface Membership extends Authorship, Timestamps {
  id: ULID;
  worldId: ULID;
  cardId: ULID;
  role?: string;                       // z. B. "Gegenspieler", "Kernquelle"
  weight: 1 | 2 | 3 | 4 | 5;           // Relevanz in dieser Welt
  note?: string;
}
```

Ein Board bezieht sich über `Board.worldId` auf genau eine Welt. Das Board kann Prämissen für sich pausieren (`Board.premiseOverrides`), ohne die Welt zu verändern.

## 9. Board, Linse, Layout, Snapshot

```ts
export type LensKind = 'free' | 'field' | 'timeline' | 'evidence' | 'decision';
export type BoardPhase = 'ask' | 'fill' | 'read' | 'check' | 'decide' | 'review';

export interface Board extends Authorship, Federation, Timestamps {
  id: ULID;
  worldId: ULID;
  guidingQuestion: string;             // Pflicht, nicht leer
  questionHistory: { text: string; setAt: ISODateTime }[];
  horizon?: ISODate;                   // Zeithorizont der Frage
  phase: BoardPhase;                   // Marker, nicht erzwungen
  activeLens: LensKind;
  items: BoardItem[];                  // gepinnte Karten (Verweise, keine Kopien)
  layouts: Partial<Record<LensKind, Layout>>;
  lensConfig: Partial<Record<LensKind, LensConfig>>;
  asOf: ISODateTime | null;            // Zeitstand; null = jetzt
  premiseOverrides: { cardId: ULID; paused: boolean }[];
  decisionCardId?: ULID;               // wenn aus dem Board eine Entscheidung wurde
  status: 'active' | 'decided' | 'archived';
}

export interface BoardItem {
  cardId: ULID;
  pinnedAt: ISODateTime;
  pinnedBy: AuthorRef;
  parked: boolean;                     // Fremdkörper-Ablage
  parkedNote?: string;
  parkedAt?: ISODateTime;
  role?: 'context' | 'pro' | 'contra'; // v. a. in Linse Entscheidung
  optionId?: string;                   // Zuordnung zu Option der Entscheidung
}

export interface Layout {
  lens: LensKind;
  positions: Record<ULID, { x: number; y: number; w?: number; h?: number }>; // Karten-ID -> Position
  viewport?: { x: number; y: number; zoom: number };
  zones?: Record<ULID, { x: number; y: number; w: number; h: number }>;      // field: Akteur-Zonen
  lanes?: { id: 'statements' | 'moves'; y: number; h: number }[];             // timeline: zwei Spuren
  columns?: { optionId: string; x: number; w: number }[];                     // decision: Optionen-Spalten
}

/** Linsenspezifische Einstellungen. */
export type LensConfig =
  | { kind: 'free' }
  | { kind: 'field'; actorIds: ULID[]; showPlayerCards: boolean }
  | { kind: 'timeline'; from: ISODate; to: ISODate; actorFilter: ULID[]; showHorizon: boolean }
  | { kind: 'evidence'; premiseId: ULID; groupByOrigin: boolean }
  | { kind: 'decision'; decisionId: ULID };

/** Snapshot: Lage am Datum X. Rekonstruierbar über das Log und zusätzlich eingefroren für Anzeige und Review. */
export interface Snapshot extends Authorship, Timestamps {
  id: ULID;
  boardId: ULID;
  takenAt: ISODateTime;
  label: string;                       // "Entscheidung am 05.10.2026"
  reason: 'manual' | 'decision' | 'review';
  upToSeq: number;                     // Ereignislog-Position: Welt-Stand zu diesem Zeitpunkt
  frozen: {
    guidingQuestion: string;
    items: BoardItem[];
    layouts: Partial<Record<LensKind, Layout>>;
    stanceIds: ULID[];                 // die zu diesem Zeitpunkt aktuellen Haltungen
    relationIds: ULID[];
    barometer: BarometerResult[];      // berechnete Werte, damit sie später vergleichbar bleiben
    premiseTexts: string[];
  };
  contentHash: string;
}
```

Snapshots verändern keine Welt. Die Review-Ansicht lädt `upToSeq` und vergleicht mit dem heutigen Stand (Event-Replay bis zur Sequenznummer, oder `frozen` direkt).

## 10. Ereignislog

Das Log ist die Wahrheit. Es ist append-only: Ereignisse werden nie geändert oder gelöscht. "Löschen" ist ein Ereignis (`CardArchived`), das den Zustand ändert. Projektionen (SQL-Tabellen) werden aus dem Log gebaut und können jederzeit neu aufgebaut werden.

```ts
export interface EventEnvelope<T extends string, P> {
  seq: number;                         // lokal monoton steigend (SQLite-Zeilenindex)
  id: ULID;                            // globale Ereignis-ID
  type: T;
  at: ISODateTime;
  actor: AuthorRef;                    // wer es ausgelöst hat
  payload: P;
  causedBy?: ULID;                     // Folgeereignis eines anderen (z. B. GhostAccepted -> CardCreated)
  schemaVersion: number;
  signature?: string;                  // Phase 4
}

export type WorldEvent =
  // Karten
  | EventEnvelope<'CardProposed',        { card: Card }>                              // Geist
  | EventEnvelope<'GhostAccepted',       { cardId: ULID; edits?: Partial<Card> }>     // Mensch übernimmt
  | EventEnvelope<'GhostDismissed',      { cardId: ULID; reason?: string }>
  | EventEnvelope<'CardCreated',         { card: Card }>                              // Mensch legt direkt an
  | EventEnvelope<'CardUpdated',         { cardId: ULID; patch: unknown }>
  | EventEnvelope<'CardArchived',        { cardId: ULID }>
  // Haltung
  | EventEnvelope<'StanceSet',           { stance: Stance }>                          // nur actor.kind === 'user'
  // Beziehungen
  | EventEnvelope<'RelationProposed',    { relation: Relation }>
  | EventEnvelope<'RelationAdded',       { relation: Relation }>
  | EventEnvelope<'RelationRemoved',     { relationId: ULID }>
  // Welt
  | EventEnvelope<'WorldCreated',        { world: World }>
  | EventEnvelope<'PremiseSet',          { worldId: ULID; premises: PremiseRef[] }>
  | EventEnvelope<'MembershipSet',       { membership: Membership }>
  // Eingang
  | EventEnvelope<'InboxItemIngested',   { sourceId: ULID; statementCount: number; model: string }>
  | EventEnvelope<'ExtractionFailed',    { sourceId: ULID; error: string }>
  // Board
  | EventEnvelope<'BoardCreated',        { board: Board }>
  | EventEnvelope<'GuidingQuestionSet',  { boardId: ULID; text: string }>
  | EventEnvelope<'BoardPhaseChanged',   { boardId: ULID; phase: BoardPhase }>
  | EventEnvelope<'BoardItemPinned',     { boardId: ULID; item: BoardItem }>
  | EventEnvelope<'BoardItemParked',     { boardId: ULID; cardId: ULID; note?: string }>
  | EventEnvelope<'BoardLayoutChanged',  { boardId: ULID; lens: LensKind; layout: Layout }>
  | EventEnvelope<'SnapshotTaken',       { snapshot: Snapshot }>
  // Prognose, Entscheidung, Review
  | EventEnvelope<'PredictionMade',      { cardId: ULID }>                            // Karte existiert bereits
  | EventEnvelope<'PredictionResolved',  { cardId: ULID; outcome: 'yes' | 'no' | 'partial' | 'void'; note?: string; evidenceCardIds: ULID[] }>
  | EventEnvelope<'DecisionMade',        { decisionId: ULID; boardId?: ULID; chosenOptionId: string }>
  | EventEnvelope<'ReviewScheduled',     { decisionId: ULID; reviewAt: ISODate }>
  | EventEnvelope<'DecisionReviewed',    { decisionId: ULID; outcome: 'good' | 'mixed' | 'bad' | 'open'; lesson?: string }>
  // Erfahrung und Regel
  | EventEnvelope<'ExperienceRecorded',  { cardId: ULID; seriesId?: ULID }>
  | EventEnvelope<'RuleDerived',         { cardId: ULID; fromDecisionIds: ULID[] }>
  | EventEnvelope<'RuleApplied',         { ruleId: ULID; decisionId: ULID; fit: 'conform' | 'deviated' }>
  // Plattform (Phase 4)
  | EventEnvelope<'CardShared',          { cardId: ULID; visibility: Visibility; contentHash: string }>
  | EventEnvelope<'RemoteCardReceived',  { card: Card; authorKey: string }>;
```

Schreibrechte pro Ereignisart (durchgesetzt im `store`, siehe [04](04-architektur.md#4-speicher)):

| Akteur | Darf schreiben |
|---|---|
| Mensch (UI) | alles |
| Ingest/LLM-Adapter | `CardProposed`, `RelationProposed`, `InboxItemIngested`, `ExtractionFailed` (nur Geister) |
| Externer Agent (MCP) | `CardProposed`, `RelationProposed` (nur Geister, in die Inbox) |
| System (Projektionen, Erinnerungen) | `ReviewScheduled` auslösen, berechnete Vorschläge als `CardProposed` |

Embeddings sind **kein** Teil des Logs. Sie sind abgeleitete Daten (sqlite-vec) und können neu berechnet werden, auch mit einem anderen Modell.

## 11. Prognose, Entscheidung, Regel

### 11.1 Prognose (Prediction)

Nur was als Prognose erfasst ist, kann bewertet werden. Prognosen sind der Motor der Quellenbewertung.

```ts
export interface PredictionData {
  claim: string;                          // "Eskalation an der Straße von Hormus bis 05.01.2027"
  author: Speaker;                        // Quelle/Akteur ODER { kind: 'self' }
  probability: number | null;             // 0..1: wie wahrscheinlich hielt der Urheber das Eintreten?
  probabilityBasis: 'stated' | 'mapped' | 'self' | null;
  madeAt: FuzzyDate;                      // wann geäußert
  resolveBy: ISODate;                     // Auflösungsdatum
  criterion: string;                      // Auflösungskriterium, konkret und prüfbar
  status: 'open' | 'resolved' | 'void';   // void = nicht entscheidbar, zählt nicht
  outcome: 'yes' | 'no' | 'partial' | null;
  outcomeValue: 0 | 0.5 | 1 | null;       // no=0, partial=0.5, yes=1
  resolvedAt?: ISODateTime;
  resolutionNote?: string;
  resolutionEvidence: ULID[];             // Karten, die das Ergebnis belegen
  derivedFromStatementId?: ULID;          // Aussage, aus der die Prognose markiert wurde
}
```

`probabilityBasis`: `stated` = die Quelle nannte eine Zahl, `mapped` = der Mensch hat ein Wahrscheinlichkeitswort übersetzt, `self` = eigene Prognose. Standardabbildung für Wörter (anpassbar, immer sichtbar):

| Wort | p | Wort | p |
|---|---|---|---|
| sicher | 0,95 | unwahrscheinlich | 0,20 |
| sehr wahrscheinlich | 0,80 | sehr unwahrscheinlich | 0,08 |
| wahrscheinlich | 0,65 | ausgeschlossen | 0,03 |
| möglich | 0,40 | | |

Ohne Wahrscheinlichkeit fließt die Prognose nur in die Trefferquote ein, nicht in den Brier-Score.

### 11.2 Entscheidung (Decision)

```ts
export interface DecisionData {
  situation: string;
  trigger: string;                        // Auslöser ("Angebot läuft bis 30.11.")
  options: DecisionOption[];
  chosenOptionId: string | null;
  conditions: string[];                   // Bedingungen für die Umsetzung
  exclusions: Exclusion[];                // Ausschlusskriterien
  rationale: { text: string; cardIds: ULID[] }; // Begründung mit verlinkten Karten
  priorities: { label: string; rank: number }[]; // "Verlustbegrenzung vor Rendite"
  predictionIds: ULID[];                  // eigene Prognosen zu dieser Entscheidung
  appliedRuleIds: ULID[];                 // Regeln, die gegriffen haben
  snapshotId: ULID | null;
  decidedAt: ISODateTime | null;
  reviewAt: ISODate | null;
  review?: {
    reviewedAt: ISODateTime;
    whatHappened: string;
    outcome: 'good' | 'mixed' | 'bad' | 'open';
    processAssessment?: 'sound' | 'flawed'; // Prozess und Ergebnis getrennt bewerten
    lesson?: string;
    experienceCardId?: ULID;
  };
}

export interface DecisionOption {
  id: string;
  label: string;
  description?: string;
  proCardIds: ULID[];
  contraCardIds: ULID[];
}

export interface Exclusion { id: string; text: string; triggered?: boolean; note?: string }
```

### 11.3 Regel (Rule)

Verdichtete Entscheidungslogik: "Wenn Bedingungen, dann bevorzuge Handlung, außer ...".

```ts
export interface RuleData {
  name: string;                           // "Preisgrenze Mallorca"
  when: Condition[];                      // alle müssen zutreffen (UND)
  prefer: string;                         // bevorzugte Handlung
  unless: Condition[];                    // Ausnahmen
  status: 'draft' | 'active' | 'retired';
  derivedFromDecisionIds: ULID[];
  derivedFromExperienceIds: ULID[];
  scopeWorldIds: ULID[];                  // leer = alle Welten
  /** abgeleitet, nicht per Hand pflegen */
  stats?: { applied: number; hit: number; miss: number; open: number };
}

export interface Condition {
  id: string;
  text: string;                           // "Preis pro m² unter 4.000 €"
  test:
    | { kind: 'numeric'; metric: string; op: '<' | '<=' | '>' | '>=' | '=='; value: number; unit?: string }
    | { kind: 'cardExists'; cardType: CardType; query: string }   // z. B. Erfahrung/Beleg vorhanden
    | { kind: 'manual' };                                         // Mensch bestätigt
}
```

Eine Regel entsteht ab Phase 3 aus wiederholten Entscheidungen. Die Regelstatistik wird aus `RuleApplied` und `DecisionReviewed` berechnet: `hit` = befolgt und Ergebnis gut/gemischt, `miss` = befolgt und schlecht, abgewichen zählt gesondert.

## 12. SourceProfile (abgeleitet)

Das Profil wird nie von Hand gepflegt, sondern aus Karten, Prognosen und meinen Haltungen berechnet. Es gibt **keinen Gesamtwert**.

```ts
export interface DimensionValue<T = number> {
  value: T | null;               // null, wenn n < minN
  n: number;                     // Stichprobengröße, immer angezeigt
  minN: number;                  // Standard 5; darunter "zu wenig Daten"
}

export interface SourceProfile {
  sourceId: ULID;                // Source- oder Akteur-Karte
  computedAt: ISODateTime;
  hitRate: DimensionValue;                     // Anteil zutreffender aufgelöster Prognosen
  brier: DimensionValue;                       // mittlerer Brier-Score (nur Prognosen mit p)
  topicCompetence: { topicId: ULID; hitRate: DimensionValue; brier: DimensionValue }[];
  agreementWithMyWorld: DimensionValue;        // aus meinen Stances; privat
  deviation: { statementId: ULID; myAgreement: Agreement }[];  // Aussagen, bei denen ich abweiche
  valueOfDissent: { dissentCount: number; sourceRight: number; list: ULID[] };
  sourceQuality: DimensionValue;               // Anteil BELEGT an allen Aussagen
  independence: DimensionValue;                // eigenständige Wurzeln je 10 Aussagen
}
```

### Brier-Score

Der Brier-Score misst, wie gut Wahrscheinlichkeitsangaben kalibriert sind. Für eine aufgelöste Prognose mit Wahrscheinlichkeit `p` (0..1) und Ergebnis `o` (nicht eingetreten = 0, teilweise = 0,5, eingetreten = 1) gilt:

```
Brier = (p - o)²
Mittlerer Brier einer Quelle = Durchschnitt über ihre aufgelösten Prognosen mit p
```

Kleiner ist besser. 0 ist perfekt, 1 maximal falsch. Wer immer 50 % sagt, erreicht 0,25 (Referenzwert "Münzwurf").

| Prognose | p | Ergebnis | Brier |
|---|---|---|---|
| "Eskalation sehr wahrscheinlich" | 0,80 | nicht eingetreten (0) | (0,80 − 0)² = 0,64 |
| "Eskalation 30 %" | 0,30 | nicht eingetreten (0) | (0,30 − 0)² = 0,09 |
| "Verkäufer akzeptiert, 45 %" | 0,45 | nicht eingetreten (0) | 0,2025 |
| "Preis steigt, 70 %" | 0,70 | eingetreten (1) | 0,09 |

Grenzen, die die UI zeigen muss: Wenige Prognosen sind Zufall (n < 5: "zu wenig Daten"). Brier ist themenabhängig, daher je Thema berechnen. Prognosen ohne Wahrscheinlichkeit zählen nur in der Trefferquote.

**Trefferquote:** Anteil aufgelöster Prognosen mit `outcome === 'yes'` unter denen, bei denen der Urheber das Eintreten behauptete (`p ≥ 0,5` oder keine Zahl, Aussage positiv formuliert). `partial` zählt halb, `void` zählt nicht.

**Wert des Widerspruchs:** Für jede aufgelöste Prognose der Quelle, bei der meine damalige Haltung (aus der Stance-Historie zum Zeitpunkt `madeAt`) der Quelle widersprach, prüfen wir, wer richtig lag. `sourceRight` zählt Fälle, in denen die Quelle richtig lag und ich falsch. Das braucht die **Haltungshistorie**: Ohne sie ließe sich nachträglich beschönigen.

**Übereinstimmung mit meiner Welt:** Anteil der Aussagen der Quelle, zu denen meine aktuelle Zustimmung ≥ +1 ist, an allen Aussagen mit gesetzter Haltung. Nicht teilbar (Haltungen sind privat).

## 13. Kompaktes Beispiel als JSON

**Erfundene Beispieldaten**, stark verkürzt (Zeitstempel, Schema-Versionen und Autorenfelder gekürzt). Sie zeigen Welt, Prämisse, zwei Akteure, eine Quelle, eine Aussage mit Fundstelle, eine Beziehung, eine Haltung und eine Prognose.

```json
{
  "_comment": "Beispieldaten, erfunden. Felder origin/author/visibility/createdAt/updatedAt/schemaVersion gekürzt, wo kein Erkenntnisgewinn.",
  "world": {
    "id": "01JB3E28JT97KB6CQ643DZVMXX",
    "name": "Geopolitik & Depot",
    "premises": [{ "cardId": "01JBQKFBF5KZNWJ47TAN9ZT24M", "position": 0, "active": true }],
    "origin": "human", "author": { "kind": "user", "id": "01JBM9S346Q3D25VT4F5V37E3S" }, "visibility": "private"
  },
  "cards": [
    {
      "id": "01JBQKFBF5KZNWJ47TAN9ZT24M", "type": "premise", "status": "active",
      "title": "Geopolitik schlägt Märkte",
      "data": { "text": "Geopolitik schlägt Märkte", "kind": "premise" },
      "origin": "human", "visibility": "private"
    },
    {
      "id": "01JBNPZX45HY43KWJRP1XPA7Z3", "type": "actor", "status": "active", "title": "Iran",
      "data": { "kind": "state", "aliases": [], "interests": [], "capabilities": [], "dependencies": [], "redLines": [] },
      "origin": "human", "visibility": "private"
    },
    {
      "id": "01JBDJ8FSSZ5AWSH8VHTPRE95B", "type": "actor", "status": "active", "title": "USA",
      "data": { "kind": "state", "aliases": ["Vereinigte Staaten"], "interests": [], "capabilities": [], "dependencies": [], "redLines": [] },
      "origin": "human", "visibility": "private"
    },
    {
      "id": "01JB9EE0ZBGJ09TQM83XSSSS6Y", "type": "source", "status": "active", "title": "Podcast \"Lagebild\" #112 (Beispiel)",
      "data": { "kind": "podcast", "publishedAt": { "value": "2026-09-30", "precision": "day" },
                "isPrimaryMaterial": false, "transcript": { "language": "de", "hasTimestamps": true } },
      "origin": "import", "visibility": "private"
    },
    {
      "id": "01JB5GQAPENECFSECZP11HYGCP", "type": "statement", "status": "active",
      "title": "Iran: kein Interesse an Schließung",
      "data": {
        "content": "Iran hat kein Interesse an einer Schließung der Meerenge.",
        "kind": "claim",
        "speaker": { "kind": "actor", "cardId": "01JBNPZX45HY43KWJRP1XPA7Z3" },
        "citation": { "sourceId": "01JB9EE0ZBGJ09TQM83XSSSS6Y", "locator": { "kind": "timestamp", "value": "41:20" } },
        "statedAt": { "value": "2026-09-12", "precision": "day" },
        "evidence": [], "verbatim": false,
        "extraction": { "model": "beispiel-llm", "chunkRef": "chunk-17" }
      },
      "origin": "ai", "author": { "kind": "model", "id": "beispiel-llm" }, "visibility": "private"
    },
    {
      "id": "01JB7AG3BCKKDJWBHP1G201CYF", "type": "prediction", "status": "active",
      "title": "Eskalation Hormus bis 05.01.2027",
      "data": {
        "claim": "Eskalation an der Straße von Hormus bis 05.01.2027",
        "author": { "kind": "self" },
        "probability": 0.30, "probabilityBasis": "self",
        "madeAt": { "value": "2026-10-05", "precision": "day" },
        "resolveBy": "2027-01-05",
        "criterion": "Zwischenfall mit Schäden oder Toten an Handelsschiffen laut >= 2 unabhängigen Ursprüngen ODER Verkehrsunterbrechung > 24 h",
        "status": "open", "outcome": null, "outcomeValue": null, "resolutionEvidence": []
      },
      "origin": "human", "visibility": "private"
    }
  ],
  "relations": [
    {
      "id": "01JBB9Y73MY63FCH26W14WMCHW", "type": "supports", "status": "active",
      "from": "01JB5GQAPENECFSECZP11HYGCP", "to": "01JBQKFBF5KZNWJ47TAN9ZT24M",
      "note": "Hinweis auf Rhetorik gegen Handeln, siehe Zeitachse", "basisCardIds": [],
      "origin": "human", "visibility": "private"
    }
  ],
  "stances": [
    {
      "id": "01JB1RNJ47E65GH2BH8VGS9ZM5",
      "target": { "kind": "card", "id": "01JB5GQAPENECFSECZP11HYGCP" },
      "ownerId": "01JBM9S346Q3D25VT4F5V37E3S",
      "agreement": -1, "confidence": 60, "weight": 4,
      "rationale": "Manöver spricht dagegen, aber Manöver ist auch Abschreckung.",
      "setAt": "2026-10-05T09:12:00Z", "supersedes": null, "origin": "human", "visibility": "private"
    }
  ]
}
```

## 14. Invarianten

Prüfregeln für `packages/core` (zod `superRefine`) und für Tests.

1. Jede ID ist eine gültige ULID. Jede Entität hat `origin`, `author`, `visibility`.
2. `Statement`: `speaker` vorhanden. `citation` nicht null, außer `speaker.kind` ist `self` oder `tool`. `evidence[].sourceId` zeigt auf eine Quelle mit `isPrimaryMaterial`.
3. `Stance.origin === 'human'`. Jede Stance mit `supersedes` hat denselben `target` und `ownerId` wie der Vorgänger. Es gibt pro `target` und `ownerId` genau eine Stance ohne Nachfolger.
4. `confidence` in 0..100, `agreement` in −2..+2, `weight` in 1..5.
5. Karten mit `status: 'ghost'` haben `ghost.reason` und tauchen in keiner Barometer-, Profil- oder Kontextpaket-Berechnung als Evidenz auf (im Paket nur im Abschnitt `ghosts`, wenn angefordert).
6. `Board.guidingQuestion` ist nicht leer.
7. `Prediction`: `resolveBy` ist gesetzt und `criterion` nicht leer, sonst lässt sie sich nicht als Karte aktivieren. `outcome` ist nur bei `status: 'resolved'` gesetzt. `probability` in 0..1 oder null.
8. `Relation` verbindet nur erlaubte Typpaare (Tabelle in Abschnitt 7), `from !== to`.
9. Das Log wird nie geändert. `seq` ist lückenlos. Jede Projektion lässt sich aus dem Log neu aufbauen und ergibt dasselbe Ergebnis (Test: Rebuild und Vergleich).
10. Ein `Snapshot` ändert keine Welt-Objekte.
