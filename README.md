# Callisto

KI-Telefonassistent für Arztpraxen auf AWS. Die Praxis leitet ihre Telefonanlage auf eine Nummer um; der Assistent bucht Termine und nimmt Rezeptwünsche auf, verbindet bei sonstigen Anliegen mit der Praxis, erkennt Notfälle und kennt Sprechzeiten und Urlaub. Das Praxisteam sieht alle Anrufe in einer Weboberfläche, stellt Termine zur Buchung bereit und konfiguriert dort den Assistenten.

- **Ausrollen in wenigen Schritten:** [docs/de/quickstart.md](docs/de/quickstart.md)
- Konfiguration und Telefonie: [docs/de/konfiguration.md](docs/de/konfiguration.md)
- Architektur und Entscheidungen: [docs/de/architektur.md](docs/de/architektur.md)
- In English: [Quickstart](docs/en/quickstart.md), [Configuration](docs/en/configuration.md), [Architecture](docs/en/architecture.md)

## Aufbau

| Ordner                 | Inhalt                                                                    |
| ---------------------- | ------------------------------------------------------------------------- |
| `packages/domain`      | Fachlogik ohne AWS: Schemas, Sprechzeiten, Feiertage, Terminslots, Rechte |
| `packages/data`        | DynamoDB-Schlüsselschema und Repositories                                 |
| `services/api`         | REST-API der Weboberfläche (Lambda hinter API Gateway)                    |
| `services/voice-agent` | Sprachagent: Gesprächssitzung, Nova Sonic, Werkzeuge, Testmodus           |
| `apps/web`             | Weboberfläche (React): Tagesgeschehen, Einstellungen, Testanruf           |
| `infra`                | AWS-Infrastruktur als CDK-App                                             |

## Technologien

Alles ist TypeScript in npm-Workspaces. Patientendaten liegen in Frankfurt (`eu-central-1`), das Sprachmodell läuft in Stockholm (`eu-north-1`). Warum welche Wahl getroffen wurde, steht in [docs/de/architektur.md](docs/de/architektur.md).

**Weboberfläche**

| Technologie             | Wofür                                                              |
| ----------------------- | ------------------------------------------------------------------ |
| React, Vite             | Single-Page-App, Entwicklungsserver und Build                      |
| TanStack Router         | Ansichten und Adressen, auch für das Einstellungs-Sheet            |
| TanStack Query          | Serverdaten laden, zwischenspeichern, alle 10 Sekunden auffrischen |
| Hono RPC-Client         | Typsichere Aufrufe der API mit den Typen der API selbst            |
| Radix UI                | Menüleiste, Kontextmenüs, Dialoge, Meldungen                       |
| react-resizable-panels  | Verschiebbare Navigation und Detailbereich                         |
| react-oidc-context      | Anmeldung über Cognito (Code-Flow mit PKCE)                        |
| Web Audio, AudioWorklet | Mikrofon und Lautsprecher im Testanruf                             |
| CSS-Variablen           | Gestaltung hell und dunkel                                         |

**API und Fachlogik**

| Technologie               | Wofür                                                                         |
| ------------------------- | ----------------------------------------------------------------------------- |
| Zod                       | Schemas für Eingaben und Daten, gemeinsam für API, Oberfläche und Sprachagent |
| Hono                      | REST-API, je Bereich eine App (Einstellungen, Anrufe, Benutzer)               |
| AWS Lambda, API Gateway   | Betrieb der API, Prüfung der Anmeldung über Cognito                           |
| Amazon Cognito            | Benutzerkonten, Anmeldung mit Zwei-Faktor-Code                                |
| EventBridge Scheduler     | Nächtliches Erzeugen der Terminslots                                          |
| Powertools for AWS Lambda | Strukturierte Protokolle ohne Patientendaten                                  |

**Sprachagent**

| Technologie                     | Wofür                                                            |
| ------------------------------- | ---------------------------------------------------------------- |
| Amazon Nova 2.5 Sonic (Bedrock) | Das Gespräch selbst: Sprache rein, Sprache raus, Werkzeugaufrufe |
| Amazon Polly                    | Feste Ansagen wortgenau (Begrüßung, 112, Verabschiedung)         |
| WebSocket (`ws`)                | Testanruf aus dem Browser                                        |
| ECS Fargate                     | Dauerhaft laufender Container für die Gespräche                  |

**Telefonie**

| Technologie                                               | Wofür                                                      |
| --------------------------------------------------------- | ---------------------------------------------------------- |
| Amazon Chime SDK (SIP Media Application, Voice Connector) | Rufnummer, Annahme und Weiterleitung von Anrufen           |
| SIP, RTP, G.711                                           | Telefonleitung direkt im Sprachagenten, ohne Telefonanlage |

**Daten**

| Technologie       | Wofür                                                                         |
| ----------------- | ----------------------------------------------------------------------------- |
| DynamoDB          | Zwei Tabellen: Planung (Einstellungen, Slots, Benutzer, Protokoll) und Anrufe |
| AWS KMS           | Eigener Schlüssel für die Anruftabelle                                        |
| EventBridge Pipes | Ereignis bei neuem Anliegen, nur mit Kennungen                                |
| Secrets Manager   | Schlüssel für die Tickets des Testanrufs                                      |

**Infrastruktur und Werkzeuge**

| Technologie        | Wofür                                                                                  |
| ------------------ | -------------------------------------------------------------------------------------- |
| AWS CDK            | Gesamte Infrastruktur als Code                                                         |
| CloudFront, S3     | Auslieferung der Oberfläche; leitet `/v1` an die API und `/voice` an den Sprachagenten |
| AWS WAF (optional) | Schutz der API                                                                         |
| Vitest             | Tests aller Workspaces                                                                 |
| Biome              | Lint und Formatierung                                                                  |

## Lokal entwickeln

Ohne AWS-Konto: API und Sprachagent laufen in einem Prozess auf Daten im Arbeitsspeicher, mit einer Beispielpraxis und erfundenen Anrufen des Tages. Eine Anmeldung gibt es lokal nicht; oben rechts lässt sich zwischen zwei Beispielbenutzern (Administration, Praxisteam) wechseln.

```sh
npm install          # Abhängigkeiten aller Workspaces
npm run dev:api      # API und Sprachagent auf http://localhost:8787
npm run dev:web      # Weboberfläche auf http://localhost:5173
npm run check        # Lint, Typprüfung und Tests
```

Den Assistenten spielt lokal ein Skript, das getippte Stichworte versteht („Termin“, „Rezept“, „Sprechzeiten“ …). Mit `CALLISTO_MODEL=nova npm run dev:api` spricht der Testanruf stattdessen mit Nova Sonic auf Bedrock; dafür werden AWS-Zugangsdaten in der Shell und der freigeschaltete Modellzugriff in Stockholm gebraucht.

Der Entwicklungsserver öffnet außerdem eine Telefonleitung auf `sip:praxis@127.0.0.1:5060` (SIP über UDP, G.711). Ein Softphone wie Linphone ruft dort an wie ein Patient. Für gesprochene Antworten braucht es `CALLISTO_MODEL=nova`, denn das Skript versteht keine Sprache.

## Ausrollen auf AWS

Schritt für Schritt: [docs/de/quickstart.md](docs/de/quickstart.md).

```sh
npm run synth        # Weboberfläche bauen, CloudFormation-Vorlagen erzeugen
npm run diff         # Unterschied zum ausgerollten Stand
npm run deploy       # alle Stacks ausrollen
```
