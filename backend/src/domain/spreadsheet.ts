import ExcelJS from 'exceljs';
import JSZip from 'jszip';
import { AppError } from '../lib/errors.js';

export type ImportBucket = 'essentials' | 'fun' | 'future';
export type ParsedMonth = {
  sheet: string;
  month: string;
  income: { label: string; amount: number }[];
  items: { bucket: ImportBucket; label: string; amount: number }[];
  /** The sheet's own totals (cents), when present. */
  sheetTotals: { netIncome: number | null; spend: number | null };
  /** Sums of what was read. */
  parsedTotals: { netIncome: number; spend: number };
  matches: boolean;
  warnings: string[];
};

const MONTHS = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];
const FULL =
  /^(january|february|march|april|may|june|july|august|september|sept|october|november|december)$/;

/** "Nov 23" → "2023-11", "June 26" → "2026-06"; anything else → null. */
export function parseSheetMonth(name: string): string | null {
  const m = name
    .trim()
    .toLowerCase()
    .match(/^([a-z]{3,9})\s+(\d{2}|\d{4})$/);
  if (!m) return null;
  const [, word, yy] = m as unknown as [string, string, string];
  const index = MONTHS.indexOf(word.slice(0, 3));
  if (index === -1 || (word.length > 3 && !FULL.test(word))) return null;
  const year = yy.length === 2 ? 2000 + Number(yy) : Number(yy);
  if (year < 2000 || year > 2099) return null;
  return `${year}-${String(index + 1).padStart(2, '0')}`;
}

/** Plain value of a cell: numbers, cached formula results, rich text. */
function valueOf(v: ExcelJS.CellValue): string | number | null {
  if (v === null || v === undefined) return null;
  if (typeof v === 'number' || typeof v === 'string') return v;
  if (typeof v === 'boolean' || v instanceof Date) return null;
  if (typeof v === 'object') {
    if ('richText' in v) return v.richText.map((r) => r.text).join('');
    if ('result' in v) return valueOf(v.result as ExcelJS.CellValue);
    if ('text' in v && typeof v.text === 'string') return v.text;
  }
  return null;
}
const text = (v: string | number | null) => (v === null ? '' : String(v).trim());
const num = (v: string | number | null): number | null => {
  if (typeof v === 'number') return v;
  if (typeof v === 'string' && /^-?\d+([.,]\d+)?$/.test(v.trim()))
    return Number(v.replace(',', '.'));
  return null;
};
const toCents = (euros: number) => Math.round(euros * 100);

const SUMMARY_LABELS = /^(summary|total net income|spend|unused amount)$/i;
const BUCKET_COLUMNS: { bucket: ImportBucket; title: string; label: number; amount: number }[] = [
  { bucket: 'essentials', title: 'Fundamentals', label: 1, amount: 2 },
  { bucket: 'fun', title: 'Fun', label: 3, amount: 4 },
  { bucket: 'future', title: 'Future You', label: 5, amount: 6 },
];

function parseSheet(ws: ExcelJS.Worksheet, month: string): ParsedMonth | null {
  const cell = (r: number, c: number) => valueOf(ws.getCell(r, c).value);
  const lastRow = Math.min(ws.rowCount, 500);

  let header = 0;
  for (let r = 1; r <= Math.min(40, lastRow); r++) {
    if (text(cell(r, 1)).toLowerCase() === 'fundamentals') {
      header = r;
      break;
    }
  }
  if (!header) return null;

  // Income block: the column pair that holds "Total Net income" above the header.
  let labelCol = 0;
  let netIncome: number | null = null;
  let spend: number | null = null;
  for (let r = 1; r < header; r++) {
    for (const c of [1, 3]) {
      const label = text(cell(r, c)).toLowerCase();
      if (label === 'total net income') {
        labelCol = c;
        const v = num(cell(r, c + 1));
        netIncome = v === null ? null : toCents(v);
      } else if (label === 'spend') {
        const v = num(cell(r, c + 1));
        spend = v === null ? null : toCents(v);
      }
    }
  }

  const warnings: string[] = [];
  const income: ParsedMonth['income'] = [];
  if (labelCol) {
    for (let r = 1; r < header; r++) {
      const label = text(cell(r, labelCol));
      const amount = num(cell(r, labelCol + 1));
      if (!label || SUMMARY_LABELS.test(label) || amount === null || amount === 0) continue;
      if (amount < 0) warnings.push(`Income "${label}": negative amount ${amount} skipped`);
      else income.push({ label, amount: toCents(amount) });
    }
  }

  const items: ParsedMonth['items'] = [];
  for (const col of BUCKET_COLUMNS) {
    for (let r = header + 1; r <= lastRow; r++) {
      const label = text(cell(r, col.label));
      const amount = num(cell(r, col.amount));
      if (amount === null || amount === 0) continue;
      if (amount < 0) {
        warnings.push(`${col.title} "${label || `row ${r}`}": negative amount ${amount} skipped`);
        continue;
      }
      if (!label) warnings.push(`${col.title} row ${r}: amount without a label`);
      items.push({ bucket: col.bucket, label: label || '(no label)', amount: toCents(amount) });
    }
  }

  if (income.length === 0 && items.length === 0) return null;
  const parsedTotals = {
    netIncome: income.reduce((s, i) => s + i.amount, 0),
    spend: items.reduce((s, i) => s + i.amount, 0),
  };
  return {
    sheet: ws.name,
    month,
    income,
    items,
    sheetTotals: { netIncome, spend },
    parsedTotals,
    matches:
      (netIncome === null || netIncome === parsedTotals.netIncome) &&
      (spend === null || spend === parsedTotals.spend),
    warnings,
  };
}

/** Reads a monthly-spending workbook (one sheet per month) without storing it anywhere. */
const invalid = () =>
  new AppError(400, 'INVALID_WORKBOOK', 'This file is not a readable .xlsx workbook');

// The real workbook unpacks to ~8 MB in ~180 parts; these limits stop zip bombs early.
const MAX_UNCOMPRESSED = 50_000_000;
const MAX_ENTRIES = 2_000;

/** Checks the zip directory (sizes only, nothing decompressed) before exceljs inflates it. */
async function assertSafeXlsx(buf: Buffer) {
  let zip: JSZip;
  try {
    zip = await JSZip.loadAsync(buf);
  } catch {
    throw invalid();
  }
  let total = 0;
  let entries = 0;
  zip.forEach((_, file) => {
    entries += 1;
    total +=
      (file as unknown as { _data?: { uncompressedSize?: number } })._data?.uncompressedSize ?? 0;
  });
  if (entries > MAX_ENTRIES || total > MAX_UNCOMPRESSED) {
    throw new AppError(
      400,
      'WORKBOOK_TOO_LARGE',
      'This workbook is too large to import (over 50 MB unpacked)',
    );
  }
  if (!zip.file('xl/workbook.xml')) throw invalid();
}

export async function parseSpendingWorkbook(buf: Buffer) {
  await assertSafeXlsx(buf);
  const wb = new ExcelJS.Workbook();
  try {
    await wb.xlsx.load(buf as unknown as ArrayBuffer);
  } catch {
    throw invalid();
  }
  const months: ParsedMonth[] = [];
  const skippedSheets: string[] = [];
  const seen = new Set<string>();
  for (const ws of wb.worksheets) {
    const month = parseSheetMonth(ws.name);
    if (!month) {
      skippedSheets.push(ws.name);
      continue;
    }
    if (seen.has(month)) {
      skippedSheets.push(`${ws.name} (duplicate of an earlier ${month} sheet)`);
      continue;
    }
    const parsed = parseSheet(ws, month);
    if (!parsed) {
      skippedSheets.push(`${ws.name} (empty)`);
      continue;
    }
    seen.add(month);
    months.push(parsed);
  }
  if (months.length === 0) {
    throw new AppError(
      400,
      'NO_MONTHS',
      `No month sheets found (sheets should be named like "Nov 23"). Sheets in this file: ${
        skippedSheets.join(', ') || 'none'
      }`,
    );
  }
  months.sort((a, b) => a.month.localeCompare(b.month));
  return { months, skippedSheets };
}
