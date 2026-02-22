import { existsSync } from 'node:fs';
import { CfnOutput, Duration, RemovalPolicy, Stack, type StackProps } from 'aws-cdk-lib';
import type * as acm from 'aws-cdk-lib/aws-certificatemanager';
import * as cloudfront from 'aws-cdk-lib/aws-cloudfront';
import * as origins from 'aws-cdk-lib/aws-cloudfront-origins';
import * as route53 from 'aws-cdk-lib/aws-route53';
import * as targets from 'aws-cdk-lib/aws-route53-targets';
import * as s3 from 'aws-cdk-lib/aws-s3';
import * as s3deploy from 'aws-cdk-lib/aws-s3-deployment';
import type { Construct } from 'constructs';
import type { ApiStack } from './api-stack';
import type { AuthStack } from './auth-stack';
import type { DeploymentConfig } from './config';

export interface WebStackProps extends StackProps {
  config: DeploymentConfig;
  auth: AuthStack;
  api: ApiStack;
  /** The built web app (`apps/web/dist`). */
  assetDir: string;
  /** Certificate for the app's own domain, from us-east-1; required when a domain is configured. */
  certificate?: acm.ICertificate;
}

// Single-page app: every address without a file extension is answered with index.html, and the
// router in the browser takes it from there. Runs at the edge, only for the app's own files.
const SPA_ROUTING = `function handler(event) {
  var request = event.request;
  if (request.uri.indexOf('.') === -1) {
    request.uri = '/index.html';
  }
  return request;
}`;

/**
 * Delivers the web app. CloudFront serves the static files from S3 and passes `/v1/*` on to the
 * API, so the app and its API share one address: no CORS, and the browser never talks to an
 * AWS-generated hostname.
 */
export class WebStack extends Stack {
  readonly appUrl: string;

  constructor(scope: Construct, id: string, props: WebStackProps) {
    super(scope, id, props);
    const { config, auth, api } = props;
    if (!existsSync(props.assetDir)) {
      throw new Error(
        `The web app has not been built yet (${props.assetDir} is missing). Run "npm run build --workspace @callisto/web" first.`,
      );
    }

    const bucket = new s3.Bucket(this, 'AppBucket', {
      blockPublicAccess: s3.BlockPublicAccess.BLOCK_ALL,
      encryption: s3.BucketEncryption.S3_MANAGED,
      enforceSSL: true,
      // The bucket only holds build output; it can always be recreated.
      removalPolicy: RemovalPolicy.DESTROY,
      autoDeleteObjects: true,
    });

    const voiceOrigin = config.domain && config.voice ? ` wss://${config.domain.voiceHost}` : '';
    const securityHeaders = new cloudfront.ResponseHeadersPolicy(this, 'SecurityHeaders', {
      comment: 'Callisto: security headers of the web app',
      securityHeadersBehavior: {
        contentSecurityPolicy: {
          override: true,
          contentSecurityPolicy: [
            "default-src 'self'",
            "script-src 'self'",
            // Radix positions menus and dialogs with inline styles.
            "style-src 'self' 'unsafe-inline'",
            "img-src 'self' data:",
            "font-src 'self'",
            `connect-src 'self' https://cognito-idp.${this.region}.amazonaws.com https://*.amazoncognito.com${voiceOrigin}`,
            "frame-ancestors 'none'",
            "base-uri 'none'",
            "form-action 'self' https://*.amazoncognito.com",
          ].join('; '),
        },
        contentTypeOptions: { override: true },
        frameOptions: { frameOption: cloudfront.HeadersFrameOption.DENY, override: true },
        referrerPolicy: {
          referrerPolicy: cloudfront.HeadersReferrerPolicy.STRICT_ORIGIN_WHEN_CROSS_ORIGIN,
          override: true,
        },
        strictTransportSecurity: {
          accessControlMaxAge: Duration.days(365),
          includeSubdomains: false,
          override: true,
        },
      },
      customHeadersBehavior: {
        customHeaders: [
          // The test call needs the microphone; nothing else may use it, camera and location never.
          {
            header: 'Permissions-Policy',
            value: 'microphone=(self), camera=(), geolocation=()',
            override: true,
          },
        ],
      },
    });

    // The API, reached through CloudFront. Nothing is cached, and every header (including
    // Authorization) is passed on except Host, which API Gateway must see as its own.
    const apiOrigin = new origins.HttpOrigin(api.apiHostName, {
      protocolPolicy: cloudfront.OriginProtocolPolicy.HTTPS_ONLY,
      ...(api.apiBasePath ? { originPath: api.apiBasePath } : {}),
    });

    const domainNames = config.domain ? [config.domain.appHost] : undefined;
    if (config.domain && !props.certificate) {
      throw new Error('A certificate from us-east-1 is required for the app domain');
    }

    const distribution = new cloudfront.Distribution(this, 'Distribution', {
      comment: `Callisto ${config.stage}`,
      defaultRootObject: 'index.html',
      minimumProtocolVersion: cloudfront.SecurityPolicyProtocol.TLS_V1_2_2021,
      httpVersion: cloudfront.HttpVersion.HTTP2_AND_3,
      // Europe and North America only: the cheapest price class, and the practice is in Germany.
      priceClass: cloudfront.PriceClass.PRICE_CLASS_100,
      ...(domainNames && props.certificate ? { domainNames, certificate: props.certificate } : {}),
      defaultBehavior: {
        origin: origins.S3BucketOrigin.withOriginAccessControl(bucket),
        viewerProtocolPolicy: cloudfront.ViewerProtocolPolicy.REDIRECT_TO_HTTPS,
        cachePolicy: cloudfront.CachePolicy.CACHING_OPTIMIZED,
        responseHeadersPolicy: securityHeaders,
        functionAssociations: [
          {
            function: new cloudfront.Function(this, 'SpaRouting', {
              code: cloudfront.FunctionCode.fromInline(SPA_ROUTING),
              runtime: cloudfront.FunctionRuntime.JS_2_0,
            }),
            eventType: cloudfront.FunctionEventType.VIEWER_REQUEST,
          },
        ],
      },
      additionalBehaviors: {
        '/v1/*': {
          origin: apiOrigin,
          viewerProtocolPolicy: cloudfront.ViewerProtocolPolicy.HTTPS_ONLY,
          allowedMethods: cloudfront.AllowedMethods.ALLOW_ALL,
          cachePolicy: cloudfront.CachePolicy.CACHING_DISABLED,
          originRequestPolicy: cloudfront.OriginRequestPolicy.ALL_VIEWER_EXCEPT_HOST_HEADER,
          responseHeadersPolicy: securityHeaders,
        },
      },
    });

    this.appUrl = config.domain
      ? `https://${config.domain.appHost}`
      : `https://${distribution.distributionDomainName}`;

    if (config.domain) {
      const zone = route53.HostedZone.fromHostedZoneAttributes(this, 'Zone', {
        hostedZoneId: config.domain.hostedZoneId,
        zoneName: config.domain.zoneName,
      });
      new route53.ARecord(this, 'AppAlias', {
        zone,
        recordName: config.domain.appHost,
        target: route53.RecordTarget.fromAlias(new targets.CloudFrontTarget(distribution)),
      });
    }

    // The login only sends users back to addresses it knows, so the app client is registered
    // here, where the app's address is known.
    const webClient = auth.addWebClient(this, [this.appUrl, ...config.devOrigins]);

    const files = new s3deploy.BucketDeployment(this, 'AppFiles', {
      sources: [
        s3deploy.Source.asset(props.assetDir),
        // What differs between environments is read by the app at start-up, so the same
        // build runs everywhere.
        s3deploy.Source.jsonData('config.json', {
          apiUrl: '',
          auth: {
            mode: 'oidc',
            authority: `https://cognito-idp.${this.region}.amazonaws.com/${auth.userPool.userPoolId}`,
            clientId: webClient.userPoolClientId,
            scope: `openid email profile ${auth.apiScope}`,
            loginBaseUrl: auth.loginBaseUrl,
          },
        }),
      ],
      destinationBucket: bucket,
      distribution,
      distributionPaths: ['/index.html', '/config.json'],
      memoryLimit: 512,
    });
    files.node.addDependency(webClient);

    new CfnOutput(this, 'AppUrl', { value: this.appUrl });
  }
}
