import { afterEach, beforeEach, describe, expect, test } from 'vitest';
import { migrate } from '@/services/database/migrate';
import { getMigrations } from '@/services/database/migrations';
import { NodeDatabaseService } from '@/services/database/nodeDatabaseService';
import type { DatabaseService } from '@/types/database';

/**
 * The Notion integration is gone, but its migration stays in the registry: the
 * schema history has to remain applyable (or at least identical) for databases
 * that were created while it existed, and removing a step would make old and new
 * installs diverge. Nothing reads these tables any more, so all this test still
 * owes is "the step exists and applies idempotently".
 */
describe('Notion sync migration', () => {
  let database: DatabaseService;

  beforeEach(async () => {
    database = await NodeDatabaseService.open(':memory:');
  });

  afterEach(async () => {
    await database.close();
  });

  test('creates both mapping tables and applies idempotently', async () => {
    const migrations = getMigrations('notion-sync');
    expect(migrations).toHaveLength(1);

    await migrate(database, migrations);
    await migrate(database, migrations);

    const tables = await database.select<{ name: string }>(
      "SELECT name FROM sqlite_master WHERE type = 'table' AND name LIKE 'notion_%'",
    );
    expect(tables.map(({ name }) => name).sort()).toEqual([
      'notion_book_pages',
      'notion_note_mappings',
    ]);
    const version = await database.select<{ user_version: number }>('PRAGMA user_version');
    expect(version[0]!.user_version).toBe(migrations.length);
  });
});
