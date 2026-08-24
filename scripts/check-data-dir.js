import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';

function fail(message) {
  process.stderr.write(`RAG_DATA_VALIDATION_FAILED: ${message}\n`);
  process.exit(1);
}

const dataDir = process.argv[2] ? path.resolve(process.argv[2]) : null;
if (!dataDir) fail('必须提供 DATA_DIR');
if (existsSync(path.join(dataDir, 'runtime.lock'))) fail('检测到 runtime.lock，请先停止服务并确认实例锁已释放');
const databasePath = path.join(dataDir, 'knowledge.db');
if (!existsSync(databasePath)) fail('knowledge.db 不存在');

let database;
try {
  database = new DatabaseSync(databasePath);
  database.exec('PRAGMA busy_timeout = 5000');
  database.exec('PRAGMA wal_checkpoint(TRUNCATE)');
  const quickCheck = database.prepare('PRAGMA quick_check').all();
  if (quickCheck.length !== 1 || quickCheck[0].quick_check !== 'ok') fail('SQLite quick_check 未通过');
  const foreignKeys = database.prepare('PRAGMA foreign_key_check').all();
  if (foreignKeys.length > 0) fail('SQLite foreign_key_check 未通过');
  const schemaVersions = database.prepare('SELECT version, checksum FROM schema_version ORDER BY version').all();
  process.stdout.write(`${JSON.stringify({ status: 'VALID', schemaVersions })}\n`);
} catch (error) {
  fail('SQLite 无法打开或校验');
} finally {
  database?.close();
}
