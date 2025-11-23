import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient } from '@aws-sdk/lib-dynamodb';

export function createDocumentClient(client = new DynamoDBClient({})): DynamoDBDocumentClient {
  return DynamoDBDocumentClient.from(client, {
    // Optional fields of the domain objects are `undefined` in memory and simply absent in the table.
    marshallOptions: { removeUndefinedValues: true },
  });
}

export function isConditionalCheckFailed(error: unknown): boolean {
  return error instanceof Error && error.name === 'ConditionalCheckFailedException';
}

/** Whether a transaction was cancelled because one of its conditions did not hold. */
export function isTransactionConditionFailed(error: unknown): boolean {
  if (!(error instanceof Error) || error.name !== 'TransactionCanceledException') {
    return false;
  }
  const reasons = (error as { CancellationReasons?: Array<{ Code?: string }> }).CancellationReasons;
  return reasons?.some((reason) => reason.Code === 'ConditionalCheckFailed') ?? false;
}
