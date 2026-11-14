# Architecture

As of November 2026. This document records how Callisto is built and why.

## Core idea

A dedicated voice agent holds the conversation with Amazon Nova 2.5 Sonic, a speech-to-speech model on Amazon Bedrock. Phone, voice test in the browser and text input are three entrances to the same agent. The test mode therefore behaves like a real call and needs no phone number. Everything except the agent is serverless and costs next to nothing when idle.

```
Phone
  Patient ─► Phone network ─► SIP Media Application ──────────────────► Voice Connector
                              · call flow Lambda                            │ SIP/RTP, G.711, 8 kHz
                              · transfers to the practice when needed       │
                                                                            ▼
Test call
  Browser ─► CloudFront /voice ─► ALB (private) ──────────────────────► Voice agent (ECS Fargate)
                                                                            │ ◄─► Nova 2.5 Sonic and Polly (Bedrock, Stockholm)
                                                                            │ tools, transcript
                                                                            ▼
Web app
  Practice team ─► CloudFront ─┬─► S3 (web app)
                               └─► /v1 ─► API Gateway ─► Lambda ──────► DynamoDB ─► EventBridge Pipe ─► Event bus
                                                                                    (inquiry events, later PMS)
```

## How a call works

1. Chime SDK answers the call and hands it to the agent via SIP. If the agent cannot be reached, the SIP Media Application connects directly to the practice's second phone number.
2. The agent loads the practice's configuration with a single query and determines in code whether the practice is open, closed, on a public holiday or on vacation (`openingStateAt` in `packages/domain`). The language model receives the result as a fact and does not have to derive it.
3. The state determines the announcement preset: the text that is announced and what the assistant may do in this state (appointments, prescriptions, callbacks, transfers).
4. Fixed announcements (AI notice, absence, emergency) are spoken word for word by Polly; the free dialogue comes from Sonic.
5. Tools run inside the agent's process directly against DynamoDB: find and book appointments, take a prescription request, take an inquiry and transfer, create a callback, emergency, hang up.
6. Emergencies are covered twice: Sonic has an emergency tool, and independently a pattern match outside the model checks every utterance of the caller (`services/voice-agent/src/emergency.ts`) and can override. Both paths speak a fixed sentence with 112 and end the call.
7. Call, transcript and inquiries are stored during the conversation; the daily view shows them within a few seconds. A call's summary is built from its inquiries, not by another language model: it is as reliable as the inquiries themselves, and the transcript does not leave Frankfurt again for it.

## Building blocks

| Area           | Choice                                                                           | Reason                                                                                                                     |
| -------------- | -------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------- |
| Language model | Nova 2.5 Sonic, Bedrock in Stockholm                                             | German voices, tool calls and text input in one model; the only EU region                                                  |
| Agent          | ECS Fargate behind a private load balancer, reachable through CloudFront         | A conversation is a long-lived audio stream that Lambda cannot hold; TLS comes from CloudFront, so no own domain is needed |
| Telephony      | Chime SDK (number, SIP Media Application, Voice Connector); SIP/RTP in the agent | No telephony server of our own; still transfers to the practice when the agent fails                                       |
| API            | API Gateway (REST) and Lambda (TypeScript, Hono)                                 | Token and scope checks at the gateway, usage plans for integrations                                                        |
| Data           | DynamoDB, two tables                                                             | Millisecond access during the call, no idle costs                                                                          |
| Events         | DynamoDB Stream → EventBridge Pipe → EventBridge bus                             | Every change to an inquiry becomes an event (IDs only, no patient data); a PMS integration plugs in here                   |
| Live updates   | Polling every 10 seconds                                                         | Simpler and cheaper than a push channel for a few workstations (see below)                                                 |
| Web app        | React and TypeScript on S3 and CloudFront                                        | Static delivery; `/v1` is passed through CloudFront to the API, so no CORS                                                 |
| Sign-in        | Cognito, Managed Login, Authorization Code with PKCE                             | Credentials never touch our code; two-factor is mandatory                                                                  |
| Infrastructure | CDK (TypeScript)                                                                 | An environment is created with one command                                                                                 |

## Data

Two tables, every key carries the practice ID:

- **Planning** (`packages/data/src/keys.ts`): settings, opening hours, closures, announcement presets, categories, slot templates, roles, user profiles, slots, audit log. A practice's entire configuration lives in one partition and is loaded with one query.
- **Calls**: calls, transcript segments and inquiries. Its own KMS key, automatic retention period via TTL, stream for events.

Slots are generated from the templates as individual items. Their IDs are deterministic, so generating them again duplicates nothing. A booking is a conditional write, which rules out double bookings.

RDS was rejected: it costs money even when idle, needs a VPC with NAT, and a paused Aurora would take seconds to wake up in the middle of a call.

## Permissions

Cognito only answers the question of who is signed in. What someone may do is stored in the planning table: every user profile refers to a role, every role is a list of individual permissions (`packages/domain/src/access.ts`). The API loads profile and role on every request (cached for 30 seconds). A role change or a suspension therefore takes effect immediately, not only when the token expires.

## Data protection

- Patient data is health data. § 393 SGB V requires C5-attested cloud services and processing within the EU. That is why only services within AWS's C5 scope are used, the data lives in Frankfurt and Sonic runs in Stockholm.
- No audio is stored, only transcripts with a retention period.
- At the start, the assistant says that it is an AI assistant, and it gives no medical advice.
- Request contents are never logged; access logs contain the route template instead of the path.
- Data processing agreement, § 203 addendum and patient information are the practice's responsibility.

## Web app

The main window is the daily view: **inquiries** (the practice's work list: appointments, prescription requests, callbacks, transferred inquiries) and **calls** of a day, each with the conversation in the detail pane. Everything that changes rarely lives in a **settings sheet** that slides over the daily view (menu bar "Einstellungen" or Alt+Comma, close with Esc). The **test call** (menu bar "Testanruf") holds a conversation by text or microphone through the same session as a phone call; whatever it produces is marked as a test.

Every view describes its commands once; toolbar, menu bar, context menu and keyboard shortcuts are generated from them (`apps/web/src/shell/commands.ts`).

The interface is available in German and English; it is switched under View → Language, and without a choice the browser's language applies. Every file keeps its texts in both languages side by side (`localized` in `apps/web/src/lib/i18n.ts`); a missing translation fails the type check. What is not part of the interface stays German: the assistant's announcements and conversations, the API's messages and the practice's content.

## Live updates

A push channel (AppSync Events) was planned. What is implemented is polling every ten seconds while the tab is visible. For a practice with a few workstations that is about 200,000 requests per browser and month, so less than a dollar, without another service whose connections and permissions need maintaining. A call in progress is reloaded in the detail pane every 1.5 seconds.

## Costs (estimate, Frankfurt)

| Item                                                                     | Monthly                                 |
| ------------------------------------------------------------------------ | --------------------------------------- |
| Lambda, API Gateway, DynamoDB, CloudFront, Cognito (base load)           | a few USD                               |
| KMS key, secret                                                          | about 1.40 USD                          |
| WAF (optional)                                                           | about 9 USD                             |
| Voice agent: Fargate 0.5 vCPU/1 GB ARM, private load balancer (optional) | about 40 USD                            |
| Nova Sonic per minute of conversation                                    | about 2 ct (estimate from token prices) |

The load balancer was added compared with the first draft: the browser only opens the WebSocket connection over TLS, and Fargate tasks have no fixed address. It sits in private subnets and can only be reached through CloudFront (CloudFront VPC Origin). Web app, API and test call thus arrive under one address with CloudFront's certificate, and an own domain is not needed for anything.

## Deliberately not chosen

- **Amazon Connect with its built-in Sonic agent:** no SIP leg of our own, but tools only via AgentCore Gateway (not in the C5 scope as of January 2026) and the conversation logic as configuration instead of code. It remains the fallback plan; the tools are reusable.
- **RAG:** The practice's knowledge fits into the prompt, which is faster and more reliable.

## Status

| Part                                                                              | Status                                     |
| --------------------------------------------------------------------------------- | ------------------------------------------ |
| Data model, sign-in, API, infrastructure                                          | implemented and deployed                   |
| Settings: opening hours, closures, announcements, categories, slots, users, roles | implemented                                |
| Voice agent with test mode (text and voice)                                       | implemented, with Nova Sonic               |
| Daily view: inquiries, calls, transcripts                                         | implemented                                |
| Inquiry events for a PMS integration                                              | implemented (EventBridge), no consumer yet |
| Telephony                                                                         | implemented                                |

### Telephony

A call to the practice number goes like this:

1. The **SIP Media Application** (Chime SDK) answers it and invokes the call flow Lambda for every event (`services/api/src/telephony/call-flow.ts`).
2. The Lambda connects the call to the voice agent through the **Voice Connector** (`CallAndBridge`) and passes the call's ID along as a SIP header.
3. The **voice agent** answers the call itself via SIP (`services/voice-agent/src/telephony`): G.711 over RTP, 8 kHz, the same conversation session as the test call.
4. **Transfer:** The agent records the request in the database and hangs up. The call flow Lambda sees the record and connects the caller to the practice's second phone number (Einstellungen → Praxis → "Weiterleitung an").
5. **Failure:** If the agent cannot be reached, the Lambda connects directly to the practice.
6. **Emergency:** The agent speaks the sentence with 112 in full and then hangs up.

The voice agent has no fixed address. On start, every container registers its public address as the Voice Connector's target; no domain is needed for that. In the firewall, SIP and RTP are only open to the address range of the Voice Connectors in Frankfurt.

Between Voice Connector and agent, SIP and RTP are unencrypted, but only within the AWS network. The phone network before it is unencrypted anyway. To change that: enable TLS and SRTP on the Voice Connector and add them to the agent.

There are no CloudFormation resources for Chime SDK. Voice Connector, SIP Media Application and SIP rule are therefore created by a custom resource (`services/api/src/telephony/provision.ts`).
