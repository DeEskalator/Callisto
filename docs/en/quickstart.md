# Quickstart: deploying Callisto on AWS

This guide takes you from an empty AWS account to the first test call. Neither an own domain nor a phone number is needed for it; both can be added later.

## 1. Prerequisites

| What                                          | What for                                                      | Check with                                        |
| --------------------------------------------- | ------------------------------------------------------------- | ------------------------------------------------- |
| Node.js 24 or newer                           | Building and deploying                                        | `node --version`                                  |
| AWS CLI with a profile for the target account | Access to AWS                                                 | `aws sts get-caller-identity --profile <profile>` |
| Docker (running)                              | Container image of the voice agent; only with `"voice": true` | `docker info`                                     |
| Nova 2.5 Sonic enabled                        | The voice agent; only with `"voice": true`                    | Bedrock console, region Stockholm (`eu-north-1`)  |

An AWS profile can be set up with `aws configure sso` or `aws configure`.

Install the dependencies (in the project folder):

```sh
npm install
```

## 2. Create the configuration

Create `infra/config.json` (it is not checked in):

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

- `federalState`: Code of the German federal state (BW, BY, BE, BB, HB, HH, HE, MV, NI, NW, RP, SL, SN, ST, SH, TH). Determines the public holidays.
- `adminEmail`: The invitation for the first administrator account is sent here.
- `voice`: `true` for a test call with voice (and later the phone), about 40 USD per month. With `false`, only a few dollars per month are incurred, but there is no test call.
- `production`: Whether data and user accounts are deleted on teardown. `false`: everything disappears on teardown, data included; right for trying things out. `true`: tables, key and user accounts are kept on teardown and protected against deletion; right as soon as the practice works with it. The switch has no influence on costs, security or the behaviour of the application. Details: [configuration.md](configuration.md#the-production-switch).

All fields: [configuration.md](configuration.md).

## 3. Prepare the account (once)

CDK needs a few helper resources in the account ("bootstrap"):

```sh
cd infra
npx cdk bootstrap --profile <profile>
cd ..
```

Only if an own domain will be added later, additionally: `npx cdk bootstrap aws://<account-number>/us-east-1 --profile <profile>`.

## 4. Deploy

```sh
AWS_PROFILE=<profile> npm run deploy
```

This builds the web app and deploys all stacks. CDK asks before granting new permissions; confirm with `y`. With the voice agent, the first deployment takes about 20–30 minutes (CloudFront sets up the connection to the voice agent), without it about 10 minutes.

At the end, the output contains:

```
Callisto-dev-Web.AppUrl = https://d1234abcd.cloudfront.net
```

That is the address of the web app.

## 5. First sign-in

1. The email "Ihr Zugang zum Telefonassistenten" to `adminEmail` contains the user name and a temporary password (valid for 7 days).
2. Open `AppUrl` and sign in.
3. Choose your own password (at least 12 characters with upper- and lowercase letters, a digit and a special character).
4. Set up two-factor sign-in: scan the displayed QR code with an authenticator app (e.g. Google Authenticator, Microsoft Authenticator, 1Password).

## 6. Set up the practice

Everything is under **Einstellungen** (top right or Alt+Comma):

1. **Praxis:** Check the name, adjust the greeting, and under "Weiterleitung an" enter the practice's second phone number (the one not forwarded to the assistant). Without it, the assistant does not offer to transfer.
2. Enter **Sprechzeiten** (opening hours) and **Urlaub & Schließzeiten** (vacation and closures).
3. Check **Ansagen** (announcements): what the assistant says outside opening hours, on public holidays and during vacation.
4. Create **Kategorien** (categories, e.g. check-up, blood test), then **Slot-Vorlagen** (slot templates): when appointments of which category can be booked. The **Kalender** (calendar) shows the generated appointments.
5. **Benutzer** (users): Create accounts for the practice team; everyone receives their own invitation.

## 7. Test call

Top right **Testanruf** → **Mit Sprache** (allow the microphone) or **Mit Text**. The assistant behaves as on the phone. Results appear under **Anliegen** (inquiries, filter "Tests") and under **Anrufe** (calls, "Testanrufe zeigen"). Test appointments occupy real slots; they can be cancelled again under Anliegen.

## 8. Later: telephony

As soon as a phone number is in the AWS account, add it to `infra/config.json` and deploy again:

```json
"telephony": { "phoneNumber": "+493012345000" }
```

How to get the number and forward the practice: [configuration.md, "Enabling telephony"](configuration.md#enabling-telephony).

## Updating and removing

- **Deploy a new version:** run the same command again, `AWS_PROFILE=<profile> npm run deploy`.
- **See the difference first:** `AWS_PROFILE=<profile> npm run diff`.
- **Remove everything:** in the `infra` folder, `AWS_PROFILE=<profile> npx cdk destroy --all`. With `"production": false`, this also deletes all data.

## When something goes wrong

| Message                                           | Cause                                                                                                |
| ------------------------------------------------- | ---------------------------------------------------------------------------------------------------- |
| `The web app has not been built yet`              | Use `npm run deploy` instead of `cdk deploy` directly; it builds the web app first.                  |
| `Cannot connect to the Docker daemon`             | Start Docker (only needed with `"voice": true`).                                                     |
| `has not been bootstrapped`                       | Run step 3.                                                                                          |
| Test call: "Der Testmodus ist nicht eingerichtet" | `"voice": true` is missing from the configuration.                                                   |
| Test call: no answer, voice agent does not start  | Nova 2.5 Sonic not enabled in Stockholm; logs in CloudWatch under the voice stack's log group.       |
| No invitation email                               | Check the spam folder. Without its own email configuration, Cognito sends at most 50 emails per day. |
