---
id: wiki-microservice-katalog
titel: Microservice-Katalog & Open-Source-Bausteine (46 Bausteine, A–F)
datum: 2026-10-08
status: freigegeben
quelle: <home>\Projects\company-spawn-48naehrstoffe\Homepage\Homepage-Bau\Microservice-Katalog_2026-10-10.pdf
---

# Microservice-Katalog & Open-Source-Bausteine

Verbindlicher Katalog, aus dem gebaut wird. Jede Zeile ist ein Dienst, der einmal läuft und von allen Projekten genutzt wird. **Erste Wahl** nehmen, nur bei Hindernis auf **Ausweichen**. Lizenz in Klammern; „ja (AGPL)" = erlaubt, eigene Code-Änderungen offenlegen.

## Grundregel: ERPNext ist die Plattform
Alles, was eine Frappe-App kann, läuft in ERPNext (eine Site je Kunde) — **nicht als eigener Dienst daneben**. Ein Katalog-Dienst kommt nur dazu, wenn Frappe die Aufgabe nicht kann. Homepages/Shops = statische Astro-Seiten auf Cloudflare Pages, Daten aus ERPNext über Cloudflare-Tunnel. Verbindlich: `<projects>\ARCHITEKTUR-VORGABEN.md`.

## RAUS für unser Modell (Weiterverkauf an Kunden verboten/eingeschränkt — NICHT verwenden)
n8n, Dify, NocoDB, Invoice Ninja, Akaunting, Outline, Redpanda, Cal.com, Directus (nur <5 Mio. Umsatz), Open WebUI (nur ohne eigenes Branding).
**Tot/stockend — meiden:** MinIO (Repo archiviert), Kong-OSS (keine Releases nach 3.9), Ory (OSS stagniert), conduwuit (archiviert), Evolution API (Lizenz ab 2.4).
**WhatsApp:** nur als Zusatz mit Sperrrisiko; Hauptkanal Matrix + Telegram.

## A – Identität und Zugang
| Nr | Dienst | Erste Wahl | Ausweichen |
|----|--------|-----------|-----------|
| 1 | Anmeldung/SSO/2FA | Zitadel (AGPL) | Keycloak (Apache), Authentik |
| 2 | Mandanten und Teams | in Zitadel enthalten | Keycloak-Realms |
| 3 | Rechteverwaltung (auch Agent) | erst ERPNext-Rollen + Matrix-Raumrechte, später Cerbos (Apache) | OpenFGA, SpiceDB |
| 4 | Eingangstor (Reverse Proxy) | Traefik (MIT) | Apache APISIX |
| 5 | API-Schlüssel & Ratenlimit | Unkey (AGPL) | Traefik-Middleware |
| 6 | Geheimnis-Tresor | Infisical (MIT-Kern) | OpenBao (MPL) |
| 7 | Backend-Baukasten | PocketBase (MIT) | Supabase (Apache), Appwrite |

## B – Geld, Rechnung, Verträge
| Nr | Dienst | Erste Wahl | Ausweichen |
|----|--------|-----------|-----------|
| 8 | Zahlungseingang | Eigenbau auf MercadoPago-SDK (MIT) | Hyperswitch (ohne MercadoPago) |
| 9 | Nutzungsabrechnung „pro Agent" | Eigenbau: Ereignis-Tabelle + Monatslauf → ERPNext | Lago (AGPL), OpenMeter, Flexprice |
| 10 | Rechnungen & Buchhaltung | ERPNext (GPL) — vorhanden | Odoo Community |
| 11 | ARCA Factura electrónica | Eigenbau auf pyafipws (LGPL) | afip.js, Finbyz (ERPNext v15) |
| 12 | Guthaben-Konto (Credits) | Formance Ledger (MIT) | Blnk (Apache), TigerBeetle |
| 13 | E-Signatur | Documenso (AGPL) | DocuSeal (AGPL+Logo) |
| 14 | PDF-Erzeugung | Gotenberg (MIT) | Typst (Apache) |

## C – Kommunikation und Kundenkontakt
| Nr | Dienst | Erste Wahl | Ausweichen |
|----|--------|-----------|-----------|
| 15 | Benachrichtigungen | ntfy (Apache) + Apprise (BSD) | Novu |
| 16 | System-E-Mail | Postal (MIT) | Stalwart (AGPL) |
| 17 | Newsletter | ERPNext-Newsletter (GPL) / Listmonk | Keila (AGPL) |
| 18 | Matrix-Server | Tuwunel (Apache) | Synapse (AGPL, schwer) |
| 19 | Brücken Telegram/WhatsApp | mautrix-telegram/-whatsapp (AGPL) | WAHA (Apache) |
| 20 | Support-Posteingang | Chatwoot (MIT-Kern) | Zammad, FreeScout |
| 21 | Terminbuchung | Easy!Appointments (GPL) | — |
| 22 | Video und Sprache | LiveKit (Apache) | Jitsi (Apache) |

## D – Daten und Inhalte
| Nr | Dienst | Erste Wahl | Ausweichen |
|----|--------|-----------|-----------|
| 23 | CRM | ERPNext CRM — vorhanden | EspoCRM, Twenty |
| 24 | Formulare & Umfragen | Frappe Web Forms (MIT) / Formbricks | OpnForm, HeyForm |
| 25 | Dateiablage (S3) | Garage (AGPL) | SeaweedFS (Apache) |
| 26 | Suche | Meilisearch (MIT) | Typesense (GPL) |
| 27 | Wiki/Wissen je Kunde | Frappe Wiki (MIT) / Docmost | BookStack (MIT) |
| 28 | Webseiten-Inhalte (CMS) | statische Astro-Seiten (Cloudflare Pages) / Payload (MIT) | Strapi |
| 29 | Tabellen-Oberfläche | Baserow (MIT-Kern) | — |
| 30 | Shop/Marktplatz | Medusa (MIT) | Saleor (BSD), Vendure (GPL) |
| 31 | Übersetzung | Tolgee (Apache-Kern) | Weblate (GPL) |

## E – Automatisierung und KI
| Nr | Dienst | Erste Wahl | Ausweichen |
|----|--------|-----------|-----------|
| 32 | Workflow-Baukasten | Activepieces (MIT-Kern) | Kestra (Apache) |
| 33 | Nachrichten-Bus/Jobs | NATS (Apache) | RabbitMQ (MPL) |
| 34 | KI-Gateway (ein Zugang, Kosten/Limits je Kunde) | LiteLLM (MIT-Kern) | — |

## F – Betrieb
| Nr | Dienst | Erste Wahl | Ausweichen |
|----|--------|-----------|-----------|
| 35 | Lokale Modelle (RTX 3060) | Ollama (MIT) | vLLM (nur Linux) |
| 36 | Vektor-Speicher | Qdrant (Apache) | — |
| 37 | KI-Protokoll | Langfuse (MIT-Kern, braucht ClickHouse) | LiteLLM-Logs |
| 38 | Chat-Oberfläche im Browser | Open WebUI (Branding-Klausel) | Element/Matrix-Client |
| 39 | Erreichbarkeit/Statusseite | Uptime Kuma (MIT) | Gatus (Apache) |
| 40 | Messwerte & Logs | Prometheus + Grafana/Loki | SigNoz (MIT-Kern) |
| 41 | Fehlererfassung | GlitchTip (MIT) | — |
| 42 | Ausrollen | Docker Compose | Coolify/Dokploy (erst Linux) |
| 43 | Funktions-Schalter | Flagsmith (BSD) | Unleash, GrowthBook |
| 44 | Nutzungsanalyse | Umami (MIT) | PostHog (Self-Host nur Hobby) |
| 45 | Backup | Restic (BSD) | — |
| 46 | Beleg-Spur (Audit-Log) | Eigenbau, eine unveränderbare Tabelle | — |

## Vier Eigenbauten (gibt es nicht fertig)
- **ARCA-Rechnungsdienst** (auf pyafipws; Pflichtfeld CondicionIVAReceptorId, RG 5616).
- **MercadoPago-Dienst** (offizielles SDK MIT; Webhook-Signatur prüfen).
- **Agenten-Zähler** („pro funktionierendem Agent": Gesundheitscheck je Agent → Ereignis → Monatsrechnung in ERPNext).
- **Beleg-Spur** (jede Aktion mit Pfad + Zeit, unveränderbar).

## Welches Projekt braucht welche Bausteine
Gemeinsamer Sockel (alle Projekte): **1, 6, 10, 15, 34, 39, 46**. Zusätzlich:
| Projekt | Zusätzlich | Besonderheit |
|---------|-----------|--------------|
| **Weltenbauer / Reraise (Kartentausch)** | **2, 3, 12, 26, 30, 36** | Karten als Eigentum der Organisation — Guthaben-Konto (12) und Rechte (3) sind der Kern |
| Private Executive | 2, 3, 8, 9, 11, 18, 19, 25, 26, 27, 35, 36 | Mandantentrennung je Kunde Pflicht; Matrix vor Telegram |
| KI-Agentur Buenos Aires | 2, 8, 9, 11, 13, 20, 21, 32 | Abrechnung pro Agent; Verträge digital signieren |
| Caprey / Mercado Libre | 8, 11, 33 | Mercado-Libre-API als eigener Adapter (Eigenbau) |
| Supplements Argentinien (Barril 48) | 8, 11, 28, 30, 31 | Shop + Landingpage, Pesos, ARCA |

## Aufbau-Reihenfolge
1. Sockel: ERPNext/Frappe (Site je Mandant), Cloudflare-Tunnel, Traefik, Uptime Kuma, Restic.
2. Geld: ERPNext + die 3 Eigenbauten → Kunde kann zahlen, gültige ARCA-Rechnung.
3. Kanäle: Tuwunel (Matrix), mautrix-Brücken, ntfy+Apprise, Chatwoot.
4. KI-Schicht: LiteLLM vor Ollama, Qdrant, Garage.
5. Später: Lago, Langfuse, Activepieces, Medusa, Documenso.

Hardware-Grenze: RTX 3060 12 GB trägt ein 7–8B-Modell für alle Kunden gleichzeitig (mehr Kunden = Warteschlange, nicht mehr Modelle; Frontier über Nous). Windows-Server: Docker über WSL2; Coolify/Dokploy erst bei Linux-Host.
