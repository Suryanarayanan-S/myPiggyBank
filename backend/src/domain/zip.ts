/**
 * Reads one file out of a zip archive (NSE's daily PR zip): the central directory, then the
 * entry, stored or deflated. Pure and small, so no dependency is needed for it.
 */
import { inflateRawSync } from 'node:zlib';

const END = 0x06054b50;
const CENTRAL = 0x02014b50;
const LOCAL = 0x04034b50;

/** The text of the first entry whose name matches; null when none does. */
export function readZipEntry(zip: Buffer, matches: (name: string) => boolean): string | null {
  // The end record sits in the last 22 bytes, or before a comment of up to 64 KB.
  let end = -1;
  if (zip.length < 22) throw new Error('The download is not a zip archive');
  for (let i = zip.length - 22; i >= Math.max(0, zip.length - 22 - 0xffff); i--) {
    if (zip.readUInt32LE(i) === END) {
      end = i;
      break;
    }
  }
  if (end < 0) throw new Error('The download is not a zip archive');
  const count = zip.readUInt16LE(end + 10);
  let at = zip.readUInt32LE(end + 16);
  for (let n = 0; n < count; n++) {
    if (zip.readUInt32LE(at) !== CENTRAL) throw new Error('The zip archive is damaged');
    const method = zip.readUInt16LE(at + 10);
    const size = zip.readUInt32LE(at + 20);
    const nameLength = zip.readUInt16LE(at + 28);
    const extra = zip.readUInt16LE(at + 30);
    const comment = zip.readUInt16LE(at + 32);
    const local = zip.readUInt32LE(at + 42);
    const name = zip.toString('utf8', at + 46, at + 46 + nameLength);
    at += 46 + nameLength + extra + comment;
    if (!matches(name)) continue;
    if (zip.readUInt32LE(local) !== LOCAL) throw new Error('The zip archive is damaged');
    const start = local + 30 + zip.readUInt16LE(local + 26) + zip.readUInt16LE(local + 28);
    const data = zip.subarray(start, start + size);
    if (method === 0) return data.toString('utf8');
    if (method === 8) return inflateRawSync(data).toString('utf8');
    throw new Error(`The zip archive uses an unknown packing (${method})`);
  }
  return null;
}
