# dsh-quick-setup

把本机已安装的**第三方 DSH 插件**导出成便携插件包，在另一台电脑或同一主机上的另一个 DSH 实例中检查兼容性后**批量安装**。

除了携带插件代码的完整 `.dshpack.tgz`，也支持只导出**插件信息清单**（`.plugins.txt`）：清单只记录插件名与版本号（或不带版本号），导入时逐个从 npm 安装对应版本，体积只有几百字节，适合在不同机器间快速对齐插件集合。

适合这些场景：

- 多台电脑之间同步 DSH 插件；
- 一台 Linux/Windows 主机上有多个互相隔离的 DSH profile，需要把插件从 A 实例复制到 B 实例；
- 重装系统或新机器开荒时，不想逐个搜索、逐个安装插件。

## 它做什么

**导出（源实例）**

1. 通过 DSH 官方的 `pluginManager.listBundles()` 读取当前 profile 的插件。
2. 只保留**第三方、已安装**的 bundle；官方内置 bundle 和 `dsh-quick-setup` 自身不会被打包。
3. 两种导出形式：
   - **完整插件包**（默认）：把每个插件的包目录（跳过 `node_modules`、`.git` 等）原样写入外层归档，再与 `dsh-quick-setup-pack.json` 清单一起打成 `.dshpack.tgz`。插件包的来源环境会写入清单：DSH 版本、profile 名、Node、Electron、OS、CPU 架构、打包时间。
   - **仅插件信息**：勾选“仅导出插件信息”后，生成一个 UTF-8 文本 `.plugins.txt`，头部是 `# dsh-quick-setup/plugins@1` 格式标记、profile、DSH 版本与导出时间，正文每行一个 `插件名@版本号`。子选项“包含当前版本号”（默认勾选）决定正文格式：
     - 勾选：`name@1.2.3`，导入时从 npm 安装这个**精确版本**；
     - 不勾选：只写 `name`，导入时安装 npm 上的 **latest**。

**导入（目标实例）**

1. 接收 `.dshpack.tgz`（`application/gzip`）或 `.plugins.txt`（`text/plain`），按上传内容自动识别：
   - 插件包：在临时目录中安全解包（拒绝绝对路径、`..`、越界条目，跳过符号链接），重新读取每个插件的 `package.json`，按**目标实例**的实际环境复算兼容性：
     - `engines.dsh` 优先；没有它时检查 `peerDependencies` 里的 `@deepseek-ai/dsh` / `@deepseek-ai/dsh-*`；
     - `engines.node`、`os`、`cpu`；
     - 是否已安装、已装版本是更高还是更低（升级/降级/同版本）。
   - 插件信息清单：解析文本格式（容忍 BOM、CRLF、注释行、空行、重复项），对未安装条目调用官方 `pluginManager.inspect()`（内部走 `pnpm view`）到 npm 上核对：包是否存在、是否是 DSH 插件、最新版本与描述；已安装条目不再请求 npm。
2. 在设置页展示可安装、已安装、不兼容、版本冲突四类结果；**只有用户确认后**才安装。
3. 完整插件包里的每个选中插件以 `file:` tarball 形式交给 `pluginManager.installBundle()`；插件信息清单里的每个选中条目以 npm spec（`name@version` 或裸 `name`，即 latest）交给同一个接口，由 DSH 自己执行 pnpm 安装、构建脚本审批与最终兼容性校验；本插件不直接改写 profile 的 `package.json`，也不自行运行包管理器。
4. 安装一个插件后 DSH 会热重载组合（本插件的 Host 半也会被重启），因此界面按“一次请求装一个”的顺序逐个推进，并在响应被热重载截断时通过状态接口核对实际结果；不会因为一次重载丢掉整批任务。

## 安装

在 DSH 中让 agent 执行：

```text
plugin_manager action=install_bundle target=C:\path\to\dsh-quick-setup
```

或使用插件管理页的“从本地目录安装”，选择本目录。安装完成后重启 DSH，在 **设置 → 快速安装** 打开页面。

## 使用

1. **导出**：打开设置页，勾选要带走的插件，点“导出插件包”，得到一个 `dsh-quick-setup-<profile>-<时间>.dshpack.tgz`。
   - 如果只想同步插件名和版本，勾选“仅导出插件信息”，得到 `dsh-quick-setup-<profile>-<时间>.plugins.txt`；
   - 该模式下可再选择“包含当前版本号”（默认勾选）：取消勾选则清单只写插件名，目标实例安装 npm 上的 latest。
2. **传输**：U 盘、scp、网盘均可。
3. **导入**：在目标 DSH 的同一设置页选择文件（`.dshpack.tgz` 或 `.plugins.txt` 都接受）→ “检查兼容性” → 核对报告 → “安装选中的插件”。
4. 若结果里出现 `restart-required`，重启目标 DSH 后在插件页确认状态。

## 插件包内容与边界

插件包只包含插件**代码与包元数据**，不包含：

- DSH 账号、API Key、模型凭据；
- 聊天记录、会话数据库、工作区文件；
- 插件自己的设置值（例如音乐播放器的目录配置）；
- 原实例的 `node_modules`（避免绝对软链与平台相关二进制；依赖由目标实例的包管理器重新解析）。

插件信息清单（`.plugins.txt`）**只有插件名和版本号**（或只有插件名），不含代码、描述与来源 registry；导入时目标实例必须能访问这些包所在的 npm registry（镜像、代理或私有 registry 需已在目标 profile 配置好）。

已知限制：

- 含原生模块（`.node`）或平台限定的可选依赖的插件，可能在目标平台安装失败；报告会给出原始错误。
- 需要执行安装脚本的插件，会被 DSH 官方安装流程拦下并要求确认；本插件不会绕过该确认。
- 清单里的 `requirements` 只是导出时的快照，导入时以目标实例重新计算的报告为准。
- **同名插件的升级/降级不会自动执行**：DSH 的 `pluginManager.installBundle()` 在热重载模式下会拒绝已存在的包名。快速安装会把这类条目标成“版本冲突”，请先在插件管理里移除旧版本，再导入新包或新清单。清单里已安装且版本相同的条目会标为“已安装”，不会重复安装。
- 插件信息清单导入时，未安装条目会通过 `pnpm view` 查询 npm（并发 4、单条 15 秒超时）。网络不可用时会给出警告，条目仍可手动尝试安装；包不存在或不是 DSH 插件的条目会被标为无效并默认不选。
- 不处理插件自己的私有配置文件；这类文件通常应单独复制。

## HTTP 接口（同源，内部使用）

| 方法 | 路径 | 用途 |
| --- | --- | --- |
| GET | `/dsh-quick-setup/api/status` | 当前环境 + 可导出的第三方插件 |
| GET | `/dsh-quick-setup/api/export?plugin=<name>&plugin=…` | 流式下载完整插件包（无参数则导出全部） |
| GET | `/dsh-quick-setup/api/export?mode=info&withVersion=0\|1` | 下载插件信息清单（`text/plain`；`withVersion=0` 时只写插件名，默认带版本号） |
| POST | `/dsh-quick-setup/api/upload` | 上传插件包（`application/gzip`）或插件清单（`text/plain`），生成兼容性预览 |
| POST | `/dsh-quick-setup/api/install` | 安装**一个**选中条目（JSON：`{uploadId, name}`；清单条目按 `name@version` 或裸 `name` 装 npm 包） |

POST 需要 `x-dsh-quick-setup: 1` 头；所有接口都做同源检查。插件清单上传上限 1 MiB，插件包 1 GiB。

## 开发与验证

- Host 端没有 npm 运行时依赖；tar 读写、版本范围判断、插件清单解析都在 `lib/` 中实现，避免给 profile 增加依赖。
- 安装到 profile 后，可用以下命令验证接线、打包、兼容性报告与插件清单格式：

```bash
node scripts/smoke.mjs
# 也可以额外验证一个真实插件目录：
node scripts/smoke.mjs <profileDir>/node_modules/<plugin>
```

smoke 会在临时目录生成一个只含 `package.json` 的假插件包，走一遍“打包 → 解包 → 清单校验”的闭环，并覆盖 `.plugins.txt` 的格式化/解析往返、带/不带版本号、CRLF/BOM/注释/重复/非法行容错、格式版本拒绝，不安装任何东西。

- 在真实 Host 中验证时注意：`index.js`（Host 半）只在插件加载时执行，修改后需要重启 DSH 才会生效；`client.js` 走开发期热更新。可用 `curl`（GET）或页面操作验证，POST 需带 `x-dsh-quick-setup: 1`。
