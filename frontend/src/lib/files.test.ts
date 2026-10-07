import { describe, expect, it } from 'vitest';
import { fileToBase64 } from './files';

describe('fileToBase64', () => {
  it('encodes small files', async () => {
    expect(await fileToBase64(new Blob(['hello']))).toBe('aGVsbG8=');
  });
  it('encodes files larger than one chunk without corrupting bytes', async () => {
    const bytes = new Uint8Array(300_000).map((_, i) => i % 256);
    const b64 = await fileToBase64(new Blob([bytes]));
    expect(Buffer.from(b64, 'base64').equals(Buffer.from(bytes))).toBe(true);
  });
});
