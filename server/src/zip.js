// Minimal streaming ZIP writer (stored entries, no compression, no ZIP64, no dependencies; D-48).
// Files are opened up front (so a concurrent delete cannot break a download in progress), their CRC32 is computed by
// reading them once (cached per file: stored files are immutable), then local headers + data + central directory are
// streamed in a second pass with backpressure. Sizes and CRCs are known before the first byte, so no data descriptors.
import fs from 'node:fs';
import zlib from 'node:zlib';
import { Readable } from 'node:stream';

const CHUNK = 256 * 1024;
const U32_MAX = 0xffffffff;

export class ZipTooLargeError extends Error {
  constructor() { super('ZIP64 is not supported'); this.name = 'ZipTooLargeError'; }
}

/** DOS date/time (local fields taken from UTC; years before 1980 clamp to 1980). */
function dosDateTime(ms) {
  const d = new Date(ms);
  const y = Math.max(1980, d.getUTCFullYear());
  return {
    time: (d.getUTCHours() << 11) | (d.getUTCMinutes() << 5) | (d.getUTCSeconds() >> 1),
    date: ((y - 1980) << 9) | ((d.getUTCMonth() + 1) << 5) | d.getUTCDate(),
  };
}

function localHeader(e) {
  const h = Buffer.alloc(30 + e.nameBuf.length);
  h.writeUInt32LE(0x04034b50, 0);
  h.writeUInt16LE(20, 4); // version needed
  h.writeUInt16LE(0x0800, 6); // flags: UTF-8 names
  h.writeUInt16LE(0, 8); // method: stored
  h.writeUInt16LE(e.time, 10);
  h.writeUInt16LE(e.date, 12);
  h.writeUInt32LE(e.crc, 14);
  h.writeUInt32LE(e.size, 18);
  h.writeUInt32LE(e.size, 22);
  h.writeUInt16LE(e.nameBuf.length, 26);
  h.writeUInt16LE(0, 28); // extra length
  e.nameBuf.copy(h, 30);
  return h;
}

function centralHeader(e) {
  const h = Buffer.alloc(46 + e.nameBuf.length);
  h.writeUInt32LE(0x02014b50, 0);
  h.writeUInt16LE(20, 4); // version made by
  h.writeUInt16LE(20, 6); // version needed
  h.writeUInt16LE(0x0800, 8);
  h.writeUInt16LE(0, 10);
  h.writeUInt16LE(e.time, 12);
  h.writeUInt16LE(e.date, 14);
  h.writeUInt32LE(e.crc, 16);
  h.writeUInt32LE(e.size, 20);
  h.writeUInt32LE(e.size, 24);
  h.writeUInt16LE(e.nameBuf.length, 28);
  // extra length, comment length, disk number, internal attrs, external attrs stay 0
  h.writeUInt32LE(e.offset, 42);
  e.nameBuf.copy(h, 46);
  return h;
}

function endRecord(count, cdSize, cdOffset) {
  const h = Buffer.alloc(22);
  h.writeUInt32LE(0x06054b50, 0);
  h.writeUInt16LE(count, 8);
  h.writeUInt16LE(count, 10);
  h.writeUInt32LE(cdSize, 12);
  h.writeUInt32LE(cdOffset, 16);
  return h;
}

const aborted = (signal) => { if (signal && signal.aborted) throw new Error('aborted'); };

async function computeCrc(fh, size, signal) {
  const buf = Buffer.allocUnsafe(Math.min(CHUNK, Math.max(size, 1)));
  let crc = 0;
  let pos = 0;
  while (pos < size) {
    aborted(signal);
    const { bytesRead } = await fh.read(buf, 0, Math.min(buf.length, size - pos), pos);
    if (bytesRead === 0) throw new Error('file shorter than expected');
    crc = zlib.crc32(buf.subarray(0, bytesRead), crc);
    pos += bytesRead;
  }
  return crc >>> 0;
}

/**
 * Opens the files and computes sizes/CRCs.
 * @param {{name: string, path: string, mtimeMs?: number}[]} entries
 * @param {{signal?: AbortSignal, crcCache?: Map<string, number>}} [opts]
 * @returns {Promise<{size: number, stream: () => Readable, close: () => Promise<void>}>} `size` = exact byte length of the ZIP.
 * Rejects with ZipTooLargeError (no ZIP64) or the fs error (e.g. ENOENT); on rejection nothing stays open.
 * The caller must call close() when the response ends or aborts (idempotent).
 */
export async function prepareZip(entries, { signal, crcCache } = {}) {
  const opened = [];
  const close = async () => {
    const list = opened.splice(0);
    await Promise.all(list.map((e) => e.fh.close().catch(() => {})));
  };
  try {
    let total = 22;
    for (const src of entries) {
      aborted(signal);
      const fh = await fs.promises.open(src.path, 'r');
      const e = { fh, nameBuf: Buffer.from(src.name, 'utf8'), offset: 0, size: 0, crc: 0, ...dosDateTime(src.mtimeMs ?? Date.now()) };
      opened.push(e);
      const st = await fh.stat();
      e.size = st.size;
      total += 30 + e.nameBuf.length + e.size + 46 + e.nameBuf.length;
      if (e.size > U32_MAX || total > U32_MAX) throw new ZipTooLargeError();
      const key = `${src.path}:${st.size}:${st.mtimeMs}`;
      let crc = crcCache && crcCache.get(key);
      if (crc === undefined) {
        crc = await computeCrc(fh, e.size, signal);
        if (crcCache) {
          if (crcCache.size >= 500) crcCache.delete(crcCache.keys().next().value);
          crcCache.set(key, crc);
        }
      }
      e.crc = crc;
    }
    if (opened.length > 0xffff) throw new ZipTooLargeError();

    const list = [...opened]; // close() empties `opened`; the generator keeps its own view (reads then fail with EBADF)
    async function* generate() {
      let offset = 0;
      for (const e of list) {
        e.offset = offset;
        const h = localHeader(e);
        offset += h.length;
        yield h;
        let pos = 0;
        let crc = 0;
        while (pos < e.size) {
          aborted(signal);
          const buf = Buffer.allocUnsafe(Math.min(CHUNK, e.size - pos)); // fresh: the consumer may still hold earlier chunks
          const { bytesRead } = await e.fh.read(buf, 0, buf.length, pos);
          if (bytesRead === 0) throw new Error('file shorter than expected');
          const chunk = bytesRead === buf.length ? buf : buf.subarray(0, bytesRead);
          crc = zlib.crc32(chunk, crc);
          pos += bytesRead;
          yield chunk;
        }
        offset += e.size;
        if ((crc >>> 0) !== e.crc) throw new Error('file changed while zipping'); // cut the response: the client sees a broken download
      }
      const cdOffset = offset;
      let cdSize = 0;
      for (const e of list) { const c = centralHeader(e); cdSize += c.length; yield c; }
      yield endRecord(list.length, cdSize, cdOffset);
    }

    return {
      size: total,
      stream: () => Readable.from(generate(), { objectMode: false, highWaterMark: CHUNK }),
      close,
    };
  } catch (err) {
    await close();
    throw err;
  }
}
