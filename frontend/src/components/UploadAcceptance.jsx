import { useEffect, useRef, useState } from 'react';

import {
  getAcceptanceDocument,
  getAcceptanceJob,
  loadAcceptanceContext,
  publishAcceptanceDocument,
  uploadAcceptanceFile
} from '../api/acceptance-client.js';
import { extensionOf, formatBytes, preflightAcceptanceFile } from './acceptance-file.js';
import { pollAcceptanceJob } from './acceptance-polling.js';
import { createAcceptancePublicationGate } from './acceptance-publication.js';
import '../styles/acceptance.css';

const STAGES = [
  { id: 'selected', label: '选择文件', note: '浏览器本地校验' },
  { id: 'uploaded', label: '上传受理', note: '原文件原子保存' },
  { id: 'processing', label: '解析建索引', note: '异步任务执行' },
  { id: 'ready', label: '等待发布', note: 'READY 不可检索' },
  { id: 'published', label: '完成发布', note: 'PUBLISHED 可检索' }
];

const PHASE_ORDER = {
  idle: -1,
  selected: 0,
  uploading: 0,
  uploaded: 1,
  processing: 2,
  ready: 3,
  publishing: 3,
  published: 4,
  failed: -1
};

const DEFAULT_FORMATS = ['PDF', 'DOCX', 'XLSX', 'PPTX', 'MD', 'TXT'];
const DEFAULT_MAX_FILE_BYTES = 30 * 1024 * 1024;

export default function UploadAcceptance() {
  const [context, setContext] = useState(null);
  const [file, setFile] = useState(null);
  const [phase, setPhase] = useState('idle');
  const [job, setJob] = useState(null);
  const [document, setDocument] = useState(null);
  const [error, setError] = useState(null);
  const mounted = useRef(true);
  const pollingAbort = useRef(null);
  const publicationGate = useRef(null);
  if (publicationGate.current === null) {
    publicationGate.current = createAcceptancePublicationGate(publishAcceptanceDocument);
  }

  useEffect(() => {
    const controller = new AbortController();
    mounted.current = true;
    pollingAbort.current = controller;
    loadAcceptanceContext()
      .then((value) => mounted.current && setContext(value))
      .catch((reason) => mounted.current && setError(reason));
    return () => {
      mounted.current = false;
      controller.abort();
      if (pollingAbort.current === controller) {
        pollingAbort.current = null;
      }
    };
  }, []);

  const activeStage = PHASE_ORDER[phase] ?? -1;
  const displayedFormats = context?.supportedFormats?.length
    ? context.supportedFormats
    : DEFAULT_FORMATS;
  const displayedMaxFileBytes = context?.maxFileBytes ?? DEFAULT_MAX_FILE_BYTES;
  const contextLabel = context
    ? context.topicName?.trim() || '未提供验收 Topic'
    : error ? '验收 Topic 加载失败' : '正在准备…';
  const contextStatus = context?.topicStatus ?? (error ? 'ERROR' : 'LOADING');
  function reset() {
    setFile(null);
    setPhase('idle');
    setJob(null);
    setDocument(null);
    setError(null);
  }

  function selectFile(selectedFile) {
    setError(null);
    setJob(null);
    setDocument(null);
    if (!selectedFile) {
      reset();
      return;
    }
    const preflight = preflightAcceptanceFile(selectedFile, context);
    if (!preflight.ok) {
      setFile(null);
      setPhase('idle');
      setError(preflight.error);
      return;
    }
    setFile(selectedFile);
    setPhase('selected');
  }

  function dropFile(event) {
    event.preventDefault();
    if (!context || busy) return;
    selectFile(event.dataTransfer.files?.[0]);
  }

  async function waitForJob(jobId, documentId) {
    const result = await pollAcceptanceJob({
      jobId,
      documentId,
      fetchJob: getAcceptanceJob,
      fetchDocument: getAcceptanceDocument,
      isActive: () => mounted.current,
      onJob: setJob,
      onPhase: setPhase,
      signal: pollingAbort.current?.signal
    });
    if (result.status === 'READY' && mounted.current) {
      setDocument(result.document);
    }
  }

  async function startUpload() {
    if (!file || !context) return;
    setError(null);
    setPhase('uploading');
    try {
      const accepted = await uploadAcceptanceFile(file);
      if (!mounted.current) return;
      setJob({ id: accepted.jobId, status: accepted.jobStatus, stage: 'QUEUED' });
      setDocument({ id: accepted.documentId, status: accepted.status, fileName: file.name });
      setPhase('uploaded');
      await waitForJob(accepted.jobId, accepted.documentId);
    } catch (reason) {
      if (!mounted.current) return;
      setError(reason);
      setPhase('failed');
    }
  }

  async function publish() {
    const documentId = document?.documentId ?? document?.id;
    if (phase !== 'ready' || !documentId || publicationGate.current.isPublishing()) return;
    setError(null);
    setPhase('publishing');
    try {
      const published = await publicationGate.current.publish(documentId, {
        signal: pollingAbort.current?.signal
      });
      if (!mounted.current) return;
      setDocument(published);
      setPhase('published');
    } catch (reason) {
      if (!mounted.current) return;
      setError(reason);
      setPhase('ready');
    }
  }

  const documentId = document?.documentId ?? document?.id;
  const busy = ['uploading', 'uploaded', 'processing', 'publishing'].includes(phase);

  return (
    <main className="acceptance-page">
      <header className="acceptance-hero">
        <div>
          <div className="acceptance-eyebrow">MOCK / LOCAL ACCEPTANCE</div>
          <h1>文件入库验收台</h1>
          <p>亲自走完上传、解析、READY 与手动发布。每一步都有状态证据，不把“已上传”当作“已可检索”。</p>
        </div>
        <a className="acceptance-back" href="/">返回问答页</a>
      </header>

      <section className="acceptance-shell">
        <div className="acceptance-main">
          <div className="acceptance-safety" role="note">
            <strong>仅限本机脱敏验收</strong>
            <span>禁止上传真实企业资料。文件会写入本机隔离数据目录，仅用于 Mock 流程核验。</span>
          </div>

          <div className="topic-strip">
            <div>
              <span>验收 Topic</span>
              <strong>{contextLabel}</strong>
            </div>
            <div className="topic-id">{context?.topicId ?? '—'}</div>
            <span className={`active-badge is-${contextStatus.toLowerCase()}`}>{contextStatus}</span>
          </div>

          <section className="intake-card" aria-labelledby="upload-title">
            <div className="section-heading">
              <span className="section-number">01</span>
              <div>
                <h2 id="upload-title">投递一份验收文件</h2>
                <p>{`${displayedFormats.join(' · ')}，单文件上限 ${formatBytes(displayedMaxFileBytes)}`}</p>
              </div>
            </div>

            <label
              className={`file-drop ${file ? 'has-file' : ''} ${busy ? 'is-disabled' : ''}`}
              onDragOver={(event) => event.preventDefault()}
              onDrop={dropFile}
            >
              <input
                type="file"
                accept=".pdf,.docx,.xlsx,.pptx,.md,.txt"
                disabled={!context || busy}
                onChange={(event) => selectFile(event.target.files?.[0])}
              />
              <span className="drop-mark" aria-hidden="true">↥</span>
              <span className="drop-title">{file ? file.name : '选择文件，或拖放到这里'}</span>
              <span className="drop-meta">
                {file ? `${extensionOf(file.name)} · ${formatBytes(file.size)}` : '文件只发送到本机 127.0.0.1'}
              </span>
            </label>

            {error && (
              <div className="acceptance-error" role="alert">
                <strong>{error.errorCode || 'UPLOAD_FAILED'}</strong>
                <span>{error.message}</span>
                {error.traceId && <code>traceId: {error.traceId}</code>}
              </div>
            )}

            <div className="acceptance-actions">
              <button className="primary-action" type="button" onClick={startUpload} disabled={!file || busy || phase === 'ready' || phase === 'published'}>
                {phase === 'uploading' ? '正在上传…' : phase === 'processing' ? '正在解析…' : '开始上传并解析'}
              </button>
              <button className="secondary-action" type="button" onClick={reset} disabled={busy || phase === 'idle'}>
                重新选择
              </button>
            </div>
          </section>

          <section className="publish-card" aria-labelledby="publish-title">
            <div className="section-heading">
              <span className="section-number">02</span>
              <div>
                <h2 id="publish-title">确认后手动发布</h2>
                <p>任务成功只会进入 READY；点击发布后，文档才成为 PUBLISHED。</p>
              </div>
            </div>
            <button
              aria-busy={phase === 'publishing'}
              className="publish-action"
              type="button"
              onClick={publish}
              disabled={phase !== 'ready' || publicationGate.current.isPublishing()}
            >
              {phase === 'publishing' ? '正在发布…' : phase === 'published' ? '已发布' : '发布到测试知识库'}
            </button>
            {phase === 'ready' && (
              <p className="publish-gate-note"><strong>READY</strong> 当前尚不可检索；请确认内容后手动发布，发布后可检索。</p>
            )}
            {phase === 'publishing' && (
              <p className="publish-gate-note" role="status">正在提交发布请求，请勿重复操作。</p>
            )}
            {phase === 'published' && documentId && (
              <div className="publish-success" role="status">
                <span><strong>PUBLISHED</strong> 发布成功，文档现在可检索</span>
                <span className="publish-success-actions">
                  <a href="/?acceptance=1">进入问答</a>
                  <a href={`/api/acceptance/documents/${encodeURIComponent(documentId)}/file`} target="_blank" rel="noreferrer">核对原文件</a>
                </span>
              </div>
            )}
          </section>
        </div>

        <aside className="pipeline-panel" aria-label="入库阶段">
          <div className="pipeline-head">
            <span>LIVE PIPELINE</span>
            <strong>{phase === 'failed' ? 'FAILED' : phase.toUpperCase()}</strong>
          </div>
          <ol className="pipeline-stages">
            {STAGES.map((stage, index) => {
              const completed = index < activeStage || (index === activeStage && phase === 'published');
              const current = index === activeStage && phase !== 'published';
              return (
                <li className={completed ? 'complete' : current ? 'current' : ''} key={stage.id}>
                  <span className="stage-index">{String(index + 1).padStart(2, '0')}</span>
                  <div>
                    <strong>{stage.label}</strong>
                    <span>{stage.note}</span>
                  </div>
                  <span className="stage-light" aria-label={completed ? '已完成' : current ? '进行中' : '未开始'} />
                </li>
              );
            })}
          </ol>

          <dl className="audit-grid">
            <div><dt>任务状态</dt><dd>{job?.status ?? '—'}</dd></div>
            <div><dt>当前阶段</dt><dd>{job?.stage ?? '—'}</dd></div>
            <div><dt>文档状态</dt><dd>{document?.status ?? '—'}</dd></div>
            <div><dt>错误码</dt><dd>{job?.errorCode ?? error?.errorCode ?? '—'}</dd></div>
          </dl>
          <div className="id-ledger">
            <span>JOB</span><code>{job?.jobId ?? job?.id ?? '—'}</code>
            <span>DOC</span><code>{documentId ?? '—'}</code>
          </div>
          <p className="security-note">长期 API Key 保留在服务端；浏览器只持有短期、同源、HttpOnly 验收会话。</p>
        </aside>
      </section>
    </main>
  );
}
