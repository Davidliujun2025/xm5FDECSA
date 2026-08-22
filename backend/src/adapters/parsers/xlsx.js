import ExcelJS from 'exceljs';
import { zipSync } from 'fflate';

import { createParsedBlock, normalizeParserError } from '../../domain/ingestion.js';
import { asBuffer, inspectOfficeArchive } from './common.js';

const SPREADSHEET_MAIN_NAMESPACE = 'http://schemas.openxmlformats.org/spreadsheetml/2006/main';

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function normalizeSpreadsheetNamespace(bytes) {
  const xml = Buffer.from(bytes).toString('utf8');
  const namespacePattern = new RegExp(
    `xmlns:([A-Za-z_][\\w.-]*)=(["'])${escapeRegExp(SPREADSHEET_MAIN_NAMESPACE)}\\2`
  );
  const match = namespacePattern.exec(xml);
  if (!match) {
    return { bytes, changed: false };
  }

  const [, prefix, quote] = match;
  const defaultDeclaration = `xmlns=${quote}${SPREADSHEET_MAIN_NAMESPACE}${quote}`;
  const declarationReplacement = xml.includes(defaultDeclaration) ? '' : defaultDeclaration;
  const tagPattern = new RegExp(`<(/?)${escapeRegExp(prefix)}:`, 'g');
  return {
    bytes: Buffer.from(xml.replace(match[0], declarationReplacement).replace(tagPattern, '<$1'), 'utf8'),
    changed: true
  };
}

function excelJsCompatibleBuffer(buffer, options) {
  const entries = inspectOfficeArchive(buffer, { ...options, select: () => true });
  let changed = false;
  for (const [name, bytes] of Object.entries(entries)) {
    if (!/^xl\/.*\.xml$/i.test(name)) {
      continue;
    }
    const normalized = normalizeSpreadsheetNamespace(bytes);
    entries[name] = normalized.bytes;
    changed ||= normalized.changed;
  }
  return changed ? Buffer.from(zipSync(entries)) : buffer;
}

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
  try {
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load(excelJsCompatibleBuffer(buffer, options), {
      ignoreNodes: ['dataValidations', 'extLst', 'hyperlinks', 'drawing', 'picture', 'tableParts']
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
