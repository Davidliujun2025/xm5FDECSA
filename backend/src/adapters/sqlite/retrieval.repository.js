import { AppError } from '../../domain/errors.js';

function mapPublishedRow(row) {
  return {
    id: row.id,
    documentId: row.document_id,
    fileName: row.file_name,
    text: row.text,
    location: JSON.parse(row.location),
    embedding: row.embedding,
    embeddingDim: row.embedding_dim,
    embeddingModel: row.embedding_model,
    embeddingSpace: row.embedding_space
  };
}

export class RetrievalRepository {
  constructor(database) {
    this.database = database;
    this.statements = {
      topic: database.prepare('SELECT id, status, updated_at FROM topic WHERE id = ?'),
      version: database.prepare(`
        SELECT COUNT(c.id) AS chunk_count, COALESCE(MAX(d.updated_at), '') AS document_version,
               COALESCE(MAX(c.created_at), '') AS chunk_version
        FROM document d
        LEFT JOIN chunk c ON c.document_id = d.id AND c.embedding_model = ?
        WHERE d.topic_id = ? AND d.status = 'PUBLISHED'
      `),
      published: database.prepare(`
        SELECT c.*, d.file_name
        FROM chunk c
        JOIN document d ON d.id = c.document_id AND d.topic_id = c.topic_id
        JOIN topic t ON t.id = c.topic_id
        WHERE c.topic_id = ? AND c.embedding_model = ? AND c.embedding_space = 'cosine'
          AND d.status = 'PUBLISHED' AND t.status = 'ACTIVE'
        ORDER BY c.id ASC
      `)
    };
  }

  assertActiveTopic(topicId) {
    const topic = this.statements.topic.get(topicId);
    if (!topic) {
      throw new AppError({ statusCode: 404, errorCode: 'RAG_TOPIC_NOT_FOUND', message: 'Topic 不存在' });
    }
    if (topic.status === 'DISABLED') {
      throw new AppError({ statusCode: 409, errorCode: 'RAG_TOPIC_DISABLED', message: 'Topic 已停用' });
    }
    if (topic.status !== 'ACTIVE') {
      throw new AppError({ statusCode: 409, errorCode: 'RAG_TOPIC_NOT_ACTIVE', message: 'Topic 尚未启用' });
    }
    return topic;
  }

  publishedSet(topicId, model) {
    const topic = this.assertActiveTopic(topicId);
    const version = this.statements.version.get(model, topicId);
    return {
      version: `${topic.updated_at}:${version.document_version}:${version.chunk_version}:${version.chunk_count}:${model}`,
      chunkCount: version.chunk_count
    };
  }

  loadPublished(topicId, model) {
    this.assertActiveTopic(topicId);
    return this.statements.published.all(topicId, model).map(mapPublishedRow);
  }

  revalidate(topicId, model, ids) {
    this.assertActiveTopic(topicId);
    if (!Array.isArray(ids) || ids.length === 0) {
      return [];
    }
    const placeholders = ids.map(() => '?').join(', ');
    const statement = this.database.prepare(`
      SELECT c.*, d.file_name
      FROM chunk c
      JOIN document d ON d.id = c.document_id AND d.topic_id = c.topic_id
      JOIN topic t ON t.id = c.topic_id
      WHERE c.topic_id = ? AND c.embedding_model = ? AND c.embedding_space = 'cosine'
        AND d.status = 'PUBLISHED' AND t.status = 'ACTIVE' AND c.id IN (${placeholders})
    `);
    return statement.all(topicId, model, ...ids).map(mapPublishedRow);
  }
}
