import { join } from 'node:path';
import { Duration, RemovalPolicy, Stack, type StackProps } from 'aws-cdk-lib';
import * as ec2 from 'aws-cdk-lib/aws-ec2';
import * as ecrAssets from 'aws-cdk-lib/aws-ecr-assets';
import * as ecs from 'aws-cdk-lib/aws-ecs';
import * as ecsPatterns from 'aws-cdk-lib/aws-ecs-patterns';
import * as elbv2 from 'aws-cdk-lib/aws-elasticloadbalancingv2';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as logs from 'aws-cdk-lib/aws-logs';
import * as cr from 'aws-cdk-lib/custom-resources';
import type { Construct } from 'constructs';
import type { DeploymentConfig } from './config';
import type { DataStack } from './data-stack';
import { Telephony } from './telephony';

export interface VoiceStackProps extends StackProps {
  config: DeploymentConfig;
  data: DataStack;
}

/** Nova Sonic is offered in Europe only in Stockholm; the agent calls it there. */
export const BEDROCK_REGION = 'eu-north-1';
export const NOVA_SONIC_MODEL_ID = 'amazon.nova-2-sonic-v1:0';
/** Path of test conversations, on the app's own address (see the web stack). */
export const VOICE_PATH = '/voice';

const repoRoot = join(import.meta.dirname, '..', '..');

/**
 * The voice agent: a long-running container, because a conversation is a stream that lasts
 * minutes, which a Lambda function cannot hold.
 *
 * Test calls from the browser reach it through CloudFront, on the app's own address, and from
 * there through a load balancer in private subnets (a CloudFront VPC origin). So the browser gets
 * TLS from CloudFront and no own domain or certificate is needed. The container itself runs in
 * public subnets with its own address, so it reaches Bedrock and DynamoDB without a NAT gateway;
 * with telephony the Voice Connector reaches it there on the SIP and RTP ports.
 */
export class VoiceStack extends Stack {
  /** Where the web stack sends `/voice`. */
  readonly loadBalancer: elbv2.ApplicationLoadBalancer;

  constructor(scope: Construct, id: string, props: VoiceStackProps) {
    super(scope, id, props);
    const { config, data } = props;

    const vpc = new ec2.Vpc(this, 'Vpc', {
      maxAzs: 2,
      natGateways: 0,
      subnetConfiguration: [
        { name: 'public', subnetType: ec2.SubnetType.PUBLIC, cidrMask: 24 },
        // Only for the load balancer: CloudFront VPC origins must sit in private subnets.
        { name: 'origin', subnetType: ec2.SubnetType.PRIVATE_ISOLATED, cidrMask: 24 },
      ],
    });
    const cluster = new ecs.Cluster(this, 'Cluster', {
      vpc,
      containerInsightsV2: ecs.ContainerInsights.DISABLED,
    });

    this.loadBalancer = new elbv2.ApplicationLoadBalancer(this, 'LoadBalancer', {
      vpc,
      internetFacing: false,
      vpcSubnets: { subnetType: ec2.SubnetType.PRIVATE_ISOLATED },
      // A WebSocket that is silent for a while (the caller thinks) must not be cut.
      idleTimeout: Duration.minutes(30),
      dropInvalidHeaderFields: true,
    });
    this.allowCloudFront(this.loadBalancer);

    const logGroup = new logs.LogGroup(this, 'Logs', {
      retention: logs.RetentionDays.THREE_MONTHS,
      removalPolicy: RemovalPolicy.DESTROY,
    });

    const service = new ecsPatterns.ApplicationLoadBalancedFargateService(this, 'Service', {
      cluster,
      loadBalancer: this.loadBalancer,
      publicLoadBalancer: false,
      // Reachable from CloudFront only (see above), not from everywhere.
      openListener: false,
      listenerPort: 80,
      protocol: elbv2.ApplicationProtocol.HTTP,
      cpu: 512,
      memoryLimitMiB: 1024,
      desiredCount: 1,
      runtimePlatform: {
        cpuArchitecture: ecs.CpuArchitecture.ARM64,
        operatingSystemFamily: ecs.OperatingSystemFamily.LINUX,
      },
      taskImageOptions: {
        image: ecs.ContainerImage.fromAsset(repoRoot, {
          file: 'services/voice-agent/Dockerfile',
          platform: ecrAssets.Platform.LINUX_ARM64,
          exclude: ['**/node_modules', '**/cdk.out', '**/dist', '.git', '.playwright-mcp'],
        }),
        containerPort: 8080,
        logDriver: ecs.LogDrivers.awsLogs({ streamPrefix: 'voice', logGroup }),
        environment: {
          PLANNING_TABLE: data.planningTable.tableName,
          CALLS_TABLE: data.callsTable.tableName,
          TICKET_SECRET_ARN: data.ticketSecret.secretArn,
          BEDROCK_REGION,
          NOVA_SONIC_MODEL_ID,
          NODE_OPTIONS: '--enable-source-maps',
        },
      },
      assignPublicIp: true,
      taskSubnets: { subnetType: ec2.SubnetType.PUBLIC },
      // A new version starts before the old one stops, and a broken one is rolled back.
      minHealthyPercent: 100,
      maxHealthyPercent: 200,
      circuitBreaker: { rollback: true },
      healthCheckGracePeriod: Duration.seconds(30),
    });

    service.targetGroup.configureHealthCheck({
      path: '/health',
      healthyThresholdCount: 2,
      interval: Duration.seconds(15),
    });
    // During a deployment running conversations get time to finish.
    service.targetGroup.setAttribute('deregistration_delay.timeout_seconds', '300');

    const taskRole = service.taskDefinition.taskRole;
    data.planningTable.grantReadWriteData(taskRole);
    data.callsTable.grantReadWriteData(taskRole);
    data.ticketSecret.grantRead(taskRole);
    taskRole.addToPrincipalPolicy(
      new iam.PolicyStatement({
        actions: ['bedrock:InvokeModelWithBidirectionalStream'],
        resources: [
          `arn:${this.partition}:bedrock:${BEDROCK_REGION}::foundation-model/${NOVA_SONIC_MODEL_ID}`,
        ],
      }),
    );
    taskRole.addToPrincipalPolicy(
      new iam.PolicyStatement({ actions: ['polly:SynthesizeSpeech'], resources: ['*'] }),
    );

    const container = service.taskDefinition.defaultContainer;
    if (!container) {
      throw new Error('The voice agent task has no container');
    }
    // On a new deployment or scale-in the container gets the most Fargate allows to let running
    // calls finish after it was told to stop.
    (service.taskDefinition.node.defaultChild as ecs.CfnTaskDefinition).addPropertyOverride(
      'ContainerDefinitions.0.StopTimeout',
      120,
    );

    if (config.telephony) {
      new Telephony(this, 'Telephony', { config, data, service: service.service, container });
    }
  }

  /**
   * Lets CloudFront's origin-facing servers reach the load balancer. Their address list is an
   * AWS-managed prefix list whose id differs per region; it is looked up at deployment, so that
   * synthesizing the app needs no AWS access.
   */
  private allowCloudFront(loadBalancer: elbv2.ApplicationLoadBalancer): void {
    const lookup = new cr.AwsCustomResource(this, 'CloudFrontPrefixList', {
      onUpdate: {
        service: 'EC2',
        action: 'describeManagedPrefixLists',
        parameters: {
          Filters: [
            { Name: 'prefix-list-name', Values: ['com.amazonaws.global.cloudfront.origin-facing'] },
          ],
        },
        physicalResourceId: cr.PhysicalResourceId.of('cloudfront-origin-facing'),
        outputPaths: ['PrefixLists.0.PrefixListId'],
      },
      policy: cr.AwsCustomResourcePolicy.fromSdkCalls({
        resources: cr.AwsCustomResourcePolicy.ANY_RESOURCE,
      }),
      installLatestAwsSdk: false,
    });
    loadBalancer.connections.allowFrom(
      ec2.Peer.prefixList(lookup.getResponseField('PrefixLists.0.PrefixListId')),
      ec2.Port.tcp(80),
      'CloudFront',
    );
  }
}
