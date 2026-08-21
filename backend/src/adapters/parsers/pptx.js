import { XMLParser } from 'fast-xml-parser';

import {
  createParsedBlock,
  invalidParseFileError,
  normalizeParserError
} from '../../domain/ingestion.js';
import { asBuffer, inspectOfficeArchive } from './common.js';

function visibleText(node, output = []) {
  if (Array.isArray(node)) {
    node.forEach((item) => visibleText(item, output));
    return output;
  }
  if (!node || typeof node !== 'object') {
    return output;
  }
  for (const [key, value] of Object.entries(node)) {
    if (key === 't' && (typeof value === 'string' || typeof value === 'number')) {
      output.push(String(value));
    } else {
      visibleText(value, output);
    }
  }
  return output;
}

export async function parsePptx(bytes, options = {}) {
  const buffer = asBuffer(bytes);
  const slidePattern = /^ppt\/slides\/slide(\d+)\.xml$/;
  const entries = inspectOfficeArchive(buffer, {
    ...options,
    select: (name) => slidePattern.test(name)
  });
  try {
    const parser = new XMLParser({
      ignoreAttributes: true,
      removeNSPrefix: true,
      parseTagValue: false,
      trimValues: false,
      processEntities: false
    });
    return Object.entries(entries)
      .map(([name, xmlBytes]) => ({ name, xmlBytes, slide: Number(slidePattern.exec(name)?.[1]) }))
      .filter((entry) => Number.isSafeInteger(entry.slide))
      .sort((left, right) => left.slide - right.slide)
      .map((entry, order) => {
        const xml = Buffer.from(entry.xmlBytes).toString('utf8');
        if (/<!DOCTYPE|<!ENTITY/i.test(xml)) {
          throw invalidParseFileError('PPTX 幻灯片 XML 不安全');
        }
        return createParsedBlock({
          text: visibleText(parser.parse(xml)).join(' '),
          location: { kind: 'slide', slide: entry.slide },
          order
        });
      });
  } catch (error) {
    throw normalizeParserError(error, 'PPTX');
  }
}
