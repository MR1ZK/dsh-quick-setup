/**
 * dsh-quick-setup — plain-text plugin list (`.plugins.txt`).
 *
 * The text stays tiny and hand-editable:
 *
 *     # dsh-quick-setup/plugins@1
 *     # profile: desktop
 *     # dsh: 0.2.1-rc.2
 *     # exported: 2026-10-20T13:39:00.000Z
 *     dsh-music-player@1.2.3
 *     @scope/plugin@0.4.0
 *
 * A line holds `<name>` (install the `latest` tag) or `<name>@<version>`
 * (install exactly that version). Comment lines document where the list came
 * from; every other line is one package. Parsing is lenient about comments and
 * blank lines so the file can be edited by hand, but it refuses anything that
 * is not a plain npm package name plus an exact version or dist-tag.
 *
 * This module never touches the filesystem or the clock, so it is safe to
 * exercise offline from `scripts/smoke.mjs`.
 */

export const LIST_FORMAT = 'dsh-quick-setup/plugins';
export const LIST_VERSION = 1;
export const MAX_LIST_BYTES = 1024 * 1024;
export const MAX_LIST_ENTRIES = 1000;

const FORMAT_LINE = new RegExp(
  `^#\\s*${LIST_FORMAT.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}@(\\d+)\\s*$`,
);
const META_LINE = /^#\s*([A-Za-z][A-Za-z0-9_-]*)\s*:\s*(.+?)\s*$/;
const NAME = /^(?:@[a-z0-9][a-z0-9._~-]*\/)?[a-z0-9][a-z0-9._~-]*$/;
const EXACT_VERSION = /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/;
const DIST_TAG = /^[a-z][a-z0-9._-]*$/;

/** A valid, lowercase npm registry package name (`name` or `@scope/name`). */
export function isNpmName(value) {
  return typeof value === 'string' && value.length <= 214 && NAME.test(value);
}

/** An exact semver such as `1.2.3` or `0.2.0-rc.1`; ranges are not accepted. */
export function isExactVersion(value) {
  return typeof value === 'string' && EXACT_VERSION.test(value);
}

/** A dist-tag such as `latest` or `next`. */
export function isDistTag(value) {
  return typeof value === 'string' && DIST_TAG.test(value);
}

/** The npm spec a list entry installs: `name@version`, or `name` for latest. */
export function specOf(entry) {
  if (!entry || typeof entry.name !== 'string') throw new Error('插件条目缺少包名');
  return typeof entry.version === 'string' && entry.version !== ''
    ? `${entry.name}@${entry.version}`
    : entry.name;
}

function oneLine(value) {
  return String(value).replace(/[\r\n]+/g, ' ').trim();
}

/**
 * Render installed plugins as list text.
 *
 * @param {object} options
 * @param {Array<{name: string, version?: string | null}>} options.entries
 * @param {boolean} [options.withVersion] write `name@version` (true) or bare names
 * @param {{profile?: string, dshVersion?: string}} [options.env] source comment lines
 * @returns {string}
 */
export function formatPluginList({ entries, withVersion = true, env = {} }) {
  if (!Array.isArray(entries)) throw new Error('没有要写入的插件');
  const lines = [`# ${LIST_FORMAT}@${String(LIST_VERSION)}`];
  if (env.profile) lines.push(`# profile: ${oneLine(env.profile)}`);
  if (env.dshVersion) lines.push(`# dsh: ${oneLine(env.dshVersion)}`);
  lines.push(`# exported: ${new Date().toISOString()}`);
  for (const entry of entries) {
    if (!isNpmName(entry?.name)) continue;
    const version =
      withVersion && typeof entry.version === 'string' && entry.version.trim() !== ''
        ? entry.version.trim()
        : null;
    lines.push(version ? `${entry.name}@${version}` : entry.name);
  }
  return `${lines.join('\n')}\n`;
}

function splitEntry(line) {
  const at = line.lastIndexOf('@');
  if (at <= 0) return { name: line, version: null };
  return { name: line.slice(0, at), version: line.slice(at + 1) };
}

/**
 * Parse list text into entries.
 *
 * Throws when nothing usable is found (a random text file, for example) and
 * collects skipped lines as warnings instead of failing the whole import.
 *
 * @param {string} text
 * @returns {{formatVersion: number, source: {profile: string | null, dshVersion: string | null, exportedAt: string | null}, entries: Array<{name: string, version: string | null}>, warnings: string[]}}
 */
export function parsePluginList(text) {
  if (typeof text !== 'string') throw new Error('插件清单必须是文本');
  const source = { profile: null, dshVersion: null, exportedAt: null };
  const entries = [];
  const seen = new Set();
  const warnings = [];
  let formatVersion = LIST_VERSION;

  const lines = text.replace(/^\uFEFF/, '').split(/\r?\n/);
  for (let index = 0; index < lines.length; index += 1) {
    let line = lines[index];
    const hash = line.indexOf('#');
    if (hash === 0) {
      const format = FORMAT_LINE.exec(line);
      if (format) {
        const version = Number(format[1]);
        if (version > LIST_VERSION) {
          throw new Error(
            `插件清单格式版本 ${version} 高于当前插件支持的 ${LIST_VERSION}，请先升级 dsh-quick-setup`,
          );
        }
        formatVersion = version;
        continue;
      }
      const meta = META_LINE.exec(line);
      if (meta) {
        const key = meta[1].toLowerCase();
        const value = meta[2].trim();
        if (key === 'profile') source.profile = value;
        else if (key === 'dsh') source.dshVersion = value;
        else if (key === 'exported') source.exportedAt = value;
      }
      continue;
    }
    if (hash > 0) line = line.slice(0, hash);
    line = line.trim();
    if (line === '') continue;

    if (entries.length >= MAX_LIST_ENTRIES) {
      throw new Error(`插件清单条目超过 ${MAX_LIST_ENTRIES} 条限制`);
    }
    const { name, version } = splitEntry(line);
    if (!isNpmName(name)) {
      warnings.push(`第 ${index + 1} 行不是有效的 npm 包名，已忽略：${line}`);
      continue;
    }
    if (version !== null) {
      if (version === '') {
        warnings.push(`第 ${index + 1} 行缺少版本号，已忽略：${line}`);
        continue;
      }
      if (!isExactVersion(version) && !isDistTag(version)) {
        warnings.push(
          `第 ${index + 1} 行的版本 “${version}” 不是精确版本或 dist-tag，已忽略：${line}`,
        );
        continue;
      }
    }
    if (seen.has(name)) {
      const previous = entries.find((entry) => entry.name === name);
      const detail =
        previous?.version === version
          ? ''
          : `（已记录 ${previous?.version ? `@${previous.version}` : 'latest'}，本次忽略）`;
      warnings.push(`第 ${index + 1} 行重复：${name}${detail}`);
      continue;
    }
    seen.add(name);
    entries.push({ name, version });
  }

  if (entries.length === 0) {
    throw new Error('清单里没有可识别的插件，请确认文件是 dsh-quick-setup 导出的 .plugins.txt');
  }
  return { formatVersion, source, entries, warnings };
}
