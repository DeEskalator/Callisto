# Quickstart: Callisto auf AWS ausrollen

Diese Anleitung führt vom leeren AWS-Konto bis zum ersten Testanruf. Eine eigene Domain und eine Rufnummer sind dafür nicht nötig; beides lässt sich später ergänzen.

## 1. Voraussetzungen

| Was                                        | Wofür                                                      | Prüfen mit                                       |
| ------------------------------------------ | ---------------------------------------------------------- | ------------------------------------------------ |
| Node.js 24 oder neuer                      | Bauen und Ausrollen                                        | `node --version`                                 |
| AWS CLI mit einem Profil für das Zielkonto | Zugang zu AWS                                              | `aws sts get-caller-identity --profile <profil>` |
| Docker (läuft)                             | Container-Image des Sprachagenten; nur mit `"voice": true` | `docker info`                                    |
| Nova 2.5 Sonic freigeschaltet              | Der Sprachagent; nur mit `"voice": true`                   | Bedrock-Konsole, Region Stockholm (`eu-north-1`) |

Ein AWS-Profil lässt sich mit `aws configure sso` oder `aws configure` einrichten.

Abhängigkeiten installieren (im Projektordner):

```sh
npm install
```

## 2. Konfiguration anlegen

`infra/config.json` anlegen (wird nicht eingecheckt):

```json
{
  "stage": "dev",
  "region": "eu-central-1",
  "production": false,
  "practice": {
    "id": "main",
    "name": "Hausarztpraxis Muster",
    "federalState": "NW",
    "adminEmail": "praxis@example.de",
    "adminName": "Praxisleitung"
  },
  "devOrigins": [],
  "waf": false,
  "voice": true
}
```

- `federalState`: Kürzel des Bundeslands (BW, BY, BE, BB, HB, HH, HE, MV, NI, NW, RP, SL, SN, ST, SH, TH). Bestimmt die Feiertage.
- `adminEmail`: Hierhin geht die Einladung für das erste Administrationskonto.
- `voice`: `true` für Testanruf mit Sprache (und später Telefon), ca. 40 USD im Monat. Mit `false` fallen nur wenige Dollar im Monat an, aber es gibt keinen Testanruf.
- `production`: Ob Daten und Benutzerkonten beim Abbauen mit gelöscht werden. `false`: Beim Abbauen verschwindet alles, auch die Daten; richtig zum Ausprobieren. `true`: Tabellen, Schlüssel und Benutzerkonten bleiben beim Abbauen erhalten und sind gegen Löschen geschützt; richtig, sobald die Praxis damit arbeitet. Auf Kosten, Sicherheit und Verhalten der Anwendung hat der Schalter keinen Einfluss. Genaueres: [konfiguration.md](konfiguration.md#der-schalter-production).

Alle Felder: [konfiguration.md](konfiguration.md).

## 3. Konto vorbereiten (einmalig)

CDK braucht im Konto einige Hilfsressourcen („Bootstrap“):

```sh
cd infra
npx cdk bootstrap --profile <profil>
cd ..
```

Nur wenn später eine eigene Domain eingetragen wird, zusätzlich: `npx cdk bootstrap aws://<kontonummer>/us-east-1 --profile <profil>`.

## 4. Ausrollen

```sh
AWS_PROFILE=<profil> npm run deploy
```

Das baut die Weboberfläche und rollt alle Stacks aus. CDK fragt vor neuen Berechtigungen nach; mit `y` bestätigen. Das erste Ausrollen dauert mit Sprachagent etwa 20–30 Minuten (CloudFront richtet die Verbindung zum Sprachagenten ein), ohne etwa 10 Minuten.

Am Ende steht in der Ausgabe:

```
Callisto-dev-Web.AppUrl = https://d1234abcd.cloudfront.net
```

Das ist die Adresse der Weboberfläche.

## 5. Erste Anmeldung

1. Die E-Mail „Ihr Zugang zum Telefonassistenten“ an `adminEmail` enthält Benutzername und vorläufiges Passwort (7 Tage gültig).
2. `AppUrl` öffnen und anmelden.
3. Ein eigenes Passwort vergeben (mindestens 12 Zeichen mit Groß- und Kleinbuchstaben, Ziffer und Sonderzeichen).
4. Die Zwei-Faktor-Anmeldung einrichten: den angezeigten QR-Code mit einer Authenticator-App scannen (z. B. Google Authenticator, Microsoft Authenticator, 1Password).

## 6. Praxis einrichten

Alles unter **Einstellungen** (oben rechts oder Alt+Komma):

1. **Praxis:** Name prüfen, Begrüßung anpassen, bei „Weiterleitung an“ die zweite Rufnummer der Praxis eintragen (die nicht auf den Assistenten umgeleitet ist). Ohne sie bietet der Assistent das Verbinden nicht an.
2. **Sprechzeiten** und **Urlaub & Schließzeiten** eintragen.
3. **Ansagen** prüfen: was der Assistent außerhalb der Sprechzeiten, an Feiertagen und im Urlaub sagt.
4. **Kategorien** anlegen (z. B. Vorsorge, Blutabnahme), dann **Slot-Vorlagen**: wann Termine welcher Kategorie buchbar sind. Der **Kalender** zeigt die erzeugten Termine.
5. **Benutzer:** Konten für das Praxisteam anlegen; jeder bekommt eine eigene Einladung.

## 7. Testanruf

Oben rechts **Testanruf** → **Mit Sprache** (Mikrofon erlauben) oder **Mit Text**. Der Assistent verhält sich wie am Telefon. Ergebnisse stehen unter **Anliegen** (Filter „Tests“) und unter **Anrufe** („Testanrufe zeigen“). Testtermine belegen echte Slots; unter Anliegen lassen sie sich wieder absagen.

## 8. Später: Telefonie

Sobald eine Rufnummer im AWS-Konto ist, in `infra/config.json` ergänzen und erneut ausrollen:

```json
"telephony": { "phoneNumber": "+493012345000" }
```

Wie man die Nummer bekommt und die Praxis umleitet: [konfiguration.md, „Telefonie einschalten“](konfiguration.md#telefonie-einschalten).

## Aktualisieren und entfernen

- **Neue Version ausrollen:** denselben Befehl erneut ausführen, `AWS_PROFILE=<profil> npm run deploy`.
- **Unterschied vorher ansehen:** `AWS_PROFILE=<profil> npm run diff`.
- **Alles entfernen:** im Ordner `infra` `AWS_PROFILE=<profil> npx cdk destroy --all`. Mit `"production": false` werden dabei auch alle Daten gelöscht.

## Wenn etwas nicht klappt

| Meldung                                             | Ursache                                                                                                          |
| --------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------- |
| `The web app has not been built yet`                | `npm run deploy` statt `cdk deploy` direkt verwenden; es baut die Oberfläche vorher.                             |
| `Cannot connect to the Docker daemon`               | Docker starten (nur mit `"voice": true` nötig).                                                                  |
| `has not been bootstrapped`                         | Schritt 3 ausführen.                                                                                             |
| Testanruf: „Der Testmodus ist nicht eingerichtet“   | `"voice": true` fehlt in der Konfiguration.                                                                      |
| Testanruf: keine Antwort, Sprachagent startet nicht | Nova 2.5 Sonic in Stockholm nicht freigeschaltet; Protokoll in CloudWatch unter der Log-Gruppe des Voice-Stacks. |
| Keine Einladungs-E-Mail                             | Spam-Ordner prüfen. Cognito versendet ohne eigene E-Mail-Konfiguration höchstens 50 E-Mails am Tag.              |
