# Architektur

Stand: Dezember 2025. Dieses Dokument hält fest, wie Callisto aufgebaut ist und warum.

## Grundidee

Ein eigener Sprachagent führt das Gespräch mit Amazon Nova 2 Sonic, einem
Speech-to-Speech-Modell auf Amazon Bedrock. Telefon, Sprachtest im Browser und Texteingabe sind
drei Eingänge in denselben Agenten. Der Testmodus verhält sich deshalb wie ein echter Anruf und
braucht keine Telefonnummer. Alles außer dem Agenten ist serverless und kostet im Leerlauf fast
nichts.

```
Patient ─ Telefonnetz ─► Chime SDK (Nummer, SIP Media App)
                              │ SIP/SRTP
                              ▼
 Browser-Testmodus ─WSS─► ┌─────────────────────────────┐
 (Sprache oder Text)      │ Voice-Agent · ECS Fargate   │ ◄─► Bedrock
                          │ Asterisk + Agent (Node/TS)  │     Nova 2 Sonic
                          └──────────────┬──────────────┘
                                         │ Werkzeuge, Transkript
                                         ▼
 Praxisteam ─► CloudFront ─► API Gateway ─► Lambda ─► DynamoDB
   (React-App aus S3)         (Cognito-JWT)              │ Streams
                                                         ▼
                                                  EventBridge-Bus
                          ┌──────────────────┬───────────┴──────┐
                          ▼                  ▼                  ▼
                   AppSync Events     SQS → Lambda       SQS → Connector
                   (Live-Dashboard)   (Kurzfassung)      (PVS, Webhooks)
```

## Ablauf eines Anrufs

1. Chime SDK nimmt den Anruf an und reicht ihn per SIP an den Agenten weiter. Ist der Agent
   nicht erreichbar, spielt die SIP Media App eine Ersatzansage oder verbindet zur Praxis.
2. Der Agent lädt die Konfiguration der Praxis mit einer Abfrage und bestimmt in Code, ob
   geöffnet, geschlossen, Feiertag oder Urlaub ist (`openingStateAt` in `packages/domain`). Das
   Sprachmodell bekommt das Ergebnis als Tatsache und muss es nicht selbst herleiten.
3. Aus dem Zustand folgt das Ansage-Preset: der Text, der angesagt wird, und was der Assistent
   in diesem Zustand tun darf (Termine, Rezepte, Rückrufe, Verbinden).
4. Feste Ansagen (KI-Hinweis, Abwesenheit, Notfall) werden wortgenau per Polly gesprochen, der
   freie Dialog kommt aus Sonic.
5. Werkzeuge laufen im Prozess des Agenten direkt gegen DynamoDB: Termine suchen und buchen,
   Rezept aufnehmen, Anliegen aufnehmen und verbinden, Rückruf anlegen, Notfall, auflegen.
6. Notfälle sind doppelt abgesichert: Sonic hat ein Notfall-Werkzeug, und ein zweites, kleines
   Modell prüft parallel jede Äußerung des Anrufers und kann übersteuern. Beide Wege nennen die
   112 und beenden das Gespräch.
7. Das Transkript läuft live ins Dashboard. Nach dem Gespräch entsteht eine Kurzfassung.

## Bausteine

| Bereich       | Wahl                                                   | Grund                                                                                |
| ------------- | ------------------------------------------------------ | ------------------------------------------------------------------------------------ |
| Sprachmodell  | Nova 2 Sonic, Bedrock in Stockholm                     | Deutsche Stimmen, Werkzeugaufrufe und Texteingabe in einem Modell; einzige EU-Region |
| Agent         | ECS Fargate, ein Task mit Asterisk und Node/TypeScript | Ein Gespräch ist ein langlebiger Audiostrom, den Lambda nicht halten kann            |
| Telefonie     | Chime SDK: Nummer, SIP Media App, Voice Connector      | Günstig; Ersatzansage und Verbinden funktionieren ohne den Agenten                   |
| API           | API Gateway (REST) und Lambda (TypeScript, Hono)       | Token- und Scope-Prüfung am Gateway, Usage Plans für Integrationen                   |
| Daten         | DynamoDB, zwei Tabellen                                | Millisekunden-Zugriffe im Gespräch, keine Leerlaufkosten                             |
| Ereignisse    | DynamoDB Streams, EventBridge, SQS mit DLQ             | Entkoppelt Dashboard, Nachbearbeitung und PVS-Anbindung                              |
| Live-Updates  | AppSync Events                                         | WebSocket-Push ohne eigene Verbindungsverwaltung                                     |
| Weboberfläche | React und TypeScript auf S3 und CloudFront             | Statische Auslieferung; Patientendaten laufen nur über die API in Frankfurt          |
| Anmeldung     | Cognito, Managed Login, Authorization Code mit PKCE    | Zugangsdaten berühren unseren Code nie; Zwei-Faktor ist Pflicht                      |
| Infrastruktur | CDK (TypeScript)                                       | Eine Umgebung entsteht mit einem Befehl                                              |

## Daten

Zwei Tabellen, alle Schlüssel tragen die Praxis-ID:

- **Planung** (`packages/data/src/keys.ts`): Einstellungen, Sprechzeiten, Schließzeiten,
  Ansage-Presets, Kategorien, Slot-Vorlagen, Rollen, Benutzerprofile, Slots, Audit-Log. Die
  gesamte Konfiguration einer Praxis liegt in einer Partition und wird mit einer Abfrage geladen.
- **Anrufe**: Anrufe, Transkript-Abschnitte und Anliegen. Eigener KMS-Schlüssel, automatische
  Löschfrist über TTL, Stream für Ereignisse.

Slots werden aus den Vorlagen als einzelne Einträge erzeugt. Ihre IDs sind deterministisch, ein
erneutes Erzeugen dupliziert also nichts. Eine Buchung ist ein bedingter Schreibzugriff, damit
sind Doppelbuchungen ausgeschlossen.

RDS wurde verworfen: Es kostet auch im Leerlauf, braucht ein VPC mit NAT, und ein pausiertes
Aurora würde mitten im Anruf sekundenlang aufwachen.

## Rechte

Cognito beantwortet nur die Frage, wer angemeldet ist. Was jemand darf, steht in der
Planungstabelle: Jedes Benutzerprofil verweist auf eine Rolle, jede Rolle ist eine Liste von
Einzelrechten (`packages/domain/src/access.ts`). Die API lädt Profil und Rolle bei jeder Anfrage
(30 Sekunden zwischengespeichert). Eine Rollenänderung oder Sperrung wirkt deshalb sofort und
nicht erst, wenn das Token abläuft.

## Datenschutz

- Patientendaten sind Gesundheitsdaten. § 393 SGB V verlangt dafür C5-testierte Cloud-Dienste
  und Verarbeitung in der EU. Deshalb werden nur Dienste aus dem C5-Umfang von AWS eingesetzt,
  die Daten liegen in Frankfurt, Sonic läuft in Stockholm.
- Es wird kein Audio gespeichert, nur Transkripte mit Löschfrist.
- Der Assistent sagt zu Beginn, dass er ein KI-Assistent ist, und gibt keinen medizinischen Rat.
- Request-Inhalte werden nie geloggt; Zugriffslogs enthalten die Routenvorlage statt der Adresse.
- Auftragsverarbeitung, § 203-Zusatz und Patienteninformation regelt die Praxis.

## Bewusst nicht gewählt

- **Amazon Connect mit eingebautem Sonic-Agenten:** keine eigene SIP-Strecke, aber Werkzeuge
  nur über AgentCore Gateway (nicht im C5-Umfang, Stand Dezember 2025) und die Gesprächslogik als
  Konfiguration statt als Code. Bleibt der Ausweichplan, die Werkzeuge sind wiederverwendbar.
- **RAG:** Das Praxiswissen passt in den Prompt, das ist schneller und zuverlässiger.

## Reihenfolge

1. Fundament: Datenmodell, Anmeldung, API-Gerüst, Infrastruktur (in Arbeit)
2. Verwaltung: Sprechzeiten, Schließzeiten, Presets, Kategorien, Slots, Benutzer
3. Sprachagent mit Testmodus
4. Tagesgeschehen live, Nachbearbeitung
5. Telefonie
6. Integrations-API (PVS: CGM Medistar, vorerst nur vorbereitet), Betrieb
