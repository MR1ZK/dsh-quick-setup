/**
 * dsh-quick-setup — plugin config backup (`cordis.patch.yml` entries).
 *
 * DSH persists plugin configuration as entries in the profile patch file
 * (`<profile>/cordis.patch.yml`): each entry names a plugin and carries its
 * `config:` object. The official config editor writes those entries, so they
 * are the portable part of a plugin's configuration: bundled defaults live in
 * the plugin itself, while user changes end up here.
 *
 * This module copies matching entries verbatim (`yaml`) so comments and `!!js`
 * expressions survive a round trip without a YAML parser dependency. Entries
 * are matched by name, including subpath entries such as `dsh-ops/shell`
 * belonging to the `dsh-ops` package.
 *
 * The module never touches the filesystem or the clock, so `scripts/smoke.mjs`
 * can exercise it offline.
 */

import { Buffer } from 'node:buffer';

export const CONFIG_FORMAT = 'dsh-quick-setup-config';
export const CONFIG_VERSION = 1;
export const MAX_CONFIG_BYTES = 512 * 1024;
export const MAX_CONFIG_ENTRY_BYTES = 128 * 1024;
export const MAX_CONFIG_ENTRIES = 200;

const ENTRY_START = /^-(?:[ \t]|$)/;
const ENTRY_KEY = /^ {2}([A-Za-z0-9_.$@/-]+):(?:[ \t]|$)/;
const ENTRY_NAME_VALUE = /^ {2}name:[ \t]*([\s\S]*)$/;
const ENTRY_ID_VALUE = /^ {2}id:[ \t]*([\s\S]*)$/;
const PACKAGE_NAME = /^(?:@[A-Za-z0-9][\w.~-]*\/)?[A-Za-z0-9][\w.~-]*(?:\/[A-Za-z0-9][\w.~-]*)*$/;

/** Reads a YAML scalar roughly: quotes, comments and escaped doubles. */
function scalar(raw) {
  const value = String(raw).trim();
  if (value === '') return '';
  if (value.length >= 2 && value.startsWith('"') && value.endsWith('"')) {
    try {
      return JSON.parse(value);
    } catch {
      return value.slice(1, -1);
    }
  }
  if (value.length >= 2 && value.startsWith("'") && value.endsWith("'")) {
    return value.slice(1, -1).replace(/''/g, "'");
  }
  return value.replace(/\s+#.*$/, '').trim();
}

function parseEntry(lines) {
  const rawLines = lines.slice();
  while (rawLines.length > 1 && rawLines[rawLines.length - 1].trim() === '') rawLines.pop();
  const entry = { raw: rawLines.join('\n'), id: null, name: null, hasConfig: false, disabled: false };
  const first = /^-([ \t]+)([A-Za-z0-9_.$@/-]+):(.*)$/.exec(rawLines[0]);
  if (first) {
    const key = first[2];
    const value = scalar(first[3]);
    if (key === 'id') entry.id = value || null;
    else if (key === 'name') entry.name = value || null;
  }
  for (const line of rawLines.slice(1)) {
    const keyMatch = ENTRY_KEY.exec(line);
    if (!keyMatch) continue;
    if (keyMatch[1] === 'config') entry.hasConfig = true;
    if (keyMatch[1] === 'disabled') {
      const value = scalar(line.slice(line.indexOf(':') + 1));
      entry.disabled = value === 'true';
    }
    const nameMatch = ENTRY_NAME_VALUE.exec(line);
    if (nameMatch) entry.name = scalar(nameMatch[1]) || null;
    const idMatch = ENTRY_ID_VALUE.exec(line);
    if (idMatch) entry.id = scalar(idMatch[1]) || null;
  }
  return entry;
}

/**
 * Splits a patch file into its preamble (leading comments and blank lines) and
 * its top-level YAML sequence entries. An entry starts at a `-` in column 0;
 * continuation lines belong to the previous entry.
 */
export function splitPatchEntries(text) {
  const lines = String(text ?? '').split(/\r?\n/);
  const preamble = [];
  const blocks = [];
  let current = null;
  for (const line of lines) {
    if (ENTRY_START.test(line)) {
      if (current) blocks.push(current);
      current = [line];
    } else if (current) {
      current.push(line);
    } else {
      preamble.push(line);
    }
  }
  if (current) blocks.push(current);
  return { preamble, entries: blocks.map(parseEntry) };
}

/** True when `entryName` is `pluginName` itself or a subpath of that package. */
export function belongsTo(entryName, pluginName) {
  return entryName === pluginName || entryName.startsWith(`${pluginName}/`);
}

function ownerOf(entryName, pluginNames) {
  if (typeof entryName !== 'string' || entryName === '') return null;
  for (const pluginName of pluginNames) {
    if (belongsTo(entryName, pluginName)) return pluginName;
  }
  return null;
}

/**
 * Copies the patch entries that configure any of `pluginNames`. Entries without
 * a `config:` key and without `disabled: true` are skipped: they carry no
 * user-visible configuration to back up.
 */
export function extractPluginConfig(text, pluginNames) {
  const names = Array.isArray(pluginNames) ? pluginNames.filter((name) => typeof name === 'string') : [];
  if (names.length === 0) return [];
  const { entries } = splitPatchEntries(text);
  const picked = [];
  const seen = new Set();
  for (const entry of entries) {
    if (!entry.name) continue;
    if (!entry.hasConfig && !entry.disabled) continue;
    const plugin = ownerOf(entry.name, names);
    if (!plugin) continue;
    const key = entry.id ? `id:${entry.id}` : `name:${entry.name}`;
    if (seen.has(key)) continue;
    seen.add(key);
    picked.push({
      id: entry.id,
      name: entry.name,
      plugin,
      yaml: entry.raw,
      bytes: Buffer.byteLength(entry.raw, 'utf8'),
    });
  }
  return picked;
}

/** Returns the backed-up entries belonging to one plugin. */
export function configEntriesOf(entries, pluginName) {
  if (!Array.isArray(entries)) return [];
  return entries.filter((entry) => entry && typeof entry.name === 'string' && belongsTo(entry.name, pluginName));
}

/** Drops the `bytes` helper field; manifests only carry id/name/yaml. */
export function toManifestEntries(entries) {
  return entries.map((entry) => ({ id: entry.id ?? null, name: entry.name, yaml: entry.yaml }));
}

/**
 * Validates imported config entries: known names, size caps and YAML that looks
 * like a patch entry. Returns a normalized `{format, version, entries}` object,
 * or null when the pack carries no config.
 */
export function normalizeConfig(config, pluginNames) {
  if (config === undefined || config === null) return null;
  if (typeof config !== 'object' || Array.isArray(config)) throw new Error('插件包配置字段格式无效');
  const input = config.entries;
  if (!Array.isArray(input)) throw new Error('插件包配置缺少 entries');
  if (input.length > MAX_CONFIG_ENTRIES) throw new Error(`插件包配置条目超过 ${MAX_CONFIG_ENTRIES} 条`);
  const names = Array.isArray(pluginNames) ? pluginNames : [];
  const entries = [];
  const seen = new Set();
  let total = 0;
  for (const item of input) {
    if (!item || typeof item !== 'object') throw new Error('插件包配置条目格式无效');
    const name = item.name;
    const yaml = item.yaml;
    if (typeof name !== 'string' || typeof yaml !== 'string') {
      throw new Error('插件包配置条目缺少 name 或 yaml');
    }
    if (!PACKAGE_NAME.test(name)) throw new Error(`插件包配置条目名称无效：${name}`);
    if (!ENTRY_START.test(yaml)) throw new Error(`插件包配置条目不是补丁条目：${name}`);
    const bytes = Buffer.byteLength(yaml, 'utf8');
    if (bytes > MAX_CONFIG_ENTRY_BYTES) throw new Error(`插件包配置条目过大：${name}`);
    total += bytes;
    if (total > MAX_CONFIG_BYTES) throw new Error('插件包配置总大小超过上限');
    const plugin = ownerOf(name, names);
    if (names.length > 0 && !plugin) throw new Error(`插件包配置条目 ${name} 不属于包内插件`);
    const key = typeof item.id === 'string' && item.id !== '' ? `id:${item.id}` : `name:${name}`;
    if (seen.has(key)) continue;
    seen.add(key);
    entries.push({ id: typeof item.id === 'string' && item.id !== '' ? item.id : null, name, yaml });
  }
  return { format: CONFIG_FORMAT, version: CONFIG_VERSION, entries };
}

/**
 * Appends copied entries to a profile patch file, skipping any entry whose id
 * or name is already present in the target. A lone `[]` empty-list marker is
 * replaced by the new entries, so an empty patch stays a valid document.
 *
 * Returns `{ text, appended, skipped }` where `appended`/`skipped` count entries.
 */
export function mergePatchEntries(text, entries) {
  const source = String(text ?? '');
  const eol = source.includes('\r\n') ? '\r\n' : '\n';
  const { preamble, entries: existing } = splitPatchEntries(source);
  const keys = new Set();
  for (const entry of existing) {
    if (entry.id) keys.add(`id:${entry.id}`);
    if (entry.name) keys.add(`name:${entry.name}`);
  }
  const appended = [];
  let skipped = 0;
  for (const entry of Array.isArray(entries) ? entries : []) {
    if (!entry || typeof entry.yaml !== 'string' || !ENTRY_START.test(entry.yaml)) continue;
    const idKey = entry.id ? `id:${entry.id}` : null;
    const nameKey = entry.name ? `name:${entry.name}` : null;
    if ((idKey && keys.has(idKey)) || (nameKey && keys.has(nameKey))) {
      skipped += 1;
      continue;
    }
    if (idKey) keys.add(idKey);
    if (nameKey) keys.add(nameKey);
    appended.push(entry.yaml);
  }

  if (appended.length === 0) return { text: source, appended: 0, skipped };

  const head = preamble
    .filter((line) => line.trim() !== '[]')
    .join(eol)
    .replace(/\s+$/, '');
  // Existing entries are copied back verbatim; only the empty `[]` marker is
  // dropped so the result stays a single top-level sequence.
  const toEol = (block) => block.split('\n').join(eol);
  const kept = existing.map((entry) => toEol(entry.raw));
  const lines = [];
  if (head !== '') lines.push(head);
  if (kept.length > 0) lines.push(kept.join(eol));
  lines.push(appended.map(toEol).join(eol));
  return { text: `${lines.join(eol)}${eol}`, appended: appended.length, skipped };
}
