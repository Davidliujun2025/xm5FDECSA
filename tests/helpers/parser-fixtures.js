import ExcelJS from 'exceljs';
import { strToU8, zipSync } from 'fflate';

function escapePdfText(text) {
  return text.replaceAll('\\', '\\\\').replaceAll('(', '\\(').replaceAll(')', '\\)');
}

export function pdfFixture(text = 'Visible PDF text') {
  const drawing = text === null
    ? '0 0 m 50 50 l S'
    : `BT /F1 12 Tf 72 720 Td (${escapePdfText(text)}) Tj ET`;
  const objects = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 5 0 R >> >> /Contents 4 0 R >>',
    `<< /Length ${Buffer.byteLength(drawing)} >>\nstream\n${drawing}\nendstream`,
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>'
  ];
  let body = '%PDF-1.4\n';
  const offsets = [0];
  objects.forEach((object, index) => {
    offsets.push(Buffer.byteLength(body));
    body += `${index + 1} 0 obj\n${object}\nendobj\n`;
  });
  const xrefOffset = Buffer.byteLength(body);
  body += `xref\n0 ${objects.length + 1}\n`;
  body += '0000000000 65535 f \n';
  body += offsets.slice(1).map((offset) => `${String(offset).padStart(10, '0')} 00000 n \n`).join('');
  body += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xrefOffset}\n%%EOF\n`;
  return Buffer.from(body, 'ascii');
}

export function encryptedPdfFixture() {
  return Buffer.concat([
    pdfFixture('secret'),
    Buffer.from('\ntrailer << /Encrypt 9 0 R >>\n', 'ascii')
  ]);
}

export function docxFixture(paragraphs = ['DOCX first paragraph', 'DOCX second paragraph']) {
  const contentTypes = '<?xml version="1.0"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>';
  const relationships = '<?xml version="1.0"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>';
  const body = paragraphs.map((paragraph) => `<w:p><w:r><w:t>${paragraph}</w:t></w:r></w:p>`).join('');
  const document = `<?xml version="1.0"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>${body}<w:sectPr/></w:body></w:document>`;
  return Buffer.from(zipSync({
    '[Content_Types].xml': strToU8(contentTypes),
    '_rels/.rels': strToU8(relationships),
    'word/document.xml': strToU8(document)
  }));
}

export async function xlsxFixture() {
  const workbook = new ExcelJS.Workbook();
  const worksheet = workbook.addWorksheet('Policies');
  worksheet.getCell('B2').value = 'XLSX visible cell';
  worksheet.getCell('C3').value = { formula: '1+1', result: 2 };
  return Buffer.from(await workbook.xlsx.writeBuffer());
}

export function pptxFixture(slides = ['PPTX visible slide']) {
  const entries = {};
  slides.forEach((text, index) => {
    entries[`ppt/slides/slide${index + 1}.xml`] = strToU8(
      `<?xml version="1.0"?><p:sld xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"><p:cSld><p:spTree><p:sp><p:txBody><a:p><a:r><a:t>${text}</a:t></a:r></a:p></p:txBody></p:sp></p:spTree></p:cSld></p:sld>`
    );
  });
  entries['[Content_Types].xml'] = strToU8('<?xml version="1.0"?><Types/>');
  return Buffer.from(zipSync(entries));
}

export function expandedArchiveFixture(size = 128) {
  return Buffer.from(zipSync({
    'word/document.xml': new Uint8Array(size).fill(65)
  }));
}
