# Konfiguration einer Umgebung

Eine Umgebung (z. B. `dev` oder `prod`) wird durch `infra/config.json` beschrieben. Die Datei
wird nicht eingecheckt, weil sie eine konkrete Praxis beschreibt. Solange sie fehlt, wird
`infra/config.example.json` verwendet.

```json
{
  "stage": "prod",
  "account": "123456789012",
  "region": "eu-central-1",
  "production": true,
  "practice": {
    "id": "main",
    "name": "Hausarztpraxis Muster",
    "federalState": "NW",
    "adminEmail": "praxis@example.de",
    "adminName": "Praxisleitung"
  },
  "domain": {
    "hostedZoneId": "Z0123456789ABCDEFGHIJ",
    "zoneName": "praxis-muster.de",
    "appHost": "app.praxis-muster.de",
    "apiHost": "api.praxis-muster.de",
    "voiceHost": "voice.praxis-muster.de"
  },
  "devOrigins": [],
  "waf": true,
  "voice": true
}
```

| Feld         | Bedeutung                                                                                                                       |
| ------------ | ------------------------------------------------------------------------------------------------------------------------------- |
| `stage`      | Name der Umgebung; Teil aller Stack- und Ressourcennamen.                                                                       |
| `account`    | AWS-Konto; ohne Angabe das Konto der aktuellen Zugangsdaten.                                                                    |
| `region`     | Region der Daten. Frankfurt (`eu-central-1`) ist vorgesehen.                                                                    |
| `production` | Schützt Tabellen und Benutzerkonten gegen Löschen und behält sie, wenn ein Stack entfernt wird.                                 |
| `practice`   | Die Praxis, die beim ersten Ausrollen angelegt wird, und das erste Administrationskonto (Einladung per E-Mail).                 |
| `domain`     | Eigene Domain in Route 53. Ohne sie läuft die Weboberfläche unter einer CloudFront-Adresse.                                     |
| `devOrigins` | Weitere Adressen, die sich anmelden und die API aufrufen dürfen, z. B. `http://localhost:5173`.                                 |
| `waf`        | AWS WAF vor der API (ca. 9 USD im Monat).                                                                                       |
| `voice`      | Sprachagent für Testmodus und Telefon (ca. 45 USD im Monat). Braucht `domain`, weil der Browser Sprache nur über TLS überträgt. |

## Ausrollen

```sh
npx cdk bootstrap                         # einmalig je Konto und Region
npx cdk bootstrap aws://<konto>/us-east-1 # zusätzlich, wenn eine Domain verwendet wird
npm run deploy
```

`npm run deploy` baut die Weboberfläche und rollt alle Stacks aus. Für den Sprachagenten muss
Docker laufen, weil das Container-Image beim Ausrollen gebaut wird.

## Nova Sonic freischalten

Der Sprachagent ruft Amazon Nova 2 Sonic in Stockholm (`eu-north-1`) auf, der einzigen
EU-Region des Modells. Der Modellzugriff muss dort einmalig in der Bedrock-Konsole aktiviert
werden.
