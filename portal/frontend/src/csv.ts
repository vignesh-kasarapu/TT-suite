// CSV (RFC 4180): quoted fields, "" escapes, CRLF or LF. The separator is whichever of , ; or tab
// the header line uses most (Excel saves ; in some locales). Blank lines are dropped.
export function parseCsv(text: string): string[][] {
  const src = text.replace(/^﻿/, '');
  const header = src.split(/\r?\n/, 1)[0] ?? '';
  const sep = [';', '\t'].reduce((best, c) => (header.split(c).length > header.split(best).length ? c : best), ',');
  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let quoted = false;
  for (let i = 0; i < src.length; i++) {
    const c = src[i];
    if (quoted) {
      if (c !== '"') field += c;
      else if (src[i + 1] === '"') {
        field += '"';
        i++;
      } else quoted = false;
    } else if (c === '"' && field === '') quoted = true;
    else if (c === sep) {
      row.push(field);
      field = '';
    } else if (c === '\n' || c === '\r') {
      if (c === '\r' && src[i + 1] === '\n') i++;
      row.push(field);
      rows.push(row);
      row = [];
      field = '';
    } else field += c;
  }
  if (field !== '' || row.length) {
    row.push(field);
    rows.push(row);
  }
  return rows.filter((r) => r.some((f) => f.trim() !== ''));
}
