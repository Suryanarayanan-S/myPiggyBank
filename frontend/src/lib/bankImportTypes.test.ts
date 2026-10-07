import { describe, expect, it } from 'vitest';
import { guessDateFormat, guessDecimal, rememberPatternFor, rulePattern } from './bankImportTypes';

describe('bank import helpers', () => {
  it('guesses the date format from samples', () => {
    expect(guessDateFormat(['01.10.26', '02.10.26'])).toBe('dd.mm.yyyy');
    expect(guessDateFormat(['2026-10-01'])).toBe('yyyy-mm-dd');
    expect(guessDateFormat(['01/10/2026'])).toBe('dd/mm/yyyy');
  });
  it('guesses the decimal separator', () => {
    expect(guessDecimal(['-52,40', '3.750,00'])).toBe(',');
    expect(guessDecimal(['-52.40', '1,234.56'])).toBe('.');
  });
  it('remembers the payee part', () => {
    expect(rulePattern('REWE · REWE Markt; Filiale 123')).toBe('REWE');
  });

  it('only remembers a short payee name, never a whole long description', () => {
    expect(rememberPatternFor('REWE · REWE Markt; Filiale 123')).toBe('REWE');
    expect(
      rememberPatternFor(
        'SEPA Lastschrift Stadtwerke München GmbH Abschlag Strom und Gas Vertragskonto 1234567890',
      ),
    ).toBeNull();
    expect(rememberPatternFor('DB · Fahrkarte')).toBeNull(); // too short: would match "feedback"
    expect(rememberPatternFor(`${'x'.repeat(61)} · purpose`)).toBeNull();
  });
});
