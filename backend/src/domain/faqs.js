import { createHash } from 'node:crypto';

const QUESTION_PATTERN = /^\s*\*\*Q(\d+)[：:]\s*(.+?)\*\*\s*$/u;
const ANSWER_PATTERN = /^\s*\*\*A(\d+)[：:]\*\*\s*(.*)$/u;
const SECTION_PATTERN = /^\s*#{2,}\s+/u;
const QUERY_REPLACEMENTS = Object.freeze([
  [/PMI[\s-]*ACP/giu, 'ACP'],
  [/(?:多少钱|价格|收费|学费)/gu, '费用'],
  [/(?:报名|申请)/gu, '报考'],
  [/(?:资格|要求)/gu, '条件'],
  [/(?:维持|维护)证书/gu, '续证'],
  [/(?:前线部署工程师|Forward\s+Deployed\s+Engineer)/giu, 'FDE']
]);
const QUERY_FILLER_PATTERN = /(?:请问|麻烦|我想知道|我想了解|告诉我|帮我|可以|一下|具体|到底|相关|关于|什么是|是什么|有哪些|有哪一些|如何|怎样|怎么|多少|为何|为什么|是否|的|呢|吗|啊|呀|请)/gu;

export function normalizeFaqText(value) {
  let normalized = String(value ?? '').normalize('NFKC').toLocaleLowerCase('zh-CN');
  for (const [pattern, replacement] of QUERY_REPLACEMENTS) {
    normalized = normalized.replace(pattern, replacement.toLocaleLowerCase('zh-CN'));
  }
  return normalized
    .replace(QUERY_FILLER_PATTERN, '')
    .replace(/[^\p{L}\p{N}]+/gu, '');
}

function faqId(domain, ordinal, question) {
  const digest = createHash('sha256').update(`${domain}\0${ordinal}\0${question}`).digest('hex').slice(0, 32);
  return `faq_${digest}`;
}

function trimBlankEdges(lines) {
  let start = 0;
  let end = lines.length;
  while (start < end && !lines[start].trim()) start += 1;
  while (end > start && !lines[end - 1].trim()) end -= 1;
  return lines.slice(start, end);
}

export function parseFaqMarkdown({ content, domain, sourceFile }) {
  const normalizedContent = String(content).replaceAll('\r\n', '\n');
  const keywordSection = /##\s*主题关键字\s*\n([^#]+?)(?=\n##|$)/u.exec(normalizedContent)?.[1] ?? '';
  const keywords = [...keywordSection.matchAll(/`([^`]+)`/gu)].map((match) => match[1].trim()).filter(Boolean);
  const entries = [];
  let current = null;

  const flush = () => {
    if (!current) return;
    const answer = trimBlankEdges(current.answerLines).join('\n').trim();
    if (!current.answerStarted || !answer) {
      throw new Error(`${sourceFile}: Q${current.ordinal} 缺少有效答案`);
    }
    entries.push(Object.freeze({
      id: faqId(domain, current.ordinal, current.question),
      domain,
      ordinal: current.ordinal,
      question: current.question,
      normalizedQuestion: normalizeFaqText(current.question),
      answer,
      keywords: Object.freeze([...keywords]),
      sourceFile
    }));
    current = null;
  };

  for (const line of normalizedContent.split('\n')) {
    const questionMatch = QUESTION_PATTERN.exec(line);
    if (questionMatch) {
      flush();
      current = {
        ordinal: Number(questionMatch[1]),
        question: questionMatch[2].trim(),
        answerStarted: false,
        answerLines: []
      };
      continue;
    }
    if (!current) continue;
    const answerMatch = ANSWER_PATTERN.exec(line);
    if (answerMatch && Number(answerMatch[1]) === current.ordinal) {
      current.answerStarted = true;
      if (answerMatch[2]) current.answerLines.push(answerMatch[2]);
      continue;
    }
    if (current.answerStarted && SECTION_PATTERN.test(line)) {
      flush();
      continue;
    }
    if (current.answerStarted) current.answerLines.push(line);
  }
  flush();

  const ordinals = new Set();
  for (const entry of entries) {
    if (!entry.normalizedQuestion || ordinals.has(entry.ordinal)) {
      throw new Error(`${sourceFile}: FAQ 编号或问题非法`);
    }
    ordinals.add(entry.ordinal);
  }
  return Object.freeze(entries);
}

function ngrams(value, size = 2) {
  if (!value) return new Set();
  if (value.length <= size) return new Set([value]);
  const values = new Set();
  for (let index = 0; index <= value.length - size; index += 1) {
    values.add(value.slice(index, index + size));
  }
  return values;
}

function characterOverlap(query, candidate) {
  const counts = new Map();
  for (const character of candidate) {
    counts.set(character, (counts.get(character) ?? 0) + 1);
  }
  let shared = 0;
  for (const character of query) {
    const available = counts.get(character) ?? 0;
    if (available > 0) {
      shared += 1;
      counts.set(character, available - 1);
    }
  }
  return {
    shared,
    queryCoverage: shared / query.length,
    dice: (2 * shared) / (query.length + candidate.length)
  };
}

export function faqSimilarity(rawQuery, normalizedQuestion) {
  const query = normalizeFaqText(rawQuery);
  const candidate = normalizeFaqText(normalizedQuestion);
  if (!query || !candidate) return 0;
  if (query === candidate) return 1;
  if (query.length >= 2 && candidate.includes(query)) {
    const ratio = Math.min(query.length, candidate.length) / Math.max(query.length, candidate.length);
    return Math.min(0.98, 0.78 + (0.2 * ratio));
  }
  const queryParts = ngrams(query);
  const candidateParts = ngrams(candidate);
  let shared = 0;
  for (const part of queryParts) {
    if (candidateParts.has(part)) shared += 1;
  }
  const orderedScore = shared === 0
    ? 0
    : Math.min(1, (0.6 * ((2 * shared) / (queryParts.size + candidateParts.size)))
      + (0.4 * (shared / queryParts.size)));
  const characters = characterOverlap(query, candidate);
  const reorderedScore = query.length >= 4
    && characters.shared >= 4
    && characters.queryCoverage >= 0.8
    && (Math.min(query.length, candidate.length) / Math.max(query.length, candidate.length)) >= 0.65
    ? Math.min(0.96, 0.55 + (0.4 * ((0.7 * characters.queryCoverage) + (0.3 * characters.dice))))
    : 0;
  return Math.max(orderedScore, reorderedScore);
}

const DOMAIN_ALIASES = Object.freeze({
  PMP: ['pmp', 'pmbok', 'pdu', '项目管理', '项目经理认证'],
  ACP: ['acp', '敏捷', 'scrum', 'kanban', '看板', '敏捷教练'],
  PBA: ['pba', '商业分析', '需求分析', '需求管理', 'cbap'],
  FDE: ['fde', '前沿部署', '前线部署', 'ai落地', 'ai部署', '大模型工程化', 'palantir', '腾讯云adp']
});

export function detectFaqDomains(value, entries) {
  const text = String(value ?? '').normalize('NFKC').toLocaleLowerCase('zh-CN');
  const detected = new Set();
  for (const [domain, aliases] of Object.entries(DOMAIN_ALIASES)) {
    if (aliases.some((alias) => text.includes(alias))) detected.add(domain);
  }
  for (const entry of entries) {
    if (entry.keywords.some((keyword) => keyword.length >= 3 && text.includes(keyword.toLocaleLowerCase('zh-CN')))) {
      detected.add(entry.domain);
    }
  }
  return detected;
}

export function rankFaqEntries({ question, contextualQuestion, entries }) {
  const domains = detectFaqDomains(contextualQuestion || question, entries);
  const pool = domains.size > 0 ? entries.filter((entry) => domains.has(entry.domain)) : entries;
  const ranked = pool
    .map((entry) => ({ entry, score: faqSimilarity(question, entry.normalizedQuestion) }))
    .sort((left, right) => (right.score - left.score)
      || left.entry.domain.localeCompare(right.entry.domain)
      || left.entry.ordinal - right.entry.ordinal);
  return Object.freeze({ ranked: Object.freeze(ranked), detectedDomains: domains });
}
