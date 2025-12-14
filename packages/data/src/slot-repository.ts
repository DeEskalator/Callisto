import {
  DeleteCommand,
  type DynamoDBDocumentClient,
  GetCommand,
  PutCommand,
  paginateQuery,
  QueryCommand,
  UpdateCommand,
} from '@aws-sdk/lib-dynamodb';
import {
  addDays,
  eachDate,
  type LocalDate,
  type LocalTime,
  parseSlotId,
  type Slot,
  type SlotStatus,
} from '@callisto/domain';
import { isConditionalCheckFailed } from './client';
import { freeSlotIndexKey, freeSlotsPk, GSI1, slotDayPk, slotKey } from './keys';

/** Slots stay visible in the calendar for about a year after their day, then delete themselves. */
const KEEP_DAYS = 400;
/** Parallel requests when a call touches many items or days. */
const CONCURRENCY = 25;

async function inParallel<Item>(items: Item[], task: (item: Item) => Promise<void>): Promise<void> {
  let next = 0;
  const worker = async () => {
    while (next < items.length) {
      const item = items[next++] as Item;
      await task(item);
    }
  };
  await Promise.all(Array.from({ length: Math.min(CONCURRENCY, items.length) }, worker));
}

/** Runs a conditional write and reports whether its condition held. */
async function conditionHeld(write: () => Promise<unknown>): Promise<boolean> {
  try {
    await write();
    return true;
  } catch (error) {
    if (isConditionalCheckFailed(error)) {
      return false;
    }
    throw error;
  }
}

const NAMES = { '#data': 'data', '#status': 'status' };

export class SlotRepository {
  constructor(
    private readonly doc: DynamoDBDocumentClient,
    private readonly tableName: string,
  ) {}

  /** The slots of one day in chronological order. */
  async listDay(practiceId: string, date: LocalDate): Promise<Slot[]> {
    const slots: Slot[] = [];
    const pages = paginateQuery(
      { client: this.doc },
      {
        TableName: this.tableName,
        KeyConditionExpression: 'PK = :pk',
        ExpressionAttributeValues: { ':pk': slotDayPk(practiceId, date) },
      },
    );
    for await (const page of pages) {
      for (const item of page.Items ?? []) {
        slots.push(item.data);
      }
    }
    return slots;
  }

  /** The slots of a range of days, both ends inclusive, in chronological order. */
  async listRange(practiceId: string, from: LocalDate, to: LocalDate): Promise<Slot[]> {
    const dates = eachDate(from, to);
    const days: Slot[][] = new Array(dates.length);
    await inParallel(
      dates.map((date, index) => ({ date, index })),
      async ({ date, index }) => {
        days[index] = await this.listDay(practiceId, date);
      },
    );
    return days.flat();
  }

  async get(practiceId: string, slotId: string): Promise<Slot | undefined> {
    const located = parseSlotId(slotId);
    if (!located) {
      return undefined;
    }
    const result = await this.doc.send(
      new GetCommand({
        TableName: this.tableName,
        Key: slotKey(practiceId, { id: slotId, ...located }),
      }),
    );
    return result.Item?.data;
  }

  /** The next free slots of a category at or after a local date and time, earliest first. */
  async findFree(
    practiceId: string,
    categoryId: string,
    from: { date: LocalDate; time: LocalTime },
    limit: number,
  ): Promise<Slot[]> {
    const result = await this.doc.send(
      new QueryCommand({
        TableName: this.tableName,
        IndexName: GSI1,
        KeyConditionExpression: 'GSI1PK = :pk AND GSI1SK >= :from',
        ExpressionAttributeValues: {
          ':pk': freeSlotsPk(practiceId, categoryId),
          ':from': `${from.date}T${from.time}`,
        },
        Limit: limit,
      }),
    );
    return (result.Items ?? []).map((item) => item.data);
  }

  /**
   * Creates the slots that do not exist yet; existing ones, booked or not, are left as they are.
   * @returns how many slots were created
   */
  async create(practiceId: string, slots: Slot[]): Promise<number> {
    return this.putEach(practiceId, slots, 'attribute_not_exists(PK)');
  }

  /**
   * Overwrites slots that are missing or still free. A slot that was booked in the meantime wins.
   * @returns how many slots were written
   */
  async replaceFree(practiceId: string, slots: Slot[]): Promise<number> {
    return this.putEach(practiceId, slots, 'attribute_not_exists(PK) OR #data.#status = :free', {
      names: NAMES,
      values: { ':free': 'free' },
    });
  }

  /**
   * Deletes slots unless they are booked.
   * @returns how many slots were deleted
   */
  async deleteUnbooked(
    practiceId: string,
    slots: Array<Pick<Slot, 'id' | 'date' | 'startTime'>>,
  ): Promise<number> {
    let deleted = 0;
    await inParallel(slots, async (slot) => {
      const held = await conditionHeld(() =>
        this.doc.send(
          new DeleteCommand({
            TableName: this.tableName,
            Key: slotKey(practiceId, slot),
            ConditionExpression: 'attribute_not_exists(PK) OR #data.#status <> :booked',
            ExpressionAttributeNames: NAMES,
            ExpressionAttributeValues: { ':booked': 'booked' },
          }),
        ),
      );
      if (held) {
        deleted += 1;
      }
    });
    return deleted;
  }

  /**
   * Moves a slot from the status it is known to have into another one. The write only happens if
   * the slot still has that status, which is what makes a booking safe against a second caller
   * taking the same slot at the same moment.
   * @returns whether the slot was changed
   */
  async changeStatus(
    practiceId: string,
    slot: Slot,
    to: SlotStatus,
    inquiryId?: string,
  ): Promise<boolean> {
    const index = freeSlotIndexKey(practiceId, slot);
    const update =
      to === 'free'
        ? {
            UpdateExpression:
              'SET #data.#status = :to, GSI1PK = :indexPk, GSI1SK = :indexSk REMOVE #data.inquiryId',
            ExpressionAttributeValues: {
              ':to': to,
              ':from': slot.status,
              ':indexPk': index.GSI1PK,
              ':indexSk': index.GSI1SK,
            },
          }
        : {
            UpdateExpression: inquiryId
              ? 'SET #data.#status = :to, #data.inquiryId = :inquiryId REMOVE GSI1PK, GSI1SK'
              : 'SET #data.#status = :to REMOVE GSI1PK, GSI1SK',
            ExpressionAttributeValues: {
              ':to': to,
              ':from': slot.status,
              ...(inquiryId ? { ':inquiryId': inquiryId } : {}),
            },
          };
    return conditionHeld(() =>
      this.doc.send(
        new UpdateCommand({
          TableName: this.tableName,
          Key: slotKey(practiceId, slot),
          ConditionExpression: '#data.#status = :from',
          ExpressionAttributeNames: NAMES,
          ...update,
        }),
      ),
    );
  }

  private async putEach(
    practiceId: string,
    slots: Slot[],
    condition: string,
    expression?: { names: Record<string, string>; values: Record<string, unknown> },
  ): Promise<number> {
    let written = 0;
    await inParallel(slots, async (slot) => {
      const held = await conditionHeld(() =>
        this.doc.send(
          new PutCommand({
            TableName: this.tableName,
            Item: this.itemFor(practiceId, slot),
            ConditionExpression: condition,
            ExpressionAttributeNames: expression?.names,
            ExpressionAttributeValues: expression?.values,
          }),
        ),
      );
      if (held) {
        written += 1;
      }
    });
    return written;
  }

  private itemFor(practiceId: string, slot: Slot) {
    const expiry = new Date(`${addDays(slot.date, KEEP_DAYS)}T00:00:00Z`);
    return {
      ...slotKey(practiceId, slot),
      ...(slot.status === 'free' ? freeSlotIndexKey(practiceId, slot) : {}),
      data: slot,
      expiresAt: Math.floor(expiry.getTime() / 1000),
    };
  }
}
