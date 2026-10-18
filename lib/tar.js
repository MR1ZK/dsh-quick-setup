/**
 * Minimal USTAR writer for plugin packs.
 *
 * We deliberately avoid adding a tar dependency to the DSH profile: the pack
 * contains ordinary files only (no hard links, devices or sparse data), which
 * is the subset USTAR covers. Long paths use GNU `LongLink` records so pnpm
 * and system tar can unpack what we produce.
 */

import { createReadStream, createWriteStream } from 'node:fs';
import { lstat, mkdir, readdir } from 'node:fs/promises';
import path from 'node:path';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { createGzip } from 'node:zlib';

const BLOCK = 512;
const MAX_FILE_SIZE = 1024 * 1024 * 1024;
const SKIPPED_NAMES = new Set([
  'node_modules',
  '.git',
  '.hg',
  '.svn',
  '.DS_Store',
  'Thumbs.db',
  '__pycache__',
]);

function toOctal(value, length) {
  const digits = Math.max(0, Math.floor(value)).toString(8);
  if (digits.length > length - 1) throw new Error(`tar field overflow: ${value}`);
  return `${'0'.repeat(length - 1 - digits.length)}${digits}\0`;
}

function makeHeader(name, options = {}) {
  const {
    mode = 0o644,
    size = 0,
    mtime = Math.floor(Date.now() / 1000),
    type = '0',
    prefix = '',
    linkname = '',
  } = options;
  const header = Buffer.alloc(BLOCK, 0);
  if (Buffer.isBuffer(name)) header.set(name.subarray(0, 100), 0);
  else header.write(name, 0, Math.min(Buffer.byteLength(name), 100), 'utf8');
  header.write(toOctal(mode, 8), 100, 8, 'latin1');
  header.write(toOctal(0, 8), 108, 8, 'latin1');
  header.write(toOctal(0, 8), 116, 8, 'latin1');
  header.write(toOctal(size, 12), 124, 12, 'latin1');
  header.write(toOctal(mtime, 12), 136, 12, 'latin1');
  header.fill(0x20, 148, 156);
  header.write(type, 156, 1, 'latin1');
  if (linkname) header.write(linkname, 157, Math.min(Buffer.byteLength(linkname), 100), 'utf8');
  header.write('ustar\0', 257, 6, 'latin1');
  header.write('00', 263, 2, 'latin1');
  header.write('root', 265, 4, 'latin1');
  header.write('root', 297, 4, 'latin1');
  header.write(toOctal(0, 8), 329, 8, 'latin1');
  header.write(toOctal(0, 8), 337, 8, 'latin1');
  if (prefix) header.write(prefix, 345, Math.min(Buffer.byteLength(prefix), 155), 'utf8');
  let checksum = 0;
  for (const byte of header) checksum += byte;
  const checksumText = checksum.toString(8).padStart(6, '0');
  header.write(checksumText, 148, 6, 'latin1');
  header[154] = 0;
  header[155] = 0x20;
  return header;
}

function paddingFor(size) {
  const remainder = size % BLOCK;
  return remainder === 0 ? Buffer.alloc(0) : Buffer.alloc(BLOCK - remainder);
}

function splitName(name) {
  if (Buffer.byteLength(name) <= 100) return { name, prefix: '' };
  if (Buffer.byteLength(name) > 255) return null;
  const parts = name.split('/');
  for (let index = parts.length - 1; index > 0; index -= 1) {
    const prefix = parts.slice(0, index).join('/');
    const rest = parts.slice(index).join('/');
    if (Buffer.byteLength(prefix) <= 155 && Buffer.byteLength(rest) <= 100) {
      return { name: rest, prefix };
    }
  }
  return null;
}

function safeMode(value) {
  const mode = value & 0o777;
  return mode === 0 ? 0o644 : mode;
}

async function collectTree(root, prefix) {
  const entries = [];
  const warnings = [];
  let bytes = 0;
  let files = 0;
  let symlinks = 0;

  async function walk(absolute, relative) {
    let info;
    try {
      info = await lstat(absolute);
    } catch (error) {
      warnings.push(`无法读取 ${relative || '.'}：${error.message}`);
      return;
    }
    if (info.isSymbolicLink()) {
      symlinks += 1;
      return;
    }
    const name = prefix
      ? relative
        ? `${prefix}/${relative}`
        : prefix
      : relative;
    if (info.isDirectory()) {
      if (name) {
        entries.push({
          type: 'dir',
          name: `${name}/`,
          mode: safeMode(info.mode) & 0o777,
          mtime: Math.floor(info.mtimeMs / 1000),
          size: 0,
        });
      }
      let children;
      try {
        children = await readdir(absolute, { withFileTypes: true });
      } catch (error) {
        warnings.push(`无法列出 ${relative || '.'}：${error.message}`);
        return;
      }
      children.sort((left, right) => left.name.localeCompare(right.name));
      for (const child of children) {
        if (SKIPPED_NAMES.has(child.name)) continue;
        await walk(
          path.join(absolute, child.name),
          relative ? `${relative}/${child.name}` : child.name,
        );
      }
      return;
    }
    if (!info.isFile()) return;
    if (info.size > MAX_FILE_SIZE) {
      warnings.push(`跳过超过 1 GiB 的文件 ${relative}`);
      return;
    }
    entries.push({
      type: 'file',
      absolute,
      name,
      mode: safeMode(info.mode),
      mtime: Math.floor(info.mtimeMs / 1000),
      size: info.size,
    });
    files += 1;
    bytes += info.size;
  }

  await walk(root, '');
  if (symlinks > 0) warnings.push(`跳过 ${symlinks} 个符号链接`);
  return { entries, warnings, bytes, files };
}

async function* fileChunks(entry) {
  let written = 0;
  if (entry.size > 0) {
    for await (const chunk of createReadStream(entry.absolute)) {
      if (written >= entry.size) break;
      const remaining = entry.size - written;
      const take = chunk.length > remaining ? chunk.subarray(0, remaining) : chunk;
      if (take.length > 0) {
        written += take.length;
        yield take;
      }
    }
  }
  while (written < entry.size) {
    const size = Math.min(64 * 1024, entry.size - written);
    written += size;
    yield Buffer.alloc(size);
  }
}

async function* emitHeader(entry) {
  const nameBuffer = Buffer.from(entry.name, 'utf8');
  let parts = splitName(entry.name);
  if (!parts) {
    const longName = Buffer.concat([nameBuffer, Buffer.from([0])]);
    yield makeHeader('././@LongLink', {
      type: 'L',
      size: longName.length,
      mode: 0o644,
      mtime: entry.mtime,
    });
    yield longName;
    yield paddingFor(longName.length);
    parts = { name: nameBuffer.subarray(0, 100), prefix: '' };
  }
  yield makeHeader(parts.name, {
    mode: entry.mode,
    size: entry.size,
    mtime: entry.mtime,
    type: entry.type === 'dir' ? '5' : '0',
    prefix: parts.prefix,
  });
}

async function* tarStream(entries, firstFiles) {
  const now = Math.floor(Date.now() / 1000);
  for (const file of firstFiles) {
    const data = Buffer.isBuffer(file.data) ? file.data : Buffer.from(String(file.data), 'utf8');
    const entry = {
      type: 'file',
      name: file.name,
      mode: 0o644,
      mtime: now,
      size: data.length,
    };
    yield* emitHeader(entry);
    yield data;
    yield paddingFor(data.length);
  }
  for (const entry of entries) {
    yield* emitHeader(entry);
    if (entry.type === 'file' && entry.size > 0) {
      yield* fileChunks(entry);
      yield paddingFor(entry.size);
    }
  }
  yield Buffer.alloc(BLOCK * 2);
}

/**
 * Write a gzipped tar archive.
 *
 * @param {string} destination absolute output path
 * @param {{firstFiles?: {name: string, data: Buffer|string}[], groups?: {root: string, prefix: string}[]}} options
 */
export async function writeTarGz(destination, options = {}) {
  const { firstFiles = [], groups = [] } = options;
  const entries = [];
  const warnings = [];
  let bytes = 0;
  let files = 0;
  for (const group of groups) {
    const collected = await collectTree(group.root, group.prefix ?? '');
    entries.push(...collected.entries);
    warnings.push(...collected.warnings);
    bytes += collected.bytes;
    files += collected.files;
  }
  await mkdir(path.dirname(destination), { recursive: true });
  await pipeline(
    Readable.from(tarStream(entries, firstFiles)),
    createGzip({ level: 6 }),
    createWriteStream(destination),
  );
  return { entries: entries.length, files, bytes, warnings };
}
