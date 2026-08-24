import { createHash, randomUUID } from 'node:crypto';
import { createReadStream, mkdirSync, renameSync, rmSync } from 'node:fs';
import { readFile, rm, stat } from 'node:fs/promises';
import path from 'node:path';
import multer from 'multer';

import { inspectUploadedFile } from '../domain/documents.js';
import { AppError } from '../domain/errors.js';

function ensureWithin(root, candidate, errorCode = 'RAG_FILE_STORAGE_ERROR') {
  const resolvedRoot = path.resolve(root);
  const resolvedCandidate = path.resolve(candidate);
  const relative = path.relative(resolvedRoot, resolvedCandidate);
  if (!relative || relative.startsWith('..') || path.isAbsolute(relative)) {
    throw new AppError({
      statusCode: 500,
      errorCode,
      message: '文件存储路径校验失败'
    });
  }
  return resolvedCandidate;
}

function normalizeMultipartFileName(originalName) {
  if (typeof originalName !== 'string'
    || !/[^\x00-\x7F]/.test(originalName)
    || [...originalName].some((character) => character.codePointAt(0) > 0xFF)) {
    return originalName;
  }

  const headerBytes = Buffer.from(originalName, 'latin1');
  const decoded = headerBytes.toString('utf8');
  if (decoded.includes('\uFFFD') || !Buffer.from(decoded, 'utf8').equals(headerBytes)) {
    return originalName;
  }
  return decoded;
}

export class LocalFileStore {
  constructor(config) {
    this.dataDir = config.dataDir;
    this.maxFileBytes = config.maxFileBytes;
    this.uploadTempDir = path.join(config.dataDir, 'temp', 'uploads');
    this.originalDir = path.join(config.dataDir, 'original');
    mkdirSync(this.uploadTempDir, { recursive: true });
    mkdirSync(this.originalDir, { recursive: true });
    const storage = multer.diskStorage({
      destination: (request, file, callback) => callback(null, this.uploadTempDir),
      filename: (request, file, callback) => callback(null, `${randomUUID()}.upload`)
    });
    this.upload = multer({
      storage,
      preservePath: true,
      limits: {
        fileSize: config.maxFileBytes,
        files: 1,
        fields: 5,
        parts: 6,
        fieldNameSize: 100,
        fieldSize: 4096
      }
    });
  }

  singleUploadMiddleware() {
    return this.upload.single('file');
  }

  async prepareUpload(file) {
    if (!file?.path) {
      throw new AppError({
        statusCode: 400,
        errorCode: 'RAG_INVALID_REQUEST',
        message: '必须上传一个 file 字段'
      });
    }
    const temporaryPath = ensureWithin(this.uploadTempDir, file.path);
    const fileStat = await stat(temporaryPath);
    const bytes = await readFile(temporaryPath);
    const inspected = inspectUploadedFile({
      // Multer/Busboy decodes an unqualified multipart filename as latin1.
      // Browsers send UTF-8 bytes here, so recover them only when that
      // conversion is lossless; already-decoded Unicode and true latin1 stay intact.
      originalName: normalizeMultipartFileName(file.originalname),
      mime: file.mimetype,
      size: fileStat.size,
      bytes,
      maxFileBytes: this.maxFileBytes
    });
    return Object.freeze({
      ...inspected,
      sha256: createHash('sha256').update(bytes).digest('hex'),
      temporaryPath
    });
  }

  commitPrepared(prepared, relativeFilePath) {
    const finalPath = ensureWithin(this.dataDir, path.join(this.dataDir, ...relativeFilePath.split('/')));
    const finalDirectory = path.dirname(finalPath);
    mkdirSync(finalDirectory, { recursive: true });
    try {
      renameSync(prepared.temporaryPath, finalPath);
    } catch (error) {
      rmSync(finalDirectory, { recursive: true, force: true });
      throw error;
    }
    return relativeFilePath;
  }

  async cleanupTemporary(filePath) {
    if (!filePath) {
      return;
    }
    let safePath;
    try {
      safePath = ensureWithin(this.uploadTempDir, filePath);
    } catch {
      return;
    }
    await rm(safePath, { force: true });
  }

  removeCommitted(relativeFilePath) {
    if (!relativeFilePath) {
      return;
    }
    const finalPath = ensureWithin(this.originalDir, path.join(this.dataDir, ...relativeFilePath.split('/')));
    const documentDirectory = path.dirname(finalPath);
    rmSync(finalPath, { force: true });
    rmSync(documentDirectory, { recursive: true, force: true });
  }

  async openReadStream(relativeFilePath) {
    const finalPath = ensureWithin(this.originalDir, path.join(this.dataDir, ...relativeFilePath.split('/')));
    let fileStat;
    try {
      fileStat = await stat(finalPath);
    } catch {
      throw new AppError({
        statusCode: 404,
        errorCode: 'RAG_DOCUMENT_NOT_FOUND',
        message: '文档原文件不存在'
      });
    }
    if (!fileStat.isFile()) {
      throw new AppError({
        statusCode: 404,
        errorCode: 'RAG_DOCUMENT_NOT_FOUND',
        message: '文档原文件不存在'
      });
    }
    return { stream: createReadStream(finalPath), size: fileStat.size };
  }

  async readOriginalFile(relativeFilePath) {
    const finalPath = ensureWithin(this.originalDir, path.join(this.dataDir, ...relativeFilePath.split('/')));
    try {
      const fileStat = await stat(finalPath);
      if (!fileStat.isFile() || fileStat.size <= 0 || fileStat.size > this.maxFileBytes) {
        throw new Error('invalid original file size');
      }
      return await readFile(finalPath);
    } catch (error) {
      if (error instanceof AppError) {
        throw error;
      }
      throw new AppError({
        statusCode: 500,
        errorCode: 'RAG_FILE_STORAGE_ERROR',
        message: '后台任务无法安全读取原文件'
      });
    }
  }
}
