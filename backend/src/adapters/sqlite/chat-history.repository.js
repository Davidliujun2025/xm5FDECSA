import { randomUUID } from 'node:crypto';

import { AppError } from '../../domain/errors.js';

function id(prefix) {
  return `${prefix}_${randomUUID().replaceAll('-', '')}`;
}

function mapMessage(row) {
  return {
    id: row.id,
    role: row.role,
    content: row.content,
    intent: row.intent,
    branch: row.branch,
    metadata: row.metadata ? JSON.parse(row.metadata) : {},
    createdAt: row.created_at
  };
}

function mapDatabaseError(error) {
  if (error instanceof AppError) {
    return error;
  }
  return new AppError({
    statusCode: 503,
    errorCode: 'RAG_DATABASE_UNAVAILABLE',
    message: '会话历史数据库暂时不可用',
    cause: error
  });
}

export class ChatHistoryRepository {
  constructor(database) {
    this.database = database;
    this.statements = {
      expire: database.prepare(`
        UPDATE chat_session
        SET status = 'ENDED', ended_at = ?, last_active_at = ?
        WHERE user_ip = ? AND topic_id = ? AND status = 'ACTIVE' AND last_active_at < ?
      `),
      requested: database.prepare(`
        SELECT id, created_at, last_active_at
        FROM chat_session
        WHERE id = ? AND user_ip = ? AND topic_id = ? AND status = 'ACTIVE'
      `),
      active: database.prepare(`
        SELECT id, created_at, last_active_at
        FROM chat_session
        WHERE user_ip = ? AND topic_id = ? AND status = 'ACTIVE'
        ORDER BY last_active_at DESC
        LIMIT 1
      `),
      insertSession: database.prepare(`
        INSERT INTO chat_session(id, user_ip, topic_id, status, created_at, last_active_at)
        VALUES (?, ?, ?, 'ACTIVE', ?, ?)
      `),
      touch: database.prepare(`
        UPDATE chat_session SET last_active_at = ? WHERE id = ? AND status = 'ACTIVE'
      `),
      recentMessages: database.prepare(`
        SELECT id, role, content, intent, branch, metadata, created_at
        FROM chat_message
        WHERE session_id = ?
        ORDER BY sequence DESC
        LIMIT ?
      `),
      nextSequence: database.prepare(`
        SELECT COALESCE(MAX(sequence), 0) + 1 AS value FROM chat_message WHERE session_id = ?
      `),
      insertMessage: database.prepare(`
        INSERT INTO chat_message(id, session_id, sequence, role, content, intent, branch, metadata, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      `)
    };
  }

  beginTurn({ userIp, topicId, requestedSessionId, question, now, cutoff, historyMessageLimit }) {
    this.database.exec('BEGIN IMMEDIATE');
    try {
      this.statements.expire.run(now, now, userIp, topicId, cutoff);
      let session = requestedSessionId
        ? this.statements.requested.get(requestedSessionId, userIp, topicId)
        : null;
      session ??= this.statements.active.get(userIp, topicId);
      if (!session) {
        const sessionId = id('session');
        this.statements.insertSession.run(sessionId, userIp, topicId, now, now);
        session = { id: sessionId, created_at: now, last_active_at: now };
      }

      const history = this.statements.recentMessages
        .all(session.id, historyMessageLimit)
        .reverse()
        .map(mapMessage);
      const sequence = this.statements.nextSequence.get(session.id).value;
      const messageId = id('message');
      this.statements.insertMessage.run(messageId, session.id, sequence, 'USER', question, null, null, '{}', now);
      this.statements.touch.run(now, session.id);
      this.database.exec('COMMIT');
      return { sessionId: session.id, userMessageId: messageId, history };
    } catch (error) {
      this.database.exec('ROLLBACK');
      throw mapDatabaseError(error);
    }
  }

  completeTurn({ sessionId, answer, intent, branch, metadata, now }) {
    this.database.exec('BEGIN IMMEDIATE');
    try {
      const sequence = this.statements.nextSequence.get(sessionId).value;
      this.statements.insertMessage.run(
        id('message'),
        sessionId,
        sequence,
        'ASSISTANT',
        answer,
        intent,
        branch,
        JSON.stringify(metadata ?? {}),
        now
      );
      this.statements.touch.run(now, sessionId);
      this.database.exec('COMMIT');
    } catch (error) {
      this.database.exec('ROLLBACK');
      throw mapDatabaseError(error);
    }
  }

  listMessagesForIp(userIp, sessionId) {
    const owned = this.database.prepare('SELECT id FROM chat_session WHERE id = ? AND user_ip = ?').get(sessionId, userIp);
    if (!owned) {
      return [];
    }
    return this.database.prepare(`
      SELECT id, role, content, intent, branch, metadata, created_at
      FROM chat_message WHERE session_id = ? ORDER BY sequence ASC
    `).all(sessionId).map(mapMessage);
  }
}
