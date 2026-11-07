# 开发与发布

本仓库每个插件都是一个自包含的 DSH 组合包（bundle package），不依赖第三方 npm 包、不需要编译（`dsh-session-share` 的浏览器产物需要一次内联构建，已在仓库中提交）。本文说明插件结构、如何本地调试、如何校验与发布。

## 目录约定

```text
dsh-plugins/
├─ <plugin-dir>/              # 一个插件一个文件夹，目录名 = 包名去掉 @local/ 前缀
│  ├─ package.json            # 包名、版本、exports、files、dsh 清单
│  ├─ cordis.patch.yml        # bundle patch：向 profile 组合里插入一行插件
│  ├─ index.js                # Host 半（在 DSH Host 进程内运行的 ESM 模块）
│  ├─ client.js               # 浏览器半（DSH Web 客户端模块）
│  ├─ locale/en.json|zh.json  # 插件管理页展示用的标题/描述（meta.title/meta.description）
│  ├─ icon.svg                # 插件卡片图标
│  ├─ README.md               # 面向用户的功能、安装、使用说明
│  └─ src/ tools/ notes/ ...  # 可选：源码、构建脚本、单元测试（session-share 有）
├─ index.json                 # 由 scripts/generate-index.mjs 生成的插件市场索引
├─ docs/                      # 安装、兼容性、开发、验证文档
└─ scripts/                   # 校验、索引生成、安装验证脚本
```

## 插件由哪几部分组成

### 1. `package.json` 的 `dsh` 清单

```jsonc
{
  "name": "@local/dsh-sticky-wall",
  "version": "1.1.0",
  "type": "module",
  "main": "index.js",
  "exports": {
    ".": "./index.js",
    "./client": "./client.js",
    "./locale/*.json": "./locale/*.json",
    "./icon": "./icon.svg",
    "./package.json": "./package.json"
  },
  "files": ["index.js", "client.js", "cordis.patch.yml", "locale/*.json", "icon.svg", "README.md"],
  "dsh": {
    "bundle": { "patch": "./cordis.patch.yml" },
    "client": {
      "platform": "web",
      "immediately": true,
      "inject": ["@deepseek-ai/dsh-client-ui-settings", "@deepseek-ai/dsh-client-locale"]
    }
  }
}
```

- `dsh.bundle.patch`：指向 bundle patch 文件；没有它，插件管理器会拒绝安装（`not-a-bundle`）。
- `dsh.client`：浏览器半的声明。`platform: "web"` 表示 Web 客户端加载；`immediately: true` 表示随客户端启动立即加载；`inject` 列出这个浏览器模块依赖的 DSH 客户端模块（模块解析顺序）。
- `files`：**对 Git 安装很重要**——通过 `git+https://...#commit&path:/<dir>` 安装时，pnpm 会按 npm pack 规则打包，`files` 之外的文件不会进入安装结果。务必把运行时需要的文件（`index.js`、`client.js`、`cordis.patch.yml`、`locale/*.json`、`icon.svg`）都列全。

### 2. `cordis.patch.yml`

```yaml
# Bundle patch: insert one row for this plugin.
- insert:
    - id: sticky-wall
      name: '@local/dsh-sticky-wall'
      config: {}          # 可选：该行插件配置，会传给 apply(ctx, config)
```

一行 = 插件的一个 Host 条目。`id` 必须在整个 profile 里唯一；`name` 必须是包名（或包内子路径模块）。插件若需要可配置参数（如 `dsh-usage-stats` 的价格表），在 `config` 下写默认值，并在 README 里说明如何覆盖。

### 3. Host 半 `index.js`

普通 ESM 模块，导出 Cordis 插件入口（本仓库均为命名导出 `apply(ctx, config)`）。它只能在 DSH Host 进程内运行，可以使用 `node:` 内置模块和 DSH 提供的公开 Service（`ctx.sessionPersistence`、`ctx.sessionQuery`、`ctx.attachments`、`ctx.webServer` 等）。约定：

- 入口要**容错**：插件加载失败不应让整个 profile 崩溃；`apply` 内部用 `try/catch` 包住可失败的操作，并 `ctx.logger` 记录。
- HTTP 路由只允许回环访问（校验 peer 地址 / `Host` / `Origin`），响应加 `cache-control: no-store`，不在插件目录写文件。
- 大量计算放到需要时再做（例如 `dsh-usage-stats` 首次打开面板才扫描日志），不要阻塞 Host 启动。

### 4. 浏览器半 `client.js`

DSH Web 客户端模块系统的约定格式（不要用普通 ESM `export`）：

```js
window.__ModuleLoader__.load({
  id: '@local/dsh-xxx',
  factory: (require) => {
    const React = require('react')   // 平台模块表提供，见 dsh.client.external / inject
    // ... 注册插槽、页面、样式
  },
})
```

- 只能 `require` 平台模块表里已有的模块（React、DSH 客户端模块等），不能 `import` npm 包或 Node 内置模块。
- 通过 `ctx.slots.inject(...)` / `ctx.slots.register(...)` 注册入口与面板，并跟随插槽的声明/销毁生命周期。
- 颜色、字体、圆角等一律用 `--dsw-*` / `--ds-*` 主题 token，保证浅色/深色与 Style Studio 等主题插件兼容。
- 出错时让组件隐藏自身或渲染错误态，不要让整个插槽崩掉。

### 5. locale 与 icon

`locale/en.json`、`locale/zh.json` 的 `meta.title` / `meta.description` 是插件管理页卡片与设置列表显示的文字；`icon.svg` 是卡片图标。`meta.detail`（可选）可指向一个 Markdown 文件，用于插件页的详细介绍（本仓库没有使用，README 由安装后的文档读取）。

> 新增插件时保持 `en.json` 存在：插件市场的本地化文本要求 `en`。

## 本地开发

### 推荐：隔离 profile（不影响正在使用的 DSH Desktop）

DSH Desktop 自带命令行运行时，可以创建一个独立的 `DSH_HOME` 和 profile 来调试：

```powershell
$env:DSH_HOME = 'D:\dsh-dev-home'
$cli = 'D:\Software\DeepseekHarness\resources\runtime\cli\bin\dsh.cmd'

# 1. 用 web 模板创建开发 profile（会打印组合后的配置树）
& $cli --profile dev --from-default-profile web --dump-config

# 2. 把要调试的插件以本地链接安装进去（自动加入 dsh.profile.bundles）
& $cli plugin --profile dev add "link:D:\github\dsh-plugins\dsh-sticky-wall"

# 3. 启动 Web 服务（--port 0 让系统分配空闲端口，--no-open 不弹浏览器）
& $cli --profile dev --port 8080 --no-open
```

打开打印出的 URL 即可调试。改 `client.js` 后通常刷新页面即可看到；改 Host 半（`index.js`）需要重启该进程。

### 在桌面端里调试

把插件以 `link:<绝对路径>` 的形式装进 `desktop` profile（插件页「添加插件」），改代码后：

- 浏览器半：保存后 HMR 会更新客户端模块，刷新页面；
- Host 半：重启 DSH Desktop 才会加载新的模块代际。

数据目录与用户真实 DSH 相同（`$DSH_HOME` 默认为 `C:\Users\<你>\.dsh`）。

### `dsh-session-share` 的构建步骤

它的浏览器半由 `src/client-shell.js` + `src/export-core.js` 内联生成到 `client.js`。改 `src/` 后必须重建：

```powershell
cd dsh-session-share
node tools/build-client.mjs
node --check client.js
node tools/test-transcript.mjs
node tools/test-export-core.mjs
node tools/test-host.mjs
```

其它插件没有构建步骤，`client.js` 就是源文件。

## 仓库脚本

| 脚本 | 作用 |
| --- | --- |
| `node scripts/verify-repo.mjs` | 静态校验：manifest、bundle patch、exports、JS 语法、locale、机器绝对路径/敏感信息扫描、README 是否齐全 |
| `node scripts/generate-index.mjs` | 重新生成 `index.json`（读取各插件 package.json + locale + icon，固定到当前 Git commit） |
| `powershell -File scripts/verify-install.ps1` | 在隔离的临时 profile 里用 DSH 运行时逐个安装并启动验证（参数见 `-Help` 或脚本头注释） |

## 发布 / 更新流程

1. 修改插件代码或 README，本地验证功能。
2. 跑静态校验与单元测试：

   ```powershell
   node scripts/verify-repo.mjs
   cd dsh-session-share; node tools/test-transcript.mjs; node tools/test-export-core.mjs; node tools/test-host.mjs; cd ..
   ```

3. 提交代码（**先提交插件代码**）：

   ```powershell
   git add -A
   git commit -m "feat(dsh-xxx): ..."
   ```

4. 重新生成索引（索引把每个插件的版本固定到**当前 HEAD commit**）：

   ```powershell
   node scripts/generate-index.mjs
   git add index.json
   git commit -m "chore: refresh plugin index"
   git push
   ```

5. 推送后抽查：`https://raw.githubusercontent.com/stuPETER12138/dsh-plugins/main/index.json` 可访问且内容正确；在 DSH 的「发现」页刷新索引能读到新版本。

> 注意：索引锁定的 commit 必须包含要安装的插件代码。若改了插件但没重新生成索引，索引仍会安装旧 commit 的内容（这是 DSH 插件市场「按 commit 固定」的语义）。

## 新增一个插件

1. 复制一个现有插件目录为模板（`package.json`、`cordis.patch.yml`、`index.js`、`client.js`、`locale/`、`icon.svg`），改包名（`@local/dsh-<kebab-name>`）、行 id、locale 文案与图标。
2. 按插件实际行为更新 `dsh.client.inject`、`dsh.bundle.patch`、`files`。
3. 在 `scripts/generate-index.mjs` 的插件配置表里增加目录名、分类与关键词。
4. 在根 `README.md` 的插件表与目录树里登记；在 `docs/VERIFICATION.md` 补一条验证记录。
5. 跑 `node scripts/verify-repo.mjs`、`node scripts/generate-index.mjs`，按发布流程提交。

## 约定与红线

- 插件名统一 `@local/dsh-*`；版本遵循 SemVer。
- 不引入第三方运行时依赖；确需依赖者必须能随包安装并在 README 说明。
- 不读取、不上传用户会话内容；需要读本机数据时说明用途与存储位置。
- 不在源码里写死任何机器路径、用户名、API Key、代理地址。
- 不修改 DSH 自身文件；插件只通过公开 Service/插槽扩展。
- 每个插件 README 必须能让陌生用户从零完成「安装 → 启用 → 验证生效 → 卸载」。
