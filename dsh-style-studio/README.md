# 风格工作台 · Style Studio

> 包名 `@local/dsh-style-studio` · 版本 1.3.0 · 已在 DSH Desktop 0.2.2-rc.1 上实测启用

在 **设置 → 通用设置 → 外观** 下方加一行「视觉风格」，用五套手工调色板一键换掉整个 DeepSeek Harness 的外观。每套风格都自带浅色与深色两版，「外观」的浅色 / 深色 / 跟随系统照常工作，风格自动适配。

## 五套风格

| 风格 | 名称 | 气质 |
| --- | --- | --- |
| `ink` | 水墨书画 · Ink & Brush | 宣纸暖白与墨色文字，朱砂、石绿、赭石相间，通篇霞鹜文楷；深色是砚池夜墨、象牙色字与低饱和朱砂，安静而克制。 |
| `midnight` | 深空极夜 · Midnight Sky | 幽蓝深底与冷冽星辉，玻璃质感与柔光，适合夜间长谈。 |
| `forest` | 苔原森野 · Moss & Meadow | 苔绿与奶油的自然配色，圆润柔和的边界，像一本林间手账。 |
| `pixel` | 像素街机 · Pixel Arcade | 8-bit 街机配色：霓虹洋红与青蓝、直角边框与硬边投影，像一台老式游戏机的界面。 |
| `mono` | 石墨黑白 · Graphite Mono | 纯黑白灰与利落直角，高对比的极简编辑部风格。 |

## 为什么是「通用设置」里的一行

DSH 的设置导航按分区 id 选图标，第三方分区 id 会回落到「通用设置」的齿轮图标，像是一行重复的导航项。所以本插件不新增设置分区，而是用「外观」行同样的席位 `settings.general.item` 在通用设置里加一行：设置弹窗、内边距和滚动都交给宿主，插件只负责这一行的内容。

## 功能

- **一行入口**：「设置 → 通用设置」中「外观」下方新增「视觉风格」行，点选芯片立即生效，不新增侧边设置导航项。
- **五套完整调色板**：每套风格含 36 个颜色（浅色 / 深色各一套）与 13 项与配色无关的语言（字体、圆角、阴影、菜单模糊）。水墨书画另有单独的深色阴影档，像素街机使用 0 圆角与硬边位移阴影。
- **覆盖面广**：一次改写 110 个宿主 token——`--dsw-alias-*`、`--dsw-specific-*`、代码块与行内代码、滚动条、菜单材质、toast、开关滑块、思考过程渐隐、字体、圆角与三级阴影，面板、会话、输入框、菜单、对话框以及任何基于 token 的插件都会跟着变。
- **浅深自适应**：风格只提供调色板，「外观」行仍然掌握浅色 / 深色 / 跟随系统的决定权，切换外观时风格自动换到对应版本。
- **恢复默认**：行右侧的「恢复默认」清除当前风格，回到原生外观；未选风格时按钮禁用。
- **记住选择**：选择保存在浏览器 localStorage，刷新或重启后在同一个浏览器里自动恢复。
- **风格芯片**：每个芯片显示浅 / 深半色块、强调色圆点与本地化名称，悬停显示风格说明，选中态带 `aria-pressed`。
- **中英界面**：名称与说明随 DSH 界面语言切换。

## 覆盖范围

| 类别 | 覆盖的 token 举例 |
| --- | --- |
| 底色与层级 | `--dsw-alias-bg-base`、`bg-layer-1/2/3`、`bg-overlay`、`bg-module-platform` |
| 文字 | `label-primary`、`label-secondary`、`label-tertiary`、`label-caption` |
| 边框 | `border-l1` ~ `border-l4` |
| 品牌与状态 | `brand-primary`、`state-success/warn/error-primary` |
| 交互与代码 | `interactive-bg-hover`、`markdown-code-block`、`markdown-inline-code` |
| 组件 | toast、switch-thumb、scrollbar、menu 材质与分组标题 |
| 排版与形状 | `font-family*`、`radius-*`、`shadow-lv1/2/3`、`menu-backdrop-filter` |
| 思考过程 | `--dsw-linear-gradient-think`、`--dsw-linear-think-select` |

## 使用

1. 打开设置：Desktop 用侧栏底部的 Settings，或按 `Ctrl/Cmd + ,`。
2. 进入 **通用设置**，在「外观」下方找到「视觉风格」。
3. 点任意风格芯片，整个应用立即换肤；鼠标悬停在芯片上可以看该风格的说明。
4. 想还原时点行右侧「恢复默认」。
5. 浅色 / 深色 / 跟随系统仍由上方「外观」控制，风格跟着自动适配。

## 与「外观」的关系

「外观」仍拥有浅色 / 深色 / 跟随系统的决定权，「视觉风格」只决定配色、字体、圆角与阴影的语言，两者正交：水墨书画 + 深色 = 砚池夜墨；像素街机 + 浅色 = 米白纸面与 8-bit 强调色。风格不会改写「外观」的选择，也不会写进 DSH 配置。

## 安装

完整的安装、升级与卸载步骤见 [docs/INSTALL.md](../docs/INSTALL.md)；**每个插件单独安装**。本插件常用：

1. **方式 B：从本地文件夹安装（桌面端推荐、可离线）**：DSH Desktop 左侧栏「插件」→ 右上角「添加插件」→ 填本插件文件夹的**绝对路径**（本机为 `D:\github\dsh-plugins\dsh-style-studio`）→「安装」→「立即启用」。
2. **方式 A：从插件索引安装**：插件页「发现」标签 →「添加索引源」→ 填 `https://raw.githubusercontent.com/stuPETER12138/dsh-plugins/main/index.json` → 找到本插件 →「安装」→「立即启用」。索引方式**需要本机能访问 GitHub**。
3. **方式 D：命令行（`dsh` CLI profile）**：`dsh plugin --profile <profile> add "link:<本插件绝对路径>"`。DSH 0.2.2 会自动把它写进该 profile 的 `dsh.profile.bundles`，重启 profile 后生效；Desktop 的 `desktop` profile 请用方式 A / B，不要从外部 CLI 改。

也可以直接让 DSH 里的 Agent 安装（方式 C），效果与方式 B 相同。

安装时必须注意：路径必须是**绝对路径**；**每个插件独立安装**，插件之间没有依赖；桌面端请走**插件页**，不要手改 profile 文件。

其他插件与仓库总览见[根 README](../README.md)。

## 验证生效

- 插件页里本插件显示为已启用，没有「不可用」标记；
- 「设置 → 通用设置」在「外观」下方能看到「视觉风格」行和五个芯片；
- 点「水墨书画」：浅色下界面变成宣纸暖白 / 墨色文字，深色下变成砚黑 / 象牙字，侧栏、会话气泡、代码块、菜单同步改变；
- 点「恢复默认」：回到原生配色，localStorage 里的选择被移除；
- 刷新页面后，上次选的风格自动恢复。

## 兼容性

- **实测环境**：DSH Desktop 0.2.2-rc.1、Windows 11、Node 24.21.0 / pnpm 11.28.5；插件在本机已启用。
- **用到的扩展点**：`ctx.theme.overrideTokens(source, layer)` 主题覆盖层与 `theme/change` 事件、`slots`（`settings.general.item`）、`locale`；浏览器侧声明 `inject = ['slots', 'locale', 'theme']`，Host 半边的 `index.js` 是空实现。
- **CSS 能力**：`color-mix()`（Chromium 111+）、`body[data-ds-dark-theme]` 深色标记与 `--dsw-*` token 表；DSH Desktop 自带的 Electron 满足要求。
- **平台**：覆盖层与 body 属性都是 Web 前端机制，Windows / macOS / Linux 的桌面端与浏览器端理论上一致；实际只在本机 Windows 11 上测试。

## 数据与隐私

- **localStorage 键**：`dsh.style-studio.v1`，值是风格 id 的原始字符串（`ink` / `midnight` / `forest` / `pixel` / `mono`）；「恢复默认」时删除该键。
- **只在本机**：不联网、无遥测、不写本机文件、不与 Host 通信。
- **不改动宿主**：切换风格只做三件事——设置 `document.body` 的 `data-dsh-style` 属性、注入插件自己的样式表、在内存里注册 / 释放 token 覆盖层；不修改 DSH 源码、配置文件或「外观」偏好。

## 文件结构

| 文件 | 作用 |
| --- | --- |
| `package.json` | bundle 声明：`dsh.bundle.patch`、`dsh.client.platform = web`，并声明依赖的主题 / 设置前端包 |
| `cordis.patch.yml` | 向 Loader 插入一行 `style-studio` 插件行 |
| `index.js` | Host 半边：空的 `apply()`，仅让 Loader 行存在 |
| `client.js` | 浏览器半边：五套调色板、110 个 token 的映射层、设置行组件与调色板样式表 |
| `locale/zh.json`、`locale/en.json` | 插件管理页显示的标题与描述 |
| `icon.svg` | 插件图标 |
| `README.md` | 本文档 |

## 工作原理

1. **设置行**：向 `settings.general.item` 注册 `id: visual-style`、`order: 12` 的行，内容为标题、说明、「恢复默认」按钮和五个风格芯片。
2. **调色板**：`COLOR_KEYS` 的 36 个颜色键与 `COMMON_KEYS` 的 13 个语言键会转成 `--dsh-style-*` 自定义属性；五套 `PRESET_SPECS` 各带 `light`、`dark` 与 `common`，水墨书画另带 `commonDark`。加载时 `assertPreset()` 校验缺键并直接抛错，避免悄悄渲染出坏配色。
3. **变量层**：插件样式表为每套风格生成两条规则——`body[data-dsh-style="<id>"]` 声明浅色调色板，`body[data-dsh-style="<id>"][data-ds-dark-theme]` 声明深色调色板（以及可选的深色阴影）。
4. **token 层**：110 个宿主 token 由 `overrideTokens` 映射到 `var(--dsh-style-*)`；其中 68 个是直投，42 个是组合值（`color-mix()`、`linear-gradient()`，以及用 `var(--dsh-font-family-text, …)` 包一层以保证用户自选字体优先）。同一表达式同时用于浅色和深色，最终颜色由调色板变量决定。
5. **切换**：`applyStyle()` 写入 body 属性 → 重新注册同一个 source 的覆盖层（旧层被替换，只发一次 `theme/change`，JS 主题消费者与主题色元数据随之更新）→ 持久化选择 → 通知订阅者刷新芯片选中态。
6. **恢复默认**：删除 body 属性并释放覆盖层，宿主原生 token 立即生效。
7. **卸载 / 禁用**：插件注册的清理函数会释放覆盖层、清掉 body 属性，样式表随插件移除，外观即时恢复原生。

## 实现取舍

- **走主题覆盖层，不改宿主**：`overrideTokens` 是 DSH 公开的主题接缝；覆盖层释放后原生 token 立即回来，禁用或卸载插件不会留下痕迹。
- **调色板是数据**：五套风格只是 `light` / `dark` / `common`（+ 可选 `commonDark`）几个对象，新增风格只需要加一段数据，不用改渲染逻辑。
- **一次原子切换**：切换只写一个 body 属性和一层 token，宿主只收到一次 `theme/change`，避免逐 token 刷新造成的闪烁。
- **校验前置**：`assertPreset()` 在加载时就检查 36 个颜色键（浅 / 深各一套）与 13 个语言键，缺一个就抛错，而不是渲染出一半的配色。

## 卸载与数据清理

1. 在插件页卸载本插件（或按 [INSTALL.md](../docs/INSTALL.md) 的 CLI 方式移除 `@local/dsh-style-studio`）。卸载会自动撤销 token 覆盖层和 body 属性，界面回到原生外观。
2. 如需清除记住的选择，在 DSH 开发者工具里执行：

   ```js
   localStorage.removeItem('dsh.style-studio.v1')
   ```

   不清除的话，重新安装插件后会自动恢复上次的风格。
3. 插件不写任何本机文件或配置，卸载后没有其他残留。

## 已知限制

- **首屏闪一下原生配色**：刷新时宿主启动脚本不认识第三方调色板，要等客户端插件加载后才应用风格，这一瞬间是原生外观，属预期行为。
- **macOS 侧栏例外**：macOS 桌面端侧栏有一层宿主硬编码的渐变底色（`ui-layout`），不经过主题 token，任何风格都改不到；其余界面正常。本仓库未在 macOS 上实测，此条来自开发记录。
- **自定义字体优先**：用户在「外观」里选过字体时，风格里的文字与代码字体让位（宿主 token 用 `var(--dsh-font-family-text, …)` 包装）；水墨书画与像素街机只在没设自定义字体时才改变正文与代码字体。
- **字体回退**：水墨书画首选霞鹜文楷（LXGW WenKai）与霞鹜文楷等宽，像素街机首选 Cascadia Mono / Code；机器上没装时回退到宋体 / Consolas 等系统字体，观感会有差别。
- **第三方插件内联颜色改不到**：硬编码颜色（而不是用 `--dsw-*` token）的界面元素不会跟随风格。
- **不改外观偏好**：风格切换不修改「外观」的浅 / 深设置，也不写入 DSH 配置；它只影响当前浏览器。
- 五套调色板为原创配色，插件不含图片或字体文件。

## 常见问题

- **刷新后先闪一下原生配色？** 是预期行为：宿主启动脚本不知道第三方调色板，要等客户端插件加载完才应用。
- **换了风格但字体没变？** 先在「外观」里确认没有设置自定义字体；自定义字体优先于风格字体。
- **卸载后界面会恢复吗？** 会。覆盖层与 body 属性都在插件清理函数里释放，样式表也随插件移除。
- **切换浅色 / 深色后风格还在吗？** 在。每套风格都有两套调色板，跟随「外观」自动切换。

## 许可证

MIT License。可自由使用、修改与分发，请保留版权声明；插件按「现状」提供，不附带任何明示或暗示的担保。完整文本见仓库根目录的 [LICENSE](../LICENSE)。
