import {
  type DynamoDBDocumentClient,
  GetCommand,
  PutCommand,
  paginateQuery,
  type QueryCommandInput,
} from '@aws-sdk/lib-dynamodb';
import type { Call, Inquiry, TranscriptTurn } from '@callisto/domain';
import {
  CALL_META_SK,
  callPk,
  callsOfDayPk,
  GSI1,
  GSI2,
  inquiriesOfDayPk,
  inquiryKey,
  openInquiriesPk,
  turnSk,
} from './keys';

/** The moment an item written now may be deleted, as DynamoDB's TTL wants it (epoch seconds). */
export function expiryAfterDays(days: number, from: Date = new Date()): number {
  return Math.floor(from.getTime() / 1000) + days * 86_400;
}

const isOpen = (inquiry: Inquiry) => inquiry.status === 'new' || inquiry.status === 'in_progress';

export class CallRepository {
  constructor(
    private readonly doc: DynamoDBDocumentClient,
    private readonly tableName: string,
  ) {}

  /** Creates or replaces a call. `expiresAt` is when it deletes itself (see `expiryAfterDays`). */
  async putCall(call: Call, expiresAt: number): Promise<void> {
    await this.doc.send(
      new PutCommand({
        TableName: this.tableName,
        Item: {
          PK: callPk(call.id),
          SK: CALL_META_SK,
          GSI1PK: callsOfDayPk(call.practiceId, call.date),
          GSI1SK: `${call.startedAt}#${call.id}`,
          data: call,
          expiresAt,
        },
      }),
    );
  }

  async getCall(callId: string): Promise<Call | undefined> {
    const result = await this.doc.send(
      new GetCommand({ TableName: this.tableName, Key: { PK: callPk(callId), SK: CALL_META_SK } }),
    );
    return result.Item?.data;
  }

  /** The calls that started on a day, earliest first. */
  async listCallsByDate(practiceId: string, date: string): Promise<Call[]> {
    return this.query({
      IndexName: GSI1,
      KeyConditionExpression: 'GSI1PK = :pk',
      ExpressionAttributeValues: { ':pk': callsOfDayPk(practiceId, date) },
    });
  }

  async appendTurn(callId: string, turn: TranscriptTurn, expiresAt: number): Promise<void> {
    await this.doc.send(
      new PutCommand({
        TableName: this.tableName,
        Item: { PK: callPk(callId), SK: turnSk(turn.seq), data: turn, expiresAt },
      }),
    );
  }

  /** The transcript of a call in spoken order. */
  async listTurns(callId: string): Promise<TranscriptTurn[]> {
    return this.query({
      KeyConditionExpression: 'PK = :pk AND begins_with(SK, :turn)',
      ExpressionAttributeValues: { ':pk': callPk(callId), ':turn': 'TURN#' },
    });
  }

  async putInquiry(inquiry: Inquiry, expiresAt: number): Promise<void> {
    await this.doc.send(
      new PutCommand({
        TableName: this.tableName,
        Item: {
          ...inquiryKey(inquiry.id),
          GSI1PK: inquiriesOfDayPk(inquiry.practiceId, inquiry.date),
          GSI1SK: `${inquiry.createdAt}#${inquiry.id}`,
          // Only open inquiries are in GSI2; closing one takes it out of the worklist.
          ...(isOpen(inquiry)
            ? {
                GSI2PK: openInquiriesPk(inquiry.practiceId),
                GSI2SK: `${inquiry.createdAt}#${inquiry.id}`,
              }
            : {}),
          data: inquiry,
          expiresAt,
        },
      }),
    );
  }

  async getInquiry(inquiryId: string): Promise<Inquiry | undefined> {
    const result = await this.doc.send(
      new GetCommand({ TableName: this.tableName, Key: inquiryKey(inquiryId) }),
    );
    return result.Item?.data;
  }

  /** The inquiries created on a day, earliest first. */
  async listInquiriesByDate(practiceId: string, date: string): Promise<Inquiry[]> {
    return this.query({
      IndexName: GSI1,
      KeyConditionExpression: 'GSI1PK = :pk',
      ExpressionAttributeValues: { ':pk': inquiriesOfDayPk(practiceId, date) },
    });
  }

  /** Every inquiry the practice has not finished yet, oldest first. */
  async listOpenInquiries(practiceId: string): Promise<Inquiry[]> {
    return this.query({
      IndexName: GSI2,
      KeyConditionExpression: 'GSI2PK = :pk',
      ExpressionAttributeValues: { ':pk': openInquiriesPk(practiceId) },
    });
  }

  private async query<Item>(input: Omit<QueryCommandInput, 'TableName'>): Promise<Item[]> {
    const items: Item[] = [];
    const pages = paginateQuery({ client: this.doc }, { TableName: this.tableName, ...input });
    for await (const page of pages) {
      for (const item of page.Items ?? []) {
        items.push(item.data);
      }
    }
    return items;
  }
}
