import {
  ChimeSDKVoiceClient,
  PutVoiceConnectorOriginationCommand,
} from '@aws-sdk/client-chime-sdk-voice';

/**
 * The public IPv4 address of this container. Fargate tasks get a new one on every start, and
 * the task cannot see it itself; AWS's own echo service tells it.
 */
export async function detectPublicAddress(): Promise<string> {
  const response = await fetch('https://checkip.amazonaws.com', {
    signal: AbortSignal.timeout(5000),
  });
  const address = (await response.text()).trim();
  if (!/^\d{1,3}(\.\d{1,3}){3}$/.test(address)) {
    throw new Error(`Unexpected answer from checkip.amazonaws.com: ${address.slice(0, 40)}`);
  }
  return address;
}

/**
 * Makes the Voice Connector send calls to this container. A new container takes over new calls
 * as soon as it has started, while the old one finishes the calls it has.
 */
export async function registerWithVoiceConnector(options: {
  voiceConnectorId: string;
  region: string;
  address: string;
  port: number;
}): Promise<void> {
  await new ChimeSDKVoiceClient({ region: options.region }).send(
    new PutVoiceConnectorOriginationCommand({
      VoiceConnectorId: options.voiceConnectorId,
      Origination: {
        Disabled: false,
        Routes: [
          { Host: options.address, Port: options.port, Protocol: 'UDP', Priority: 1, Weight: 1 },
        ],
      },
    }),
  );
}
