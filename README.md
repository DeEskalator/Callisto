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
| `services/voice-agent` | Sprachagent für Telefon und Testmodus (ECS Fargate), folgt                |
| `apps/web`             | Weboberfläche (React), folgt                                              |
| `infra`                | AWS-Infrastruktur als CDK-App                                             |

## Voraussetzungen

- Node.js 24 oder neuer
- AWS CLI mit Zugangsdaten für das Zielkonto
- einmalig je Konto und Region: `npx cdk bootstrap`

## Befehle

```sh
npm install          # Abhängigkeiten aller Workspaces
npm run check        # Lint, Typprüfung und Tests
npm run synth        # CloudFormation-Vorlagen erzeugen
npm run diff         # Unterschied zum ausgerollten Stand
npm run deploy       # alle Stacks ausrollen
```

## Konfiguration einer Umgebung

`infra/config.example.json` nach `infra/config.json` kopieren und anpassen: Name der Umgebung,
Praxisname, Bundesland, E-Mail-Adresse des ersten Administrationskontos und optional die eigene
Domain. Die Datei wird nicht eingecheckt. Beim ersten Ausrollen wird die Praxis mit
Standardwerten angelegt und das Administrationskonto per E-Mail eingeladen.
