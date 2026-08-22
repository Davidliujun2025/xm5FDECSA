import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const DEFAULT_REPOSITORY_ROOT = path.resolve(import.meta.dirname, '..');
const FORBIDDEN_RUNTIME_PATH = /(^|\/)(?:node_modules|dist|coverage|artifacts|data|logs?|npm-cache)(?:\/|$)|\.(?:db|db-wal|db-shm|sqlite|sqlite3|log|zip)$/i;
const FORBIDDEN_DOCUMENT_PATH = /\.(?:pdf|doc|docx|xls|xlsx|ppt|pptx)$/i;
const ENV_FILE_PATH = /(^|\/)\.env(?:\..+)?$/i;
const SAFE_ENV_EXAMPLE_PATH = /(^|\/)\.env\.example$/i;
const SECRET_PATTERNS = [
  { label: 'private key', pattern: /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/ },
  { label: 'OpenAI-style key', pattern: /\bsk-(?:proj-)?[A-Za-z0-9_-]{20,}\b/ },
  { label: 'GitHub token', pattern: /\b(?:gh[pousr]_[A-Za-z0-9]{30,}|github_pat_[A-Za-z0-9_]{20,})\b/ },
  { label: 'AWS access key', pattern: /\bAKIA[0-9A-Z]{16}\b/ },
  { label: 'Google API key', pattern: /\bAIza[0-9A-Za-z_-]{35}\b/ },
  { label: 'Slack token', pattern: /\bxox[baprs]-[A-Za-z0-9-]{20,}\b/ }
];
const releaseTextPath = /^(?:README\.md|\.env\.example|backend\/src\/|backend\/package\.json|docs\/|examples\/|scripts\/(?:start-|backup-|restore-|check-data|package-release))/;
const browserSecretPattern = /RAG_API_KEY|MODEL_API_KEY|X-API-Key|Authorization\s*:/i;
const browserBundleSecretPattern = /RAG_API_KEY|MODEL_API_KEY|X-API-Key/i;
const assignedSecretPattern = /^[ \t]*(?:export[ \t]+|\$env:)?(?:MODEL_API_KEY|RAG_API_KEY|OPENAI_API_KEY|GITHUB_TOKEN|AWS_SECRET_ACCESS_KEY)[ \t]*=[ \t]*["']?([^\s"'`,;]+)/gmi;
const syntheticValue = /^(?:portable|test|example|synthetic|placeholder)_/i;

function candidateNames(repositoryRoot) {
  return execFileSync('git', ['ls-files', '--cached', '--others', '--exclude-standard', '-z'], {
    cwd: repositoryRoot,
    encoding: 'utf8'
  }).split('\0').filter(Boolean);
}

function pathViolations(normalized) {
  const violations = [];
  if (ENV_FILE_PATH.test(normalized) && !SAFE_ENV_EXAMPLE_PATH.test(normalized)) {
    violations.push(`${normalized}: environment file must not be tracked`);
  }
  if (FORBIDDEN_RUNTIME_PATH.test(normalized)) {
    violations.push(`${normalized}: forbidden runtime or release artifact path`);
  }
  if (FORBIDDEN_DOCUMENT_PATH.test(normalized)) {
    violations.push(`${normalized}: binary source document must be generated at test runtime, not tracked`);
  }
  return violations;
}

function assignedSecretViolations(normalized, text) {
  const violations = [];
  assignedSecretPattern.lastIndex = 0;
  for (const match of text.matchAll(assignedSecretPattern)) {
    const value = match[1];
    if (value && !syntheticValue.test(value) && !value.startsWith('<') && !value.startsWith('$')) {
      violations.push(`${normalized}: non-placeholder secret assignment`);
    }
  }
  return violations;
}

export function scanRepository({ repositoryRoot = DEFAULT_REPOSITORY_ROOT, names } = {}) {
  const normalizedRoot = path.resolve(repositoryRoot);
  const candidates = names ?? candidateNames(normalizedRoot);
  const violations = [];
  let scannedTextFiles = 0;

  for (const name of candidates) {
    const normalized = name.replaceAll('\\', '/');
    violations.push(...pathViolations(normalized));
    const absolute = path.join(normalizedRoot, normalized);
    let stats;
    try { stats = statSync(absolute); } catch { continue; }
    if (!stats.isFile() || stats.size > 5 * 1024 * 1024) continue;
    const bytes = readFileSync(absolute);
    if (bytes.includes(0)) continue;
    scannedTextFiles += 1;
    const text = bytes.toString('utf8');
    for (const { label, pattern } of SECRET_PATTERNS) {
      if (pattern.test(text)) violations.push(`${normalized}: possible ${label} material`);
    }
    violations.push(...assignedSecretViolations(normalized, text));
    if (normalized.startsWith('frontend/src/') && browserSecretPattern.test(text)) {
      violations.push(`${normalized}: long-lived credential reference in browser source`);
    }
    if (releaseTextPath.test(normalized)) {
      if (/[A-Za-z]:\\/.test(text)) violations.push(`${normalized}: absolute Windows drive path in release content`);
      if (/\b(?:10\.\d{1,3}(?:\.\d{1,3}){2}|192\.168\.\d{1,3}\.\d{1,3}|172\.(?:1[6-9]|2\d|3[01])\.\d{1,3}\.\d{1,3})\b/.test(text)) {
        violations.push(`${normalized}: fixed private IP in release content`);
      }
      if (/\b(?:TBD|FIXME)\b/i.test(text)) violations.push(`${normalized}: unfinished marker in release content`);
      if (/wbk05/i.test(text)) violations.push(`${normalized}: current username in release content`);
    }
  }

  return {
    violations: [...new Set(violations)].sort(),
    candidateFiles: candidates.length,
    scannedTextFiles
  };
}

function browserBundleFiles(bundleRoot) {
  if (!existsSync(bundleRoot)) return [];
  const files = [];
  const directories = [bundleRoot];
  while (directories.length > 0) {
    const current = directories.pop();
    for (const entry of readdirSync(current, { withFileTypes: true })) {
      const absolute = path.join(current, entry.name);
      if (entry.isDirectory()) {
        directories.push(absolute);
      } else if (/\.(?:css|html|js|map)$/i.test(entry.name)) {
        files.push(absolute);
      }
    }
  }
  return files.sort();
}

export function scanFrontendBundle({
  repositoryRoot = DEFAULT_REPOSITORY_ROOT,
  bundleRoot = path.join(repositoryRoot, 'frontend', 'dist')
} = {}) {
  const files = browserBundleFiles(path.resolve(bundleRoot));
  const violations = [];
  for (const absolute of files) {
    const text = readFileSync(absolute, 'utf8');
    if (browserBundleSecretPattern.test(text)) {
      const relative = path.relative(path.resolve(repositoryRoot), absolute).replaceAll('\\', '/');
      violations.push(`${relative}: long-lived credential reference in browser bundle`);
    }
  }
  return { violations, scannedBundleFiles: files.length };
}

function main() {
  const result = scanRepository();
  const bundle = scanFrontendBundle();
  const violations = [...new Set([...result.violations, ...bundle.violations])].sort();
  if (violations.length > 0) {
    process.stderr.write(`${violations.join('\n')}\n`);
    process.exitCode = 1;
  } else {
    process.stdout.write(`${JSON.stringify({
      status: 'SECURITY_SCAN_PASSED',
      scannedFiles: result.candidateFiles,
      scannedTextFiles: result.scannedTextFiles,
      scannedBundleFiles: bundle.scannedBundleFiles
    })}\n`);
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main();
}
