import { describe, expect, it } from 'vitest';
import {
  type CallEvent,
  type CallFlowContext,
  handleCallEvent,
  TRANSACTION_HEADER,
} from '../src/telephony/call-flow';

const VC = 'arn:aws:chime:eu-central-1:111111111111:vc/abc';
const NUMBER = '+493012345000';
const PRACTICE_LINE = '+493012345099';
const CALLER = '+4917612345678';

function context(overrides: Partial<CallFlowContext> = {}): CallFlowContext {
  return {
    voiceConnectorArn: VC,
    phoneNumber: NUMBER,
    transferNumber: async () => PRACTICE_LINE,
    takeTransfer: async () => false,
    ...overrides,
  };
}

function event(
  type: string,
  options: {
    phase?: string;
    from?: string;
    legB?: 'Connected' | 'Disconnected';
    legA?: 'Connected' | 'Disconnected';
    actionData?: CallEvent['ActionData'];
  } = {},
): CallEvent {
  return {
    SchemaVersion: '1.0',
    Sequence: 1,
    InvocationEventType: type,
    ...(options.actionData ? { ActionData: options.actionData } : {}),
    CallDetails: {
      TransactionId: 'tx-1',
      ...(options.phase ? { TransactionAttributes: { phase: options.phase } } : {}),
      Participants: [
        {
          CallId: 'call-a',
          ParticipantTag: 'LEG-A',
          From: options.from ?? CALLER,
          To: NUMBER,
          Status: options.legA ?? 'Connected',
        },
        ...(options.legB
          ? [{ CallId: 'call-b', ParticipantTag: 'LEG-B' as const, Status: options.legB }]
          : []),
      ],
    },
  };
}

const hangupOf = (callId: string) => ({
  Type: 'Hangup',
  Parameters: { CallId: callId, SipResponseCode: '0' },
});

describe('the call flow of the phone number', () => {
  it('bridges a new call to the assistant and names the transaction', async () => {
    const response = await handleCallEvent(event('NEW_INBOUND_CALL'), context());
    expect(response).toEqual({
      SchemaVersion: '1.0',
      TransactionAttributes: { phase: 'assistant' },
      Actions: [
        {
          Type: 'CallAndBridge',
          Parameters: {
            CallTimeoutSeconds: 10,
            CallerIdNumber: CALLER,
            Endpoints: [{ BridgeEndpointType: 'AWS', Arn: VC, Uri: 'callisto' }],
            SipHeaders: { [TRANSACTION_HEADER]: 'tx-1' },
          },
        },
      ],
    });
  });

  it('uses the practice number as caller id when the caller withholds theirs', async () => {
    const response = await handleCallEvent(
      event('NEW_INBOUND_CALL', { from: 'anonymous' }),
      context(),
    );
    const [action] = response.Actions;
    expect(action?.Type === 'CallAndBridge' && action.Parameters.CallerIdNumber).toBe(NUMBER);
  });

  it('puts the caller through to the practice when the assistant asked for it', async () => {
    const response = await handleCallEvent(
      event('HANGUP', {
        phase: 'assistant',
        legB: 'Disconnected',
        actionData: { Type: 'Hangup', Parameters: { ParticipantTag: 'LEG-B' } },
      }),
      context({ takeTransfer: async (id) => id === 'tx-1' }),
    );
    expect(response.TransactionAttributes).toEqual({ phase: 'practice' });
    expect(response.Actions).toEqual([
      {
        Type: 'CallAndBridge',
        Parameters: {
          CallTimeoutSeconds: 60,
          CallerIdNumber: CALLER,
          Endpoints: [{ BridgeEndpointType: 'PSTN', Uri: PRACTICE_LINE }],
        },
      },
    ]);
  });

  it('ends the call when the assistant hangs up without putting the caller through', async () => {
    const response = await handleCallEvent(
      event('HANGUP', {
        phase: 'assistant',
        legB: 'Disconnected',
        actionData: { Type: 'Hangup', Parameters: { ParticipantTag: 'LEG-B' } },
      }),
      context(),
    );
    expect(response.Actions).toEqual([hangupOf('call-a')]);
  });

  it('connects the caller with the practice when the assistant cannot be reached', async () => {
    const response = await handleCallEvent(
      event('ACTION_FAILED', {
        phase: 'assistant',
        actionData: { Type: 'CallAndBridge', ErrorType: 'CallNotAnswered' },
      }),
      context(),
    );
    expect(response.TransactionAttributes).toEqual({ phase: 'practice' });
  });

  it('ends the call when neither assistant nor practice can be reached', async () => {
    const noLine = await handleCallEvent(
      event('ACTION_FAILED', { phase: 'assistant', actionData: { Type: 'CallAndBridge' } }),
      context({ transferNumber: async () => undefined }),
    );
    expect(noLine.Actions).toEqual([hangupOf('call-a')]);

    const practiceBusy = await handleCallEvent(
      event('ACTION_FAILED', { phase: 'practice', actionData: { Type: 'CallAndBridge' } }),
      context(),
    );
    expect(practiceBusy.Actions).toEqual([hangupOf('call-a')]);
  });

  it('ends the other leg when the caller hangs up, so nothing stays open and billed', async () => {
    const response = await handleCallEvent(
      event('HANGUP', {
        phase: 'assistant',
        legA: 'Disconnected',
        legB: 'Connected',
        actionData: { Type: 'Hangup', Parameters: { ParticipantTag: 'LEG-A' } },
      }),
      context(),
    );
    expect(response.Actions).toEqual([hangupOf('call-b')]);
  });
});
