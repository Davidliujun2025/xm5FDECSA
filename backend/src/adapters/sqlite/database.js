import { createHash } from 'node:crypto';
import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';

import { AppError } from '../../domain/errors.js';

function checksum(content) {
  return createHash('sha256').update(content).digest('hex');
}

function applyMigrations(database, migrationsDir) {
  database.exec(`
    CREATE TABLE IF NOT EXISTS schema_version (
      version TEXT PRIMARY KEY,
      checksum TEXT NOT NULL,
      applied_at TEXT NOT NULL
    ) STRICT
  `);

  const migrations = readdirSync(migrationsDir)
    .filter((fileName) => /^\d+.*\.sql$/i.test(fileName))
    .sort((left, right) => left.localeCompare(right));
  const getVersion = database.prepare('SELECT checksum FROM schema_version WHERE version = ?');
  const recordVersion = database.prepare('INSERT INTO schema_version(version, checksum, applied_at) VALUES (?, ?, ?)');

  for (const fileName of migrations) {
    const sql = readFileSync(path.join(migrationsDir, fileName), 'utf8');
    const migrationChecksum = checksum(sql);
    const applied = getVersion.get(fileName);
    if (applied) {
      if (applied.checksum !== migrationChecksum) {
        throw new AppError({
          statusCode: 500,
          errorCode: 'RAG_SCHEMA_MISMATCH',
          message: '数据库 migration 校验失败',
          details: { version: fileName }
        });
      }
      continue;
    }

    database.exec('BEGIN IMMEDIATE');
    try {
      database.exec(sql);
      recordVersion.run(fileName, migrationChecksum, new Date().toISOString());
      database.exec('COMMIT');
    } catch (error) {
      database.exec('ROLLBACK');
      throw error;
    }
  }
}

export function openSqliteDatabase(config) {
  const databasePath = path.join(config.dataDir, 'knowledge.db');
  let database;
  try {
    database = new DatabaseSync(databasePath);
    database.exec('PRAGMA journal_mode = WAL');
    database.exec('PRAGMA foreign_keys = ON');
    database.exec('PRAGMA busy_timeout = 5000');
    applyMigrations(database, config.migrationsDir);
    return database;
  } catch (error) {
    database?.close();
    if (error instanceof AppError) {
      throw error;
    }
    throw new AppError({
      statusCode: 500,
      errorCode: 'RAG_DATABASE_UNAVAILABLE',
      message: 'SQLite 初始化失败',
      cause: error
    });
  }
}
