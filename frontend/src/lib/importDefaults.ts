export type ImportMode = 'import' | 'replace' | 'skip';

/** Months already imported, or already filled in the app, default to Skip to avoid double counting. */
export const defaultImportMode = (existing: { imported: number; manual: number }): ImportMode =>
  existing.imported > 0 || existing.manual > 0 ? 'skip' : 'import';
