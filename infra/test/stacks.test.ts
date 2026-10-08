import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { App } from 'aws-cdk-lib';
import { Match, Template } from 'aws-cdk-lib/assertions';
import { describe, expect, it } from 'vitest';
import { ApiStack } from '../lib/api-stack';
import { AuthStack } from '../lib/auth-stack';
import type { DeploymentConfig } from '../lib/config';
import { DataStack } from '../lib/data-stack';
import { EdgeCertificateStack } from '../lib/edge-certificate-stack';
import { VoiceStack } from '../lib/voice-stack';
import { WebStack } from '../lib/web-stack';

const domain = {
  hostedZoneId: 'Z0000000000000',
  zoneName: 'praxis.test',
  appHost: 'app.praxis.test',
  apiHost: 'api.praxis.test',
};

const baseConfig: DeploymentConfig = {
  stage: 'test',
  region: 'eu-central-1',
  production: true,
  practice: {
    id: 'main',
    name: 'Praxis Test',
    federalState: 'NW',
    adminEmail: 'admin@praxis.test',
    adminName: 'Administration',
  },
  devOrigins: ['http://localhost:5173'],
  waf: true,
  voice: false,
};

// A stand-in for the built web app; the stack only needs the directory to exist.
const assetDir = mkdtempSync(join(tmpdir(), 'callisto-web-'));
mkdirSync(assetDir, { recursive: true });
writeFileSync(join(assetDir, 'index.html'), '<!doctype html>');

function synth(overrides: Partial<DeploymentConfig> = {}) {
  const config = { ...baseConfig, ...overrides };
  // Bundling and building the code is not needed to inspect the templates and would be slow.
  const app = new App({ context: { 'aws:cdk:bundling-stacks': [] } });
  const env = { account: '111111111111', region: config.region };
  const data = new DataStack(app, 'Data', { env, config });
  const auth = new AuthStack(app, 'Auth', { env, config });
  const voice = config.voice ? new VoiceStack(app, 'Voice', { env, config, data }) : undefined;
  const api = new ApiStack(app, 'Api', {
    env,
    config,
    data,
    auth,
    voiceUrl: voice ? '/voice' : undefined,
  });
  const certificate = config.domain
    ? new EdgeCertificateStack(app, 'Cert', {
        env: { account: '111111111111', region: 'us-east-1' },
        crossRegionReferences: true,
        hostedZoneId: config.domain.hostedZoneId,
        zoneName: config.domain.zoneName,
        domainName: config.domain.appHost,
      }).certificate
    : undefined;
  const web = new WebStack(app, 'Web', {
    env,
    crossRegionReferences: config.domain !== undefined,
    config,
    auth,
    api,
    assetDir,
    certificate,
    voice,
  });
  return {
    data: Template.fromStack(data),
    auth: Template.fromStack(auth),
    api: Template.fromStack(api),
    web: Template.fromStack(web),
    voice: voice ? Template.fromStack(voice) : undefined,
  };
}

describe('data stack', () => {
  it('encrypts patient data with its own key and streams changes', () => {
    const { data } = synth();
    data.resourceCountIs('AWS::DynamoDB::GlobalTable', 2);
    data.hasResourceProperties('AWS::KMS::Key', { EnableKeyRotation: true });
    data.hasResourceProperties('AWS::DynamoDB::GlobalTable', {
      SSESpecification: { SSEEnabled: true, SSEType: 'KMS' },
      StreamSpecification: { StreamViewType: 'NEW_AND_OLD_IMAGES' },
      TimeToLiveSpecification: { AttributeName: 'expiresAt', Enabled: true },
    });
  });

  it('protects production data against deletion and keeps backups', () => {
    const { data } = synth({ production: true });
    const tables = Object.values(data.findResources('AWS::DynamoDB::GlobalTable'));
    expect(tables).toHaveLength(2);
    for (const table of tables) {
      expect(table.DeletionPolicy).toBe('Retain');
      expect(table.Properties.Replicas[0]).toMatchObject({
        DeletionProtectionEnabled: true,
        PointInTimeRecoverySpecification: { PointInTimeRecoveryEnabled: true },
      });
    }
  });

  it('lets a non-production environment be torn down completely', () => {
    const { data } = synth({ production: false });
    for (const table of Object.values(data.findResources('AWS::DynamoDB::GlobalTable'))) {
      expect(table.DeletionPolicy).toBe('Delete');
    }
  });

  it('publishes inquiry changes as events without patient data', () => {
    const { data } = synth();
    const pipes = Object.values(data.findResources('AWS::Pipes::Pipe'));
    expect(pipes).toHaveLength(1);
    const template = pipes[0]?.Properties.TargetParameters.InputTemplate as string;
    expect(template).toContain('inquiryId');
    expect(template).not.toMatch(/patient|firstName|lastName|dateOfBirth/);
  });
});

describe('auth stack', () => {
  it('only lets administrators create accounts and requires a second factor', () => {
    const { auth } = synth();
    auth.hasResourceProperties('AWS::Cognito::UserPool', {
      AdminCreateUserConfig: Match.objectLike({ AllowAdminCreateUserOnly: true }),
      MfaConfiguration: 'ON',
      EnabledMfas: ['SOFTWARE_TOKEN_MFA'],
    });
  });
});

describe('web stack', () => {
  it('registers the app as a code-flow client without a secret, for its own address', () => {
    const { web } = synth({ domain });
    web.hasResourceProperties('AWS::Cognito::UserPoolClient', {
      GenerateSecret: false,
      AllowedOAuthFlows: ['code'],
      AllowedOAuthScopes: Match.arrayWith(['callisto-api/app']),
      CallbackURLs: [
        'https://app.praxis.test/auth/callback',
        'http://localhost:5173/auth/callback',
      ],
      EnableTokenRevocation: true,
      PreventUserExistenceErrors: 'ENABLED',
    });
  });

  it('serves the app from a private bucket and passes /v1 uncached to the API', () => {
    const { web } = synth();
    web.hasResourceProperties('AWS::S3::Bucket', {
      PublicAccessBlockConfiguration: Match.objectLike({ BlockPublicAcls: true }),
    });
    const distribution = Object.values(web.findResources('AWS::CloudFront::Distribution'))[0];
    const behaviors = distribution?.Properties.DistributionConfig.CacheBehaviors;
    expect(behaviors).toHaveLength(1);
    expect(behaviors[0]).toMatchObject({
      PathPattern: '/v1/*',
      // Managed policies: CachingDisabled and AllViewerExceptHostHeader.
      CachePolicyId: '4135ea2d-6df8-44a3-9df3-4b5a84be39ad',
      OriginRequestPolicyId: 'b689b0a8-53d0-40ab-baf2-68738e2966ac',
    });
  });

  it("sends test calls under the app's own address to the voice agent", () => {
    const behaviors = (template: Template) =>
      Object.values(template.findResources('AWS::CloudFront::Distribution'))[0]?.Properties
        .DistributionConfig.CacheBehaviors as Array<{ PathPattern: string }>;
    expect(behaviors(synth().web).map((behavior) => behavior.PathPattern)).toEqual(['/v1/*']);
    expect(behaviors(synth({ voice: true }).web).map((behavior) => behavior.PathPattern)).toEqual([
      '/v1/*',
      '/voice*',
    ]);
    synth({ voice: true }).web.resourceCountIs('AWS::CloudFront::VpcOrigin', 1);
  });
});

describe('api stack', () => {
  it('requires a Cognito token with the API scope on every method except the CORS preflight', () => {
    const { api } = synth();
    const methods = Object.values(api.findResources('AWS::ApiGateway::Method'));
    expect(methods.length).toBeGreaterThan(0);
    for (const { Properties: method } of methods) {
      if (method.HttpMethod === 'OPTIONS') {
        expect(method.AuthorizationType).toBe('NONE');
      } else {
        expect(method.AuthorizationType).toBe('COGNITO_USER_POOLS');
        expect(method.AuthorizationScopes).toEqual(['callisto-api/app']);
      }
    }
  });

  it('grants Cognito administration only to the users and seed functions', () => {
    const { api } = synth();
    const policies = Object.values(api.findResources('AWS::IAM::Policy'));
    const withCognito = policies.filter((policy) =>
      JSON.stringify(policy.Properties.PolicyDocument).includes('cognito-idp:'),
    );
    const roleNames = withCognito.map((policy) => JSON.stringify(policy.Properties.Roles));
    expect(withCognito).toHaveLength(2);
    expect(roleNames.some((roles) => roles.includes('UsersApi'))).toBe(true);
    expect(roleNames.some((roles) => roles.includes('Seed'))).toBe(true);
  });

  it('gives access to the calls table only to the calls function', () => {
    const { api } = synth();
    const policies = Object.values(api.findResources('AWS::IAM::Policy'));
    const withCalls = policies.filter((policy) =>
      JSON.stringify(policy.Properties.PolicyDocument).includes('CallsTable'),
    );
    expect(withCalls).toHaveLength(1);
    expect(JSON.stringify(withCalls[0]?.Properties.Roles)).toContain('CallsApi');
  });

  it('puts the firewall in front of the API only when configured', () => {
    synth({ waf: true }).api.resourceCountIs('AWS::WAFv2::WebACLAssociation', 1);
    synth({ waf: false }).api.resourceCountIs('AWS::WAFv2::WebACL', 0);
  });

  it('serves the API from the own domain and switches the generated address off', () => {
    const { api } = synth({ domain });
    api.hasResourceProperties('AWS::ApiGateway::RestApi', { DisableExecuteApiEndpoint: true });
    api.hasResourceProperties('AWS::ApiGateway::DomainName', {
      DomainName: 'api.praxis.test',
      SecurityPolicy: 'TLS_1_2',
    });
  });

  it('needs no CORS when only the app on its own address calls it', () => {
    const { api } = synth({ devOrigins: [] });
    const methods = Object.values(api.findResources('AWS::ApiGateway::Method'));
    expect(methods.some((method) => method.Properties.HttpMethod === 'OPTIONS')).toBe(false);
  });
});

describe('voice stack', () => {
  it('runs without an own domain, behind a private load balancer that tolerates long silences', () => {
    const { voice } = synth({ voice: true });
    voice?.hasResourceProperties('AWS::ElasticLoadBalancingV2::LoadBalancer', {
      Scheme: 'internal',
      LoadBalancerAttributes: Match.arrayWith([
        { Key: 'idle_timeout.timeout_seconds', Value: '1800' },
      ]),
    });
    voice?.hasResourceProperties('AWS::ElasticLoadBalancingV2::Listener', { Protocol: 'HTTP' });
    voice?.resourceCountIs('AWS::CertificateManager::Certificate', 0);
    voice?.hasResourceProperties('AWS::ECS::TaskDefinition', {
      RuntimePlatform: { CpuArchitecture: 'ARM64', OperatingSystemFamily: 'LINUX' },
    });
  });

  it('lets only CloudFront reach the load balancer', () => {
    const { voice } = synth({ voice: true });
    const groups = Object.values(voice?.findResources('AWS::EC2::SecurityGroup') ?? {});
    const open = groups.flatMap((group) => group.Properties.SecurityGroupIngress ?? []);
    expect(open.some((rule: { CidrIp?: string }) => rule.CidrIp === '0.0.0.0/0')).toBe(false);
    const ingress = Object.values(voice?.findResources('AWS::EC2::SecurityGroupIngress') ?? {});
    expect(
      ingress.some(
        (rule) =>
          rule.Properties.SourcePrefixListId !== undefined && rule.Properties.FromPort === 80,
      ),
    ).toBe(true);
  });

  it('needs no NAT gateway', () => {
    synth({ voice: true }).voice?.resourceCountIs('AWS::EC2::NatGateway', 0);
  });

  it('may call exactly Nova Sonic in Stockholm', () => {
    const { voice } = synth({ voice: true });
    const policies = JSON.stringify(voice?.findResources('AWS::IAM::Policy'));
    expect(policies).toContain('"bedrock:InvokeModel"');
    expect(policies).toContain('bedrock:eu-north-1::foundation-model/amazon.nova-2-5-sonic');
  });

  it('tells the API where test conversations are held', () => {
    const { api } = synth({ voice: true });
    api.hasResourceProperties('AWS::Lambda::Function', {
      Environment: { Variables: Match.objectLike({ VOICE_URL: '/voice' }) },
    });
  });
});

describe('telephony', () => {
  const telephony = { phoneNumber: '+493012345000' };

  it('is not there until a phone number is configured', () => {
    const { voice } = synth({ voice: true });
    voice?.resourceCountIs('Custom::ChimeVoiceConnector', 0);
    voice?.resourceCountIs('Custom::ChimeSipMediaApplication', 0);
  });

  it('creates Voice Connector and SIP media application for the number', () => {
    const { voice } = synth({ voice: true, telephony });
    voice?.hasResourceProperties('Custom::ChimeVoiceConnector', {
      Kind: 'VoiceConnector',
      Region: 'eu-central-1',
    });
    voice?.hasResourceProperties('Custom::ChimeSipMediaApplication', {
      Kind: 'SipMediaApplication',
      PhoneNumber: '+493012345000',
    });
    voice?.hasResourceProperties('AWS::Lambda::Permission', {
      Principal: 'voiceconnector.chime.amazonaws.com',
    });
  });

  it('opens SIP and RTP only to the Voice Connector address range', () => {
    const { voice } = synth({ voice: true, telephony });
    // Rules to address ranges are inline in the security group, rules between groups separate.
    const ingress = [
      ...Object.values(voice?.findResources('AWS::EC2::SecurityGroupIngress') ?? {}).map(
        (resource) => resource.Properties,
      ),
      ...Object.values(voice?.findResources('AWS::EC2::SecurityGroup') ?? {}).flatMap(
        (resource) => resource.Properties.SecurityGroupIngress ?? [],
      ),
    ].filter((rule) => rule.IpProtocol === 'udp');
    expect(ingress).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ CidrIp: '99.77.247.0/24', FromPort: 5060, ToPort: 5060 }),
        expect.objectContaining({ CidrIp: '99.77.247.0/24', FromPort: 20000, ToPort: 20199 }),
      ]),
    );
    expect(ingress.every((rule) => rule.CidrIp === '99.77.247.0/24')).toBe(true);
  });

  it('lets the container enter its own address at the Voice Connector, and nothing else', () => {
    const { voice } = synth({ voice: true, telephony });
    voice?.hasResourceProperties('AWS::ECS::TaskDefinition', {
      ContainerDefinitions: [
        Match.objectLike({
          Environment: Match.arrayWith([
            { Name: 'SIP_PORT', Value: '5060' },
            { Name: 'VOICE_CONNECTOR_REGION', Value: 'eu-central-1' },
          ]),
        }),
      ],
    });
    const policies = Object.values(voice?.findResources('AWS::IAM::Policy') ?? {});
    const task = policies.find((policy) =>
      JSON.stringify(policy.Properties.Roles).includes('TaskRole'),
    );
    const statement = JSON.stringify(task?.Properties.PolicyDocument);
    expect(statement).toContain('chime:PutVoiceConnectorOrigination');
    expect(statement).not.toContain('chime:Create');
  });
});
