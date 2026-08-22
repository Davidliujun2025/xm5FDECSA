function lineRange(point) {
  const start = point.lineStart;
  const end = point.lineEnd ?? start;
  if (!Number.isInteger(start)) {
    return '';
  }
  return start === end ? `第 ${start} 行` : `第 ${start}–${end} 行`;
}

function formatPoint(point) {
  if (!point || typeof point !== 'object') {
    return '';
  }
  switch (point.kind) {
    case 'cell':
      return point.sheet && point.cell ? `${point.sheet}!${point.cell}` : '';
    case 'page':
      return Number.isInteger(point.page) ? `第 ${point.page} 页` : '';
    case 'slide':
      return Number.isInteger(point.slide) ? `第 ${point.slide} 张幻灯片` : '';
    case 'paragraph':
      return Number.isInteger(point.paragraph) ? `第 ${point.paragraph} 段` : '';
    case 'line':
      return lineRange(point);
    case 'markdown': {
      const heading = Array.isArray(point.headingPath) ? point.headingPath.filter(Boolean).join(' › ') : '';
      const lines = lineRange(point);
      return [heading, lines].filter(Boolean).join(' · ');
    }
    default:
      return '';
  }
}

export function formatCitationLocation(location) {
  if (!location || typeof location !== 'object') {
    return '';
  }
  const start = location.start ?? location;
  const end = location.end ?? start;

  if (start.kind === 'cell' && end.kind === 'cell' && start.sheet && start.cell && end.sheet && end.cell) {
    if (start.sheet === end.sheet) {
      const cells = start.cell === end.cell ? start.cell : `${start.cell}–${end.cell}`;
      return `工作表：${start.sheet} · 单元格：${cells}`;
    }
    return `工作表：${start.sheet} · 单元格：${start.cell} → 工作表：${end.sheet} · 单元格：${end.cell}`;
  }

  const startText = formatPoint(start);
  const endText = formatPoint(end);
  if (!startText) {
    return '';
  }
  return !endText || endText === startText ? startText : `${startText} → ${endText}`;
}

export function summarizeCitationExcerpt(excerpt, maxLength = 240) {
  if (typeof excerpt !== 'string') {
    return '';
  }
  const normalized = excerpt.replace(/\s+/g, ' ').trim();
  if (normalized.length <= maxLength) {
    return normalized;
  }
  return `${normalized.slice(0, maxLength - 1).trimEnd()}…`;
}
