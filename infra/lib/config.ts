import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { FEDERAL_STATES } from '@callisto/domain';
import { z } from 'zod';

const hostName = z.string().regex(/^[a-z0-9.-]+$/);

const DeploymentConfigSchema = z.object({
  /** Name of the environment, e.g. `dev` or `prod`; part of every stack and resource name. */
  stage: z.string().regex(/^[a-z][a-z0-9]{1,15}$/),
  /** AWS account to deploy to; defaults to the account of the current credentials. */
  account: z
    .string()
    .regex(/^\d{12}$/)
    .optional(),
  region: z.string().default('eu-central-1'),
  /**
   * Whether the practice's data can be deleted. Affects exactly the two tables, the key of the
   * calls table and the user pool. On: they survive `cdk destroy` and resource replacement, and
   * tables and user pool have AWS deletion protection. Off: they are deleted with the stack.
   * Nothing else (cost, security, app behaviour) depends on it. See docs/en/configuration.md.
   */
  production: z.boolean().default(false),
  /** The practice that is set up on the first deployment. */
  practice: z.object({
    id: z
      .string()
      .regex(/^[a-z0-9-]{1,32}$/)
      .default('main'),
    name: z.string().min(1),
    federalState: z.enum(FEDERAL_STATES),
    /** Receives the invitation for the first administrator account. */
    adminEmail: z.email(),
    adminName: z.string().min(1),
  }),
  /**
   * Own domain; optional. Without it the app runs under the address CloudFront assigns
   * (https://<id>.cloudfront.net), which works just as well.
   */
  domain: z
    .object({
      hostedZoneId: z.string().min(1),
      zoneName: hostName,
      appHost: hostName,
      apiHost: hostName,
    })
    .optional(),
  /** Further origins that may sign in and call the API, e.g. the local dev server. */
  devOrigins: z.array(z.url()).default([]),
  /** Puts AWS WAF in front of the API (about 9 USD per month). */
  waf: z.boolean().default(false),
  /**
   * Runs the voice agent, which serves the test call and the phone line (about 40 USD per month
   * for container and load balancer).
   */
  voice: z.boolean().default(false),
  /**
   * The phone line. Leave it out until the number is in the account's phone number inventory
   * (product type "SIP media application dial-in"); everything else works without it. Needs
   * `voice`; no domain needed.
   */
  telephony: z
    .object({
      /** The number callers dial, in E.164, e.g. +4930123456. */
      phoneNumber: z
        .string()
        .regex(/^\+[1-9]\d{6,14}$/, 'Rufnummer im Format +4930123456 erwartet'),
    })
    .optional(),
});

export type DeploymentConfig = z.infer<typeof DeploymentConfigSchema>;

/**
 * Reads `infra/config.json`. The file is not checked in because it describes one concrete
 * practice; `config.example.json` is used as long as it does not exist, so that `cdk synth`
 * works on a fresh checkout.
 */
export function loadConfig(directory: string): DeploymentConfig {
  const own = join(directory, 'config.json');
  const file = existsSync(own) ? own : join(directory, 'config.example.json');
  const parsed = DeploymentConfigSchema.safeParse(JSON.parse(readFileSync(file, 'utf8')));
  if (!parsed.success) {
    throw new Error(`Invalid deployment config in ${file}:\n${z.prettifyError(parsed.error)}`);
  }
  if (parsed.data.telephony && !parsed.data.voice) {
    throw new Error(`Invalid deployment config in ${file}: "telephony" needs "voice": true`);
  }
  return parsed.data;
}

/**
 * Origins that call the API from another address and therefore need CORS: the web app on its
 * own domain and the local dev server. Without a domain the app reaches the API through its
 * own address (see the web stack), which needs none.
 */
export function webOrigins(config: DeploymentConfig): string[] {
  const origins = [...config.devOrigins];
  if (config.domain) {
    origins.unshift(`https://${config.domain.appHost}`);
  }
  return origins;
}
