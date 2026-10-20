/**
 * dsh-quick-setup — Host half.
 *
 * Exposes four same-origin endpoints used by the settings page:
 *   GET  /dsh-quick-setup/api/status   environment + installed third-party bundles
 *   GET  /dsh-quick-setup/api/export   stream a .dshpack.tgz, or a .plugins.txt list
 *   POST /dsh-quick-setup/api/upload   receive and inspect a pack or a plugin list
 *   POST /dsh-quick-setup/api/install  install one selected pack or list entry
 *
 * Two export formats share the endpoints. A pack carries each plugin's code and
 * installs from a local tarball; a plugin list carries only names and versions
 * (`name@version`, or `name` for the `latest` tag) and installs every entry
 * from the npm registry through `pluginManager.installBundle(spec)`.
 *
 * The UI installs entries one request at a time. Installing a bundle makes DSH
 * hot-reload the composition (and therefore this plugin), so a long-lived
 * server-side batch job would lose its state after the first successful entry.
 *
 * All package mutations go through the official `pluginManager` service; this
 * plugin never edits the profile manifest, runs a package manager itself, or
 * installs anything without a user confirmation in the Web UI.
 */

import { createReadStream, createWriteStream, readFileSync } from 'node:fs';
import { mkdir, readFile, readdir, realpath, rm, stat, unlink, writeFile } from 'node:fs/promises';
import { randomBytes } from 'node:crypto';
import path from 'node:path';
import { Transform } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { writeTarGz } from './lib/tar.js';
import { extractTarGz } from './lib/tar-extract.js';
import { compareVersions, isValidRange, satisfies } from './lib/range.js';
import {
  LIST_FORMAT,
  LIST_VERSION,
  MAX_LIST_BYTES,
  formatPluginList,
  parsePluginList,
  specOf,
} from './lib/plugin-list.js';

const SELF = 'dsh-quick-setup';
const PACK_FORMAT = 'dsh-quick-setup-pack';
const PACK_VERSION = 1;
const API_PREFIX = '/dsh-quick-setup/api';
const MAX_UPLOAD = 1024 * 1024 * 1024;
const MAX_MANIFEST = 4 * 1024 * 1024;
const UPLOAD_TTL = 24 * 60 * 60 * 1000;
const INSPECT_TIMEOUT = 15000;
const INSPECT_CONCURRENCY = 4;

export const name = SELF;
export const inject = ['webServer', 'pluginManager', 'profileContext'];

function json(response, status, value) {
  const body = JSON.stringify(value);
  response.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store',
    'x-content-type-options': 'nosniff',
  });
  response.end(body);
}

function fail(response, status, message) {
  json(response, status, { ok: false, error: message });
}

function safeName(value) {
  return String(value).replace(/[^0-9A-Za-z._-]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 80) || 'pack';
}

function stamp() {
  const date = new Date();
  const pad = (value) => String(value).padStart(2, '0');
  return `${date.getFullYear()}${pad(date.getMonth() + 1)}${pad(date.getDate())}-${pad(date.getHours())}${pad(date.getMinutes())}`;
}

function errorInfo(error) {
  if (!error) return null;
  return {
    code: error.code ?? null,
    message: error.message ?? String(error),
    diagnostic: error.diagnostic ?? null,
    incompatible: Array.isArray(error.incompatible) ? error.incompatible : null,
  };
}

function readJsonFileSync(filename) {
  try {
    return JSON.parse(readFileSync(filename, 'utf8'));
  } catch {
    return null;
  }
}

function dshPeers(pkg) {
  const peers = {};
  const source = pkg?.peerDependencies;
  if (!source || typeof source !== 'object') return peers;
  for (const [key, range] of Object.entries(source)) {
    if (key === '@deepseek-ai/dsh' || key.startsWith('@deepseek-ai/dsh-')) peers[key] = range;
  }
  return peers;
}

function requirementsOf(pkg) {
  return {
    engines: pkg?.engines && typeof pkg.engines === 'object' ? pkg.engines : null,
    peers: dshPeers(pkg),
    os: Array.isArray(pkg?.os) ? pkg.os : null,
    cpu: Array.isArray(pkg?.cpu) ? pkg.cpu : null,
  };
}

function listAllows(list, value) {
  if (!Array.isArray(list) || list.length === 0) return true;
  const names = list.filter((entry) => typeof entry === 'string');
  const blocked = names.filter((entry) => entry.startsWith('!')).map((entry) => entry.slice(1));
  if (blocked.includes(value)) return false;
  const allowed = names.filter((entry) => !entry.startsWith('!'));
  return allowed.length === 0 || allowed.includes(value);
}

function compatibilityOf(pkg, env) {
  const reasons = [];
  const warnings = [];
  const engines = pkg?.engines && typeof pkg.engines === 'object' ? pkg.engines : null;
  const peers = dshPeers(pkg);

  if (engines && Object.hasOwn(engines, 'dsh')) {
    const range = engines.dsh;
    if (typeof range !== 'string') {
      reasons.push('package.json 的 engines.dsh 必须是字符串');
    } else if (!isValidRange(range)) {
      reasons.push(`无法解析 engines.dsh：${range || '(空)'}`);
    } else if (env.dshVersion && !satisfies(env.dshVersion, range)) {
      reasons.push(`需要 DSH ${range}，当前 ${env.dshVersion}`);
    }
  } else if (Object.keys(peers).length > 0) {
    for (const [peer, range] of Object.entries(peers)) {
      if (typeof range !== 'string' || range.trim() === '') {
        reasons.push(`${peer} 的版本范围为空`);
        continue;
      }
      const effective = ['workspace:^', 'workspace:~', 'workspace:*'].includes(range)
        ? env.dshVersion
        : range;
      if (!isValidRange(effective)) {
        reasons.push(`无法解析 ${peer} 的版本范围：${range}`);
      } else if (env.dshVersion && !satisfies(env.dshVersion, effective)) {
        reasons.push(`需要 ${peer} ${range}，当前 DSH ${env.dshVersion}`);
      }
    }
  }

  if (engines && typeof engines.node === 'string' && engines.node.trim()) {
    if (!isValidRange(engines.node)) {
      warnings.push(`无法解析 engines.node：${engines.node}`);
    } else if (!satisfies(env.node, engines.node)) {
      reasons.push(`需要 Node ${engines.node}，当前 ${env.node}`);
    }
  }
  if (Array.isArray(pkg?.os) && pkg.os.length > 0 && !listAllows(pkg.os, env.platform)) {
    reasons.push(`仅支持操作系统 ${pkg.os.join(', ')}，当前 ${env.platform}`);
  }
  if (Array.isArray(pkg?.cpu) && pkg.cpu.length > 0 && !listAllows(pkg.cpu, env.arch)) {
    reasons.push(`仅支持 CPU ${pkg.cpu.join(', ')}，当前 ${env.arch}`);
  }

  return { ok: reasons.length === 0, reasons, warnings };
}

function isInside(root, target) {
  const relative = path.relative(root, target);
  return relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative));
}

export function apply(ctx) {
  const webServer = ctx.get('webServer');
  const pluginManager = ctx.get('pluginManager');
  const profile = ctx.get('profileContext');
  const cacheRoot = path.join(profile.dir, '.dsh-quick-setup');

  const env = (() => {
    const installManifest = readJsonFileSync(profile.installAnchor) ?? {};
    return {
      dshVersion: typeof installManifest.version === 'string' ? installManifest.version : null,
      dshName: typeof installManifest.name === 'string' ? installManifest.name : null,
      profile: profile.name ?? path.basename(profile.dir),
      platform: process.platform,
      arch: process.arch,
      node: process.versions.node,
      electron: process.versions.electron ?? null,
      generatedAt: new Date().toISOString(),
    };
  })();

  function originAllowed(request) {
    const origin = request.headers.origin;
    if (origin) {
      let expected = null;
      try {
        expected = webServer.getOrigin();
      } catch {
        expected = null;
      }
      if (expected && origin !== expected) return false;
    }
    const site = request.headers['sec-fetch-site'];
    if (site && site !== 'same-origin' && site !== 'none') return false;
    return true;
  }

  function postAllowed(request) {
    return originAllowed(request) && request.headers['x-dsh-quick-setup'] === '1';
  }

  function readBody(request, limit) {
    return new Promise((resolve, reject) => {
      const chunks = [];
      let total = 0;
      request.on('data', (chunk) => {
        total += chunk.length;
        if (total > limit) {
          reject(new Error('请求体过大'));
          request.destroy();
          return;
        }
        chunks.push(chunk);
      });
      request.on('end', () => resolve(Buffer.concat(chunks)));
      request.on('error', reject);
    });
  }

  function readJsonBody(request, limit = 1024 * 1024) {
    return readBody(request, limit).then((buffer) => {
      try {
        return JSON.parse(buffer.toString('utf8'));
      } catch {
        throw new Error('请求不是合法 JSON');
      }
    });
  }

  /**
   * Stream the request body to `destination` and decide from its first bytes
   * whether it is a gzip pack or a UTF-8 plugin list. The size limit follows
   * that decision, so a text list can never fill the disk.
   *
   * @returns {Promise<{kind: 'pack' | 'list', bytes: number}>}
   */
  async function receiveUpload(request, destination) {
    let total = 0;
    let kind = null;
    const limiter = new Transform({
      transform(chunk, _encoding, callback) {
        if (kind === null && chunk.length >= 2) {
          kind = chunk[0] === 0x1f && chunk[1] === 0x8b ? 'pack' : 'list';
        }
        total += chunk.length;
        const limit = kind === 'list' ? MAX_LIST_BYTES : MAX_UPLOAD;
        if (total > limit) {
          const message =
            kind === 'list' ? '插件清单超过 1 MiB 限制' : '插件包超过 1 GiB 限制';
          callback(Object.assign(new Error(message), { statusCode: 413 }));
          return;
        }
        callback(null, chunk);
      },
    });
    await pipeline(request, limiter, createWriteStream(destination));
    return { kind: kind ?? 'list', bytes: total };
  }

  async function readMetaFile(work) {
    try {
      return JSON.parse(await readFile(path.join(work, 'meta.json'), 'utf8'));
    } catch {
      return null;
    }
  }

  async function resolvePackageDir(bundleName) {
    const candidates = [
      path.join(profile.dir, 'node_modules', ...bundleName.split('/')),
      path.join(path.dirname(profile.installAnchor), 'node_modules', ...bundleName.split('/')),
    ];
    for (const candidate of candidates) {
      try {
        const resolved = await realpath(candidate);
        const info = await stat(resolved);
        if (info.isDirectory()) return resolved;
      } catch {
        // Try the next candidate.
      }
    }
    return null;
  }

  async function listThirdParty() {
    let bundles;
    try {
      bundles = await pluginManager.listBundles();
    } catch (error) {
      throw new Error(`读取插件列表失败：${error.message}`);
    }
    const rows = [];
    for (const bundle of bundles) {
      if (!bundle?.installed || bundle.official) continue;
      if (bundle.availability === 'installation') continue;
      if (typeof bundle.name !== 'string' || bundle.name === SELF) continue;
      const dir = await resolvePackageDir(bundle.name);
      if (!dir) continue;
      let pkg = null;
      try {
        pkg = JSON.parse(await readFile(path.join(dir, 'package.json'), 'utf8'));
      } catch {
        continue;
      }
      if (pkg.name !== bundle.name) continue;
      const metaTitle = bundle.meta?.title;
      const title =
        typeof metaTitle === 'string'
          ? metaTitle
          : metaTitle && typeof metaTitle === 'object'
            ? (metaTitle.zh ?? metaTitle.en ?? null)
            : null;
      rows.push({
        name: bundle.name,
        version: typeof pkg.version === 'string' ? pkg.version : (bundle.version ?? null),
        description: typeof pkg.description === 'string' ? pkg.description : (bundle.description ?? null),
        title,
        enabled: bundle.enabled !== false,
        installed: true,
        available: true,
      });
    }
    rows.sort((left, right) => left.name.localeCompare(right.name));
    return rows;
  }

  async function installedMap() {
    try {
      const bundles = await pluginManager.listBundles();
      return new Map(bundles.map((bundle) => [bundle.name, bundle]));
    } catch {
      return new Map();
    }
  }

  async function cleanupOld(directory, maxAge) {
    let entries;
    try {
      entries = await readdir(directory, { withFileTypes: true });
    } catch {
      return;
    }
    const cutoff = Date.now() - maxAge;
    for (const entry of entries) {
      const full = path.join(directory, entry.name);
      try {
        const info = await stat(full);
        if (info.mtimeMs < cutoff) await rm(full, { recursive: true, force: true });
      } catch {
        // Ignore a file that disappeared or is locked.
      }
    }
  }

  async function handleStatus(request, response) {
    if (request.method !== 'GET') return fail(response, 405, '只接受 GET');
    if (!originAllowed(request)) return fail(response, 403, '禁止跨站访问');
    const plugins = await listThirdParty();
    json(response, 200, {
      ok: true,
      env,
      plugins,
      pack: { format: PACK_FORMAT, formatVersion: PACK_VERSION, maxUpload: MAX_UPLOAD },
      list: { format: LIST_FORMAT, formatVersion: LIST_VERSION, maxUpload: MAX_LIST_BYTES },
    });
  }

  async function handleExport(request, response) {
    if (request.method !== 'GET') return fail(response, 405, '只接受 GET');
    if (!originAllowed(request)) return fail(response, 403, '禁止跨站访问');
    const url = new URL(request.url, 'http://localhost');
    const requested = url.searchParams.getAll('plugin');
    const installed = await listThirdParty();
    const chosen = installed.filter(
      (plugin) => plugin.available && (requested.length === 0 || requested.includes(plugin.name)),
    );
    if (chosen.length === 0) return fail(response, 400, '没有可导出的第三方插件');

    if (url.searchParams.get('mode') === 'info') {
      const text = formatPluginList({
        entries: chosen.map((plugin) => ({ name: plugin.name, version: plugin.version })),
        withVersion: url.searchParams.get('withVersion') !== '0',
        env,
      });
      const filename = `dsh-quick-setup-${safeName(env.profile)}-${stamp()}.plugins.txt`;
      response.writeHead(200, {
        'content-type': 'text/plain; charset=utf-8',
        'content-length': String(Buffer.byteLength(text)),
        'content-disposition': `attachment; filename="${filename}"`,
        'cache-control': 'no-store',
        'x-content-type-options': 'nosniff',
      });
      response.end(text);
      return;
    }

    const exportDirectory = path.join(cacheRoot, 'exports');
    await mkdir(exportDirectory, { recursive: true });
    await cleanupOld(exportDirectory, UPLOAD_TTL);
    const archive = path.join(exportDirectory, `pack-${randomBytes(8).toString('hex')}.tgz`);

    try {
      const groups = [];
      const plugins = [];
      for (const plugin of chosen) {
        const dir = await resolvePackageDir(plugin.name);
        if (!dir) continue;
        let pkg;
        try {
          pkg = JSON.parse(await readFile(path.join(dir, 'package.json'), 'utf8'));
        } catch {
          continue;
        }
        const slug = plugin.name.replace(/^@/, '').replace(/[\\/]/g, '__');
        const prefix = `plugins/${slug}`;
        groups.push({ root: dir, prefix });
        plugins.push({
          name: plugin.name,
          version: pkg.version ?? plugin.version,
          description: pkg.description ?? plugin.description,
          title: plugin.title,
          enabled: plugin.enabled,
          dir: prefix,
          requirements: requirementsOf(pkg),
        });
      }
      if (groups.length === 0) return fail(response, 400, '选中的插件没有可读取的包目录');

      const manifest = {
        format: PACK_FORMAT,
        formatVersion: PACK_VERSION,
        createdAt: new Date().toISOString(),
        source: env,
        plugins,
      };
      await writeTarGz(archive, {
        firstFiles: [
          { name: 'dsh-quick-setup-pack.json', data: `${JSON.stringify(manifest, null, 2)}\n` },
        ],
        groups,
      });

      const info = await stat(archive);
      const filename = `dsh-quick-setup-${safeName(env.profile)}-${stamp()}.dshpack.tgz`;
      response.writeHead(200, {
        'content-type': 'application/gzip',
        'content-length': String(info.size),
        'content-disposition': `attachment; filename="${filename}"`,
        'cache-control': 'no-store',
        'x-content-type-options': 'nosniff',
      });
      try {
        await pipeline(createReadStream(archive), response);
      } catch {
        response.destroy();
      } finally {
        await unlink(archive).catch(() => {});
      }
    } catch (error) {
      await unlink(archive).catch(() => {});
      if (!response.headersSent) fail(response, 500, `打包失败：${error.message}`);
      else response.destroy();
    }
  }

  async function parseManifest(root) {
    const filename = path.join(root, 'dsh-quick-setup-pack.json');
    const info = await stat(filename).catch(() => null);
    if (!info || !info.isFile()) throw new Error('插件包缺少 dsh-quick-setup-pack.json');
    if (info.size > MAX_MANIFEST) throw new Error('插件包清单过大');
    let manifest;
    try {
      manifest = JSON.parse(await readFile(filename, 'utf8'));
    } catch (error) {
      throw new Error(`插件包清单不是合法 JSON：${error.message}`);
    }
    if (!manifest || manifest.format !== PACK_FORMAT) {
      throw new Error('这不是 dsh-quick-setup 插件包');
    }
    if (!Number.isInteger(manifest.formatVersion) || manifest.formatVersion < 1) {
      throw new Error('插件包格式版本无效');
    }
    if (manifest.formatVersion > PACK_VERSION) {
      throw new Error(
        `插件包格式版本 ${manifest.formatVersion} 高于当前插件支持的 ${PACK_VERSION}，请先升级 dsh-quick-setup`,
      );
    }
    if (!Array.isArray(manifest.plugins)) throw new Error('插件包清单缺少 plugins');
    return manifest;
  }

  function publicSource(source) {
    if (!source || typeof source !== 'object') return null;
    return {
      profile: typeof source.profile === 'string' ? source.profile : null,
      dshVersion: typeof source.dshVersion === 'string' ? source.dshVersion : null,
      platform: typeof source.platform === 'string' ? source.platform : null,
      arch: typeof source.arch === 'string' ? source.arch : null,
      node: typeof source.node === 'string' ? source.node : null,
      electron: typeof source.electron === 'string' ? source.electron : null,
      generatedAt: typeof source.generatedAt === 'string' ? source.generatedAt : null,
    };
  }

  async function buildPreview(root, manifest) {
    const current = await installedMap();
    const plugins = [];
    const warnings = [];

    for (const entry of manifest.plugins) {
      if (!entry || typeof entry.name !== 'string' || typeof entry.dir !== 'string') {
        warnings.push('忽略清单中缺少 name/dir 的条目');
        continue;
      }
      const relative = entry.dir.replace(/\\/g, '/');
      const normalized = path.posix.normalize(relative);
      if (!normalized.startsWith('plugins/') || normalized.includes('..') || path.isAbsolute(normalized)) {
        warnings.push(`忽略非法包目录：${entry.dir}`);
        continue;
      }
      const dir = path.resolve(root, ...normalized.split('/'));
      if (!isInside(root, dir)) {
        warnings.push(`忽略越界包目录：${entry.dir}`);
        continue;
      }
      let pkg;
      try {
        pkg = JSON.parse(await readFile(path.join(dir, 'package.json'), 'utf8'));
      } catch {
        warnings.push(`${entry.name}：包内缺少可读的 package.json，已忽略`);
        continue;
      }
      const name = typeof pkg.name === 'string' ? pkg.name : entry.name;
      if (name !== entry.name) {
        warnings.push(`${entry.name}：包内名称为 ${name}，以包内名称为准`);
      }

      const installed = current.get(name);
      const compatibility = compatibilityOf(pkg, env);
      let status = 'compatible';
      let reason = null;
      let installable = true;

      if (name === SELF) {
        status = 'self';
        reason = '插件包中的 dsh-quick-setup 需要在目标实例手动安装，已跳过';
        installable = false;
      } else if (!pkg.dsh || typeof pkg.dsh !== 'object' || !pkg.dsh.bundle) {
        status = 'not-bundle';
        reason = '不是 DSH bundle（package.json 缺少 dsh.bundle）';
        installable = false;
      } else if (!compatibility.ok) {
        status = 'incompatible';
        reason = compatibility.reasons.join('；');
        installable = false;
      } else if (installed?.installed) {
        const currentVersion = installed.version ?? null;
        const diff = currentVersion && pkg.version ? compareVersions(pkg.version, currentVersion) : null;
        if (diff === 0) {
          status = 'installed';
          reason =
            installed.enabled === (entry.enabled !== false)
              ? '已安装相同版本，启用状态也一致'
              : '已安装相同版本，安装时会同步启用状态';
        } else {
          status = diff !== null && diff < 0 ? 'downgrade' : 'upgrade';
          installable = false;
          reason = `已安装 ${currentVersion ?? '未知版本'}，本包为 ${pkg.version ?? '未知版本'}；为避免覆盖现有配置，快速安装不会自动替换同名插件，请先在插件管理中移除它`;
        }
      }

      if (compatibility.warnings.length > 0) warnings.push(`${name}：${compatibility.warnings.join('；')}`);

      plugins.push({
        name,
        version: typeof pkg.version === 'string' ? pkg.version : null,
        description: typeof pkg.description === 'string' ? pkg.description : null,
        status,
        reason,
        installable,
        selectedByDefault: status === 'compatible',
        enabled: entry.enabled !== false,
        dir: normalized,
        currentVersion: installed?.version ?? null,
        currentEnabled: installed?.installed ? installed.enabled !== false : null,
        requirements: requirementsOf(pkg),
        warnings: compatibility.warnings,
      });
    }

    const counts = {
      total: plugins.length,
      compatible: plugins.filter((plugin) => plugin.status === 'compatible').length,
      upgrade: plugins.filter((plugin) => plugin.status === 'upgrade').length,
      downgrade: plugins.filter((plugin) => plugin.status === 'downgrade').length,
      installed: plugins.filter((plugin) => plugin.status === 'installed').length,
      incompatible: plugins.filter((plugin) => plugin.status === 'incompatible').length,
      invalid: 0,
      latest: 0,
      skipped: plugins.filter((plugin) => !plugin.installable && plugin.status !== 'installed').length,
    };

    return {
      kind: 'pack',
      createdAt: typeof manifest.createdAt === 'string' ? manifest.createdAt : null,
      source: publicSource(manifest.source),
      plugins,
      warnings,
      counts,
    };
  }

  /**
   * Inspect one npm spec without letting a slow registry lookup hold the
   * upload request open: abort after INSPECT_TIMEOUT and answer with a warning
   * while the install path remains available.
   *
   * @returns {Promise<{ok: true, value: any} | {ok: false, error?: unknown, reason?: 'timeout'}>}
   */
  function inspectEntry(spec) {
    return new Promise((resolve) => {
      let settled = false;
      const controller = new AbortController();
      const finish = (value) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        resolve(value);
      };
      const timer = setTimeout(() => {
        controller.abort();
        finish({ ok: false, reason: 'timeout' });
      }, INSPECT_TIMEOUT);
      timer.unref?.();
      pluginManager.inspect(spec, undefined, controller.signal).then(
        (value) => finish({ ok: true, value }),
        (error) => finish({ ok: false, error }),
      );
    });
  }

  async function mapWithConcurrency(items, limit, worker) {
    const results = new Array(items.length);
    let next = 0;
    const run = async () => {
      while (next < items.length) {
        const index = next;
        next += 1;
        results[index] = await worker(items[index], index);
      }
    };
    await Promise.all(Array.from({ length: Math.min(limit, items.length) }, run));
    return results;
  }

  /**
   * Preview a `.plugins.txt` list: local checks first, then one `inspect` per
   * entry that would actually be installed (already-installed entries need no
   * registry lookup). Compatibility is re-checked by `installBundle` itself.
   */
  async function buildInfoPreview(parsed) {
    const current = await installedMap();
    const plugins = [];
    const warnings = [...parsed.warnings];
    const pending = [];

    for (const entry of parsed.entries) {
      const installed = current.get(entry.name);
      const installedVersion = typeof installed?.version === 'string' ? installed.version : null;
      const plugin = {
        name: entry.name,
        version: entry.version,
        pinned: Boolean(entry.version),
        resolvedVersion: null,
        description: null,
        status: 'compatible',
        reason: null,
        installable: true,
        selectedByDefault: false,
        enabled: null,
        dir: null,
        currentVersion: installed?.installed ? installedVersion : null,
        currentEnabled: installed?.installed ? installed.enabled !== false : null,
        requirements: null,
        warnings: [],
      };

      if (entry.name === SELF) {
        plugin.status = 'self';
        plugin.installable = false;
        plugin.reason = '清单中的 dsh-quick-setup 需要在目标实例手动安装，已跳过';
      } else if (installed?.installed) {
        plugin.status = 'installed';
        if (entry.version && installedVersion) {
          const diff = compareVersions(entry.version, installedVersion);
          if (diff === 0) {
            plugin.reason = '已安装相同版本，已跳过';
          } else {
            plugin.status = diff < 0 ? 'downgrade' : 'upgrade';
            plugin.installable = false;
            plugin.reason = `已安装 ${installedVersion}，清单为 ${entry.version}；为避免覆盖现有配置，快速安装不会自动替换同名插件，请先在插件管理中移除它`;
          }
        } else if (!entry.version) {
          plugin.reason = '已安装；清单未记录版本，不会自动升级';
        } else {
          plugin.reason = '已安装，已跳过';
        }
      } else {
        pending.push(plugin);
      }
      plugins.push(plugin);
    }

    if (pending.length > 0) {
      if (typeof pluginManager.inspect === 'function') {
        await mapWithConcurrency(pending, INSPECT_CONCURRENCY, async (row) => {
          const spec = specOf({ name: row.name, version: row.version });
          const outcome = await inspectEntry(spec);
          if (!outcome.ok) {
            const why =
              outcome.reason === 'timeout'
                ? '校验超时'
                : outcome.error?.message ?? String(outcome.error);
            row.warnings.push(`无法向 npm 校验 ${spec}（${why}），安装时会再试`);
            return;
          }
          const inspection = outcome.value;
          if (!inspection || typeof inspection !== 'object') return;
          if (inspection.status === 'accepted') {
            // `inspect` already refused non-bundles for registry specs.
            if (typeof inspection.version === 'string') {
              if (!row.pinned) row.resolvedVersion = inspection.version;
              row.version = row.pinned ? row.version : inspection.version;
            }
            row.description = typeof inspection.description === 'string' ? inspection.description : null;
            return;
          }
          const reason = typeof inspection.reason === 'string' ? inspection.reason : '';
          switch (inspection.problem) {
            case 'not-found':
              row.status = 'invalid';
              row.installable = false;
              row.reason = `npm 上没有找到 ${spec}${reason ? `：${reason}` : ''}`;
              break;
            case 'not-a-bundle':
              row.status = 'not-bundle';
              row.installable = false;
              row.reason = `${row.name} 不是 DSH 插件（package.json 缺少 dsh.bundle）`;
              break;
            case 'network':
            case 'timeout':
              row.warnings.push(`无法连接 npm 校验 ${spec}，安装时会再试${reason ? `：${reason}` : ''}`);
              break;
            case 'already-installed':
              row.status = 'installed';
              row.reason = '插件已经安装，已跳过';
              break;
            default:
              row.status = 'invalid';
              row.installable = false;
              row.reason = `无法校验 ${spec}${reason ? `：${reason}` : ''}`;
          }
        });
      } else {
        warnings.push('当前 DSH 插件管理器不支持 npm 预校验，导入时会直接安装');
      }
    }

    for (const plugin of plugins) {
      if (plugin.status === 'compatible') {
        plugin.reason = plugin.pinned
          ? `将从 npm 安装 ${specOf({ name: plugin.name, version: plugin.version })}`
          : `将从 npm 安装最新的 ${plugin.name}`;
      }
      plugin.selectedByDefault = plugin.status === 'compatible' || plugin.status === 'installed';
      if (plugin.warnings.length > 0) warnings.push(`${plugin.name}：${plugin.warnings.join('；')}`);
    }

    const counts = {
      total: plugins.length,
      compatible: plugins.filter((plugin) => plugin.status === 'compatible').length,
      upgrade: plugins.filter((plugin) => plugin.status === 'upgrade').length,
      downgrade: plugins.filter((plugin) => plugin.status === 'downgrade').length,
      installed: plugins.filter((plugin) => plugin.status === 'installed').length,
      incompatible:
        plugins.filter((plugin) => plugin.status === 'invalid' || plugin.status === 'not-bundle').length,
      invalid: plugins.filter((plugin) => plugin.status === 'invalid').length,
      latest: plugins.filter((plugin) => plugin.installable && !plugin.pinned).length,
      skipped: plugins.filter((plugin) => !plugin.installable && plugin.status !== 'installed').length,
    };

    return {
      kind: 'list',
      createdAt: parsed.source.exportedAt ?? null,
      source: {
        profile: parsed.source.profile ?? null,
        dshVersion: parsed.source.dshVersion ?? null,
        platform: null,
        arch: null,
        node: null,
        electron: null,
        generatedAt: parsed.source.exportedAt ?? null,
      },
      plugins,
      formatVersion: parsed.formatVersion,
      warnings,
      counts,
    };
  }

  async function handleUpload(request, response) {
    if (request.method !== 'POST') return fail(response, 405, '只接受 POST');
    if (!postAllowed(request)) return fail(response, 403, '禁止跨站或未标记的请求');
    const uploadId = randomBytes(12).toString('hex');
    const work = path.join(cacheRoot, 'uploads', uploadId);
    await mkdir(work, { recursive: true });
    const file = path.join(work, 'upload.bin');
    try {
      const { kind } = await receiveUpload(request, file);
      if (kind === 'list') {
        const parsed = parsePluginList(await readFile(file, 'utf8'));
        const preview = await buildInfoPreview(parsed);
        await writeFile(
          path.join(work, 'meta.json'),
          `${JSON.stringify(
            {
              kind: 'list',
              entries: parsed.entries,
              source: parsed.source,
              createdAt: new Date().toISOString(),
              preview: Object.fromEntries(
                (preview.plugins || []).map((plugin) => [
                  plugin.name,
                  { status: plugin.status, reason: plugin.reason ?? null },
                ]),
              ),
            },
            null,
            2,
          )}\n`,
        );
        json(response, 200, { ok: true, uploadId, manifest: preview });
        return;
      }
      const unpacked = path.join(work, 'unpacked');
      await mkdir(unpacked, { recursive: true });
      await extractTarGz(file, unpacked);
      const manifest = await parseManifest(unpacked);
      const preview = await buildPreview(unpacked, manifest);
      json(response, 200, { ok: true, uploadId, manifest: preview });
    } catch (error) {
      await rm(work, { recursive: true, force: true }).catch(() => {});
      fail(response, 400, `导入失败：${error.message}`);
    }
  }

  /**
   * Install one entry of a `.plugins.txt` list from the npm registry.
   *
   * The text carries no package manifest, so engines/peers are checked by
   * `installBundle` itself; this handler only enforces the same "never replace
   * an installed plugin automatically" rule the pack path uses.
   */
  async function installListEntry(response, meta, name) {
    const entries = Array.isArray(meta.entries) ? meta.entries : [];
    const entry = entries.find((item) => item && item.name === name);
    if (!entry) return fail(response, 404, '插件清单中没有这个插件');
    // The preview already ruled some entries out (missing on npm, not a bundle,
    // or the plugin itself). Reject them here too so a direct API call cannot
    // bypass the UI and make pnpm chase a package that does not exist.
    const verdict = meta.preview?.[name];
    if (verdict && (verdict.status === 'invalid' || verdict.status === 'not-bundle' || verdict.status === 'self')) {
      return fail(response, 409, `插件清单中的 ${name} 在检查时被标记为不可安装：${verdict.reason ?? verdict.status}`);
    }
    const version = typeof entry.version === 'string' && entry.version !== '' ? entry.version : null;
    let current = (await installedMap().catch(() => new Map())).get(name);
    if (current?.installed) {
      return json(response, 200, {
        ok: true,
        result: {
          name,
          action: 'skip',
          ok: true,
          reason: version ? '已安装同版本或其它版本，不会自动替换同名插件' : '已安装；清单未记录版本，不会自动升级',
          version: current.version ?? version,
          application: 'applied',
        },
      });
    }

    const spec = version ? `${name}@${version}` : name;
    try {
      const result = await pluginManager.installBundle(spec, { enabled: true });
      const ok = !result?.error && result?.application !== 'failed';
      return json(response, 200, {
        ok,
        result: {
          name,
          action: 'install',
          ok,
          spec,
          application: result?.application ?? null,
          version: result?.version ?? version,
          error: errorInfo(result?.error),
          warnings: Array.isArray(result?.warnings) ? result.warnings : [],
          restartReason: result?.restartReason ?? null,
        },
        error: ok ? null : errorInfo(result?.error)?.message ?? '安装失败',
      });
    } catch (error) {
      if (error?.code === 'already-installed') {
        current = (await installedMap().catch(() => new Map())).get(name);
        if (current?.installed) {
          return json(response, 200, {
            ok: true,
            result: {
              name,
              action: 'skip',
              ok: true,
              reason: '同名插件已经安装',
              version: current.version ?? version,
              application: 'applied',
            },
          });
        }
      }
      return json(response, 200, { ok: false, error: errorInfo(error)?.message ?? String(error) });
    }
  }

  async function handleInstall(request, response) {
    if (request.method !== 'POST') return fail(response, 405, '只接受 POST');
    if (!postAllowed(request)) return fail(response, 403, '禁止跨站或未标记的请求');

    const body = await readJsonBody(request);
    const uploadId = typeof body.uploadId === 'string' ? body.uploadId : '';
    if (!/^[a-f0-9]{24}$/.test(uploadId)) return fail(response, 400, '无效的上传标识');
    const name =
      typeof body.name === 'string'
        ? body.name
        : Array.isArray(body.plugins) && typeof body.plugins[0] === 'string'
          ? body.plugins[0]
          : '';
    if (name.trim() === '') return fail(response, 400, '没有选择要安装的插件');

    const work = path.join(cacheRoot, 'uploads', uploadId);
    const uploadInfo = await stat(path.join(work, 'upload.bin')).catch(() => null);
    if (!uploadInfo) {
      return fail(response, 404, '上传记录不存在或已过期，请重新上传插件包或插件清单');
    }

    const meta = await readMetaFile(work);
    if (meta?.kind === 'list') return installListEntry(response, meta, name);

    const unpacked = path.join(work, 'unpacked');
    let manifest;
    try {
      manifest = await parseManifest(unpacked);
    } catch (error) {
      return fail(response, 400, `插件包已失效：${error.message}`);
    }
    const preview = await buildPreview(unpacked, manifest);
    const plugin = preview.plugins.find((item) => item.name === name);
    if (!plugin) return fail(response, 404, '插件包中没有这个插件');
    if (plugin.status === 'incompatible' || plugin.status === 'not-bundle' || plugin.status === 'self') {
      return json(response, 200, { ok: false, error: plugin.reason || '这个条目不能安装' });
    }
    if (!plugin.installable && plugin.status !== 'installed') {
      return json(response, 200, { ok: false, error: plugin.reason || '这个条目不能安装' });
    }

    try {
      if (plugin.status === 'installed') {
        const current = (await installedMap()).get(name);
        if (!current?.installed) {
          return json(response, 200, { ok: false, error: '插件状态已变化，请刷新后重试' });
        }
        if ((current.enabled !== false) !== (plugin.enabled !== false)) {
          const result = await pluginManager.setBundleEnabled(name, plugin.enabled !== false);
          return json(response, 200, {
            ok: true,
            result: {
              name,
              action: 'sync-enabled',
              ok: true,
              application: result?.application ?? 'applied',
              version: current.version ?? plugin.version,
            },
          });
        }
        return json(response, 200, {
          ok: true,
          result: {
            name,
            action: 'skip',
            ok: true,
            reason: '已安装同版本且状态一致',
            version: current.version ?? plugin.version,
            application: 'applied',
          },
        });
      }

      const source = path.resolve(unpacked, ...plugin.dir.split('/'));
      if (!isInside(unpacked, source)) throw new Error('包目录越界');
      await mkdir(path.join(cacheRoot, 'packages'), { recursive: true });
      const slug = safeName(plugin.name.replace(/^@/, '').replace(/[\\/]/g, '__'));
      const version = safeName(plugin.version ?? '0');
      const tarball = path.join(cacheRoot, 'packages', `${slug}-${version}.tgz`);
      await writeTarGz(tarball, { groups: [{ root: source, prefix: 'package' }] });

      const result = await pluginManager.installBundle(tarball, {
        enabled: plugin.enabled !== false,
      });
      const ok = !result?.error && result?.application !== 'failed';
      return json(response, 200, {
        ok,
        result: {
          name,
          action: 'install',
          ok,
          application: result?.application ?? null,
          version: result?.version ?? plugin.version,
          error: errorInfo(result?.error),
          warnings: Array.isArray(result?.warnings) ? result.warnings : [],
          restartReason: result?.restartReason ?? null,
        },
        error: ok ? null : errorInfo(result?.error)?.message ?? '安装失败',
      });
    } catch (error) {
      if (error?.code === 'already-installed') {
        const current = (await installedMap().catch(() => new Map())).get(name);
        if (current?.version === plugin.version) {
          return json(response, 200, {
            ok: true,
            result: {
              name,
              action: 'skip',
              ok: true,
              reason: '同名同版本插件已经安装',
              version: plugin.version,
              application: 'applied',
            },
          });
        }
      }
      return json(response, 200, { ok: false, error: errorInfo(error)?.message ?? String(error) });
    }
  }

  ctx.effect(() => {
    const timer = setInterval(() => {
      cleanupOld(path.join(cacheRoot, 'uploads'), UPLOAD_TTL).catch(() => {});
      cleanupOld(path.join(cacheRoot, 'exports'), UPLOAD_TTL).catch(() => {});
    }, 60 * 60 * 1000);
    timer.unref?.();
    return () => clearInterval(timer);
  }, 'dsh-quick-setup: cache cleanup');

  const routes = [
    [`${API_PREFIX}/status`, handleStatus],
    [`${API_PREFIX}/export`, handleExport],
    [`${API_PREFIX}/upload`, handleUpload],
    [`${API_PREFIX}/install`, handleInstall],
  ];
  for (const [routePath, handler] of routes) {
    ctx.effect(
      () =>
        webServer.register({
          kind: 'exact',
          path: routePath,
          handler: (request, response) => {
            Promise.resolve(handler(request, response)).catch((error) => {
              if (response.headersSent) {
                response.destroy();
                return;
              }
              fail(response, 500, `内部错误：${error.message}`);
            });
          },
        }),
      `dsh-quick-setup: route ${routePath}`,
    );
  }
}
