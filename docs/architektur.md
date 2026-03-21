# Architektur

Stand: März 2026. Dieses Dokument hält fest, wie Callisto aufgebaut ist und warum.

## Grundidee

Ein eigener Sprachagent führt das Gespräch mit Amazon Nova 2 Sonic, einem Speech-to-Speech-Modell auf Amazon Bedrock. Telefon, Sprachtest im Browser und Texteingabe sind drei Eingänge in denselben Agenten. Der Testmodus verhält sich deshalb wie ein echter Anruf und braucht keine Telefonnummer. Alles außer dem Agenten ist serverless und kostet im Leerlauf fast nichts.

```
Telefon
  Patient ─► Telefonnetz ─► SIP Media Application ────────────────────► Voice Connector
                            · Anrufablauf-Lambda                            │ SIP/RTP, G.711, 8 kHz
                            · verbindet bei Bedarf zur Praxis               │
                                                                            ▼
Testanruf
  Browser ─► CloudFront /voice ─► ALB (privat) ───────────────────────► Sprachagent (ECS Fargate)
                                                                            │ ◄─► Nova 2 Sonic und Polly (Bedrock, Stockholm)
                                                                            │ Werkzeuge, Transkript
                                                                            ▼
Weboberfläche
  Praxisteam ─► CloudFront ─┬─► S3 (Weboberfläche)
                            └─► /v1 ─► API Gateway ─► Lambda ─────────► DynamoDB ─► EventBridge Pipe ─► Event-Bus
                                                                                    (Anliegen-Ereignisse, später PVS)
```

## Ablauf eines Anrufs

1. Chime SDK nimmt den Anruf an und reicht ihn per SIP an den Agenten weiter. Ist der Agent nicht erreichbar, verbindet die SIP Media Application direkt mit der zweiten Rufnummer der Praxis.
2. Der Agent lädt die Konfiguration der Praxis mit einer Abfrage und bestimmt in Code, ob geöffnet, geschlossen, Feiertag oder Urlaub ist (`openingStateAt` in `packages/domain`). Das Sprachmodell bekommt das Ergebnis als Tatsache und muss es nicht selbst herleiten.
3. Aus dem Zustand folgt das Ansage-Preset: der Text, der angesagt wird, und was der Assistent in diesem Zustand tun darf (Termine, Rezepte, Rückrufe, Verbinden).
4. Feste Ansagen (KI-Hinweis, Abwesenheit, Notfall) werden wortgenau per Polly gesprochen, der freie Dialog kommt aus Sonic.
5. Werkzeuge laufen im Prozess des Agenten direkt gegen DynamoDB: Termine suchen und buchen, Rezept aufnehmen, Anliegen aufnehmen und verbinden, Rückruf anlegen, Notfall, auflegen.
6. Notfälle sind doppelt abgesichert: Sonic hat ein Notfall-Werkzeug, und unabhängig davon prüft ein Muster-Abgleich außerhalb des Modells jede Äußerung des Anrufers (`services/voice-agent/src/emergency.ts`) und kann übersteuern. Beide Wege sprechen einen festen Satz mit der 112 und beenden das Gespräch.
7. Anruf, Transkript und Anliegen werden während des Gesprächs gespeichert; das Tagesgeschehen zeigt sie nach wenigen Sekunden. Die Kurzfassung eines Anrufs wird aus seinen Anliegen gebildet, nicht von einem weiteren Sprachmodell: Sie ist so verlässlich wie die Anliegen selbst, und das Transkript verlässt Frankfurt dafür nicht noch einmal.

## Bausteine

| Bereich       | Wahl                                                                           | Grund                                                                                                                                |
| ------------- | ------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------ |
| Sprachmodell  | Nova 2 Sonic, Bedrock in Stockholm                                             | Deutsche Stimmen, Werkzeugaufrufe und Texteingabe in einem Modell; einzige EU-Region                                                 |
| Agent         | ECS Fargate hinter einem privaten Load Balancer, erreichbar über CloudFront    | Ein Gespräch ist ein langlebiger Audiostrom, den Lambda nicht halten kann; TLS kommt von CloudFront, daher keine eigene Domain nötig |
| Telefonie     | Chime SDK (Nummer, SIP Media Application, Voice Connector); SIP/RTP im Agenten | Kein eigener Telefonie-Server nötig; verbindet zur Praxis auch, wenn der Agent ausfällt                                              |
| API           | API Gateway (REST) und Lambda (TypeScript, Hono)                               | Token- und Scope-Prüfung am Gateway, Usage Plans für Integrationen                                                                   |
| Daten         | DynamoDB, zwei Tabellen                                                        | Millisekunden-Zugriffe im Gespräch, keine Leerlaufkosten                                                                             |
| Ereignisse    | DynamoDB Stream → EventBridge Pipe → EventBridge-Bus                           | Jede Änderung an einem Anliegen wird ein Ereignis (nur IDs, keine Patientendaten); hier dockt eine PVS-Anbindung an                  |
| Live-Updates  | Abfrage alle 10 Sekunden                                                       | Für wenige Arbeitsplätze einfacher und günstiger als ein Push-Kanal (siehe unten)                                                    |
| Weboberfläche | React und TypeScript auf S3 und CloudFront                                     | Statische Auslieferung; `/v1` wird über CloudFront an die API gereicht, daher kein CORS                                              |
| Anmeldung     | Cognito, Managed Login, Authorization Code mit PKCE                            | Zugangsdaten berühren unseren Code nie; Zwei-Faktor ist Pflicht                                                                      |
| Infrastruktur | CDK (TypeScript)                                                               | Eine Umgebung entsteht mit einem Befehl                                                                                              |

## Daten

Zwei Tabellen, alle Schlüssel tragen die Praxis-ID:

- **Planung** (`packages/data/src/keys.ts`): Einstellungen, Sprechzeiten, Schließzeiten, Ansage-Presets, Kategorien, Slot-Vorlagen, Rollen, Benutzerprofile, Slots, Audit-Log. Die gesamte Konfiguration einer Praxis liegt in einer Partition und wird mit einer Abfrage geladen.
- **Anrufe**: Anrufe, Transkript-Abschnitte und Anliegen. Eigener KMS-Schlüssel, automatische Löschfrist über TTL, Stream für Ereignisse.

Slots werden aus den Vorlagen als einzelne Einträge erzeugt. Ihre IDs sind deterministisch, ein erneutes Erzeugen dupliziert also nichts. Eine Buchung ist ein bedingter Schreibzugriff, damit sind Doppelbuchungen ausgeschlossen.

RDS wurde verworfen: Es kostet auch im Leerlauf, braucht ein VPC mit NAT, und ein pausiertes Aurora würde mitten im Anruf sekundenlang aufwachen.

## Rechte

Cognito beantwortet nur die Frage, wer angemeldet ist. Was jemand darf, steht in der Planungstabelle: Jedes Benutzerprofil verweist auf eine Rolle, jede Rolle ist eine Liste von Einzelrechten (`packages/domain/src/access.ts`). Die API lädt Profil und Rolle bei jeder Anfrage (30 Sekunden zwischengespeichert). Eine Rollenänderung oder Sperrung wirkt deshalb sofort und nicht erst, wenn das Token abläuft.

## Datenschutz

- Patientendaten sind Gesundheitsdaten. § 393 SGB V verlangt dafür C5-testierte Cloud-Dienste und Verarbeitung in der EU. Deshalb werden nur Dienste aus dem C5-Umfang von AWS eingesetzt, die Daten liegen in Frankfurt, Sonic läuft in Stockholm.
- Es wird kein Audio gespeichert, nur Transkripte mit Löschfrist.
- Der Assistent sagt zu Beginn, dass er ein KI-Assistent ist, und gibt keinen medizinischen Rat.
- Request-Inhalte werden nie geloggt; Zugriffslogs enthalten die Routenvorlage statt der Adresse.
- Auftragsverarbeitung, § 203-Zusatz und Patienteninformation regelt die Praxis.

## Weboberfläche

Das Hauptfenster ist das Tagesgeschehen: **Anliegen** (die Arbeitsliste der Praxis: Termine, Rezeptwünsche, Rückrufe, durchgestellte Anliegen) und **Anrufe** eines Tages, jeweils mit dem Gesprächsverlauf im Detailbereich. Alles, was selten geändert wird, liegt in einem **Einstellungs-Sheet**, das sich über das Tagesgeschehen legt (Menüleiste „Einstellungen“ oder Alt+Komma, schließen mit Esc). Der **Testanruf** (Menüleiste „Testanruf“) führt ein Gespräch per Text oder Mikrofon über dieselbe Sitzung wie ein Telefonanruf; was dabei entsteht, ist als Test gekennzeichnet.

Jede Ansicht beschreibt ihre Befehle einmal; Symbolleiste, Menüleiste, Kontextmenü und Tastenkürzel werden daraus erzeugt (`apps/web/src/shell/commands.ts`).

## Live-Aktualisierung

Geplant war ein Push-Kanal (AppSync Events). Umgesetzt ist eine Abfrage alle zehn Sekunden, solange der Tab sichtbar ist. Bei einer Praxis mit wenigen Arbeitsplätzen sind das pro Browser und Monat rund 200.000 Anfragen, also unter einem Dollar, ohne einen weiteren Dienst, dessen Verbindungen und Berechtigungen gepflegt werden müssen. Ein laufender Anruf wird im Detailbereich alle 1,5 Sekunden nachgeladen.

## Kosten (Schätzung, Frankfurt)

| Posten                                                                    | Monatlich                                 |
| ------------------------------------------------------------------------- | ----------------------------------------- |
| Lambda, API Gateway, DynamoDB, CloudFront, Cognito (Grundlast)            | wenige USD                                |
| KMS-Schlüssel, Secret                                                     | ca. 1,40 USD                              |
| WAF (optional)                                                            | ca. 9 USD                                 |
| Sprachagent: Fargate 0,5 vCPU/1 GB ARM, privater Load Balancer (optional) | ca. 40 USD                                |
| Nova Sonic je Gesprächsminute                                             | ca. 2 ct (Schätzung aus den Tokenpreisen) |

Der Load Balancer ist gegenüber dem ersten Entwurf hinzugekommen: Der Browser baut die WebSocket-Verbindung nur über TLS auf, und Fargate-Tasks haben keine feste Adresse. Er liegt in privaten Subnetzen und ist nur über CloudFront erreichbar (CloudFront VPC Origin). So kommen Weboberfläche, API und Testanruf unter einer Adresse an, mit dem Zertifikat von CloudFront, und eine eigene Domain ist für nichts nötig.

## Bewusst nicht gewählt

- **Amazon Connect mit eingebautem Sonic-Agenten:** keine eigene SIP-Strecke, aber Werkzeuge nur über AgentCore Gateway (nicht im C5-Umfang, Stand Januar 2026) und die Gesprächslogik als Konfiguration statt als Code. Bleibt der Ausweichplan, die Werkzeuge sind wiederverwendbar.
- **RAG:** Das Praxiswissen passt in den Prompt, das ist schneller und zuverlässiger.

## Stand

| Teil                                                                                     | Stand                                                                                       |
| ---------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------- |
| Datenmodell, Anmeldung, API, Infrastruktur                                               | umgesetzt, lokal getestet, noch nicht ausgerollt                                            |
| Einstellungen: Sprechzeiten, Schließzeiten, Ansagen, Kategorien, Slots, Benutzer, Rollen | umgesetzt                                                                                   |
| Sprachagent mit Testmodus (Text und Sprache)                                             | umgesetzt; lokal mit einem Skript-Modell getestet, gegen Nova Sonic noch nicht              |
| Tagesgeschehen: Anliegen, Anrufe, Transkripte                                            | umgesetzt                                                                                   |
| Anliegen-Ereignisse für eine PVS-Anbindung                                               | umgesetzt (EventBridge), noch ohne Abnehmer                                                 |
| Telefonie                                                                                | umgesetzt und mit einem simulierten Telefon getestet; gegen eine echte Rufnummer noch nicht |

### Telefonie

Ein Anruf auf die Praxisnummer läuft so:

1. Die **SIP Media Application** (Chime SDK) nimmt ihn an und ruft für jedes Ereignis die Anrufablauf-Lambda auf (`services/api/src/telephony/call-flow.ts`).
2. Diese verbindet den Anruf über den **Voice Connector** mit dem Sprachagenten (`CallAndBridge`) und gibt die Kennung des Anrufs als SIP-Header mit.
3. Der **Sprachagent** nimmt den Anruf selbst per SIP an (`services/voice-agent/src/telephony`): G.711 über RTP, 8 kHz, dieselbe Gesprächssitzung wie der Testanruf.
4. **Verbinden:** Der Agent vermerkt den Wunsch in der Datenbank und legt auf. Die Anrufablauf-Lambda sieht den Vermerk und verbindet den Anrufer mit der zweiten Rufnummer der Praxis (Einstellungen → Praxis → „Weiterleitung an“).
5. **Ausfall:** Ist der Agent nicht erreichbar, verbindet die Lambda direkt mit der Praxis.
6. **Notfall:** Der Agent sagt den Satz mit der 112 vollständig an und legt dann auf.

Der Sprachagent hat keine feste Adresse. Jeder Container trägt beim Start seine öffentliche Adresse als Ziel des Voice Connectors ein; dafür braucht es keine Domain. SIP und RTP sind in der Firewall nur für den Adressbereich der Voice Connectoren in Frankfurt offen.

Zwischen Voice Connector und Agent laufen SIP und RTP unverschlüsselt, aber nur innerhalb des AWS-Netzes. Das Telefonnetz davor ist ohnehin unverschlüsselt. Wer das ändern will: TLS und SRTP am Voice Connector einschalten und im Agenten ergänzen.

Für Chime SDK gibt es keine CloudFormation-Ressourcen. Voice Connector, SIP Media Application und SIP-Regel legt deshalb eine Custom Resource an (`services/api/src/telephony/provision.ts`).
