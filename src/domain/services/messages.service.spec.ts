import { createTestingModule, randomCode } from '../../../test/test.helper';
import sql from '../../db';
import { DomainModule } from '../domain.module';
import { ImportService } from './import.service';
import { MessagesService } from './messages.service';

describe('messageTime', () => {
  it('should return a date from a message id', () => {
    const time = Date.now() - 1000;
    const date = MessagesService.messageTime({ id: `${time}-0` });
    expect(date.getTime()).toBe(time);
  });
  it('should return the current date for an invalid message id', () => {
    const now = Date.now();
    const date = MessagesService.messageTime({ id: 'invalid' });
    expect(date.getTime()).toBeGreaterThanOrEqual(now);
  });
  it('should cope with a null id', async () => {
    const now = Date.now();
    const date = MessagesService.messageTime({ id: null });
    expect(date.getTime()).toBeGreaterThanOrEqual(now);
  });
  it('should cope with no id', async () => {
    const now = Date.now();
    const date = MessagesService.messageTime({});
    expect(date.getTime()).toBeGreaterThanOrEqual(now);
  });
  it('should use timestamp if provided', async () => {
    const time = Math.trunc((Date.now() - 1000) / 1000);
    const date = MessagesService.messageTime({
      id: '100-0',
      message: { timestamp: time },
    });
    expect(date.getTime()).toBe(time * 1000);
  });
});

let idCount = 0;

describe('create', () => {
  it('should load duplicate events', async () => {
    await createTestingModule([DomainModule], async (app) => {
      const messages = app.get(MessagesService);
      const code1 = randomCode();
      const messageId = `${Date.now()}-${idCount++}`;

      await messages.create(
        [
          {
            id: messageId,
            message: {
              code: code1,
              action: 'created',
            },
          },
          {
            id: messageId,
            message: {
              code: code1,
              action: 'created',
            },
          },
        ],
        true,
      );

      const result =
        await sql`SELECT * FROM product_update_event WHERE message->>'code' = ${code1}`;
      expect(result).toHaveLength(2);
    });
  });

  it('should cope with null characters', async () => {
    await createTestingModule([DomainModule], async (app) => {
      const messages = app.get(MessagesService);
      const code1 = randomCode();
      await messages.create(
        [
          {
            id: `${Date.now()}-${idCount++}`,
            message: {
              code: code1,
              comment: 'test \u0000 test2 \u0000 end',
            },
          },
        ],
        true,
      );

      const result =
        await sql`SELECT * FROM product_update_event WHERE message->>'code' = ${code1}`;
      expect(result).toHaveLength(1);
      expect(result[0].message.comment).toBe('test  test2  end');
    });
  });

  it('should create contributors', async () => {
    await createTestingModule([DomainModule], async (app) => {
      const messages = app.get(MessagesService);
      const code1 = randomCode();
      const user1 = randomCode();
      const user2 = randomCode();

      // Given and existing contributor record
      sql`INSERT INTO contributor (code) VALUES(${user1})`;

      // When events are imported
      await messages.create(
        [
          {
            id: `${Date.now()}-${idCount++}`,
            message: {
              code: code1,
              user_id: user1,
              action: 'created',
            },
          },
          {
            id: `${Date.now()}-${idCount++}`,
            message: {
              code: code1,
              user_id: user2,
              action: 'created',
            },
          },
        ],
        true,
      );

      const result = await sql`SELECT * FROM contributor WHERE code in ${sql([
        user1,
        user2,
      ])} order by id`;
      expect(result).toHaveLength(2);
      expect(result[1].id).toBe(result[0].id + 1);
    });
  });

  it('should aggregate events by count and distinct products', async () => {
    await createTestingModule([DomainModule], async (app) => {
      const messages = app.get(MessagesService);
      // Create some products
      const code1 = randomCode();
      const code2 = randomCode();
      const owner1 = randomCode();

      await sql`INSERT INTO product ${sql([
        {
          code: code1,
          owners_tags: owner1,
        },
        {
          code: code2,
          owners_tags: owner1,
        },
      ])}`;

      // Create some messages
      let idCount = 0;
      const nextId = () => `${Date.now()}-${idCount++}`;
      await messages.create(
        [
          {
            id: nextId(),
            message: {
              code: code1,
              action: 'created',
              user_id: 'test',
              rev: 1,
            },
          },
          {
            id: nextId(),
            message: {
              code: code1,
              action: 'created',
              user_id: 'test',
              rev: 2,
            },
          },
          {
            id: nextId(),
            message: {
              code: code1,
              action: 'created',
              user_id: 'test',
              rev: 2, // Duplicate
            },
          },
          {
            id: nextId(),
            message: {
              code: code2,
              action: 'created',
              user_id: 'test',
              rev: 1,
            },
          },
        ],
        true,
      );

      const results =
        await sql`SELECT * from product_update join product on product.id = product_update.product_id`;

      const myResult1 = results.filter(
        (r) => r.owners_tags === owner1 && r.code === code1,
      );
      expect(myResult1).toHaveLength(2);

      const myResult2 = results.filter(
        (r) => r.owners_tags === owner1 && r.code === code2,
      );
      expect(myResult2).toHaveLength(1);
    });
  });

  it('should update existing aggregate counts', async () => {
    await createTestingModule([DomainModule], async (app) => {
      const messages = app.get(MessagesService);
      // Create a product
      const code1 = randomCode();
      await sql`INSERT INTO product ${sql([
        {
          code: code1,
        },
      ])}`;
      const action1 = randomCode();

      // Create an existing message
      let idCount = 0;
      const nextId = () => `${Date.now()}-${idCount++}`;
      await messages.create(
        [
          {
            id: nextId(),
            message: {
              code: code1,
              action: action1,
              user_id: 'test',
              rev: 1,
            },
          },
        ],
        true,
      );

      // Add another message
      await messages.create(
        [
          {
            id: nextId(),
            message: {
              code: code1,
              action: action1,
              user_id: 'test',
              rev: 2,
            },
          },
        ],
        true,
      );

      const results =
        await sql`SELECT * from product_update join product on product.id = product_update.product_id`;

      const myResult1 = results.filter((r) => r.code === code1);
      expect(myResult1).toHaveLength(2);
    });
  });

  it('should not call importWithFilter for initialImport', async () => {
    await createTestingModule([DomainModule], async (app) => {
      const importService = app.get(ImportService);
      const importSpy = jest
        .spyOn(importService, 'importWithFilter')
        .mockImplementation();

      const code1 = randomCode();
      const code2 = randomCode();
      let idCount = 0;
      const nextId = () => `${Date.now()}-${idCount++}`;
      const messages = [
        {
          id: nextId(),
          message: {
            code: code1,
          },
        },
        {
          id: nextId(),
          message: {
            code: code2,
          },
        },
      ];

      const messagesService = app.get(MessagesService);
      await messagesService.create(messages, true);

      // Then the import is not called
      expect(importSpy).not.toHaveBeenCalled();

      // Update events are created for all codes
      const events =
        await sql`SELECT * FROM product_update_event WHERE message->>'code' IN ${sql(
          [code1, code2],
        )}`;

      expect(events).toHaveLength(2);
    });
  });

  it('should not include non-food products in call to importWithFilter', async () => {
    await createTestingModule([DomainModule], async (app) => {
      const importService = app.get(ImportService);
      const importSpy = jest
        .spyOn(importService, 'importWithFilter')
        .mockImplementation();

      const code1 = randomCode();
      const code2 = randomCode();
      let idCount = 0;
      const nextId = () => `${Date.now()}-${idCount++}`;
      const messages = [
        {
          id: nextId(),
          message: {
            code: code1,
            product_type: 'food',
          },
        },
        {
          id: nextId(),
          message: {
            code: code2,
            product_type: 'beauty',
          },
        },
      ];

      const messagesService = app.get(MessagesService);
      await messagesService.create(messages);

      // Then the import is called
      expect(importSpy).toHaveBeenCalledTimes(1);

      // Update events are created for all codes
      const events =
        await sql`SELECT * FROM product_update_event WHERE message->>'code' IN ${sql(
          [code1, code2],
        )}`;

      expect(events).toHaveLength(2);

      // Import with filter only called for the food product
      const importWithFilterIn = importSpy.mock.calls[0][0].code.$in;
      expect(importWithFilterIn).toHaveLength(1);
      expect(importWithFilterIn[0]).toBe(code1);
    });
  });

  it('should not call importWithFilter for updates to only non-food products', async () => {
    await createTestingModule([DomainModule], async (app) => {
      const importService = app.get(ImportService);
      const importSpy = jest
        .spyOn(importService, 'importWithFilter')
        .mockImplementation();

      const code1 = randomCode();
      let idCount = 0;
      const nextId = () => `${Date.now()}-${idCount++}`;
      const messages = [
        {
          id: nextId(),
          message: {
            code: code1,
            product_type: 'beauty',
          },
        },
      ];

      const messagesService = app.get(MessagesService);
      await messagesService.create(messages);

      // Then the import is not called
      expect(importSpy).toHaveBeenCalledTimes(0);
    });
  });

  it('should call importWithFilter for normal imports', async () => {
    await createTestingModule([DomainModule], async (app) => {
      const importService = app.get(ImportService);
      const importSpy = jest
        .spyOn(importService, 'importWithFilter')
        .mockImplementation();

      const code1 = randomCode();
      const code2 = randomCode();
      let idCount = 0;
      const nextId = () => `${Date.now()}-${idCount++}`;
      const messages = [
        {
          id: nextId(),
          message: {
            code: code1,
            product_type: 'food',
          },
        },
        {
          id: nextId(),
          message: {
            code: code2,
            product_type: 'food',
          },
        },
      ];

      const messagesService = app.get(MessagesService);
      await messagesService.create(messages);

      // Then the import is called
      expect(importSpy).toHaveBeenCalled();

      // Update events are created for all codes
      const events =
        await sql`SELECT * FROM product_update_event WHERE message->>'code' IN ${sql(
          [code1, code2],
        )}`;

      expect(events).toHaveLength(2);
    });
  });

  // This is just needed for backward compatibility with PO versions that don't send rev in the event
  it('should get revision from product if not in message', async () => {
    await createTestingModule([DomainModule], async (app) => {
      const messages = app.get(MessagesService);
      // Create a product
      const code1 = randomCode();

      await sql`INSERT INTO product ${sql([
        {
          code: code1,
          revision: 123,
        },
      ])}`;

      // Create a message with no rev
      let idCount = 0;
      const nextId = () => `${Date.now()}-${idCount++}`;
      await messages.create(
        [
          {
            id: nextId(),
            message: {
              code: code1,
              action: 'created',
              user_id: 'test',
            },
          },
        ],
        true,
      );

      const results =
        await sql`SELECT product_update.revision from product_update join product on product.id = product_update.product_id where code = ${code1}`;

      expect(results).toHaveLength(1);
      expect(results[0].revision).toBe(123);
    });
  });
});
