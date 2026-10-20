#!/usr/bin/env node
/**
 * Offline smoke test for the parts of dsh-quick-setup that do not need a DSH
 * runtime: tar writing/extraction, semver range previews, and the
 * `.plugins.txt` plugin-info list format.
 *
 * Usage: node scripts/smoke.mjs [realPluginDir]
 */

import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, rm, stat, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { writeTarGz } from '../lib/tar.js';
import { extractTarGz } from '../lib/tar-extract.js';
import { compareVersions, isValidRange, satisfies } from '../lib/range.js';
import {
  LIST_VERSION,
  formatPluginList,
  isDistTag,
  isExactVersion,
  isNpmName,
  parsePluginList,
  specOf,
} from '../lib/plugin-list.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = await mkdtemp(path.join(os.tmpdir(), 'dsh-quick-setup-smoke-'));

try {
  const plugin = path.join(root, 'plugins', 'example-plugin');
  await mkdir(path.join(plugin, 'lib'), { recursive: true });
  await writeFile(
    path.join(plugin, 'package.json'),
    JSON.stringify(
      {
        name: 'example-plugin',
        version: '1.2.3',
        dsh: { bundle: { patch: './cordis.patch.yml' } },
      },
      null,
      2,
    ),
  );
  await writeFile(path.join(plugin, 'cordis.patch.yml'), '- insert: []\n');
  await writeFile(path.join(plugin, 'lib', 'index.js'), 'export const name = "example";\n');

  const manifest = {
    format: 'dsh-quick-setup-pack',
    formatVersion: 1,
    plugins: [{ name: 'example-plugin', dir: 'plugins/example-plugin' }],
  };
  const archive = path.join(root, 'pack.tgz');
  const report = await writeTarGz(archive, {
    firstFiles: [{ name: 'dsh-quick-setup-pack.json', data: JSON.stringify(manifest) }],
    groups: [{ root: plugin, prefix: 'plugins/example-plugin' }],
  });
  assert.equal(report.files, 3);

  const unpacked = path.join(root, 'unpacked');
  await extractTarGz(archive, unpacked);
  assert.deepEqual(
    JSON.parse(await readFile(path.join(unpacked, 'dsh-quick-setup-pack.json'), 'utf8')),
    manifest,
  );
  assert.equal(
    await readFile(path.join(unpacked, 'plugins', 'example-plugin', 'lib', 'index.js'), 'utf8'),
    'export const name = "example";\n',
  );
  assert.equal(await readFile(path.join(unpacked, 'plugins', 'example-plugin', 'cordis.patch.yml'), 'utf8'), '- insert: []\n');
  const size = (await stat(path.join(unpacked, 'plugins', 'example-plugin', 'package.json'))).size;
  assert.ok(size > 0);

  // Plugin info list: text round-trip, pinned and unpinned entries.
  const listText = formatPluginList({
    entries: [
      { name: 'example-plugin', version: '1.2.3' },
      { name: '@scope/other', version: '0.4.0' },
      { name: 'no-version-plugin', version: null },
    ],
    withVersion: true,
    env: { profile: 'desktop', dshVersion: '0.2.1-rc.2' },
  });
  assert.match(listText, /^# dsh-quick-setup\/plugins@\d+\n/);
  const parsed = parsePluginList(listText);
  assert.equal(parsed.formatVersion, LIST_VERSION);
  assert.equal(parsed.source.profile, 'desktop');
  assert.equal(parsed.source.dshVersion, '0.2.1-rc.2');
  assert.match(parsed.source.exportedAt, /^\d{4}-\d{2}-\d{2}T/);
  assert.deepEqual(parsed.entries, [
    { name: 'example-plugin', version: '1.2.3' },
    { name: '@scope/other', version: '0.4.0' },
    { name: 'no-version-plugin', version: null },
  ]);
  assert.deepEqual(parsed.warnings, []);
  assert.equal(specOf(parsed.entries[0]), 'example-plugin@1.2.3');
  assert.equal(specOf(parsed.entries[2]), 'no-version-plugin');

  // "Include current version" unchecked: bare names install the latest tag.
  const bareText = formatPluginList({
    entries: [{ name: 'example-plugin', version: '1.2.3' }],
    withVersion: false,
    env: {},
  });
  assert.match(bareText, /\nexample-plugin\n$/);
  const bareParsed = parsePluginList(bareText);
  assert.equal(bareParsed.entries[0].version, null);
  assert.equal(specOf(bareParsed.entries[0]), 'example-plugin');

  // Hand-edited lists: comments, blank lines, CRLF, duplicates and bad lines.
  const messy = parsePluginList(
    [
      '\uFEFF# dsh-quick-setup/plugins@1',
      '# profile: laptop',
      '',
      'example-plugin@2.0.0   # pinned by hand',
      'example-plugin@1.0.0',
      'Bad_Name@1.0.0',
      'ranged@^1.2.3',
      'broken@',
      'no-version-plugin',
      'no-version-plugin',
    ].join('\r\n'),
  );
  assert.equal(messy.entries.length, 2);
  assert.deepEqual(messy.entries[0], { name: 'example-plugin', version: '2.0.0' });
  assert.equal(messy.entries[1].version, null);
  assert.equal(messy.warnings.length, 5);
  assert.throws(() => parsePluginList('just some random text\n'), /没有可识别的插件/);
  assert.throws(() => parsePluginList('# dsh-quick-setup/plugins@99\n'), /高于当前插件支持/);

  // Package name and version grammar.
  assert.equal(isNpmName('dsh-music-player'), true);
  assert.equal(isNpmName('@scope/plugin.js'), true);
  assert.equal(isNpmName('BadName'), false);
  assert.equal(isNpmName('../evil'), false);
  assert.equal(isNpmName('@scope/'), false);
  assert.equal(isExactVersion('1.2.3'), true);
  assert.equal(isExactVersion('0.2.0-rc.1'), true);
  assert.equal(isExactVersion('^1.2.3'), false);
  assert.equal(isExactVersion('>=2'), false);
  assert.equal(isDistTag('latest'), true);
  assert.equal(isDistTag('next-2'), true);
  assert.equal(isDistTag('1.2.3'), false);

  assert.equal(compareVersions('0.2.1-rc.2', '0.2.1'), -1);
  assert.equal(compareVersions('1.2.3', '1.2.3'), 0);
  assert.equal(compareVersions('1.10.0', '1.9.9'), 1);
  assert.equal(satisfies('0.2.1-rc.2', '>=0.2.1-rc.2 <0.3.0'), true);
  assert.equal(satisfies('0.2.1-rc.2', '^0.2.1-rc.1'), true);
  assert.equal(satisfies('0.2.1-rc.2', '>=0.3.0'), false);
  assert.equal(satisfies('24.4.1', '>=20'), true);
  assert.equal(satisfies('18.20.0', '>=20'), false);
  assert.equal(satisfies('1.2.3', '~1.2'), true);
  assert.equal(satisfies('1.3.0', '~1.2'), false);
  assert.equal(isValidRange('workspace:^'), false);
  assert.equal(isValidRange('not a range'), false);

  console.log(`smoke ok · ${report.files} files · ${report.bytes} bytes · ${path.relative(here, archive)}`);

  const real = process.argv[2] || process.env.SMOKE_REAL_DIR;
  if (real) {
    const realArchive = path.join(root, 'real.tgz');
    const realReport = await writeTarGz(realArchive, {
      groups: [{ root: real, prefix: 'plugins/real' }],
    });
    const realUnpacked = path.join(root, 'real-unpacked');
    await extractTarGz(realArchive, realUnpacked);
    const pkg = JSON.parse(
      await readFile(path.join(realUnpacked, 'plugins', 'real', 'package.json'), 'utf8'),
    );
    console.log(
      `real-package ok · ${pkg.name}@${pkg.version} · ${realReport.files} files · ${realReport.bytes} bytes`,
    );
  }
} finally {
  await rm(root, { recursive: true, force: true });
}
