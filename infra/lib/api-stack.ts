import { API_ROUTES, type ApiFunctionName } from '@callisto/api/routes';
import {
  Aws,
  CfnOutput,
  Duration,
  RemovalPolicy,
  Stack,
  type StackProps,
  TimeZone,
} from 'aws-cdk-lib';
import * as apigw from 'aws-cdk-lib/aws-apigateway';
import * as acm from 'aws-cdk-lib/aws-certificatemanager';
import type * as lambda from 'aws-cdk-lib/aws-lambda';
import * as logs from 'aws-cdk-lib/aws-logs';
import * as route53 from 'aws-cdk-lib/aws-route53';
import * as targets from 'aws-cdk-lib/aws-route53-targets';
import * as scheduler from 'aws-cdk-lib/aws-scheduler';
import * as schedulerTargets from 'aws-cdk-lib/aws-scheduler-targets';
import * as wafv2 from 'aws-cdk-lib/aws-wafv2';
import * as triggers from 'aws-cdk-lib/triggers';
import type { Construct } from 'constructs';
import type { AuthStack } from './auth-stack';
import { type DeploymentConfig, webOrigins } from './config';
import type { DataStack } from './data-stack';
import { ServiceFunction } from './service-function';

export interface ApiStackProps extends StackProps {
  config: DeploymentConfig;
  data: DataStack;
  auth: AuthStack;
}

/**
 * The REST API of the web app: API Gateway in front of one Lambda function per area.
 *
 * API Gateway verifies the access token and its scope before a function runs; the function then
 * checks what the user's role allows. Each function only gets the IAM permissions of its area,
 * e.g. only the users function may manage Cognito accounts.
 */
export class ApiStack extends Stack {
  readonly api: apigw.RestApi;
  /** Base URL without a trailing slash; the routes start at `/v1`. */
  readonly apiUrl: string;

  constructor(scope: Construct, id: string, props: ApiStackProps) {
    super(scope, id, props);
    const { config, data, auth } = props;

    const origins = webOrigins(config);
    const primaryOrigin = origins[0];
    if (!primaryOrigin) {
      throw new Error('The deployment config needs a domain or at least one entry in devOrigins');
    }

    // ── API Gateway ──────────────────────────────────────────────────────────

    const accessLogs = new logs.LogGroup(this, 'AccessLogs', {
      retention: logs.RetentionDays.THREE_MONTHS,
      removalPolicy: RemovalPolicy.DESTROY,
    });

    this.api = new apigw.RestApi(this, 'Api', {
      restApiName: `callisto-${config.stage}`,
      description: 'Callisto: API der Weboberfläche',
      endpointConfiguration: { types: [apigw.EndpointType.REGIONAL] },
      // With an own domain the generated address is switched off, so there is one way in.
      disableExecuteApiEndpoint: config.domain !== undefined,
      cloudWatchRole: true,
      cloudWatchRoleRemovalPolicy: RemovalPolicy.RETAIN,
      deployOptions: {
        stageName: 'live',
        tracingEnabled: true,
        metricsEnabled: true,
        throttlingRateLimit: 50,
        throttlingBurstLimit: 100,
        accessLogDestination: new apigw.LogGroupLogDestination(accessLogs),
        // The resource path is the route template, so ids and names never end up in the log.
        accessLogFormat: apigw.AccessLogFormat.custom(
          JSON.stringify({
            requestId: apigw.AccessLogField.contextRequestId(),
            time: apigw.AccessLogField.contextRequestTime(),
            ip: apigw.AccessLogField.contextIdentitySourceIp(),
            user: apigw.AccessLogField.contextAuthorizerClaims('sub'),
            method: apigw.AccessLogField.contextHttpMethod(),
            route: apigw.AccessLogField.contextResourcePath(),
            status: apigw.AccessLogField.contextStatus(),
            latencyMs: apigw.AccessLogField.contextResponseLatency(),
            integrationLatencyMs: apigw.AccessLogField.contextIntegrationLatency(),
            error: apigw.AccessLogField.contextErrorMessage(),
          }),
        ),
      },
      // Preflight requests are answered here, without authorization and without a Lambda call.
      defaultCorsPreflightOptions: {
        allowOrigins: origins,
        allowMethods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
        allowHeaders: ['Authorization', 'Content-Type'],
        maxAge: Duration.minutes(10),
      },
    });

    // Errors raised by API Gateway itself (expired token, throttling) need the CORS header too,
    // otherwise the browser hides them from the web app.
    for (const [name, type] of [
      ['Default4xx', apigw.ResponseType.DEFAULT_4XX],
      ['Default5xx', apigw.ResponseType.DEFAULT_5XX],
    ] as const) {
      this.api.addGatewayResponse(name, {
        type,
        responseHeaders: { 'Access-Control-Allow-Origin': `'${primaryOrigin}'` },
      });
    }

    const authorizer = new apigw.CognitoUserPoolsAuthorizer(this, 'Authorizer', {
      cognitoUserPools: [auth.userPool],
      resultsCacheTtl: Duration.minutes(5),
    });
    const methodOptions: apigw.MethodOptions = {
      authorizer,
      authorizationType: apigw.AuthorizationType.COGNITO,
      authorizationScopes: [auth.apiScope],
    };

    // ── Functions ────────────────────────────────────────────────────────────

    const environment = {
      PLANNING_TABLE: data.planningTable.tableName,
      ALLOWED_ORIGINS: origins.join(','),
    };

    const adminApi = new ServiceFunction(this, 'AdminApi', {
      entry: 'services/api/src/admin/handler.ts',
      description: 'Practice configuration and planning: settings, hours, closures, presets, slots',
      environment,
      // Changes that re-derive the slots of the whole booking horizon take a moment; this is
      // API Gateway's own limit for a request.
      timeout: Duration.seconds(29),
    });
    data.planningTable.grantReadWriteData(adminApi);

    const nightlySlots = new ServiceFunction(this, 'NightlySlots', {
      entry: 'services/api/src/scheduling/nightly.ts',
      description: 'Extends the bookable slots by one day every night',
      environment: {
        PLANNING_TABLE: data.planningTable.tableName,
        PRACTICE_ID: config.practice.id,
      },
      timeout: Duration.minutes(2),
    });
    data.planningTable.grantReadWriteData(nightlySlots);
    new scheduler.Schedule(this, 'NightlySlotsSchedule', {
      description: 'Callisto: nightly slot generation',
      schedule: scheduler.ScheduleExpression.cron({
        hour: '2',
        minute: '30',
        timeZone: TimeZone.EUROPE_BERLIN,
      }),
      target: new schedulerTargets.LambdaInvoke(nightlySlots, { retryAttempts: 2 }),
    });

    const usersApi = new ServiceFunction(this, 'UsersApi', {
      entry: 'services/api/src/users/handler.ts',
      description: 'Own profile, user accounts and roles',
      environment: { ...environment, USER_POOL_ID: auth.userPool.userPoolId },
    });
    data.planningTable.grantReadWriteData(usersApi);
    auth.userPool.grant(
      usersApi,
      'cognito-idp:AdminCreateUser',
      'cognito-idp:AdminDeleteUser',
      'cognito-idp:AdminDisableUser',
      'cognito-idp:AdminEnableUser',
      'cognito-idp:AdminGetUser',
      'cognito-idp:AdminUserGlobalSignOut',
    );

    // ── Routes ───────────────────────────────────────────────────────────────

    const functions: Record<ApiFunctionName, lambda.IFunction> = {
      admin: adminApi,
      users: usersApi,
    };
    const v1 = this.api.root.addResource('v1');
    for (const [segment, functionName] of Object.entries(API_ROUTES)) {
      const integration = new apigw.LambdaIntegration(functions[functionName], {
        allowTestInvoke: false,
      });
      const resource = v1.addResource(segment);
      resource.addMethod('ANY', integration, methodOptions);
      resource.addProxy({
        anyMethod: true,
        defaultIntegration: integration,
        defaultMethodOptions: methodOptions,
      });
    }

    // ── First-time setup ─────────────────────────────────────────────────────

    const seed = new ServiceFunction(this, 'Seed', {
      entry: 'services/api/src/seed/handler.ts',
      description: 'Creates the practice, the built-in roles and the first administrator',
      timeout: Duration.seconds(30),
      environment: {
        PLANNING_TABLE: data.planningTable.tableName,
        USER_POOL_ID: auth.userPool.userPoolId,
        PRACTICE_ID: config.practice.id,
        PRACTICE_NAME: config.practice.name,
        FEDERAL_STATE: config.practice.federalState,
        ADMIN_EMAIL: config.practice.adminEmail,
        ADMIN_NAME: config.practice.adminName,
      },
    });
    data.planningTable.grantReadWriteData(seed);
    auth.userPool.grant(seed, 'cognito-idp:AdminCreateUser', 'cognito-idp:AdminGetUser');
    // Runs once after the first deployment and again whenever the seed function changes.
    new triggers.Trigger(this, 'SeedTrigger', { handler: seed, timeout: Duration.minutes(1) });

    // ── Web application firewall ─────────────────────────────────────────────

    if (config.waf) {
      this.addFirewall(config);
    }

    // ── Own domain ───────────────────────────────────────────────────────────

    if (config.domain) {
      const { apiHost, hostedZoneId, zoneName } = config.domain;
      const zone = route53.HostedZone.fromHostedZoneAttributes(this, 'Zone', {
        hostedZoneId,
        zoneName,
      });
      const domainName = this.api.addDomainName('ApiDomain', {
        domainName: apiHost,
        certificate: new acm.Certificate(this, 'ApiCertificate', {
          domainName: apiHost,
          validation: acm.CertificateValidation.fromDns(zone),
        }),
        endpointType: apigw.EndpointType.REGIONAL,
        securityPolicy: apigw.SecurityPolicy.TLS_1_2,
      });
      new route53.ARecord(this, 'ApiAlias', {
        zone,
        recordName: apiHost,
        target: route53.RecordTarget.fromAlias(new targets.ApiGatewayDomain(domainName)),
      });
      this.apiUrl = `https://${apiHost}`;
    } else {
      const stage = this.api.deploymentStage.stageName;
      this.apiUrl = `https://${this.api.restApiId}.execute-api.${this.region}.${Aws.URL_SUFFIX}/${stage}`;
    }

    new CfnOutput(this, 'ApiUrl', { value: this.apiUrl });
  }

  /** AWS managed rule groups plus a rate limit per client address. */
  private addFirewall(config: DeploymentConfig): void {
    const metricPrefix = `callisto-${config.stage}-api`;
    const visibility = (name: string) => ({
      cloudWatchMetricsEnabled: true,
      sampledRequestsEnabled: true,
      metricName: `${metricPrefix}-${name}`,
    });
    const managedRules = [
      'AWSManagedRulesAmazonIpReputationList',
      'AWSManagedRulesKnownBadInputsRuleSet',
      'AWSManagedRulesCommonRuleSet',
    ];

    const webAcl = new wafv2.CfnWebACL(this, 'WebAcl', {
      scope: 'REGIONAL',
      defaultAction: { allow: {} },
      visibilityConfig: visibility('all'),
      rules: [
        {
          name: 'RateLimitPerAddress',
          priority: 0,
          action: { block: {} },
          statement: {
            rateBasedStatement: { limit: 600, evaluationWindowSec: 300, aggregateKeyType: 'IP' },
          },
          visibilityConfig: visibility('rate-limit'),
        },
        ...managedRules.map((name, index) => ({
          name,
          priority: index + 1,
          overrideAction: { none: {} },
          statement: { managedRuleGroupStatement: { vendorName: 'AWS', name } },
          visibilityConfig: visibility(name),
        })),
      ],
    });
    new wafv2.CfnWebACLAssociation(this, 'WebAclAssociation', {
      resourceArn: this.api.deploymentStage.stageArn,
      webAclArn: webAcl.attrArn,
    });
  }
}
