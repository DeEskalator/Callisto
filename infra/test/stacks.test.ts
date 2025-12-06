import { App } from 'aws-cdk-lib';
import { Match, Template } from 'aws-cdk-lib/assertions';
import { describe, expect, it } from 'vitest';
import { ApiStack } from '../lib/api-stack';
import { AuthStack } from '../lib/auth-stack';
import type { DeploymentConfig } from '../lib/config';
import { DataStack } from '../lib/data-stack';

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
};

function synth(overrides: Partial<DeploymentConfig> = {}) {
  const config = { ...baseConfig, ...overrides };
  // Bundling the Lambda code is not needed to inspect the templates and would slow the tests down.
  const app = new App({ context: { 'aws:cdk:bundling-stacks': [] } });
  const env = { account: '111111111111', region: config.region };
  const data = new DataStack(app, 'Data', { env, config });
  const auth = new AuthStack(app, 'Auth', { env, config });
  const api = new ApiStack(app, 'Api', { env, config, data, auth });
  return {
    data: Template.fromStack(data),
    auth: Template.fromStack(auth),
    api: Template.fromStack(api),
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

  it('configures the web client for the authorization code flow without a secret', () => {
    const { auth } = synth();
    auth.hasResourceProperties('AWS::Cognito::UserPoolClient', {
      GenerateSecret: false,
      AllowedOAuthFlows: ['code'],
      AllowedOAuthScopes: Match.arrayWith(['callisto-api/app']),
      CallbackURLs: ['http://localhost:5173/auth/callback'],
      EnableTokenRevocation: true,
      PreventUserExistenceErrors: 'ENABLED',
    });
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

  it('puts the firewall in front of the API only when configured', () => {
    synth({ waf: true }).api.resourceCountIs('AWS::WAFv2::WebACLAssociation', 1);
    synth({ waf: false }).api.resourceCountIs('AWS::WAFv2::WebACL', 0);
  });

  it('serves the API from the own domain and switches the generated address off', () => {
    const { api } = synth({
      domain: {
        hostedZoneId: 'Z0000000000000',
        zoneName: 'praxis.test',
        appHost: 'app.praxis.test',
        apiHost: 'api.praxis.test',
      },
    });
    api.hasResourceProperties('AWS::ApiGateway::RestApi', { DisableExecuteApiEndpoint: true });
    api.hasResourceProperties('AWS::ApiGateway::DomainName', {
      DomainName: 'api.praxis.test',
      SecurityPolicy: 'TLS_1_2',
    });
  });
});
