import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { DatabaseSync } from 'node:sqlite';

import {
  loadConfirmedQuestionSet,
  recordAcceptanceResults
} from '../backend/src/acceptance/acceptance-results.js';
import { REAL_ACCEPTANCE_EVIDENCE_FILE } from '../backend/src/acceptance/real-acceptance.js';

function argValue(argv, name) {
  const index = argv.indexOf(name);
  if (index === -1) {
    return undefined;
  }
  const value = argv[index + 1];
  if (!value || value.startsWith('--')) {
    throw new Error(`RAG_ACCEPTANCE_RESULT_USAGE: ${name} 需要跟一个参数`);
  }
  return value;
}

function resultSummary(verdicts) {
  const lines = ['真实模型验收结果记录完成'];
  for (const item of verdicts.items) {
    lines.push(`${item.ok ? 'PASS' : 'FAIL'} ${item.id} ${item.type} ${item.status}`);
  }
  lines.push(`总判定: ${verdicts.passed ? 'ACCEPTANCE_PASSED' : 'ACCEPTANCE_FAILED'}`);
  return lines.join('\n');
}

async function runFromCommandLine() {
  const argv = process.argv.slice(2);
  const dataDir = argValue(argv, '--data-dir');
  const resultsPath = argValue(argv, '--results');
  if (!dataDir || !resultsPath) {
    throw new Error('RAG_ACCEPTANCE_RESULT_USAGE: 需要 --data-dir 与 --results 两个参数');
  }
  const resolvedDataDir = path.resolve(dataDir);
  const evidencePath = path.join(resolvedDataDir, REAL_ACCEPTANCE_EVIDENCE_FILE);
  let existingEvidence;
  try {
    existingEvidence = JSON.parse(readFileSync(evidencePath, 'utf8'));
  } catch {
    throw new Error('RAG_ACCEPTANCE_RESULT_INVALID: 未找到环境证据文件，请先运行 start-real-acceptance.js 准备环境');
  }
  const results = JSON.parse(readFileSync(path.resolve(resultsPath), 'utf8'));
  const topicId = results.topicId ?? argValue(argv, '--topic-id');
  const database = new DatabaseSync(path.join(resolvedDataDir, 'knowledge.db'), { readOnly: true });
  try {
    const verdicts = await recordAcceptanceResults({
      questionSet: loadConfirmedQuestionSet(),
      results,
      database,
      topicId,
      embeddingModel: existingEvidence.embeddingModel,
      existingEvidence,
      evidencePath,
      conclusion: results.conclusion ?? null
    });
    process.stdout.write(`${resultSummary(verdicts)}\n`);
    if (!verdicts.passed) {
      process.exitCode = 1;
    }
  } finally {
    database.close();
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  runFromCommandLine().catch((error) => {
    const safe = error?.errorCode
      ? `${error.errorCode}: ${error.message}`
      : (error?.message || 'RAG_ACCEPTANCE_RESULT_FAILED: 验收结果记录失败');
    process.stderr.write(`${safe}\n`);
    process.exitCode = 1;
  });
}
