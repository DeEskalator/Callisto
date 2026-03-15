import { CfnOutput, CustomResource, Duration, Stack } from 'aws-cdk-lib';
import * as ec2 from 'aws-cdk-lib/aws-ec2';
import type * as ecs from 'aws-cdk-lib/aws-ecs';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as cr from 'aws-cdk-lib/custom-resources';
import { Construct } from 'constructs';
import type { DeploymentConfig } from './config';
import type { DataStack } from './data-stack';
import { ServiceFunction } from './service-function';

/** UDP port of SIP signalling on the voice agent. */
export const SIP_PORT = 5060;
/** UDP ports for the audio of running calls: one each, so up to 100 calls at once. */
export const RTP_PORTS = { min: 20000, max: 20199 };

/**
 * Where Voice Connectors send SIP and RTP from, per region (Amazon Chime SDK administrator
 * guide, "Network configuration and bandwidth requirements"). Only these may reach the line.
 */
const VOICE_CONNECTOR_CIDRS: Record<string, string> = {
  'eu-central-1': '99.77.247.0/24',
  'eu-west-1': '99.77.250.0/24',
  'eu-west-2': '99.77.249.0/24',
  'us-east-1': '3.80.16.0/23',
  'us-west-2': '99.77.253.0/24',
};

export interface TelephonyProps {
  config: DeploymentConfig;
  data: DataStack;
  /** The voice agent's service; the phone line is opened on its containers. */
  service: ecs.FargateService;
  container: ecs.ContainerDefinition;
}

/**
 * The phone line: the practice's number, a SIP media application that runs the call flow, and a
 * Voice Connector that carries calls to the voice agent over SIP.
 *
 * The voice agent's containers have no fixed address. Each one enters its own public address as
 * the Voice Connector's destination when it starts, so no domain is needed for the line.
 */
export class Telephony extends Construct {
  constructor(scope: Construct, id: string, props: TelephonyProps) {
    super(scope, id);
    const { config, data, service, container } = props;
    const telephony = config.telephony;
    if (!telephony) {
      throw new Error('Telephony needs a phone number');
    }
    const region = Stack.of(this).region;
    const cidr = VOICE_CONNECTOR_CIDRS[region];
    if (!cidr) {
      throw new Error(`No Voice Connector address range is known for ${region}`);
    }
    const name = `callisto-${config.stage}`;

    // ── The voice agent opens the line ───────────────────────────────────────

    for (const ports of [ec2.Port.udp(SIP_PORT), ec2.Port.udpRange(RTP_PORTS.min, RTP_PORTS.max)]) {
      service.connections.allowFrom(ec2.Peer.ipv4(cidr), ports, 'Voice Connector');
    }
    container.addEnvironment('SIP_PORT', String(SIP_PORT));
    container.addEnvironment('RTP_PORTS', `${RTP_PORTS.min}-${RTP_PORTS.max}`);
    container.addEnvironment('PRACTICE_ID', config.practice.id);
    // ── Amazon Chime SDK resources (no CloudFormation types; custom resources) ──

    const provisioner = new ServiceFunction(this, 'Provisioner', {
      entry: 'services/api/src/telephony/provision.ts',
      description: 'Creates the Chime SDK resources of the phone line',
      timeout: Duration.minutes(2),
    });
    provisioner.addToRolePolicy(
      new iam.PolicyStatement({
        actions: [
          'chime:CreateVoiceConnector',
          'chime:DeleteVoiceConnector',
          'chime:GetVoiceConnector',
          'chime:PutVoiceConnectorOrigination',
          'chime:CreateSipMediaApplication',
          'chime:UpdateSipMediaApplication',
          'chime:DeleteSipMediaApplication',
          'chime:CreateSipRule',
          'chime:UpdateSipRule',
          'chime:DeleteSipRule',
        ],
        resources: ['*'],
      }),
    );
    // The first Voice Connector of an account creates Chime's service-linked role.
    provisioner.addToRolePolicy(
      new iam.PolicyStatement({
        actions: ['iam:CreateServiceLinkedRole'],
        resources: ['*'],
        conditions: {
          StringEquals: { 'iam:AWSServiceName': 'voiceconnector.chime.amazonaws.com' },
        },
      }),
    );
    const provider = new cr.Provider(this, 'Provider', { onEventHandler: provisioner });

    const voiceConnector = new CustomResource(this, 'VoiceConnector', {
      serviceToken: provider.serviceToken,
      resourceType: 'Custom::ChimeVoiceConnector',
      properties: { Kind: 'VoiceConnector', Name: name, Region: region },
    });

    // The container tells the Voice Connector where to send calls: to its own address.
    container.addEnvironment('VOICE_CONNECTOR_ID', voiceConnector.getAttString('VoiceConnectorId'));
    container.addEnvironment('VOICE_CONNECTOR_REGION', region);
    service.taskDefinition.taskRole.addToPrincipalPolicy(
      new iam.PolicyStatement({
        actions: ['chime:PutVoiceConnectorOrigination'],
        resources: [voiceConnector.getAttString('VoiceConnectorArn')],
      }),
    );

    const callFlow = new ServiceFunction(this, 'CallFlow', {
      entry: 'services/api/src/telephony/handler.ts',
      description: 'Call flow of the phone number (SIP media application)',
      environment: {
        PLANNING_TABLE: data.planningTable.tableName,
        CALLS_TABLE: data.callsTable.tableName,
        PRACTICE_ID: config.practice.id,
        VOICE_CONNECTOR_ARN: voiceConnector.getAttString('VoiceConnectorArn'),
        PHONE_NUMBER: telephony.phoneNumber,
      },
    });
    data.planningTable.grantReadData(callFlow);
    // Reads and removes the transfer marks the voice agent writes.
    data.callsTable.grantReadWriteData(callFlow);
    callFlow.addPermission('InvokedByChime', {
      principal: new iam.ServicePrincipal('voiceconnector.chime.amazonaws.com'),
      sourceAccount: Stack.of(this).account,
    });

    const application = new CustomResource(this, 'SipMediaApplication', {
      serviceToken: provider.serviceToken,
      resourceType: 'Custom::ChimeSipMediaApplication',
      properties: {
        Kind: 'SipMediaApplication',
        Name: name,
        Region: region,
        LambdaArn: callFlow.functionArn,
        PhoneNumber: telephony.phoneNumber,
      },
    });
    // The function and its permissions (children of it) must exist before Chime checks them.
    application.node.addDependency(callFlow);

    new CfnOutput(this, 'PhoneNumber', { value: telephony.phoneNumber });
  }
}
