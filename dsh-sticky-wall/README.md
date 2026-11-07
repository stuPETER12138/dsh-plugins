# 便签墙 · Sticky Wall

带左侧栏入口的 DSH Web 插件：灵感来的一瞬间先贴到墙上，重要的置顶，以后用搜索找回。

- 左侧栏「便签墙」行打开整页便签墙，输入框自动聚焦。
- `⌘/Ctrl + Enter` 保存；置顶、搜索、六种便签纸颜色、双击编辑、复制。
- 便签保存在本机（`localStorage`，键 `dsh.sticky-wall.notes.v1`），切换面板／刷新／重启都在。
- 删除后 6 秒内可撤销。
- 颜色全部取自 `--dsw-*` 主题 token，深色主题（`body[data-ds-dark-theme]`）下便签纸色、边框与投影单独调过。

## 文件

| 文件 | 作用 |
| --- | --- |
| `package.json` | bundle 声明（`dsh.bundle.patch`、`dsh.client`） |
| `cordis.patch.yml` | 插入一行 `sticky-wall` 插件行 |
| `index.js` | Host 半侧：空 `apply`，只为让 Loader 行存在 |
| `client.js` | 浏览器半侧：`sidebar.panellist` + `main` 两个席位，含页面、样式、本地存储 |
| `locale/{en,zh}.json` | 插件管理页的标题与描述 |
| `icon.svg` | 插件行图标 |

## 安装 / 卸载

```sh
dsh plugin --profile desktop add link:<本目录绝对路径>
```

再把 `@local/dsh-sticky-wall` 追加到 profile `package.json` 的 `dsh.profile.bundles`（启用 HMR 时保存即生效）。卸载时从该列表移除包名，再执行：

```sh
dsh plugin --profile desktop remove @local/dsh-sticky-wall
```

便签数据不在插件目录里，卸载不会删除。
