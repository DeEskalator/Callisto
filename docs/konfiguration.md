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
  "voice": true,
  "telephony": { "phoneNumber": "+493012345000" }
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

## Telefonie einschalten

1. **Rufnummer bestellen:** In der Amazon-Chime-SDK-Konsole (Telefonnummernverwaltung) oder
   über den AWS-Support eine deutsche Ortsnummer mit dem Produkttyp „SIP media application
   dial-in“ anfordern. Dafür werden Gewerbenachweis und eine Adresse im Vorwahlbereich verlangt;
   die Bereitstellung dauert mehrere Wochen. Alternativ lässt sich eine bestehende Nummer
   portieren.
2. **Zweite Nummer eintragen:** In der Weboberfläche unter Einstellungen → Praxis →
   „Weiterleitung an“ die Nummer eintragen, zu der der Assistent verbindet. Sie darf nicht auf den
   Assistenten umgeleitet sein.
3. **Konfiguration ergänzen:** `"telephony": { "phoneNumber": "+49…" }` in `infra/config.json`
   und `npm run deploy`.
4. **Umleiten:** Die Telefonanlage der Praxis auf die neue Nummer umleiten (immer oder nur bei
   Nichtannahme, je nach Wunsch).

Ein Anruf kostet zusätzlich zu Nova Sonic wenige Cent pro Minute für Rufnummer, SIP Media
Application und Voice Connector; verbunden zur Praxis kommt die Verbindung ins deutsche Festnetz
hinzu.
