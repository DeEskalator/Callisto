# Callisto

KI-Telefonassistent für Arztpraxen auf AWS. Die Praxis leitet ihre Telefonanlage auf eine Nummer um; der Assistent nimmt Termine und Rezeptwünsche auf, verbindet bei sonstigen Anliegen mit der Praxis, erkennt Notfälle und kennt Sprechzeiten und Urlaub. Das Praxisteam sieht alle Anrufe in einer Weboberfläche und konfiguriert dort den Assistenten.

- **Ausrollen in wenigen Schritten:** [docs/quickstart.md](docs/quickstart.md)
- Konfiguration und Telefonie: [docs/konfiguration.md](docs/konfiguration.md)
- Architektur und Entscheidungen: [docs/architektur.md](docs/architektur.md)

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

Alles ist TypeScript in npm-Workspaces. Patientendaten liegen in Frankfurt (`eu-central-1`), das Sprachmodell läuft in Stockholm (`eu-north-1`). Warum welche Wahl getroffen wurde, steht in [docs/architektur.md](docs/architektur.md).

**Weboberfläche**

| Technologie             | Wofür                                                              | Code                                                                             |
| ----------------------- | ------------------------------------------------------------------ | -------------------------------------------------------------------------------- |
| React, Vite             | Single-Page-App, Entwicklungsserver und Build                      | `apps/web/src/main.tsx`, `apps/web/vite.config.ts`                               |
| TanStack Router         | Ansichten und Adressen, auch für das Einstellungs-Sheet            | `apps/web/src/app/router.tsx`                                                    |
| TanStack Query          | Serverdaten laden, zwischenspeichern, alle 10 Sekunden auffrischen | `apps/web/src/app/queries.ts`                                                    |
| Hono RPC-Client         | Typsichere Aufrufe der API mit den Typen der API selbst            | `apps/web/src/app/api.ts`                                                        |
| Radix UI                | Menüleiste, Kontextmenüs, Dialoge, Meldungen                       | `apps/web/src/shell/AppMenubar.tsx`, `apps/web/src/ui/`                          |
| react-resizable-panels  | Verschiebbare Navigation und Detailbereich                         | `apps/web/src/shell/AppShell.tsx`, `apps/web/src/shell/ViewFrame.tsx`            |
| react-oidc-context      | Anmeldung über Cognito (Code-Flow mit PKCE)                        | `apps/web/src/app/session.tsx`                                                   |
| Web Audio, AudioWorklet | Mikrofon und Lautsprecher im Testanruf                             | `apps/web/src/features/testcall/audio.ts`, `apps/web/public/recorder-worklet.js` |
| CSS-Variablen           | Gestaltung hell und dunkel                                         | `apps/web/src/styles/`                                                           |

**API und Fachlogik**

| Technologie               | Wofür                                                                         | Code                                                                            |
| ------------------------- | ----------------------------------------------------------------------------- | ------------------------------------------------------------------------------- |
| Zod                       | Schemas für Eingaben und Daten, gemeinsam für API, Oberfläche und Sprachagent | `packages/domain/src/`                                                          |
| Hono                      | REST-API, je Bereich eine App (Einstellungen, Anrufe, Benutzer)               | `services/api/src/admin/`, `services/api/src/calls/`, `services/api/src/users/` |
| AWS Lambda, API Gateway   | Betrieb der API, Prüfung der Anmeldung über Cognito                           | `services/api/src/*/handler.ts`, `infra/lib/api-stack.ts`                       |
| Amazon Cognito            | Benutzerkonten, Anmeldung mit Zwei-Faktor-Code                                | `services/api/src/users/directory.ts`, `infra/lib/auth-stack.ts`                |
| EventBridge Scheduler     | Nächtliches Erzeugen der Terminslots                                          | `services/api/src/scheduling/`, `infra/lib/api-stack.ts`                        |
| Powertools for AWS Lambda | Strukturierte Protokolle ohne Patientendaten                                  | `services/api/src/lib/app.ts`                                                   |

**Sprachagent**

| Technologie                     | Wofür                                                            | Code                                                                       |
| ------------------------------- | ---------------------------------------------------------------- | -------------------------------------------------------------------------- |
| Amazon Nova 2.5 Sonic (Bedrock) | Das Gespräch selbst: Sprache rein, Sprache raus, Werkzeugaufrufe | `services/voice-agent/src/nova-sonic-model.ts`                             |
| Amazon Polly                    | Feste Ansagen wortgenau (Begrüßung, 112, Verabschiedung)         | `services/voice-agent/src/speech.ts`, `services/voice-agent/src/prompt.ts` |
| WebSocket (`ws`)                | Testanruf aus dem Browser                                        | `services/voice-agent/src/server.ts`                                       |
| ECS Fargate                     | Dauerhaft laufender Container für die Gespräche                  | `services/voice-agent/Dockerfile`, `infra/lib/voice-stack.ts`              |

**Telefonie**

| Technologie                                               | Wofür                                                      | Code                                                    |
| --------------------------------------------------------- | ---------------------------------------------------------- | ------------------------------------------------------- |
| Amazon Chime SDK (SIP Media Application, Voice Connector) | Rufnummer, Annahme und Weiterleitung von Anrufen           | `services/api/src/telephony/`, `infra/lib/telephony.ts` |
| SIP, RTP, G.711                                           | Telefonleitung direkt im Sprachagenten, ohne Telefonanlage | `services/voice-agent/src/telephony/`                   |

**Daten**

| Technologie       | Wofür                                                                         | Code                                                                |
| ----------------- | ----------------------------------------------------------------------------- | ------------------------------------------------------------------- |
| DynamoDB          | Zwei Tabellen: Planung (Einstellungen, Slots, Benutzer, Protokoll) und Anrufe | `packages/data/src/keys.ts` (Schlüsselschema), `packages/data/src/` |
| AWS KMS           | Eigener Schlüssel für die Anruftabelle                                        | `infra/lib/data-stack.ts`                                           |
| EventBridge Pipes | Ereignis bei neuem Anliegen, nur mit Kennungen                                | `infra/lib/data-stack.ts`                                           |
| Secrets Manager   | Schlüssel für die Tickets des Testanrufs                                      | `packages/data/src/ticket.ts`, `infra/lib/data-stack.ts`            |

**Infrastruktur und Werkzeuge**

| Technologie        | Wofür                                                                                  | Code                                  |
| ------------------ | -------------------------------------------------------------------------------------- | ------------------------------------- |
| AWS CDK            | Gesamte Infrastruktur als Code                                                         | `infra/bin/callisto.ts`, `infra/lib/` |
| CloudFront, S3     | Auslieferung der Oberfläche; leitet `/v1` an die API und `/voice` an den Sprachagenten | `infra/lib/web-stack.ts`              |
| AWS WAF (optional) | Schutz der API                                                                         | `infra/lib/api-stack.ts`              |
| Vitest             | Tests aller Workspaces                                                                 | `*/test/`, `vitest.config.ts`         |
| Biome              | Lint und Formatierung                                                                  | `biome.json`                          |

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

Schritt für Schritt: [docs/quickstart.md](docs/quickstart.md).

```sh
npm run synth        # Weboberfläche bauen, CloudFormation-Vorlagen erzeugen
npm run diff         # Unterschied zum ausgerollten Stand
npm run deploy       # alle Stacks ausrollen
```
