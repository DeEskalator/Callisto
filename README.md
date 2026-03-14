# Callisto

KI-Telefonassistent für Arztpraxen auf AWS. Die Praxis leitet ihre Telefonanlage auf eine Nummer
um; der Assistent nimmt Termine und Rezeptwünsche auf, verbindet bei sonstigen Anliegen mit der
Praxis, erkennt Notfälle und kennt Sprechzeiten und Urlaub. Das Praxisteam sieht alle Anrufe in
einer Weboberfläche und konfiguriert dort den Assistenten.

Architektur und Entscheidungen: [docs/architektur.md](docs/architektur.md).

## Aufbau

| Ordner                 | Inhalt                                                                    |
| ---------------------- | ------------------------------------------------------------------------- |
| `packages/domain`      | Fachlogik ohne AWS: Schemas, Sprechzeiten, Feiertage, Terminslots, Rechte |
| `packages/data`        | DynamoDB-Schlüsselschema und Repositories                                 |
| `services/api`         | REST-API der Weboberfläche (Lambda hinter API Gateway)                    |
| `services/voice-agent` | Sprachagent: Gesprächssitzung, Nova Sonic, Werkzeuge, Testmodus           |
| `apps/web`             | Weboberfläche (React): Tagesgeschehen, Einstellungen, Testanruf           |
| `infra`                | AWS-Infrastruktur als CDK-App                                             |

## Lokal entwickeln

Ohne AWS-Konto: API und Sprachagent laufen in einem Prozess auf Daten im Arbeitsspeicher, mit
einer Beispielpraxis und erfundenen Anrufen des Tages. Eine Anmeldung gibt es lokal nicht; oben
rechts lässt sich zwischen zwei Beispielbenutzern (Administration, Praxisteam) wechseln.

```sh
npm install          # Abhängigkeiten aller Workspaces
npm run dev:api      # API und Sprachagent auf http://localhost:8787
npm run dev:web      # Weboberfläche auf http://localhost:5173
npm run check        # Lint, Typprüfung und Tests
```

Den Assistenten spielt lokal ein Skript, das getippte Stichworte versteht („Termin“, „Rezept“,
„Sprechzeiten“ …). Mit `CALLISTO_MODEL=nova npm run dev:api` spricht der Testanruf stattdessen
mit Nova Sonic auf Bedrock; dafür werden AWS-Zugangsdaten in der Shell und der freigeschaltete
Modellzugriff in Stockholm gebraucht.

Der Entwicklungsserver öffnet außerdem eine Telefonleitung auf `sip:praxis@127.0.0.1:5060`
(SIP über UDP, G.711). Ein Softphone wie Linphone ruft dort an wie ein Patient. Für gesprochene
Antworten braucht es `CALLISTO_MODEL=nova`, denn das Skript versteht keine Sprache.

## Ausrollen auf AWS

Siehe [docs/konfiguration.md](docs/konfiguration.md).

```sh
npm run synth        # Weboberfläche bauen, CloudFormation-Vorlagen erzeugen
npm run diff         # Unterschied zum ausgerollten Stand
npm run deploy       # alle Stacks ausrollen
```
