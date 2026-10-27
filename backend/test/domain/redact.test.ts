import { describe, expect, it } from 'vitest';
import { redact } from '../../src/domain/redact.js';

describe('redact', () => {
  it('masks what identifies a person or an account, keeps the words that name a payee', () => {
    expect(redact('SEPA Überweisung DE89 3704 0044 0532 0130 00 Max')).toBe(
      'SEPA Überweisung [IBAN] Max',
    );
    expect(redact('Gutschrift DE89370400440532013000')).toBe('Gutschrift [IBAN]');
    expect(redact('PAN ABCDE1234F TDS refund')).toBe('PAN [PAN] TDS refund');
    expect(redact('mail surya@example.com re order')).toBe('mail [email] re order');
    expect(redact('Call +49 151 2345 6789 Taxi')).toBe('Call [phone] Taxi');
    expect(redact('Karte 4111 1111 1111 1111 REWE')).toBe('Karte [number] REWE');
    expect(redact('Kundennr. 12345678 Stadtwerke')).toBe('Kundennr. [number] Stadtwerke');
  });

  it('masks identifiers as real German and Indian bank lines write them', () => {
    const lines = [
      'NEFT-HDFCN52026102712345678-RAHUL SHARMA-ACC50100123456789',
      'Lastschrift KDNR123456789 MREF0012345678 REF_12345678',
      'IBANDE89370400440532013000',
      'UPI/rahul.sharma@okaxis/Payment from Phone',
      'Karte 4111-1111-1111-1111',
      'Überweisung de89 3704 0044 0532 0130 00',
      'PAN abcps1234k',
      'cut off: DE89 3704 0044 05',
      'Handy 0171 1234567',
    ];
    for (const line of lines) {
      const out = redact(line);
      expect(out, line).not.toMatch(/\d{5,}/);
      expect(out, line).not.toMatch(/\d{4}[ -]\d{4}/);
      expect(out, line).not.toMatch(/@/);
      expect(out, line).not.toMatch(/abcps1234k/i);
    }
    expect(redact('UPI/rahul.sharma@okaxis/Payment')).toBe('UPI/[email]/Payment');
    expect(redact('Handy 0171 1234567')).toBe('Handy [phone]');
    expect(redact('cut off: DE89 3704 0044 05')).toBe('cut off: [IBAN]');
  });

  it('leaves short numbers, dates and amounts alone', () => {
    expect(redact('REWE Markt; Filiale 123')).toBe('REWE Markt; Filiale 123');
    expect(redact('Miete 01.10.2026 912,00')).toBe('Miete 01.10.2026 912,00');
    expect(redact('Bäckerei Schäfer')).toBe('Bäckerei Schäfer');
    expect(redact('Rechnung 2026-10-27 Stadtwerke')).toBe('Rechnung 2026-10-27 Stadtwerke');
    expect(redact('Swiggy order 5 items')).toBe('Swiggy order 5 items');
  });
});
