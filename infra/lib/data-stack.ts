import { RemovalPolicy, Stack, type StackProps } from 'aws-cdk-lib';
import * as dynamodb from 'aws-cdk-lib/aws-dynamodb';
import * as events from 'aws-cdk-lib/aws-events';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as kms from 'aws-cdk-lib/aws-kms';
import * as pipes from 'aws-cdk-lib/aws-pipes';
import * as secretsmanager from 'aws-cdk-lib/aws-secretsmanager';
import type { Construct } from 'constructs';
import type { DeploymentConfig } from './config';

export interface DataStackProps extends StackProps {
  config: DeploymentConfig;
}

const stringKey = (name: string) => ({ name, type: dynamodb.AttributeType.STRING });

/**
 * Everything that holds state: the two tables, the key for patient data and the event bus.
 * Kept in its own stack so that the stateless stacks can be replaced without touching it.
 */
export class DataStack extends Stack {
  /** Configuration, users, slots and the audit log. See `packages/data/src/keys.ts`. */
  readonly planningTable: dynamodb.TableV2;
  /** Calls, transcripts and inquiries, i.e. everything a patient said. */
  readonly callsTable: dynamodb.TableV2;
  readonly patientDataKey: kms.Key;
  readonly eventBus: events.EventBus;
  /** Shared by the API and the voice agent to sign and check tickets for test conversations. */
  readonly ticketSecret: secretsmanager.Secret;

  constructor(scope: Construct, id: string, props: DataStackProps) {
    super(scope, id, props);
    const { config } = props;
    const removalPolicy = config.production ? RemovalPolicy.RETAIN : RemovalPolicy.DESTROY;

    this.patientDataKey = new kms.Key(this, 'PatientDataKey', {
      description: `Callisto ${config.stage}: encrypts calls, transcripts and inquiries`,
      enableKeyRotation: true,
      removalPolicy,
    });

    this.planningTable = new dynamodb.TableV2(this, 'PlanningTable', {
      partitionKey: stringKey('PK'),
      sortKey: stringKey('SK'),
      billing: dynamodb.Billing.onDemand(),
      globalSecondaryIndexes: [
        { indexName: 'GSI1', partitionKey: stringKey('GSI1PK'), sortKey: stringKey('GSI1SK') },
      ],
      timeToLiveAttribute: 'expiresAt',
      pointInTimeRecoverySpecification: { pointInTimeRecoveryEnabled: true },
      deletionProtection: config.production,
      removalPolicy,
    });

    this.callsTable = new dynamodb.TableV2(this, 'CallsTable', {
      partitionKey: stringKey('PK'),
      sortKey: stringKey('SK'),
      billing: dynamodb.Billing.onDemand(),
      encryption: dynamodb.TableEncryptionV2.customerManagedKey(this.patientDataKey),
      globalSecondaryIndexes: [
        { indexName: 'GSI1', partitionKey: stringKey('GSI1PK'), sortKey: stringKey('GSI1SK') },
        { indexName: 'GSI2', partitionKey: stringKey('GSI2PK'), sortKey: stringKey('GSI2SK') },
      ],
      // Retention: transcripts and inquiries delete themselves when their time is up.
      timeToLiveAttribute: 'expiresAt',
      // Changes are turned into domain events for the dashboard and for integrations.
      dynamoStream: dynamodb.StreamViewType.NEW_AND_OLD_IMAGES,
      pointInTimeRecoverySpecification: { pointInTimeRecoveryEnabled: true },
      deletionProtection: config.production,
      removalPolicy,
    });

    this.eventBus = new events.EventBus(this, 'EventBus', {
      eventBusName: `callisto-${config.stage}`,
    });

    this.ticketSecret = new secretsmanager.Secret(this, 'TicketSecret', {
      description: `Callisto ${config.stage}: signs tickets for test conversations`,
      generateSecretString: { passwordLength: 48, excludePunctuation: true },
    });

    this.publishInquiryEvents(config);
  }

  /**
   * Turns every new or changed inquiry into an event on the bus. This is where an integration
   * (e.g. with the practice management system) attaches: it subscribes to the events and fetches
   * the details through the API. The events carry ids and the type, never patient data.
   */
  private publishInquiryEvents(config: DeploymentConfig): void {
    const role = new iam.Role(this, 'InquiryEventsRole', {
      assumedBy: new iam.ServicePrincipal('pipes.amazonaws.com'),
    });
    this.callsTable.grantStreamRead(role);
    this.patientDataKey.grantDecrypt(role);
    this.eventBus.grantPutEventsTo(role);

    const field = (path: string) => `<$.dynamodb.NewImage.data.M.${path}>`;
    new pipes.CfnPipe(this, 'InquiryEvents', {
      name: `callisto-${config.stage}-inquiry-events`,
      description: 'Callisto: inquiries from the calls table as events',
      roleArn: role.roleArn,
      source: this.callsTable.tableStreamArn ?? '',
      sourceParameters: {
        dynamoDbStreamParameters: { startingPosition: 'LATEST', batchSize: 10 },
        filterCriteria: {
          filters: [
            {
              pattern: JSON.stringify({
                eventName: ['INSERT', 'MODIFY'],
                dynamodb: { Keys: { PK: { S: [{ prefix: 'INQ#' }] } } },
              }),
            },
          ],
        },
      },
      target: this.eventBus.eventBusArn,
      targetParameters: {
        eventBridgeEventBusParameters: {
          source: 'callisto.inquiries',
          detailType: 'Inquiry changed',
        },
        inputTemplate: `{"change": "<$.eventName>", "inquiryId": "${field('id.S')}", "practiceId": "${field('practiceId.S')}", "type": "${field('details.M.type.S')}", "status": "${field('status.S')}", "test": ${field('test.BOOL')}}`,
      },
    });
  }
}
