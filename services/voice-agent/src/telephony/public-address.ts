import { ChangeResourceRecordSetsCommand, Route53Client } from '@aws-sdk/client-route-53';

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
 * Points the SIP host name at this container. The Voice Connector sends calls to that name, so
 * a new container takes over new calls about a minute after it starts (the record's TTL), while
 * the old one finishes the calls it has.
 */
export async function publishSipAddress(options: {
  hostedZoneId: string;
  hostName: string;
  address: string;
}): Promise<void> {
  await new Route53Client({}).send(
    new ChangeResourceRecordSetsCommand({
      HostedZoneId: options.hostedZoneId,
      ChangeBatch: {
        Comment: 'Callisto voice agent started',
        Changes: [
          {
            Action: 'UPSERT',
            ResourceRecordSet: {
              Name: options.hostName,
              Type: 'A',
              TTL: 60,
              ResourceRecords: [{ Value: options.address }],
            },
          },
        ],
      },
    }),
  );
}
