export type ColumnMapping = {
  date: number | null;
  description: number | null;
  payee: number | null;
  amount: number | null;
  currency: number | null;
};
export type CsvPreview = {
  delimiter: string;
  headers: string[];
  rows: string[][];
  mapping: ColumnMapping;
};
export type DateFormat = 'dd.mm.yyyy' | 'dd/mm/yyyy' | 'mm/dd/yyyy' | 'yyyy-mm-dd';
export type AnalysedRow = {
  index: number;
  date: string | null;
  amount: number | null;
  type: 'income' | 'expense';
  description: string;
  error: string | null;
  duplicate: 'file' | 'existing' | 'possible' | null;
  suggestion: string | null;
};
export type Analysis = {
  rows: AnalysedRow[];
  summary: { total: number; valid: number; invalid: number; duplicates: number };
};

/** Picks the date format that reads the most sample values. */
export function guessDateFormat(samples: string[]): DateFormat {
  const tests: [DateFormat, RegExp][] = [
    ['dd.mm.yyyy', /^\d{1,2}\.\d{1,2}\.\d{2,4}$/],
    ['yyyy-mm-dd', /^\d{4}-\d{1,2}-\d{1,2}$/],
    ['dd/mm/yyyy', /^\d{1,2}\/\d{1,2}\/\d{2,4}$/],
  ];
  let best: DateFormat = 'dd.mm.yyyy';
  let bestHits = -1;
  for (const [f, re] of tests) {
    const hits = samples.filter((s) => re.test(s.trim())).length;
    if (hits > bestHits) [best, bestHits] = [f, hits];
  }
  return best;
}

/** "," when amounts look like 1.234,56 / -52,40, otherwise ".". */
export function guessDecimal(samples: string[]): ',' | '.' {
  const comma = samples.filter((s) => /,\d{1,2}\s*$/.test(s.trim())).length;
  const dot = samples.filter((s) => /\.\d{1,2}\s*$/.test(s.trim())).length;
  return comma >= dot ? ',' : '.';
}

/** The part of a description used to remember a category: the payee before " · ". */
export const rulePattern = (description: string) => description.split(' · ')[0]!.trim();

/**
 * The pattern to remember for a row, or null when there is nothing safe to remember: no payee
 * (the text would be the whole description), or a payee too short (would match inside other words)
 * or too long to ever match again.
 */
export function rememberPatternFor(description: string): string | null {
  if (!description.includes(' · ')) return null;
  const p = rulePattern(description);
  return p.length >= 3 && p.length <= 60 ? p : null;
}
