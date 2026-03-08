/**
 * The call flow of the phone number, as the SIP media application of the Amazon Chime SDK runs
 * it. Every event of a call (it arrives, a leg hangs up, an action fails) invokes this function,
 * which answers with the next actions.
 *
 *   caller ──► SIP media application ──CallAndBridge──► Voice Connector ──SIP──► voice agent
 *                        │
 *                        └──CallAndBridge (PSTN)──► the practice's second line
 *                           · when the assistant puts the caller through
 *                           · when the assistant cannot be reached
 *
 * Event and action formats: Amazon Chime SDK developer guide, "Understanding telephony events"
 * and "CallAndBridge".
 */

export interface Participant {
  CallId: string;
  ParticipantTag: 'LEG-A' | 'LEG-B';
  To?: string;
  From?: string;
  Direction?: string;
  Status?: 'Connected' | 'Disconnected';
}

export interface CallEvent {
  SchemaVersion: string;
  Sequence: number;
  InvocationEventType: string;
  ActionData?: {
    Type?: string;
    Parameters?: {
      CallId?: string;
      ParticipantTag?: string;
      Endpoints?: Array<{ BridgeEndpointType?: string }>;
    };
    ErrorType?: string;
  };
  CallDetails: {
    TransactionId: string;
    TransactionAttributes?: Record<string, string>;
    Participants: Participant[];
  };
}

export type Action =
  | {
      Type: 'CallAndBridge';
      Parameters: {
        CallTimeoutSeconds: number;
        CallerIdNumber: string;
        Endpoints: Array<
          | { BridgeEndpointType: 'AWS'; Arn: string; Uri: string }
          | { BridgeEndpointType: 'PSTN'; Uri: string }
        >;
        SipHeaders?: Record<string, string>;
      };
    }
  | { Type: 'Hangup'; Parameters: { CallId: string; SipResponseCode: string } };

export interface CallFlowResponse {
  SchemaVersion: '1.0';
  Actions: Action[];
  TransactionAttributes?: Record<string, string>;
}

export interface CallFlowContext {
  /** The Voice Connector in front of the voice agent. */
  voiceConnectorArn: string;
  /** The practice's phone number, in E.164 (the number callers dial). */
  phoneNumber: string;
  /** Where callers are put through to; the practice's second line. */
  transferNumber: () => Promise<string | undefined>;
  /** Whether the voice agent asked for this call to be put through (and forgets it). */
  takeTransfer: (transactionId: string) => Promise<boolean>;
}

/** Same name as in the voice agent, which reads it from the INVITE. */
export const TRANSACTION_HEADER = 'x-callisto-transaction';

/** Which call is bridged to leg B right now; kept by the SIP media application between events. */
type Phase = 'assistant' | 'practice';

const isE164 = (number: string | undefined): number is string =>
  number !== undefined && /^\+[1-9]\d{6,14}$/.test(number);

const respond = (actions: Action[], phase: Phase | undefined): CallFlowResponse => ({
  SchemaVersion: '1.0',
  Actions: actions,
  // Returned with every answer, so it is there with the next event whatever the platform keeps.
  ...(phase ? { TransactionAttributes: { phase } } : {}),
});

const hangup = (callId: string): Action => ({
  Type: 'Hangup',
  Parameters: { CallId: callId, SipResponseCode: '0' },
});

export async function handleCallEvent(
  event: CallEvent,
  context: CallFlowContext,
): Promise<CallFlowResponse> {
  const { CallDetails: details } = event;
  const legA = details.Participants.find((participant) => participant.ParticipantTag === 'LEG-A');
  const legB = details.Participants.find((participant) => participant.ParticipantTag === 'LEG-B');
  const phase = details.TransactionAttributes?.phase as Phase | undefined;
  if (!legA) {
    return respond([], phase);
  }
  // The practice sees the patient's number when it is known, otherwise the practice's own.
  const callerId = isE164(legA.From) ? legA.From : context.phoneNumber;

  const toPractice = async (): Promise<CallFlowResponse> => {
    const target = await context.transferNumber();
    if (!target) {
      return respond([hangup(legA.CallId)], phase);
    }
    return respond(
      [
        {
          Type: 'CallAndBridge',
          Parameters: {
            CallTimeoutSeconds: 60,
            CallerIdNumber: callerId,
            Endpoints: [{ BridgeEndpointType: 'PSTN', Uri: target }],
          },
        },
      ],
      'practice',
    );
  };

  switch (event.InvocationEventType) {
    case 'NEW_INBOUND_CALL':
      return respond(
        [
          {
            Type: 'CallAndBridge',
            Parameters: {
              // The agent answers within a second; longer means it is not there.
              CallTimeoutSeconds: 10,
              CallerIdNumber: callerId,
              Endpoints: [
                { BridgeEndpointType: 'AWS', Arn: context.voiceConnectorArn, Uri: 'callisto' },
              ],
              SipHeaders: { [TRANSACTION_HEADER]: details.TransactionId },
            },
          },
        ],
        'assistant',
      );

    case 'ACTION_FAILED':
      // The assistant could not be reached: the caller goes straight to the practice rather
      // than into silence. If the practice cannot be reached either, the call ends.
      if (phase === 'assistant' && event.ActionData?.Type === 'CallAndBridge') {
        return toPractice();
      }
      return respond([hangup(legA.CallId)], phase);

    case 'HANGUP': {
      const hungUp = event.ActionData?.Parameters?.ParticipantTag;
      if (hungUp === 'LEG-A') {
        // The caller hung up: the other leg must be ended too, or it stays open and billed.
        return respond(legB && legB.Status !== 'Disconnected' ? [hangup(legB.CallId)] : [], phase);
      }
      if (legA.Status === 'Disconnected') {
        return respond([], phase);
      }
      // Leg B hung up. If it was the assistant and it put the caller through, connect the
      // practice; otherwise the conversation is over.
      if (phase === 'assistant' && (await context.takeTransfer(details.TransactionId))) {
        return toPractice();
      }
      return respond([hangup(legA.CallId)], phase);
    }

    default:
      return respond([], phase);
  }
}
