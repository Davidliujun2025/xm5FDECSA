export function formatBytes(bytes) {
  if (!Number.isFinite(bytes)) return '—';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(2)} MB`;
}

export function extensionOf(fileName = '') {
  return fileName.includes('.') ? fileName.split('.').pop().toUpperCase() : '';
}

export function preflightAcceptanceFile(file, { supportedFormats = [], maxFileBytes } = {}) {
  const extension = extensionOf(file?.name);
  const allowedExtensions = new Set(supportedFormats.map((value) => String(value).toUpperCase()));
  if (!allowedExtensions.has(extension)) {
    return {
      ok: false,
      error: {
        errorCode: 'LOCAL_FORMAT_CHECK',
        message: `不支持 .${extension.toLowerCase() || '未知'} 文件，请选择页面列出的格式。`
      }
    };
  }
  if (!Number.isFinite(file?.size) || file.size <= 0 || !Number.isFinite(maxFileBytes) || file.size > maxFileBytes) {
    return {
      ok: false,
      error: {
        errorCode: 'LOCAL_SIZE_CHECK',
        message: `文件必须大于 0 B 且不超过 ${formatBytes(maxFileBytes)}。`
      }
    };
  }
  return { ok: true, extension };
}
