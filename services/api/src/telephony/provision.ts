import {
  ChimeSDKVoiceClient,
  CreateSipMediaApplicationCommand,
  CreateSipRuleCommand,
  CreateVoiceConnectorCommand,
  DeleteSipMediaApplicationCommand,
  DeleteSipRuleCommand,
  DeleteVoiceConnectorCommand,
  PutVoiceConnectorOriginationCommand,
  UpdateSipMediaApplicationCommand,
  UpdateSipRuleCommand,
  type VoiceConnectorAwsRegion,
} from '@aws-sdk/client-chime-sdk-voice';
import type { CloudFormationCustomResourceEvent } from 'aws-lambda';

/**
 * Creates, updates and deletes the Amazon Chime SDK resources of the phone line. CloudFormation
 * has no resource types for them, so the stack declares them as custom resources handled here.
 *
 * - `VoiceConnector`: the SIP trunk to the voice agent, with the agent's host name as its only
 *   origination route.
 * - `SipMediaApplication`: runs the call flow Lambda for every call to the phone number, together
 *   with the SIP rule that sends calls to the number there.
 */

interface VoiceConnectorProps {
  Kind: 'VoiceConnector';
  Name: string;
  Region: string;
  Host: string;
  Port: string;
}

interface SipMediaApplicationProps {
  Kind: 'SipMediaApplication';
  Name: string;
  Region: string;
  LambdaArn: string;
  PhoneNumber: string;
}

type Props = VoiceConnectorProps | SipMediaApplicationProps;

interface Result {
  PhysicalResourceId: string;
  Data?: Record<string, string>;
}

const isNotFound = (error: unknown) => error instanceof Error && error.name === 'NotFoundException';

async function ignoreNotFound(action: () => Promise<unknown>): Promise<void> {
  try {
    await action();
  } catch (error) {
    if (!isNotFound(error)) {
      throw error;
    }
  }
}

// ── Voice Connector ─────────────────────────────────────────────────────────────

async function putOrigination(client: ChimeSDKVoiceClient, id: string, props: VoiceConnectorProps) {
  await client.send(
    new PutVoiceConnectorOriginationCommand({
      VoiceConnectorId: id,
      Origination: {
        Disabled: false,
        Routes: [
          { Host: props.Host, Port: Number(props.Port), Protocol: 'UDP', Priority: 1, Weight: 1 },
        ],
      },
    }),
  );
}

async function voiceConnector(
  event: CloudFormationCustomResourceEvent,
  props: VoiceConnectorProps,
): Promise<Result> {
  const client = new ChimeSDKVoiceClient({ region: props.Region });
  if (event.RequestType === 'Delete') {
    await ignoreNotFound(() =>
      client.send(new DeleteVoiceConnectorCommand({ VoiceConnectorId: event.PhysicalResourceId })),
    );
    return { PhysicalResourceId: event.PhysicalResourceId };
  }

  let id = event.RequestType === 'Update' ? event.PhysicalResourceId : undefined;
  let arn: string | undefined;
  if (!id) {
    const created = await client.send(
      new CreateVoiceConnectorCommand({
        Name: props.Name,
        AwsRegion: props.Region as VoiceConnectorAwsRegion,
        // Between Voice Connector and agent the audio stays on AWS's network; the phone network
        // before it is unencrypted anyway. See docs/architektur.md.
        RequireEncryption: false,
      }),
    );
    id = created.VoiceConnector?.VoiceConnectorId;
    arn = created.VoiceConnector?.VoiceConnectorArn;
    if (!id) {
      throw new Error('The Voice Connector was created without an id');
    }
  }
  await putOrigination(client, id, props);
  return {
    PhysicalResourceId: id,
    Data: {
      VoiceConnectorId: id,
      VoiceConnectorArn:
        arn ?? `arn:aws:chime:${props.Region}:${event.ServiceToken.split(':')[4]}:vc/${id}`,
    },
  };
}

// ── SIP media application and SIP rule ──────────────────────────────────────────

async function removeRule(client: ChimeSDKVoiceClient, ruleId: string, name: string) {
  // A rule has to be disabled before it can be deleted.
  await ignoreNotFound(() =>
    client.send(new UpdateSipRuleCommand({ SipRuleId: ruleId, Name: name, Disabled: true })),
  );
  await ignoreNotFound(() => client.send(new DeleteSipRuleCommand({ SipRuleId: ruleId })));
}

async function createRule(
  client: ChimeSDKVoiceClient,
  applicationId: string,
  props: SipMediaApplicationProps,
): Promise<string> {
  const rule = await client.send(
    new CreateSipRuleCommand({
      Name: `${props.Name}-number`,
      TriggerType: 'ToPhoneNumber',
      TriggerValue: props.PhoneNumber,
      TargetApplications: [
        { SipMediaApplicationId: applicationId, Priority: 1, AwsRegion: props.Region },
      ],
    }),
  );
  const ruleId = rule.SipRule?.SipRuleId;
  if (!ruleId) {
    throw new Error('The SIP rule was created without an id');
  }
  return ruleId;
}

async function sipMediaApplication(
  event: CloudFormationCustomResourceEvent,
  props: SipMediaApplicationProps,
): Promise<Result> {
  const client = new ChimeSDKVoiceClient({ region: props.Region });
  // The physical id holds both: "<application id>|<rule id>".
  const [applicationId, ruleId] =
    event.RequestType === 'Create' ? [] : event.PhysicalResourceId.split('|');

  if (event.RequestType === 'Delete') {
    if (ruleId) {
      await removeRule(client, ruleId, `${props.Name}-number`);
    }
    if (applicationId) {
      await ignoreNotFound(() =>
        client.send(new DeleteSipMediaApplicationCommand({ SipMediaApplicationId: applicationId })),
      );
    }
    return { PhysicalResourceId: event.PhysicalResourceId };
  }

  if (event.RequestType === 'Update' && applicationId && ruleId) {
    await client.send(
      new UpdateSipMediaApplicationCommand({
        SipMediaApplicationId: applicationId,
        Name: props.Name,
        Endpoints: [{ LambdaArn: props.LambdaArn }],
      }),
    );
    const previous = event.OldResourceProperties as unknown as SipMediaApplicationProps;
    if (previous.PhoneNumber === props.PhoneNumber) {
      return {
        PhysicalResourceId: event.PhysicalResourceId,
        Data: { SipMediaApplicationId: applicationId },
      };
    }
    // A new number: the rule is replaced, so calls to the old number stop reaching the assistant.
    await removeRule(client, ruleId, `${previous.Name}-number`);
    const newRuleId = await createRule(client, applicationId, props);
    return {
      PhysicalResourceId: `${applicationId}|${newRuleId}`,
      Data: { SipMediaApplicationId: applicationId },
    };
  }

  const created = await client.send(
    new CreateSipMediaApplicationCommand({
      Name: props.Name,
      AwsRegion: props.Region,
      Endpoints: [{ LambdaArn: props.LambdaArn }],
    }),
  );
  const newApplicationId = created.SipMediaApplication?.SipMediaApplicationId;
  if (!newApplicationId) {
    throw new Error('The SIP media application was created without an id');
  }
  try {
    const newRuleId = await createRule(client, newApplicationId, props);
    return {
      PhysicalResourceId: `${newApplicationId}|${newRuleId}`,
      Data: { SipMediaApplicationId: newApplicationId },
    };
  } catch (error) {
    // Typically: the number is not (yet) in the account's inventory as a SIP media application
    // number. Clean up, so that the next attempt starts fresh.
    await ignoreNotFound(() =>
      client.send(
        new DeleteSipMediaApplicationCommand({ SipMediaApplicationId: newApplicationId }),
      ),
    );
    throw new Error(
      `The phone number ${props.PhoneNumber} could not be routed to the assistant: ${
        error instanceof Error ? error.message : String(error)
      }. Is it in the account's phone number inventory with the product type "SIP media application dial-in"?`,
    );
  }
}

/** Custom resource handler (CDK provider framework, onEvent). */
export const handler = async (event: CloudFormationCustomResourceEvent): Promise<Result> => {
  const props = event.ResourceProperties as unknown as Props & { ServiceToken: string };
  switch (props.Kind) {
    case 'VoiceConnector':
      return voiceConnector(event, props);
    case 'SipMediaApplication':
      return sipMediaApplication(event, props);
    default:
      throw new Error(`Unknown kind of telephony resource: ${(props as { Kind: string }).Kind}`);
  }
};
