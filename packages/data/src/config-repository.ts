import {
  DeleteCommand,
  type DynamoDBDocumentClient,
  GetCommand,
  PutCommand,
  paginateQuery,
  TransactWriteCommand,
} from '@aws-sdk/lib-dynamodb';
import type {
  AnnouncementPreset,
  AppointmentCategory,
  Closure,
  OpeningHours,
  PracticeSettings,
  Role,
  SlotTemplate,
} from '@callisto/domain';
import { isTransactionConditionFailed } from './client';
import {
  COLLECTION_PREFIX,
  type ConfigCollection,
  HOURS_SK,
  practicePk,
  SETTINGS_SK,
} from './keys';

/** Everything a practice has configured, as loaded by one query. */
export interface PracticeConfig {
  practiceId: string;
  settings: PracticeSettings;
  hours: OpeningHours;
  closures: Closure[];
  presets: AnnouncementPreset[];
  categories: AppointmentCategory[];
  templates: SlotTemplate[];
  roles: Role[];
}

type Collections = Pick<PracticeConfig, ConfigCollection>;
export type CollectionItem<C extends ConfigCollection> = Collections[C][number];

const byName = (left: { name: string }, right: { name: string }) =>
  left.name.localeCompare(right.name, 'de');

export class ConfigRepository {
  constructor(
    private readonly doc: DynamoDBDocumentClient,
    private readonly tableName: string,
  ) {}

  async load(practiceId: string): Promise<PracticeConfig | undefined> {
    let settings: PracticeSettings | undefined;
    let hours: OpeningHours | undefined;
    const collections: Collections = {
      closures: [],
      presets: [],
      categories: [],
      templates: [],
      roles: [],
    };

    const pages = paginateQuery(
      { client: this.doc },
      {
        TableName: this.tableName,
        KeyConditionExpression: 'PK = :pk',
        ExpressionAttributeValues: { ':pk': practicePk(practiceId) },
      },
    );
    for await (const page of pages) {
      for (const item of page.Items ?? []) {
        const sortKey = item.SK as string;
        if (sortKey === SETTINGS_SK) {
          settings = item.data;
        } else if (sortKey === HOURS_SK) {
          hours = item.data;
        } else {
          const collection = collectionOf(sortKey);
          if (collection) {
            (collections[collection] as unknown[]).push(item.data);
          }
        }
      }
    }
    if (!settings || !hours) {
      return undefined;
    }

    collections.closures.sort((left, right) => left.from.localeCompare(right.from));
    collections.presets.sort(byName);
    collections.categories.sort(byName);
    collections.templates.sort(byName);
    collections.roles.sort(
      (left, right) => Number(right.builtin) - Number(left.builtin) || byName(left, right),
    );
    return { practiceId, settings, hours, ...collections };
  }

  async putSettings(practiceId: string, settings: PracticeSettings): Promise<void> {
    await this.put(practiceId, SETTINGS_SK, settings);
  }

  async putHours(practiceId: string, hours: OpeningHours): Promise<void> {
    await this.put(practiceId, HOURS_SK, hours);
  }

  async getItem<C extends ConfigCollection>(
    practiceId: string,
    collection: C,
    id: string,
  ): Promise<CollectionItem<C> | undefined> {
    const result = await this.doc.send(
      new GetCommand({
        TableName: this.tableName,
        Key: { PK: practicePk(practiceId), SK: COLLECTION_PREFIX[collection] + id },
      }),
    );
    return result.Item?.data;
  }

  async putItem<C extends ConfigCollection>(
    practiceId: string,
    collection: C,
    item: CollectionItem<C>,
  ): Promise<void> {
    await this.put(practiceId, COLLECTION_PREFIX[collection] + item.id, item);
  }

  async deleteItem(practiceId: string, collection: ConfigCollection, id: string): Promise<void> {
    await this.doc.send(
      new DeleteCommand({
        TableName: this.tableName,
        Key: { PK: practicePk(practiceId), SK: COLLECTION_PREFIX[collection] + id },
      }),
    );
  }

  /**
   * Writes the initial configuration of a practice unless it already has one. All items are
   * written in one transaction, so a practice is never left half set up.
   * @returns whether the practice was created by this call
   */
  async createPractice(
    practiceId: string,
    initial: { settings: PracticeSettings; hours: OpeningHours; presets: AnnouncementPreset[] },
  ): Promise<boolean> {
    const item = (sortKey: string, data: unknown) => ({
      TableName: this.tableName,
      Item: this.itemFor(practiceId, sortKey, data),
    });
    try {
      await this.doc.send(
        new TransactWriteCommand({
          TransactItems: [
            {
              Put: {
                ...item(SETTINGS_SK, initial.settings),
                ConditionExpression: 'attribute_not_exists(PK)',
              },
            },
            { Put: item(HOURS_SK, initial.hours) },
            ...initial.presets.map((preset) => ({
              Put: item(COLLECTION_PREFIX.presets + preset.id, preset),
            })),
          ],
        }),
      );
      return true;
    } catch (error) {
      if (isTransactionConditionFailed(error)) {
        return false;
      }
      throw error;
    }
  }

  private async put(practiceId: string, sortKey: string, data: unknown): Promise<void> {
    await this.doc.send(
      new PutCommand({
        TableName: this.tableName,
        Item: this.itemFor(practiceId, sortKey, data),
      }),
    );
  }

  private itemFor(practiceId: string, sortKey: string, data: unknown) {
    return {
      PK: practicePk(practiceId),
      SK: sortKey,
      data,
      updatedAt: new Date().toISOString(),
    };
  }
}

function collectionOf(sortKey: string): ConfigCollection | undefined {
  for (const [collection, prefix] of Object.entries(COLLECTION_PREFIX)) {
    if (sortKey.startsWith(prefix)) {
      return collection as ConfigCollection;
    }
  }
  return undefined;
}
