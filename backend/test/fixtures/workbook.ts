import ExcelJS from 'exceljs';

type Row = [label: string | number, amount: number | null];
export type SheetSpec = {
  name: string;
  layout?: 'standard' | 'old';
  income?: Row[];
  essentials?: Row[];
  fun?: Row[];
  future?: Row[];
  /** The sheet's own totals; default = correct sums. `null` leaves the cell empty. */
  netIncome?: number | null;
  spend?: number | null;
  formulaTotals?: boolean;
  extraCells?: [address: string, value: ExcelJS.CellValue][];
};

const sum = (rows: Row[] = []) => rows.reduce((s, [, a]) => s + (a ?? 0), 0);

/** Builds a synthetic workbook shaped like the user's monthly-spending sheets. */
export async function buildWorkbook(sheets: SheetSpec[]): Promise<Buffer> {
  const wb = new ExcelJS.Workbook();
  for (const s of sheets) {
    const ws = wb.addWorksheet(s.name);
    const old = s.layout === 'old';
    const [labelCol, amountCol] = old ? ['A', 'B'] : ['C', 'D'];
    const net = s.netIncome === undefined ? sum(s.income) : s.netIncome;
    const spend = s.spend === undefined ? sum(s.essentials) + sum(s.fun) + sum(s.future) : s.spend;
    const total = (v: number | null, formula: string) =>
      v === null ? null : s.formulaTotals ? { formula, result: v } : v;

    if (!old) ws.getCell('C1').value = 'Summary';
    (s.income ?? []).forEach(([label, amount], i) => {
      const r = (old ? 1 : 2) + i;
      ws.getCell(`${labelCol}${r}`).value = label;
      if (amount !== null) ws.getCell(`${amountCol}${r}`).value = amount;
    });
    const netRow = old ? 6 : 9;
    ws.getCell(`${labelCol}${netRow}`).value = 'Total Net income';
    ws.getCell(`${amountCol}${netRow}`).value = total(net, 'SUM(D2:D8)');
    if (!old) {
      ws.getCell('C10').value = 'Spend';
      ws.getCell('D10').value = total(spend, 'L19');
      ws.getCell('C11').value = 'Unused Amount';
    }
    const header = old ? 7 : 15;
    ['Fundamentals', 'Fundamentals', 'Fun', 'Fun', 'Future You', 'Future You'].forEach((h, i) => {
      ws.getCell(header, i + 1).value = h;
    });
    const put = (rows: Row[] = [], col: number) =>
      rows.forEach(([label, amount], i) => {
        ws.getCell(header + 1 + i, col).value = label;
        if (amount !== null) ws.getCell(header + 1 + i, col + 1).value = amount;
      });
    put(s.essentials, 1);
    put(s.fun, 3);
    put(s.future, 5);
    // The real sheets keep a goal/actual summary in I–L; the parser must ignore it.
    ws.getCell('J16').value = 0.5;
    ws.getCell('L19').value = spend;
    for (const [addr, v] of s.extraCells ?? []) ws.getCell(addr).value = v;
  }
  return Buffer.from(await wb.xlsx.writeBuffer());
}
