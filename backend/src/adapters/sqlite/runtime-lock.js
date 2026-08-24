import { closeSync, mkdirSync, openSync, readFileSync, unlinkSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';

import { AppError } from '../../domain/errors.js';

export function ensureDataDirectories(dataDir) {
  mkdirSync(dataDir, { recursive: true });
  for (const directory of ['original', 'temp', 'logs', 'backups']) {
    mkdirSync(path.join(dataDir, directory), { recursive: true });
  }
}

function processIsActive(pid) {
  if (!Number.isSafeInteger(pid) || pid <= 0) {
    return false;
  }
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return error.code === 'EPERM';
  }
}

function readLock(lockPath) {
  try {
    return JSON.parse(readFileSync(lockPath, 'utf8'));
  } catch {
    return null;
  }
}

export function acquireRuntimeLock(dataDir) {
  const lockPath = path.join(dataDir, 'runtime.lock');
  const token = randomUUID();
  let descriptor;

  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      descriptor = openSync(lockPath, 'wx', 0o600);
      break;
    } catch (error) {
      if (error.code !== 'EEXIST') {
        throw new AppError({
          statusCode: 500,
          errorCode: 'RAG_DATA_DIR_UNAVAILABLE',
          message: '数据目录不可用',
          cause: error
        });
      }
      const current = readLock(lockPath);
      if (current && processIsActive(current.pid)) {
        throw new AppError({
          statusCode: 409,
          errorCode: 'RAG_INSTANCE_ALREADY_RUNNING',
          message: '数据目录已由另一个服务实例使用'
        });
      }
      try {
        unlinkSync(lockPath);
      } catch (unlinkError) {
        if (unlinkError.code !== 'ENOENT') {
          throw new AppError({
            statusCode: 409,
            errorCode: 'RAG_INSTANCE_ALREADY_RUNNING',
            message: '无法确认数据目录的实例锁状态'
          });
        }
      }
    }
  }

  if (descriptor === undefined) {
    throw new AppError({
      statusCode: 409,
      errorCode: 'RAG_INSTANCE_ALREADY_RUNNING',
      message: '数据目录已由另一个服务实例使用'
    });
  }

  writeFileSync(descriptor, JSON.stringify({ pid: process.pid, token, createdAt: new Date().toISOString() }), 'utf8');
  closeSync(descriptor);
  let released = false;

  return {
    release() {
      if (released) {
        return;
      }
      const current = readLock(lockPath);
      if (current?.token === token) {
        try {
          unlinkSync(lockPath);
        } catch (error) {
          if (error.code !== 'ENOENT') {
            throw error;
          }
        }
      }
      released = true;
    }
  };
}
