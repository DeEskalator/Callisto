# Konfiguration einer Umgebung

Eine Umgebung (z. B. `dev` oder `prod`) wird durch `infra/config.json` beschrieben. Die Datei wird nicht eingecheckt, weil sie eine konkrete Praxis beschreibt. Solange sie fehlt, wird `infra/config.example.json` verwendet.

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
    "apiHost": "api.praxis-muster.de"
  },
  "devOrigins": [],
  "waf": true,
  "voice": true,
  "telephony": { "phoneNumber": "+493012345000" }
}
```

| Feld         | Bedeutung                                                                                                                                                                                                             |
| ------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `stage`      | Name der Umgebung; Teil aller Stack- und Ressourcennamen.                                                                                                                                                             |
| `account`    | AWS-Konto; ohne Angabe das Konto der aktuellen Zugangsdaten.                                                                                                                                                          |
| `region`     | Region der Daten. Frankfurt (`eu-central-1`) ist vorgesehen.                                                                                                                                                          |
| `production` | Ob Daten und Benutzerkonten beim Abbauen und durch Versehen gelöscht werden können. `false`: werden mit gelöscht. `true`: bleiben erhalten und sind gegen Löschen geschützt. Siehe [unten](#der-schalter-production). |
| `practice`   | Die Praxis, die beim ersten Ausrollen angelegt wird, und das erste Administrationskonto (Einladung per E-Mail).                                                                                                       |
| `domain`     | Optional. Eigene Domain in Route 53 für eine schönere Adresse. Ohne sie läuft alles unter der kostenlosen CloudFront-Adresse (`https://<id>.cloudfront.net`), auch Testanruf und Telefonie.                           |
| `devOrigins` | Weitere Adressen, die sich anmelden und die API aufrufen dürfen, z. B. `http://localhost:5173`.                                                                                                                       |
| `waf`        | AWS WAF vor der API (ca. 9 USD im Monat).                                                                                                                                                                             |
| `voice`      | Sprachagent für Testanruf und Telefon (ca. 40 USD im Monat). Braucht keine Domain.                                                                                                                                    |

## Der Schalter `production`

Der Schalter betrifft genau vier Ressourcen, die die Daten der Praxis halten:

- die Planungstabelle (Einstellungen, Sprechzeiten, Termine, Benutzerprofile, Protokoll),
- die Anruftabelle (Anrufe, Transkripte, Anliegen),
- den KMS-Schlüssel, mit dem die Anruftabelle verschlüsselt ist,
- den Benutzerpool in Cognito (die Anmeldekonten).

Für sie legt er zweierlei fest:

|                                               | `"production": false`                                                                                                          | `"production": true`                                                                                                                                                                   |
| --------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Beim Abbauen (`cdk destroy`)                  | Die vier werden gelöscht, mit allen Daten und Konten. Der Schlüssel wird nach einer Wartezeit von 30 Tagen endgültig gelöscht. | Sie bleiben bestehen; nur alles andere wird abgebaut. Daten und Konten sind danach noch da und verursachen weiter Kosten (z. B. 1 USD im Monat für den Schlüssel).                     |
| Löschschutz bei AWS                           | aus                                                                                                                            | an: Tabellen und Benutzerpool lassen sich auch in der Konsole oder per API nicht löschen, bis der Schutz bewusst abgeschaltet wird. Für den Schlüssel gibt es keinen solchen Schalter. |
| Änderung, die eine Tabelle neu anlegen müsste | Die alte Tabelle wird gelöscht.                                                                                                | Die alte Tabelle bleibt mit ihren Daten stehen.                                                                                                                                        |

Was er nicht beeinflusst: Kosten, Leistung, Sicherheit (Anmeldung, Zwei-Faktor und Verschlüsselung sind in beiden Fällen gleich) und das Verhalten der Anwendung. Die Point-in-Time-Sicherungen der Tabellen sind immer eingeschaltet; sie werden aber mit der Tabelle gelöscht. Weboberfläche, API, Sprachagent und Logs werden beim Abbauen immer entfernt.

**Wann was:**

- `false` für Umgebungen zum Ausprobieren, die rückstandslos wieder verschwinden sollen.
- `true`, sobald die Praxis mit der Umgebung arbeitet.
- Umstellen geht jederzeit mit einem erneuten `npm run deploy`, ohne dass Daten verloren gehen. Soll eine `true`-Umgebung endgültig abgebaut werden, zuerst auf `false` stellen und einmal ausrollen; erst dann ist der Löschschutz aufgehoben.

## Ausrollen

```sh
npx cdk bootstrap                         # einmalig je Konto und Region
npx cdk bootstrap aws://<konto>/us-east-1 # zusätzlich, wenn eine Domain verwendet wird
npm run deploy
```

`npm run deploy` baut die Weboberfläche und rollt alle Stacks aus. Für den Sprachagenten muss Docker laufen, weil das Container-Image beim Ausrollen gebaut wird. Das erste Ausrollen mit Sprachagent dauert etwas länger, weil CloudFront die Verbindung zum privaten Load Balancer einrichtet (bis zu 15 Minuten).

## Ohne eigene Domain

Die kleinste Konfiguration, mit der alles läuft (Weboberfläche, Testanruf mit Sprache und, sobald die Nummer da ist, Telefonie):

```json
{
  "stage": "dev",
  "region": "eu-central-1",
  "practice": {
    "name": "Hausarztpraxis Muster",
    "federalState": "NW",
    "adminEmail": "praxis@example.de",
    "adminName": "Praxisleitung"
  },
  "devOrigins": [],
  "voice": true
}
```

Die Adresse der Weboberfläche steht nach dem Ausrollen in der Ausgabe `AppUrl` des Web-Stacks.

## Nova Sonic freischalten

Der Sprachagent ruft Amazon Nova 2 Sonic in Stockholm (`eu-north-1`) auf, der einzigen EU-Region des Modells. Der Modellzugriff muss dort einmalig in der Bedrock-Konsole aktiviert werden.

## Telefonie einschalten

1. **Rufnummer bestellen:** In der Amazon-Chime-SDK-Konsole (Telefonnummernverwaltung) oder über den AWS-Support eine deutsche Ortsnummer mit dem Produkttyp „SIP media application dial-in“ anfordern. Dafür werden Gewerbenachweis und eine Adresse im Vorwahlbereich verlangt; die Bereitstellung dauert mehrere Wochen. Alternativ lässt sich eine bestehende Nummer portieren.
2. **Zweite Nummer eintragen:** In der Weboberfläche unter Einstellungen → Praxis → „Weiterleitung an“ die Nummer eintragen, zu der der Assistent verbindet. Sie darf nicht auf den Assistenten umgeleitet sein.
3. **Konfiguration ergänzen:** `"telephony": { "phoneNumber": "+49…" }` in `infra/config.json` und `npm run deploy`.
4. **Umleiten:** Die Telefonanlage der Praxis auf die neue Nummer umleiten (immer oder nur bei Nichtannahme, je nach Wunsch).

Ein Anruf kostet zusätzlich zu Nova Sonic wenige Cent pro Minute für Rufnummer, SIP Media Application und Voice Connector; verbunden zur Praxis kommt die Verbindung ins deutsche Festnetz hinzu.
