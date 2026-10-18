# dsh-quick-setup

把本机已安装的**第三方 DSH 插件**导出成便携插件包，在另一台电脑或同一主机上的另一个 DSH 实例中检查兼容性后**批量安装**。

适合这些场景：

- 多台电脑之间同步 DSH 插件；
- 一台 Linux/Windows 主机上有多个互相隔离的 DSH profile，需要把插件从 A 实例复制到 B 实例；
- 重装系统或新机器开荒时，不想逐个搜索、逐个安装插件。

## 它做什么

**导出（源实例）**

1. 通过 DSH 官方的 `pluginManager.listBundles()` 读取当前 profile 的插件。
2. 只保留**第三方、已安装**的 bundle；官方内置 bundle 和 `dsh-quick-setup` 自身不会被打包。
3. 把每个插件的包目录（跳过 `node_modules`、`.git` 等）原样写入外层归档，再与 `dsh-quick-setup-pack.json` 清单一起打成 `.dshpack.tgz`。
4. 插件包的来源环境会写入清单：DSH 版本、profile 名、Node、Electron、OS、CPU 架构、打包时间。

**导入（目标实例）**

1. 接收 `.dshpack.tgz`，在临时目录中安全解包（拒绝绝对路径、`..`、越界条目，跳过符号链接）。
2. 重新读取每个插件的 `package.json`，按**目标实例**的实际环境复算兼容性：
   - `engines.dsh` 优先；没有它时检查 `peerDependencies` 里的 `@deepseek-ai/dsh` / `@deepseek-ai/dsh-*`；
   - `engines.node`、`os`、`cpu`；
   - 是否已安装、已装版本是更高还是更低（升级/降级/同版本）。
3. 在设置页展示可安装、已安装、不兼容、版本冲突四类结果；**只有用户确认后**才安装。
4. 每个选中插件以 `file:` tarball 形式交给 `pluginManager.installBundle()`，由 DSH 自己执行 pnpm 安装、构建脚本审批与最终兼容性校验；本插件不直接改写 profile 的 `package.json`，也不自行运行包管理器。
5. 安装一个插件后 DSH 会热重载组合（本插件的 Host 半也会被重启），因此界面按“一次请求装一个”的顺序逐个推进，并在响应被热重载截断时通过状态接口核对实际结果；不会因为一次重载丢掉整批任务。

## 安装

在 DSH 中让 agent 执行：

```text
plugin_manager action=install_bundle target=C:\path\to\dsh-quick-setup
```

或使用插件管理页的“从本地目录安装”，选择本目录。安装完成后重启 DSH，在 **设置 → 快速安装** 打开页面。

## 使用

1. **导出**：打开设置页，勾选要带走的插件，点“导出插件包”，得到一个 `dsh-quick-setup-<profile>-<时间>.dshpack.tgz`。
2. **传输**：U 盘、scp、网盘均可。
3. **导入**：在目标 DSH 的同一设置页选择文件 → “检查兼容性” → 核对报告 → “安装选中的插件”。
4. 若结果里出现 `restart-required`，重启目标 DSH 后在插件页确认状态。

## 插件包内容与边界

插件包只包含插件**代码与包元数据**，不包含：

- DSH 账号、API Key、模型凭据；
- 聊天记录、会话数据库、工作区文件；
- 插件自己的设置值（例如音乐播放器的目录配置）；
- 原实例的 `node_modules`（避免绝对软链与平台相关二进制；依赖由目标实例的包管理器重新解析）。

已知限制：

- 含原生模块（`.node`）或平台限定的可选依赖的插件，可能在目标平台安装失败；报告会给出原始错误。
- 需要执行安装脚本的插件，会被 DSH 官方安装流程拦下并要求确认；本插件不会绕过该确认。
- 清单里的 `requirements` 只是导出时的快照，导入时以目标实例重新计算的报告为准。
- **同名插件的升级/降级不会自动执行**：DSH 的 `pluginManager.installBundle()` 在热重载模式下会拒绝已存在的包名。快速安装会把这类条目标成“版本冲突”，请先在插件管理里移除旧版本，再导入新包。
- 不处理插件自己的私有配置文件；这类文件通常应单独复制。

## HTTP 接口（同源，内部使用）

| 方法 | 路径 | 用途 |
| --- | --- | --- |
| GET | `/dsh-quick-setup/api/status` | 当前环境 + 可导出的第三方插件 |
| GET | `/dsh-quick-setup/api/export?plugin=<name>&plugin=…` | 流式下载插件包（无参数则导出全部） |
| POST | `/dsh-quick-setup/api/upload` | 上传并解包、生成兼容性预览（`application/gzip`） |
| POST | `/dsh-quick-setup/api/install` | 安装**一个**选中条目（JSON：`{uploadId, name}`） |

POST 需要 `x-dsh-quick-setup: 1` 头；所有接口都做同源检查。

## 开发与验证

- Host 端没有 npm 运行时依赖；tar 读写、版本范围判断都在 `lib/` 中实现，避免给 profile 增加依赖。
- 安装到 profile 后，可用以下命令验证接线、打包与兼容性报告：

```bash
node scripts/smoke.mjs
# 也可以额外验证一个真实插件目录：
node scripts/smoke.mjs <profileDir>/node_modules/<plugin>
```

会在临时目录生成一个只含 `package.json` 的假插件包，走一遍“打包 → 解包 → 清单校验”的闭环，不安装任何东西。
