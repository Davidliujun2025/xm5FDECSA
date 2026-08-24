export const FORMAT_FIXTURES = Object.freeze([
  {
    extension: 'pdf',
    mime: 'application/pdf',
    bytes: Buffer.from('%PDF-1.4\n1 0 obj<</Type/Catalog>>endobj\n%%EOF', 'utf8')
  },
  {
    extension: 'docx',
    mime: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    bytes: officeEnvelope('docx-visible-text')
  },
  {
    extension: 'xlsx',
    mime: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    bytes: officeEnvelope('xlsx-cell-value')
  },
  {
    extension: 'pptx',
    mime: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
    bytes: officeEnvelope('pptx-slide-text')
  },
  {
    extension: 'md',
    mime: 'text/markdown',
    bytes: Buffer.from('# 脱敏知识\n\n这是一段 Markdown 测试内容。', 'utf8')
  },
  {
    extension: 'txt',
    mime: 'text/plain',
    bytes: Buffer.from('这是一段 UTF-8 脱敏文本。', 'utf8')
  }
]);

export function officeEnvelope(label) {
  return Buffer.concat([
    Buffer.from([0x50, 0x4b, 0x03, 0x04]),
    Buffer.from(label.padEnd(32, '_'), 'utf8'),
    Buffer.from([0x50, 0x4b, 0x05, 0x06]),
    Buffer.alloc(18)
  ]);
}
