/**
 * Streaming gzip/tar extractor for imported plugin packs.
 *
 * Extraction is the only place where bytes from another machine become files,
 * so paths are confined to the destination directory, links are never
 * materialised, and the total expanded size is capped.
 */

import { createReadStream } from 'node:fs';
import { chmod, mkdir, open } from 'node:fs/promises';
import path from 'node:path';
import { createGunzip } from 'node:zlib';

const BLOCK = 512;
const MAX_EXPANDED = 4 * 1024 * 1024 * 1024;
const MAX_ENTRIES = 200000;

class ByteQueue {
  constructor(iterable) {
    this.iterator = iterable[Symbol.asyncIterator]();
    this.chunks = [];
    this.length = 0;
    this.ended = false;
  }

  async fill() {
    if (this.ended) return false;
    const step = await this.iterator.next();
    if (step.done) {
      this.ended = true;
      return false;
    }
    const chunk = Buffer.isBuffer(step.value) ? step.value : Buffer.from(step.value);
    if (chunk.length > 0) {
      this.chunks.push(chunk);
      this.length += chunk.length;
    }
    return true;
  }

  async read(length) {
    if (length === 0) return Buffer.alloc(0);
    while (this.length < length) {
      if (!(await this.fill())) return null;
    }
    const output = Buffer.allocUnsafe(length);
    let offset = 0;
    while (offset < length) {
      const chunk = this.chunks[0];
      const take = Math.min(chunk.length, length - offset);
      chunk.copy(output, offset, 0, take);
      offset += take;
      this.length -= take;
      if (take === chunk.length) this.chunks.shift();
      else this.chunks[0] = chunk.subarray(take);
    }
    return output;
  }

  async readSome(max) {
    if (this.length === 0 && !(await this.fill())) return null;
    const chunk = this.chunks[0];
    const take = Math.min(chunk.length, max);
    const output = take === chunk.length ? chunk : chunk.subarray(0, take);
    this.length -= take;
    if (take === chunk.length) this.chunks.shift();
    else this.chunks[0] = chunk.subarray(take);
    return output;
  }

  async discard(length) {
    let remaining = length;
    while (remaining > 0) {
      const chunk = await this.readSome(Math.min(remaining, 1024 * 1024));
      if (!chunk) throw new Error('tar 数据提前结束');
      remaining -= chunk.length;
    }
  }
}

function readString(buffer, offset, length) {
  const slice = buffer.subarray(offset, offset + length);
  const zero = slice.indexOf(0);
  return slice.subarray(0, zero === -1 ? slice.length : zero).toString('utf8');
}

function readOctal(buffer, offset, length) {
  if (buffer[offset] & 0x80) {
    let value = buffer[offset] & 0x7f;
    for (let index = 1; index < length; index += 1) value = value * 256 + buffer[offset + index];
    return value;
  }
  const text = readString(buffer, offset, length).trim();
  if (!text) return 0;
  const parsed = Number.parseInt(text, 8);
  return Number.isFinite(parsed) ? parsed : 0;
}

function paddingFor(size) {
  const remainder = size % BLOCK;
  return remainder === 0 ? 0 : BLOCK - remainder;
}

function resolveInside(root, name) {
  const normalized = name
    .replace(/\\/g, '/')
    .replace(/^\.\/+/, '')
    .replace(/^\/+/, '')
    .replace(/\/+$/, '');
  if (!normalized) return null;
  const parts = normalized.split('/');
  if (parts.some((part) => part === '..' || part === '')) {
    throw new Error(`插件包包含非法路径：${name}`);
  }
  const full = path.resolve(root, normalized);
  if (full !== root && !full.startsWith(`${root}${path.sep}`)) {
    throw new Error(`插件包路径越界：${name}`);
  }
  return full;
}

function parsePax(data) {
  const fields = new Map();
  let offset = 0;
  while (offset < data.length) {
    const space = data.indexOf(0x20, offset);
    if (space === -1) break;
    const length = Number.parseInt(data.toString('latin1', offset, space), 10);
    if (!Number.isFinite(length) || length <= 0) break;
    const record = data.subarray(space + 1, offset + length - 1);
    const equals = record.indexOf(0x3d);
    if (equals > 0) {
      fields.set(
        record.subarray(0, equals).toString('utf8'),
        record.subarray(equals + 1).toString('utf8'),
      );
    }
    offset += length;
  }
  return fields;
}

/**
 * Extract `archive` into `destination`.
 *
 * @param {string} archive absolute .tgz path
 * @param {string} destination absolute directory (created when missing)
 */
export async function extractTarGz(archive, destination) {
  const root = path.resolve(destination);
  await mkdir(root, { recursive: true });
  const queue = new ByteQueue(createReadStream(archive).pipe(createGunzip()));
  const stats = { files: 0, directories: 0, bytes: 0, skippedLinks: 0, skippedEntries: 0 };
  let longName = '';
  let paxPath = '';
  let paxSize = null;
  let entries = 0;

  for (;;) {
    const header = await queue.read(BLOCK);
    if (!header) break;
    if (header.every((byte) => byte === 0)) break;
    entries += 1;
    if (entries > MAX_ENTRIES) throw new Error('插件包条目过多');

    const expectedChecksum = readOctal(header, 148, 8);
    let checksum = 0;
    for (let index = 0; index < BLOCK; index += 1) {
      checksum += index >= 148 && index < 156 ? 0x20 : header[index];
    }
    if (expectedChecksum !== 0 && checksum !== expectedChecksum) {
      throw new Error('插件包 tar 头校验失败');
    }

    const type = header.toString('latin1', 156, 157);
    const size = paxSize ?? readOctal(header, 124, 12);
    let name = readString(header, 0, 100);
    const prefix = readString(header, 345, 155);
    if (prefix) name = `${prefix}/${name}`;

    if (type === 'L') {
      const data = await queue.read(size);
      if (!data) throw new Error('插件包长文件名数据缺失');
      longName = readString(data, 0, data.length);
      await queue.discard(paddingFor(size));
      continue;
    }
    if (type === 'K') {
      await queue.discard(size + paddingFor(size));
      continue;
    }
    if (type === 'x' || type === 'g') {
      const data = type === 'x' ? await queue.read(size) : null;
      if (type === 'x' && data) {
        const fields = parsePax(data);
        if (fields.has('path')) paxPath = fields.get('path');
        if (fields.has('size')) paxSize = Number.parseInt(fields.get('size'), 10);
      } else {
        await queue.discard(size);
      }
      await queue.discard(paddingFor(size));
      continue;
    }

    if (longName) {
      name = longName;
      longName = '';
    } else if (paxPath) {
      name = paxPath;
      paxPath = '';
    }
    paxSize = null;

    if (!name) {
      await queue.discard(size + paddingFor(size));
      continue;
    }

    const target = resolveInside(root, name);
    if (!target) {
      await queue.discard(size + paddingFor(size));
      continue;
    }

    if (type === '5') {
      await mkdir(target, { recursive: true });
      const mode = readOctal(header, 100, 8) & 0o777;
      if (mode) await chmod(target, mode).catch(() => {});
      stats.directories += 1;
      await queue.discard(size + paddingFor(size));
      continue;
    }

    if (type === '1' || type === '2' || type === '3' || type === '4' || type === '6') {
      stats.skippedLinks += 1;
      await queue.discard(size + paddingFor(size));
      continue;
    }

    if (type !== '0' && type !== '7' && type !== '') {
      stats.skippedEntries += 1;
      await queue.discard(size + paddingFor(size));
      continue;
    }

    stats.bytes += size;
    if (stats.bytes > MAX_EXPANDED) throw new Error('插件包解压后超过 4 GiB 限制');
    await mkdir(path.dirname(target), { recursive: true });
    const handle = await open(target, 'w', 0o644);
    try {
      let remaining = size;
      while (remaining > 0) {
        const chunk = await queue.readSome(Math.min(remaining, 1024 * 1024));
        if (!chunk) throw new Error('插件包文件数据提前结束');
        await handle.write(chunk);
        remaining -= chunk.length;
      }
    } finally {
      await handle.close();
    }
    const mode = readOctal(header, 100, 8) & 0o777;
    if (mode) await chmod(target, mode).catch(() => {});
    stats.files += 1;
    await queue.discard(paddingFor(size));
  }

  return stats;
}
