import ExcelJS from 'exceljs';

import { createParsedBlock, normalizeParserError } from '../../domain/ingestion.js';
import { asBuffer, inspectOfficeArchive } from './common.js';

function cachedCellText(cell) {
  const value = cell.value;
  if (value && typeof value === 'object' && 'formula' in value) {
    if (value.result === undefined || value.result === null) {
      return '';
    }
    return String(value.result);
  }
  if (value && typeof value === 'object' && Array.isArray(value.richText)) {
    return value.richText.map((part) => part.text || '').join('');
  }
  if (value && typeof value === 'object' && 'hyperlink' in value) {
    return String(value.text || '');
  }
  return cell.text;
}

export async function parseXlsx(bytes, options = {}) {
  const buffer = asBuffer(bytes);
  inspectOfficeArchive(buffer, options);
  try {
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load(buffer, {
      ignoreNodes: ['dataValidations', 'extLst', 'hyperlinks', 'drawing', 'picture']
    });
    const blocks = [];
    workbook.eachSheet((worksheet) => {
      worksheet.eachRow({ includeEmpty: false }, (row) => {
        row.eachCell({ includeEmpty: false }, (cell) => {
          const text = cachedCellText(cell);
          if (!String(text ?? '').trim()) {
            return;
          }
          blocks.push(createParsedBlock({
            text,
            location: { kind: 'cell', sheet: worksheet.name, cell: cell.address },
            order: blocks.length
          }));
        });
      });
    });
    return blocks;
  } catch (error) {
    throw normalizeParserError(error, 'XLSX');
  }
}
