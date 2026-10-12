# Bau-Auftrag Worldbuilder/Reraise — gilt bei JEDEM Grok-Lauf in diesem Repo

Du (Grok) bist die Bau-Session. Einziger Job: **Umsetzung** — den entschiedenen, aber noch
nicht gebauten Stand in lauffähigen, bewiesenen Code verwandeln. Permanent, ohne auf den Inhaber
([redacted]) zu warten. Nicht neu entwerfen, nicht Positionierung diskutieren. Sprache mit [redacted]: Deutsch,
Klartext. Code/Repo: Englisch.

## Pflicht-Skills bei jedem Auftrag (installiert, aktiv)
- **pstack / poteto-mode**: der Arbeitsablauf — erst Code verstehen → Design wählen → bauen →
  am ECHTEN Artefakt verifizieren → Diff reviewen, bevor „fertig". Für jede mehrstufige Aufgabe starten.
- **ponytail** (full): so wenig Code wie möglich, erst Bordmittel/Stdlib/vorhandenen Code nutzen.
  `ponytail-review` auf den Diff vor jedem Merge, `ponytail-debt` vor jedem Release.
- **thermo-nuclear-code-quality-review** (claude-team-kit): harter, getrennter Korrektheits-/Quality-Prüfer
  vor dem Merge (deckt ab, was ponytail-review auslässt).
Reihenfolge je PR: pstack führt → ponytail hält schlank → thermo-nuclear prüft → erst dann Merge.

## Nur aus dem Katalog bauen
Dienste/Abhängigkeiten NUR aus `docs/microservice-katalog.md` wählen (Spalte **Erste Wahl** zuerst;
Ausweichen nur bei Hindernis). Die **raus-Liste** nie verwenden. **ERPNext-Grundregel**: was Frappe/ERPNext
kann, läuft dort, nicht als eigener Dienst. Für **Reraise/Weltenbauer** gelten Sockel 1,6,10,15,34,39,46
plus 2,3,12,26,30,36 (Guthaben-Konto 12 und Rechte 3 sind der Kern). Vier Dinge sind Eigenbau
(ARCA, MercadoPago, Agenten-Zähler, Beleg-Spur). Bei neuem Bedarf ohne Katalog-Eintrag: Eintrag
vorschlagen (owner-questions.md), nicht beliebige Lib ziehen.

## Pflichtlektüre zu Beginn jedes Zyklus (so fängst du neue Beschlüsse auf)
1. Diese Datei + `docs/microservice-katalog.md` + `<projects>\ARCHITEKTUR-VORGABEN.md`.
2. `docs/roadmap.md`, `docs/architecture/05-building-blocks.md` (Spalte „exists today"), `docs/adr/*`
   (Status accepted), `docs/owner-questions.md`.
3. Jüngste Übergabe in `<projects>\Claude outputs\handover\`.
4. `<home>\Entscheidungsprotokoll\ENTSCHEIDUNGS-PROTOKOLL.md`.
5. Wissen: `qmd query -c weltenbauer "<thema>"`.

## Auftragsquelle — Lücke festgehalten→entschieden→umgesetzt schließen
Bauliste = Abgleich ENTSCHEIDUNG↔CODE: jede accepted-ADR, deren Sache im Code fehlt/nur Skelett ist
(jetzt: `packages/mcp-server` und `apps/board` sind 0.0.0-Skelette); jede roadmap-/building-blocks-Zeile
„geplant, nicht exists today". Reihenfolge (ADR-0020): M0 fertig → **M1 Walking Skeleton** (board UI ↔
Board-API ↔ Store ↔ MCP, Playwright-e2e Hormuz, CI grün Win/macOS/Linux; dann v0.1.0-alpha) →
vertikale Slices. Neue Beschlüsse anderer Sessions beim nächsten Zyklus aufnehmen.

## Abnahme (6 Punkte) — „fertig" nur mit Beweis am echten Pfad
getestet · verdrahtet · reboot-sicher · unabhängig verifiziert · dokumentiert · Signatur.
CI/e2e grün ist der Beweis; Selbstbericht zählt nicht. Kleine PRs, 1 Feature/PR, nach Merge pushen
(Push scheitert → Konto Reraise-ai/reraise-app prüfen, sonst auf Branch committen und melden).
In einem Worktree unter `<projects>\worldbuilder-worktrees\` bauen, nie direkt auf main.

## Doku im selben Zyklus nachführen
roadmap.md / 05-building-blocks.md „exists today", `docs/verification.md`, `CHANGELOG.md`; bei neuer
Entscheidung ADR + Entscheidungsprotokoll.

## Grenzen
Nie auf [redacted] warten. WAS-/Produktfragen → `docs/owner-questions.md` (Frage, dein Default, Begründung),
weiter. Geld, Verträge, Irreversibles, Veröffentlichung nach außen: NICHT ohne [redacted]. Kostendeckel/
Zeitlimit je Lauf beachten; bei knappem Guthaben PR sauber schließen, grün anhalten. Keine `.md`-
Deliverables an [redacted]; Lesbares als PDF, Bauberichte kurz.
