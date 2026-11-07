# 任务完成与等待确认通知 · Completion Notify

一个 DSH 插件：会话**跑完任务**、或**卡在等你操作**时，由 DSH 主进程弹出**操作系统通知**，不用一直盯着页面。

- **Host 侧发送**：订阅会话日志事件，detached 调系统通知（Windows → `powershell.exe` WinRT toast，macOS → `osascript`，Linux → `notify-send`）。页面被覆盖、最小化、关掉都不影响。
- **标题写明会话**：`「会话名」任务完成 / 任务出错 / 任务中断 / 等你授权 / 等你回答`；标题超过 18 字截断。
- **一个开关 + 测试**：「设置 → 通用」里一行，带「发送测试通知」按钮。
- **不打扰正在看的回答**：浏览器把窗口焦点与当前会话报给 Host（30 秒心跳），Host 在"页面可见 + 窗口在前台 + 正是这个会话"时跳过完成通知。关闭/隐藏页面则一定提醒。
- **子会话不打扰**：`origin: subagent` 的会话结束不通知。

## 触发时机

| 事件 | 通知 |
| --- | --- |
| `turn/end`（主会话，reason=completed） | 「会话名」任务完成 |
| `turn/end`（reason=error） | 「会话名」任务出错 |
| `turn/end`（其它原因） | 「会话名」任务中断 |
| `approval/asked` | 「会话名」等你授权（带工具名） |
| `user-questions/request` | 「会话名」等你回答（观察型监听，始终放行） |

## 结构

| 文件 | 作用 |
| --- | --- |
| `index.js` | Host：`session/event` 监听、通知队列、系统弹窗；`/completion-notify/state`、`/completion-notify/test` 两条 loopback 路由 |
| `client.js` | 浏览器：设置行（开关 + 测试）与焦点上报 |
| `cordis.patch.yml` | 插入一行 `completion-notify` 插件行 |
| `package.json` | bundle 声明 |
| `locale/*.json`、`icon.svg` | 插件管理页显示用 |

## 性能与实现要点

- **事件过滤在前**：`session/event` 每来一个事件只做一次 `type` 比较就返回；只有 `turn/end` / `approval/asked` 才继续。
- **标题缓存**：会话标题按 session id 缓存（上限 64），避免每轮重复折叠会话日志。
- **通知串行 + 去重**：同一时刻只跑一个通知进程；10 秒内相同标题只弹一次，一次性完成多个会话不会起一堆 PowerShell。
- **上报走查询参数**：浏览器用 `POST /completion-notify/state?enabled=1&visible=1&focused=0&main=<id>` 上报，Host 不做 JSON body 解析。
- **无内存/磁盘诊断**：不写日志文件、不做环形缓冲；只保留一条 `ctx.logger` 记录。
- **失败只降级**：弹窗进程错误只记日志，绝不影响对话或 Host。

## 已知限制

- Windows 通知使用已注册的 AppUserModelID `electron.app.DeepSeek Harness`；换发行版可能需要改这个常量。
- 通知是纯文本 toast，点击只把窗口带到前台，不会直接跳到对应会话。
- 专注助手 / 系统通知设置仍会拦截横幅，这是操作系统行为。

## 安装

```sh
dsh plugin --profile desktop add link:<这个目录的绝对路径>
```

再把 `@local/dsh-completion-notify` 追加到 profile `package.json` 的 `dsh.profile.bundles`。

## 卸载

从 `dsh.profile.bundles` 移除该包名，然后执行：

```sh
dsh plugin --profile desktop remove @local/dsh-completion-notify
```

开关状态保存在浏览器 local storage 的 `dsh.completion-notify.v1` 键下。
