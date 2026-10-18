window.__ModuleLoader__.load({
  id: 'dsh-quick-setup',
  factory(require) {
    const React = require('react');
    const h = React.createElement;
    const NS = 'dsh-quick-setup';
    const API = '/dsh-quick-setup/api';

    const messages = {
      zh: {
        nav: '快速安装',
        title: '快速安装与迁移',
        subtitle:
          '把本机已安装的第三方插件导出为插件包，在另一台电脑或另一个 DSH 实例中检查兼容性后批量安装。',
        envDsh: 'DSH',
        envProfile: '配置',
        envNode: 'Node',
        envPlatform: '平台',
        exportTitle: '导出本机插件',
        exportHint: '官方内置插件和 dsh-quick-setup 自身不会被导出。',
        exportEmpty: '本机没有可导出的第三方插件。',
        selectAll: '全选',
        selectNone: '全不选',
        selected: '已选 {count} 个',
        exportAction: '导出插件包',
        loading: '正在读取插件列表…',
        importTitle: '导入插件包',
        importHint:
          '插件包只包含插件代码，不包含账号、密钥、聊天记录或设置。导入时会重新校验 DSH 版本、Node 版本与平台。',
        chooseFile: '选择 .dshpack.tgz',
        noFile: '尚未选择文件',
        checkAction: '检查兼容性',
        uploading: '正在解包并校验兼容性…',
        previewTitle: '插件包检查结果',
        previewFrom: '来源',
        previewCreated: '打包时间',
        countCompatible: '可安装 {count}',
        countIncompatible: '不兼容 {count}',
        countInstalled: '已安装 {count}',
        countSkipped: '跳过 {count}',
        currentVersion: '当前 {version}',
        installAction: '安装选中的 {count} 个插件',
        installHint: '安装会调用 DSH 官方的插件管理器，并逐条报告结果。',
        installing: '正在安装…',
        jobRunning: '正在安装 {index}/{total}{name}',
        jobPreparing: '正在准备安装任务…',
        jobDone: '安装任务完成',
        jobRestart:
          '有插件需要重启 DSH 后才会生效。请重启当前 DSH 实例，然后回到插件页确认状态。',
        refresh: '刷新环境',
        retry: '重新选择文件',
        resultOk: '成功',
        resultFail: '失败',
        rejectedTitle: '以下条目未安装',
        warnings: '提示',
        noSelection: '请至少选择一个插件。',
        routeMissing: '快速安装服务尚未就绪，请确认插件已启用并重启 DSH。',
        requestFailed: '请求失败：{message}',
        enabled: '启用',
        disabled: '停用',
        installedBadge: '已安装',
        incompatibleBadge: '不兼容',
        selfBadge: '跳过',
        notBundleBadge: '非插件',
        compatibleBadge: '可安装',
        upgradeBadge: '升级',
        downgradeBadge: '降级',
        conflictBadge: '版本冲突',
        syncBadge: '同步状态',
        packMeta: '{count} 个插件 · {size}',
        close: '关闭',
      },
      en: {
        nav: 'Quick Setup',
        title: 'Quick Setup & Migration',
        subtitle:
          'Export the third-party plugins installed here as a portable pack, then validate and batch-install them on another computer or another DSH instance.',
        envDsh: 'DSH',
        envProfile: 'Profile',
        envNode: 'Node',
        envPlatform: 'Platform',
        exportTitle: 'Export plugins from this instance',
        exportHint: 'Official built-in bundles and dsh-quick-setup itself are not exported.',
        exportEmpty: 'No third-party plugins are available to export.',
        selectAll: 'Select all',
        selectNone: 'Select none',
        selected: '{count} selected',
        exportAction: 'Export pack',
        loading: 'Reading installed plugins…',
        importTitle: 'Import a plugin pack',
        importHint:
          'A pack contains plugin code only — no accounts, secrets, conversations or settings. Compatibility is re-checked on import.',
        chooseFile: 'Choose .dshpack.tgz',
        noFile: 'No file selected',
        checkAction: 'Check compatibility',
        uploading: 'Unpacking and checking compatibility…',
        previewTitle: 'Pack inspection',
        previewFrom: 'From',
        previewCreated: 'Created',
        countCompatible: '{count} installable',
        countIncompatible: '{count} incompatible',
        countInstalled: '{count} installed',
        countSkipped: '{count} skipped',
        currentVersion: 'current {version}',
        installAction: 'Install {count} selected plugins',
        installHint: 'Installs go through the official DSH plugin manager and are reported one by one.',
        installing: 'Installing…',
        jobRunning: 'Installing {index}/{total}{name}',
        jobPreparing: 'Preparing the install job…',
        jobDone: 'Install job finished',
        jobRestart:
          'Some plugins take effect after DSH restarts. Restart this DSH instance, then check the Plugins page.',
        refresh: 'Refresh environment',
        retry: 'Choose another file',
        resultOk: 'OK',
        resultFail: 'Failed',
        rejectedTitle: 'Not installed',
        warnings: 'Notes',
        noSelection: 'Select at least one plugin.',
        routeMissing: 'The Quick Setup service is not ready yet. Make sure the plugin is enabled and restart DSH.',
        requestFailed: 'Request failed: {message}',
        enabled: 'enabled',
        disabled: 'disabled',
        installedBadge: 'installed',
        incompatibleBadge: 'incompatible',
        selfBadge: 'skipped',
        notBundleBadge: 'not a bundle',
        compatibleBadge: 'installable',
        upgradeBadge: 'upgrade',
        downgradeBadge: 'downgrade',
        conflictBadge: 'version conflict',
        syncBadge: 'sync state',
        packMeta: '{count} plugins · {size}',
        close: 'Close',
      },
    };

    const styles = {
      root: {
        display: 'flex',
        flexDirection: 'column',
        gap: 14,
        maxWidth: 920,
        padding: '2px 0 32px',
        color: 'var(--dsw-alias-label-primary, #1f2329)',
        fontSize: 13,
        lineHeight: 1.5,
      },
      title: { margin: 0, fontSize: 20, fontWeight: 650, letterSpacing: '-0.01em' },
      subtitle: {
        margin: '6px 0 0',
        color: 'var(--dsw-alias-label-secondary, #6b7280)',
        fontSize: 13,
        maxWidth: 760,
      },
      envRow: { display: 'flex', flexWrap: 'wrap', gap: 6 },
      chip: {
        display: 'inline-flex',
        alignItems: 'center',
        gap: 5,
        padding: '3px 9px',
        borderRadius: 999,
        border: '1px solid var(--dsw-alias-border-l1, rgba(127,127,127,.22))',
        background: 'var(--dsw-alias-bg-layer-2, rgba(127,127,127,.07))',
        color: 'var(--dsw-alias-label-secondary, #6b7280)',
        fontSize: 11.5,
        whiteSpace: 'nowrap',
      },
      chipStrong: { color: 'var(--dsw-alias-label-primary, #1f2329)', fontWeight: 600 },
      error: {
        padding: '9px 12px',
        borderRadius: 9,
        border: '1px solid var(--dsw-alias-state-error, #d14343)',
        background: 'var(--dsw-alias-bg-layer-1, #fff)',
        color: 'var(--dsw-alias-state-error, #d14343)',
        fontSize: 12.5,
        whiteSpace: 'pre-wrap',
      },
      notice: {
        padding: '9px 12px',
        borderRadius: 9,
        border: '1px solid var(--dsw-alias-border-l1, rgba(127,127,127,.22))',
        background: 'var(--dsw-alias-bg-layer-2, rgba(127,127,127,.07))',
        color: 'var(--dsw-alias-label-secondary, #6b7280)',
        fontSize: 12.5,
      },
      card: {
        display: 'flex',
        flexDirection: 'column',
        gap: 10,
        padding: '14px 16px',
        borderRadius: 12,
        border: '1px solid var(--dsw-alias-border-l1, rgba(127,127,127,.22))',
        background: 'var(--dsw-alias-bg-layer-1, #fff)',
      },
      cardHead: { display: 'flex', alignItems: 'baseline', gap: 10, flexWrap: 'wrap' },
      cardTitle: { fontSize: 14, fontWeight: 650 },
      cardHint: { color: 'var(--dsw-alias-label-secondary, #6b7280)', fontSize: 12 },
      list: { display: 'flex', flexDirection: 'column' },
      row: {
        display: 'grid',
        gridTemplateColumns: '22px minmax(0, 1fr) auto',
        alignItems: 'start',
        gap: 10,
        padding: '8px 0',
        borderTop: '1px solid var(--dsw-alias-border-l2, rgba(127,127,127,.12))',
      },
      rowFirst: { borderTop: 'none' },
      check: { marginTop: 2, width: 15, height: 15, accentColor: 'var(--dsw-alias-label-primary, #1f2329)' },
      nameLine: { display: 'flex', alignItems: 'baseline', gap: 7, flexWrap: 'wrap', minWidth: 0 },
      name: { fontWeight: 600, fontSize: 13, overflowWrap: 'anywhere' },
      version: {
        color: 'var(--dsw-alias-label-secondary, #6b7280)',
        fontSize: 11.5,
        fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
      },
      reason: { color: 'var(--dsw-alias-label-secondary, #6b7280)', fontSize: 12, marginTop: 2 },
      badge: {
        display: 'inline-flex',
        alignItems: 'center',
        padding: '1px 7px',
        borderRadius: 999,
        border: '1px solid currentColor',
        fontSize: 11,
        lineHeight: 1.55,
        whiteSpace: 'nowrap',
      },
      footer: { display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap', paddingTop: 2 },
      spacer: { flex: 1 },
      primary: {
        appearance: 'none',
        border: '1px solid transparent',
        borderRadius: 8,
        padding: '7px 14px',
        background: 'var(--dsw-alias-label-primary, #1f2329)',
        color: 'var(--dsw-alias-bg-base, #fff)',
        fontSize: 12.5,
        fontWeight: 600,
        cursor: 'pointer',
      },
      secondary: {
        appearance: 'none',
        border: '1px solid var(--dsw-alias-border-l2, rgba(127,127,127,.28))',
        borderRadius: 8,
        padding: '7px 12px',
        background: 'transparent',
        color: 'var(--dsw-alias-label-primary, #1f2329)',
        fontSize: 12.5,
        cursor: 'pointer',
      },
      linkButton: {
        appearance: 'none',
        border: 'none',
        background: 'transparent',
        color: 'var(--dsw-alias-label-secondary, #6b7280)',
        fontSize: 12,
        cursor: 'pointer',
        padding: 0,
      },
      fileRow: { display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' },
      fileName: { color: 'var(--dsw-alias-label-secondary, #6b7280)', fontSize: 12, overflowWrap: 'anywhere' },
      progressTrack: {
        height: 6,
        borderRadius: 999,
        background: 'var(--dsw-alias-bg-layer-2, rgba(127,127,127,.14))',
        overflow: 'hidden',
      },
      progressBar: {
        height: '100%',
        borderRadius: 999,
        background: 'var(--dsw-alias-label-primary, #1f2329)',
        transition: 'width .25s ease',
      },
      mono: { fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace', fontSize: 11.5 },
      resultRow: {
        display: 'grid',
        gridTemplateColumns: '16px minmax(0, 1fr)',
        gap: 8,
        padding: '5px 0',
        fontSize: 12.5,
      },
      muted: { color: 'var(--dsw-alias-label-secondary, #6b7280)' },
    };

    const colors = {
      ok: 'var(--dsw-alias-state-success, #2e9e5b)',
      warn: 'var(--dsw-alias-state-warn, #b7791f)',
      err: 'var(--dsw-alias-state-error, #d14343)',
      muted: 'var(--dsw-alias-label-secondary, #6b7280)',
    };

    function Badge(props) {
      return h(
        'span',
        { style: { ...styles.badge, color: colors[props.kind] || colors.muted } },
        props.children,
      );
    }

    function statusView(status, t) {
      switch (status) {
        case 'compatible':
          return { kind: 'ok', label: t('compatibleBadge') };
        case 'upgrade':
        case 'downgrade':
          return { kind: 'warn', label: t('conflictBadge') };
        case 'installed':
          return { kind: 'muted', label: t('installedBadge') };
        case 'incompatible':
          return { kind: 'err', label: t('incompatibleBadge') };
        case 'self':
          return { kind: 'muted', label: t('selfBadge') };
        case 'not-bundle':
          return { kind: 'err', label: t('notBundleBadge') };
        default:
          return { kind: 'muted', label: status };
      }
    }

    function formatBytes(value) {
      if (!Number.isFinite(value) || value <= 0) return '0 B';
      if (value < 1024) return `${value} B`;
      if (value < 1024 * 1024) return `${(value / 1024).toFixed(1)} KiB`;
      if (value < 1024 * 1024 * 1024) return `${(value / (1024 * 1024)).toFixed(1)} MiB`;
      return `${(value / (1024 * 1024 * 1024)).toFixed(2)} GiB`;
    }

    async function readJson(response) {
      let data = null;
      try {
        data = await response.json();
      } catch {
        data = null;
      }
      if (!response.ok) {
        throw new Error(data?.error || `HTTP ${response.status}`);
      }
      return data;
    }

    function getJson(url) {
      return fetch(url, { headers: { accept: 'application/json' } }).then(readJson);
    }

    function postJson(url, body) {
      return fetch(url, {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-dsh-quick-setup': '1' },
        body: JSON.stringify(body),
      }).then(readJson);
    }

    function Section(props) {
      const t = props.t;
      const [env, setEnv] = React.useState(null);
      const [plugins, setPlugins] = React.useState([]);
      const [selected, setSelected] = React.useState(() => new Set());
      const [loading, setLoading] = React.useState(true);
      const [error, setError] = React.useState(null);
      const [file, setFile] = React.useState(null);
      const [busy, setBusy] = React.useState(null);
      const [uploadId, setUploadId] = React.useState(null);
      const [pack, setPack] = React.useState(null);
      const [job, setJob] = React.useState(null);
      const initialized = React.useRef(false);

      const loadStatus = React.useCallback(async () => {
        setLoading(true);
        setError(null);
        try {
          const data = await getJson(`${API}/status`);
          setEnv(data.env);
          setPlugins(Array.isArray(data.plugins) ? data.plugins : []);
          setSelected((previous) => {
            if (!initialized.current) {
              initialized.current = true;
              return new Set((data.plugins || []).map((plugin) => plugin.name));
            }
            const available = new Set((data.plugins || []).map((plugin) => plugin.name));
            return new Set([...previous].filter((name) => available.has(name)));
          });
        } catch (loadError) {
          setError(
            loadError instanceof TypeError || /Failed to fetch|NetworkError/i.test(String(loadError))
              ? t('routeMissing')
              : t('requestFailed', { message: loadError.message || String(loadError) }),
          );
        } finally {
          setLoading(false);
        }
      }, [t]);

      React.useEffect(() => {
        void loadStatus();
      }, [loadStatus]);

      function toggle(name) {
        setSelected((previous) => {
          const next = new Set(previous);
          if (next.has(name)) next.delete(name);
          else next.add(name);
          return next;
        });
      }

      function resetImport() {
        setFile(null);
        setUploadId(null);
        setPack(null);
        setJob(null);
        setBusy(null);
        setError(null);
      }

      async function uploadPack() {
        if (!file || busy) return;
        setBusy('upload');
        setError(null);
        setJob(null);
        try {
          const data = await fetch(`${API}/upload`, {
            method: 'POST',
            headers: { 'content-type': 'application/gzip', 'x-dsh-quick-setup': '1' },
            body: file,
          }).then(readJson);
          setUploadId(data.uploadId);
          setPack(data.manifest);
          setSelected(
            new Set(
              (data.manifest.plugins || [])
                .filter((plugin) => plugin.selectedByDefault && (plugin.installable || plugin.status === 'installed'))
                .map((plugin) => plugin.name),
            ),
          );
        } catch (uploadError) {
          setError(t('requestFailed', { message: uploadError.message || String(uploadError) }));
        } finally {
          setBusy(null);
        }
      }

      function exportPack() {
        if (selected.size === 0) {
          setError(t('noSelection'));
          return;
        }
        const params = new URLSearchParams();
        for (const name of selected) params.append('plugin', name);
        window.location.assign(`${API}/export?${params.toString()}`);
      }

      function selectable(plugin) {
        return Boolean(plugin.installable) || plugin.status === 'installed';
      }

      function delay(milliseconds) {
        return new Promise((resolve) => setTimeout(resolve, milliseconds));
      }

      async function readStatusWhenReady(timeoutMs) {
        const deadline = Date.now() + timeoutMs;
        while (Date.now() < deadline) {
          try {
            return await getJson(`${API}/status`);
          } catch {
            await delay(600);
          }
        }
        return null;
      }

      async function installOne(name) {
        const target = (pack.plugins || []).find((plugin) => plugin.name === name) || null;
        let lastError = null;
        for (let attempt = 0; attempt < 3; attempt += 1) {
          try {
            const data = await postJson(`${API}/install`, { uploadId, name });
            if (!data.ok) {
              return {
                name,
                action: 'install',
                ok: false,
                error: { message: data.error || '安装失败' },
              };
            }
            return data.result || { name, action: 'install', ok: true };
          } catch (requestError) {
            lastError = requestError;
            // Installing a bundle hot-reloads DSH (and this Host plugin), which can
            // cut the HTTP response even though the install itself succeeded.
            await delay(1200);
            const status = await readStatusWhenReady(20000);
            const found = status ? (status.plugins || []).find((plugin) => plugin.name === name) : null;
            const versionMatches = !target?.version || found?.version === target.version;
            const enabledMatches =
              !target ||
              target.status !== 'installed' ||
              ((found?.enabled !== false) === (target.enabled !== false));
            if (found?.installed === true && versionMatches && enabledMatches) {
              return {
                name,
                action: 'install',
                ok: true,
                application: 'applied',
                version: found.version || target?.version || null,
                recovered: true,
              };
            }
            if (!status) break;
          }
        }
        return {
          name,
          action: 'install',
          ok: false,
          error: { message: lastError?.message || '安装请求失败，请刷新后重试' },
        };
      }

      async function installSelected() {
        if (!pack || !uploadId || busy) return;
        const names = (pack.plugins || [])
          .filter((plugin) => selected.has(plugin.name) && selectable(plugin))
          .map((plugin) => plugin.name);
        if (names.length === 0) {
          setError(t('noSelection'));
          return;
        }
        setBusy('install');
        setError(null);
        setJob({
          total: names.length,
          index: 0,
          current: names[0],
          results: [],
          done: false,
          restartRequired: false,
          error: null,
        });
        const results = [];
        let restartRequired = false;
        try {
          for (let index = 0; index < names.length; index += 1) {
            const result = await installOne(names[index]);
            results.push(result);
            if (result?.application === 'restart-required') restartRequired = true;
            setJob({
              total: names.length,
              index: index + 1,
              current: names[index + 1] || null,
              results: [...results],
              done: false,
              restartRequired,
              error: null,
            });
          }
          setJob({
            total: names.length,
            index: names.length,
            current: null,
            results: [...results],
            done: true,
            restartRequired,
            error: null,
          });
        } catch (installError) {
          setError(t('requestFailed', { message: installError.message || String(installError) }));
          setJob((previous) => ({
            ...(previous || {}),
            done: true,
            error: { message: installError.message || String(installError) },
          }));
        } finally {
          setBusy(null);
          void loadStatus();
        }
      }

      function renderEnv() {
        if (!env) return null;
        return h(
          'div',
          { style: styles.envRow },
          h('span', { style: styles.chip }, `${t('envDsh')} `, h('span', { style: styles.chipStrong }, env.dshVersion || '—')),
          h('span', { style: styles.chip }, `${t('envProfile')} `, h('span', { style: styles.chipStrong }, env.profile || '—')),
          h('span', { style: styles.chip }, `${t('envNode')} `, h('span', { style: styles.chipStrong }, env.node || '—')),
          h(
            'span',
            { style: styles.chip },
            `${t('envPlatform')} `,
            h('span', { style: styles.chipStrong }, `${env.platform || '—'}/${env.arch || '—'}`),
          ),
        );
      }

      function renderExport() {
        const allSelected = plugins.length > 0 && plugins.every((plugin) => selected.has(plugin.name));
        return h(
          'div',
          { style: styles.card },
          h(
            'div',
            { style: styles.cardHead },
            h('span', { style: styles.cardTitle }, t('exportTitle')),
            h('span', { style: styles.cardHint }, t('exportHint')),
          ),
          loading
            ? h('div', { style: styles.muted }, t('loading'))
            : plugins.length === 0
              ? h('div', { style: styles.muted }, t('exportEmpty'))
              : h(
                  'div',
                  { style: styles.list },
                  plugins.map((plugin, index) =>
                    h(
                      'div',
                      { key: plugin.name, style: { ...styles.row, ...(index === 0 ? styles.rowFirst : null) } },
                      h('input', {
                        type: 'checkbox',
                        style: styles.check,
                        checked: selected.has(plugin.name),
                        onChange: () => toggle(plugin.name),
                        'aria-label': plugin.name,
                      }),
                      h(
                        'div',
                        { style: { minWidth: 0 } },
                        h(
                          'div',
                          { style: styles.nameLine },
                          h('span', { style: styles.name }, plugin.name),
                          h('span', { style: styles.version }, plugin.version || '—'),
                          h(
                            Badge,
                            { kind: plugin.enabled ? 'ok' : 'muted' },
                            plugin.enabled ? t('enabled') : t('disabled'),
                          ),
                        ),
                        plugin.description ? h('div', { style: styles.reason }, plugin.description) : null,
                      ),
                      h('span', { style: styles.version }, plugin.title || ''),
                    ),
                  ),
                ),
          h(
            'div',
            { style: styles.footer },
            h(
              'button',
              {
                type: 'button',
                style: styles.linkButton,
                onClick: () =>
                  setSelected(allSelected ? new Set() : new Set(plugins.map((plugin) => plugin.name))),
              },
              allSelected ? t('selectNone') : t('selectAll'),
            ),
            h('span', { style: styles.muted }, t('selected', { count: selected.size })),
            h('span', { style: styles.spacer }),
            h(
              'button',
              {
                type: 'button',
                style: { ...styles.primary, opacity: selected.size === 0 || loading ? 0.5 : 1 },
                disabled: selected.size === 0 || loading,
                onClick: exportPack,
              },
              t('exportAction'),
            ),
          ),
        );
      }

      function renderUpload() {
        return h(
          'div',
          { style: styles.card },
          h(
            'div',
            { style: styles.cardHead },
            h('span', { style: styles.cardTitle }, t('importTitle')),
            h('span', { style: styles.cardHint }, t('importHint')),
          ),
          busy === 'upload'
            ? h('div', { style: styles.muted }, t('uploading'))
            : h(
                'div',
                { style: styles.fileRow },
                h(
                  'label',
                  { style: styles.secondary },
                  t('chooseFile'),
                  h('input', {
                    type: 'file',
                    accept: '.tgz,.tar.gz,application/gzip',
                    style: { display: 'none' },
                    onChange: (event) => {
                      const next = event.target.files && event.target.files[0];
                      setFile(next || null);
                      setPack(null);
                      setUploadId(null);
                      setJob(null);
                      setError(null);
                    },
                  }),
                ),
                h('span', { style: styles.fileName }, file ? `${file.name} · ${formatBytes(file.size)}` : t('noFile')),
                h('span', { style: styles.spacer }),
                h(
                  'button',
                  {
                    type: 'button',
                    style: { ...styles.primary, opacity: file ? 1 : 0.5 },
                    disabled: !file,
                    onClick: uploadPack,
                  },
                  t('checkAction'),
                ),
              ),
        );
      }

      function renderPreview() {
        const source = pack.source || {};
        const sourceText = [
          source.profile ? `${t('envProfile')} ${source.profile}` : null,
          source.dshVersion ? `DSH ${source.dshVersion}` : null,
          source.platform ? `${source.platform}/${source.arch || '—'}` : null,
          source.node ? `Node ${source.node}` : null,
        ]
          .filter(Boolean)
          .join(' · ');
        const selectableCount = (pack.plugins || []).filter(
          (plugin) => selected.has(plugin.name) && selectable(plugin),
        ).length;
        return h(
          'div',
          { style: styles.card },
          h(
            'div',
            { style: styles.cardHead },
            h('span', { style: styles.cardTitle }, t('previewTitle')),
            sourceText ? h('span', { style: styles.cardHint }, `${t('previewFrom')} ${sourceText}`) : null,
          ),
          h(
            'div',
            { style: styles.envRow },
            h(Badge, { kind: 'ok' }, t('countCompatible', { count: pack.counts?.compatible || 0 })),
            h(Badge, { kind: 'warn' }, t('countInstalled', { count: pack.counts?.installed || 0 })),
            h(Badge, { kind: 'err' }, t('countIncompatible', { count: pack.counts?.incompatible || 0 })),
            h(Badge, { kind: 'muted' }, t('countSkipped', { count: pack.counts?.skipped || 0 })),
          ),
          (pack.warnings || []).length > 0
            ? h(
                'div',
                { style: styles.notice },
                h('div', { style: { fontWeight: 600, marginBottom: 3 } }, t('warnings')),
                ...(pack.warnings || []).map((warning) => h('div', { key: warning }, warning)),
              )
            : null,
          h(
            'div',
            { style: styles.list },
            (pack.plugins || []).map((plugin, index) => {
              const view = statusView(plugin.status, t);
              const canSelect = selectable(plugin);
              return h(
                'div',
                { key: plugin.name, style: { ...styles.row, ...(index === 0 ? styles.rowFirst : null) } },
                h('input', {
                  type: 'checkbox',
                  style: styles.check,
                  checked: selected.has(plugin.name) && canSelect,
                  disabled: !canSelect,
                  onChange: () => toggle(plugin.name),
                  'aria-label': plugin.name,
                }),
                h(
                  'div',
                  { style: { minWidth: 0 } },
                  h(
                    'div',
                    { style: styles.nameLine },
                    h('span', { style: styles.name }, plugin.name),
                    h('span', { style: styles.version }, plugin.version || '—'),
                    h(Badge, { kind: view.kind }, view.label),
                    plugin.currentVersion && plugin.currentVersion !== plugin.version
                      ? h(
                          'span',
                          { style: styles.version },
                          t('currentVersion', { version: plugin.currentVersion }),
                        )
                      : null,
                  ),
                  plugin.reason ? h('div', { style: styles.reason }, plugin.reason) : null,
                  plugin.warnings && plugin.warnings.length > 0
                    ? h('div', { style: styles.reason }, plugin.warnings.join('；'))
                    : null,
                ),
                h('span', { style: styles.muted }, plugin.enabled ? t('enabled') : t('disabled')),
              );
            }),
          ),
          h(
            'div',
            { style: styles.footer },
            h(
              'button',
              {
                type: 'button',
                style: styles.linkButton,
                onClick: () => {
                  const allSelected = (pack.plugins || [])
                    .filter(selectable)
                    .every((plugin) => selected.has(plugin.name));
                  setSelected(
                    allSelected
                      ? new Set()
                      : new Set((pack.plugins || []).filter(selectable).map((plugin) => plugin.name)),
                  );
                },
              },
              t('selectAll'),
            ),
            h('span', { style: styles.muted }, t('selected', { count: selectableCount })),
            h('span', { style: styles.spacer }),
            h('button', { type: 'button', style: styles.secondary, onClick: resetImport }, t('retry')),
            h(
              'button',
              {
                type: 'button',
                style: { ...styles.primary, opacity: selectableCount === 0 || busy ? 0.5 : 1 },
                disabled: selectableCount === 0 || Boolean(busy),
                onClick: installSelected,
              },
              busy === 'install' ? t('installing') : t('installAction', { count: selectableCount }),
            ),
          ),
          h('div', { style: styles.muted }, t('installHint')),
        );
      }

      function renderJob() {
        const total = job.total || 0;
        const doneCount = job.done ? total : job.index || 0;
        const percent = total > 0 ? Math.max(3, Math.round((doneCount / total) * 100)) : 5;
        return h(
          'div',
          { style: styles.card },
          h('div', { style: styles.cardHead }, h('span', { style: styles.cardTitle }, t('previewTitle'))),
          h(
            'div',
            { style: styles.muted },
            job.done
              ? t('jobDone')
              : t('jobRunning', {
                  index: Math.min((job.index || 0) + 1, total),
                  total,
                  name: job.current ? ` · ${job.current}` : '',
                }),
          ),
          h('div', { style: styles.progressTrack }, h('div', { style: { ...styles.progressBar, width: `${percent}%` } })),
          (job.rejected || []).length > 0
            ? h(
                'div',
                { style: styles.notice },
                h('div', { style: { fontWeight: 600, marginBottom: 3 } }, t('rejectedTitle')),
                ...(job.rejected || []).map((item) =>
                  h('div', { key: item.name }, `${item.name} — ${item.reason}`),
                ),
              )
            : null,
          (job.results || []).length > 0
            ? h(
                'div',
                { style: styles.list },
                ...(job.results || []).map((result, index) =>
                  h(
                    'div',
                    { key: `${result.name}-${index}`, style: { ...styles.resultRow, borderTop: 'none' } },
                    h(
                      'span',
                      { style: { color: result.ok ? colors.ok : colors.err, fontWeight: 700 } },
                      result.ok ? '✓' : '✗',
                    ),
                    h(
                      'div',
                      { style: { minWidth: 0 } },
                      h(
                        'div',
                        { style: styles.nameLine },
                        h('span', { style: styles.name }, result.name),
                        h('span', { style: styles.version }, result.version || ''),
                        h(
                          'span',
                          { style: { color: result.ok ? colors.ok : colors.err, fontSize: 11.5 } },
                          result.ok ? t('resultOk') : t('resultFail'),
                        ),
                        result.application && result.application !== 'applied'
                          ? h('span', { style: styles.version }, result.application)
                          : null,
                      ),
                      result.reason ? h('div', { style: styles.reason }, result.reason) : null,
                      result.error?.message ? h('div', { style: styles.reason }, result.error.message) : null,
                      result.error?.incompatible
                        ? h(
                            'div',
                            { style: styles.reason },
                            result.error.incompatible
                              .map((item) => `${item.name}@${item.version}: ${JSON.stringify(item.requirements)}`)
                              .join('；'),
                          )
                        : null,
                      result.warnings && result.warnings.length > 0
                        ? h('div', { style: styles.reason }, result.warnings.join('；'))
                        : null,
                    ),
                  ),
                ),
              )
            : null,
          job.error ? h('div', { style: styles.error }, job.error.message || String(job.error)) : null,
          job.done && job.restartRequired ? h('div', { style: styles.notice }, t('jobRestart')) : null,
          h(
            'div',
            { style: styles.footer },
            h('span', { style: styles.spacer }),
            h('button', { type: 'button', style: styles.secondary, onClick: () => void loadStatus() }, t('refresh')),
            h('button', { type: 'button', style: styles.secondary, onClick: resetImport }, t('retry')),
          ),
        );
      }

      return h(
        'div',
        { style: styles.root },
        h('div', null, h('h2', { style: styles.title }, t('title')), h('p', { style: styles.subtitle }, t('subtitle'))),
        renderEnv(),
        error ? h('div', { style: styles.error }, error) : null,
        renderExport(),
        job ? renderJob() : pack ? renderPreview() : renderUpload(),
      );
    }

    return {
      inject: ['slots', 'locale'],
      apply(ctx) {
        const locale = ctx.get('locale');
        const slots = ctx.get('slots');
        ctx.effect(() => locale.register(NS, messages), 'dsh-quick-setup: locale');
        const t = locale.bind(NS);
        function BoundSection() {
          return h(Section, { t });
        }
        ctx.effect(
          () =>
            slots.inject('settings.section', () =>
              slots.register(
                {
                  name: 'settings.section',
                  id: 'quick-setup',
                  order: 45,
                  locale: NS,
                  label: () => t('nav'),
                },
                BoundSection,
              ),
            ),
          'dsh-quick-setup: settings section',
        );
      },
    };
  },
});
