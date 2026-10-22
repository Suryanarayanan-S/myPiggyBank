import { describe, expect, it } from 'vitest';
import { readZipEntry } from '../../src/domain/zip.js';
import { makeZip } from '../fixtures/zip.js';

describe('zip reader', () => {
  it('reads the entry whose name matches, deflated or stored', () => {
    const zip = makeZip([
      { name: 'readme.txt', text: 'hello' },
      { name: 'bc08102026.csv', text: 'SERIES,SYMBOL\nEQ,INFY\n' },
      { name: 'pd08102026.csv', text: 'stored', store: true },
    ]);
    expect(readZipEntry(zip, (n) => /^bc\d{8}\.csv$/i.test(n))).toBe('SERIES,SYMBOL\nEQ,INFY\n');
    expect(readZipEntry(zip, (n) => n.startsWith('pd'))).toBe('stored');
    expect(readZipEntry(zip, (n) => n === 'none.csv')).toBeNull();
  });

  it('says so when the data is not a zip (e.g. an error page)', () => {
    expect(() => readZipEntry(Buffer.from('<html>busy</html>'), () => true)).toThrow(/not a zip/);
    expect(() => readZipEntry(Buffer.from('busy'), () => true)).toThrow(/not a zip/);
  });
});
