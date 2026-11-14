# Configuring an environment

An environment (e.g. `dev` or `prod`) can be configured through `infra/config.json`. The file is not checked in because it describes a specific practice. `infra/config.example.json` can be used as a template.

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

| Field        | Meaning                                                                                                                                                                                                                     |
| ------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `stage`      | Name of the environment; part of all stack and resource names.                                                                                                                                                              |
| `account`    | AWS account; if omitted, the account of the current credentials.                                                                                                                                                            |
| `region`     | Region of the data. Frankfurt (`eu-central-1`) is intended.                                                                                                                                                                 |
| `production` | Whether data and user accounts can be deleted on teardown and by accident. `false`: they are deleted along with everything else. `true`: they are kept and protected against deletion. See [below](#the-production-switch). |
| `practice`   | The practice created on the first deployment, and the first administrator account (invitation by email).                                                                                                                    |
| `domain`     | Optional. An own domain in Route 53 for a nicer address. Without it, everything runs under the free CloudFront address (`https://<id>.cloudfront.net`), test call and telephony included.                                   |
| `devOrigins` | Additional origins allowed to sign in and call the API, e.g. `http://localhost:5173`.                                                                                                                                       |
| `waf`        | AWS WAF in front of the API (about 9 USD per month).                                                                                                                                                                        |
| `voice`      | Voice agent for test call and phone (about 40 USD per month). Needs no domain.                                                                                                                                              |

## The `production` switch

The switch affects exactly four resources that hold the practice's data:

- the planning table (settings, opening hours, appointments, user profiles, audit log),
- the call table (calls, transcripts, inquiries),
- the KMS key that encrypts the call table,
- the Cognito user pool (the sign-in accounts).

For them it determines two things:

|                                       | `"production": false`                                                                                            | `"production": true`                                                                                                                                           |
| ------------------------------------- | ---------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| On teardown (`cdk destroy`)           | The four are deleted, with all data and accounts. The key is deleted for good after a waiting period of 30 days. | They remain; only everything else is torn down. Data and accounts are still there afterwards and keep incurring costs (e.g. 1 USD per month for the key).      |
| Deletion protection at AWS            | off                                                                                                              | on: tables and user pool cannot be deleted in the console or via the API either until the protection is deliberately switched off. The key has no such switch. |
| Change that would require a new table | The old table is deleted.                                                                                        | The old table stays in place with its data.                                                                                                                    |

What it does not affect: costs, performance, security (sign-in, two-factor and encryption are the same in both cases) and the behaviour of the application. Point-in-time backups of the tables are always on; they are, however, deleted along with the table. Web app, API, voice agent and logs are always removed on teardown.

**When to use which:**

- `false` for environments for trying things out that should disappear without a trace.
- `true` as soon as the practice works with the environment.
- Switching is possible at any time with another `npm run deploy`, without losing data. To tear down a `true` environment for good, first set it to `false` and deploy once; only then is the deletion protection lifted.

## Deploying

```sh
npx cdk bootstrap                            # once per account and region
npx cdk bootstrap aws://<account>/us-east-1  # additionally, if a domain is used
npm run deploy
```

`npm run deploy` builds the web app and deploys all stacks. For the voice agent, Docker must be running because the container image is built during deployment. The first deployment with the voice agent takes a little longer because CloudFront sets up the connection to the private load balancer (up to 15 minutes).

## Without an own domain

The smallest configuration with which everything works (web app, test call with voice and, once the number is available, telephony):

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

After deployment, the address of the web app is in the output `AppUrl` of the web stack.

## Enabling Nova Sonic

The voice agent calls Amazon Nova 2.5 Sonic in Stockholm (`eu-north-1`), the model's only EU region. Model access has to be enabled there once in the Bedrock console.

## Enabling telephony

1. **Order a phone number:** In the Amazon Chime SDK console (phone number management) or through AWS Support, request a German local number with the product type "SIP media application dial-in". This requires proof of business registration and an address in the area code's region; provisioning takes several weeks. Alternatively, an existing number can be ported.
2. **Enter the second number:** In the web app under Einstellungen → Praxis → "Weiterleitung an", enter the number the assistant transfers to. It must not be forwarded to the assistant.
3. **Extend the configuration:** add `"telephony": { "phoneNumber": "+49…" }` to `infra/config.json` and run `npm run deploy`.
4. **Forward:** Forward the practice's phone system to the new number (always or only when unanswered, as preferred).

In addition to Nova Sonic, a call costs a few cents per minute for phone number, SIP Media Application and Voice Connector; when transferred to the practice, the connection to the German landline network is added.
