import {
  DeleteCommand,
  type DynamoDBDocumentClient,
  GetCommand,
  PutCommand,
  paginateQuery,
} from '@aws-sdk/lib-dynamodb';
import type { UserProfile } from '@callisto/domain';
import { GSI1, practiceUsersPk, userKey } from './keys';

export class UserRepository {
  constructor(
    private readonly doc: DynamoDBDocumentClient,
    private readonly tableName: string,
  ) {}

  async get(userId: string): Promise<UserProfile | undefined> {
    const result = await this.doc.send(
      new GetCommand({ TableName: this.tableName, Key: userKey(userId) }),
    );
    return result.Item?.data;
  }

  async put(profile: UserProfile): Promise<void> {
    await this.doc.send(
      new PutCommand({
        TableName: this.tableName,
        Item: {
          ...userKey(profile.id),
          GSI1PK: practiceUsersPk(profile.practiceId),
          GSI1SK: profile.email,
          data: profile,
          updatedAt: new Date().toISOString(),
        },
      }),
    );
  }

  async delete(userId: string): Promise<void> {
    await this.doc.send(new DeleteCommand({ TableName: this.tableName, Key: userKey(userId) }));
  }

  /** All users of a practice, ordered by e-mail address. */
  async listByPractice(practiceId: string): Promise<UserProfile[]> {
    const users: UserProfile[] = [];
    const pages = paginateQuery(
      { client: this.doc },
      {
        TableName: this.tableName,
        IndexName: GSI1,
        KeyConditionExpression: 'GSI1PK = :pk',
        ExpressionAttributeValues: { ':pk': practiceUsersPk(practiceId) },
      },
    );
    for await (const page of pages) {
      for (const item of page.Items ?? []) {
        users.push(item.data);
      }
    }
    return users;
  }
}
