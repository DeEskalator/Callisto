import { type DynamoDBDocumentClient, PutCommand, paginateQuery } from '@aws-sdk/lib-dynamodb';
import type { AuditEntry } from '@callisto/domain';
import { auditPk } from './keys';

export class AuditRepository {
  constructor(
    private readonly doc: DynamoDBDocumentClient,
    private readonly tableName: string,
  ) {}

  async append(entry: AuditEntry): Promise<void> {
    await this.doc.send(
      new PutCommand({
        TableName: this.tableName,
        Item: {
          PK: auditPk(entry.practiceId, entry.at.slice(0, 7)),
          SK: `${entry.at}#${entry.id}`,
          data: entry,
        },
      }),
    );
  }

  /** Entries of one calendar month (`YYYY-MM`, UTC), newest first. */
  async listMonth(practiceId: string, month: string): Promise<AuditEntry[]> {
    const entries: AuditEntry[] = [];
    const pages = paginateQuery(
      { client: this.doc },
      {
        TableName: this.tableName,
        KeyConditionExpression: 'PK = :pk',
        ExpressionAttributeValues: { ':pk': auditPk(practiceId, month) },
        ScanIndexForward: false,
      },
    );
    for await (const page of pages) {
      for (const item of page.Items ?? []) {
        entries.push(item.data);
      }
    }
    return entries;
  }
}
