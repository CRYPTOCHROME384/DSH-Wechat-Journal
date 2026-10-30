# 安装

## 前提

| 需要 | 说明 |
| --- | --- |
| DeepSeek Harness | 已安装并至少启动过一次（否则没有 profile 目录） |
| Node.js ≥ 18 | 安装器用；DSH 自带的 node 也行 |
| Python ≥ 3.10 | `journal.py` 用了 `dict \| None` 之类的新语法 |
| `requests` | Python 网页抓取辅助脚本需要；基础账本不需要 |

可选安装：`python -m pip install -r requirements.txt`。若使用 `--python` 指定解释器，请用同一个解释器安装依赖。

支持 Python 3.10 及以上；低版本不在兼容范围内。

## 一键安装

```
git clone https://github.com/CRYPTOCHROME384/DSH-Wechat-Journal.git
cd DSH-Wechat-Journal
node install.mjs
```

装完**重启 DeepSeek Harness**。插件的 HTTP 路由只有重启后才挂载——这是最常见的一步踩空。

## 参数

```
node install.mjs --data D:/my-journal       # 自定义数据目录
node install.mjs --profile myprofile        # 多 profile 时指定
node install.mjs --python /usr/bin/python3  # 指定解释器
node install.mjs --dry-run                  # 只打印，不写文件
```

默认：profile = `desktop`，数据目录 = `~/.dsh-journal/data`。

## 安装器做了什么

1. 建数据目录，铺空账本（`store.json`、`notebook.md`、`projects/`、`capture/`、`reports/`）
2. 把 `journal/*.py` 和 `RULES.md` 复制进数据目录（让数据目录自包含）
3. 在 profile 的 `package.json` 里登记两个插件（dependency + bundle）
4. 在 profile 的 `node_modules/@local/` 下建链接
5. 在 profile 的 `cordis.patch.yml` 末尾写一段配置覆盖（写入 `dataDir`）
6. 把 `schedules/` 里的三份模板填好路径，生成 `schedules-ready.md`

第 3、5 步会先备份成 `*.dsh-journal.bak`。**幂等**，重复跑不会重复写。

## 建定时任务（必须）

安装器**不能**替你建定时任务——它们存在 DSH 的 schedule 存储里，不是文件。

重启 DSH 后，把这句话发给 agent：

> 读 `<数据目录上级>/schedules-ready.md`，按里面的 schedule 元信息建三个定时任务

装完时安装器会把完整路径打印出来，直接复制即可。

三个任务：

| 任务 | 触发 | 作用 |
| --- | --- | --- |
| 微信兜底扫描 | 每天 13:00 | 插件分诊失败时补漏 |
| 晚间收口 | 每天 22:30 | 语义收尾：关任务、更项目状态 |
| 周报压实 | 周日 21:00 | 合并重复、改写四问、出周报 |

**跳过这一步的后果**：面板和微信通道能用，但没有「每晚收口 / 每周压实」——系统只剩一个记录工具，不会自己收敛。这是这套东西最核心的一半。

## 装完检查

```
python <数据目录>/journal.py status
```

应该返回一段 JSON，`projects` 是空数组。然后在面板左侧栏能看到「碎片阅读」和「账本」两个图标。

## 配置微信

1. 打开面板「碎片阅读」
2. 点「接入微信」，用手机微信打开返回的链接并确认
3. 之后往那个机器人会话里发链接或文字

微信通道走腾讯 iLink 机器人协议。**只能收到发给这个机器人的消息**，转发到「文件传输助手」它看不到——这是微信的边界，不是 bug。

机器人偶尔会出现「状态是 connected，但发送返回 `prepare failed`」。遇到就断开重连、必要时重新扫码。收消息和发消息是两条独立的链路，一条坏了另一条可能还是好的。

## 手动安装（不用安装器）

1. 把 `plugins/reading-inbox`、`plugins/journal-panel` 放到任意固定目录
2. 编辑 `~/.dsh/profiles/desktop/package.json`：

```json
{
  "dependencies": {
    "@local/reading-inbox": "link:/绝对路径/plugins/reading-inbox",
    "@local/journal-panel": "link:/绝对路径/plugins/journal-panel"
  },
  "dsh": {
    "profile": {
      "bundles": ["...", "@local/reading-inbox", "@local/journal-panel"]
    }
  }
}
```

3. 建链接：Windows 用 `mklink /J`，macOS/Linux 用 `ln -s`，指向 `node_modules/@local/<名字>`
4. 在 `~/.dsh/profiles/desktop/cordis.patch.yml` 末尾加：

```yaml
- id: reading-inbox
  config:
    dataDir: '/绝对路径/reading-inbox-data'
    journalDir: '/绝对路径/journal-data'
    python: 'python'
- id: journal-panel
  config:
    dataDir: '/绝对路径/journal-data'
    readingInbox: '/绝对路径/reading-inbox-data'
    python: 'python'
```

5. 建数据目录，把 `templates/journal/*` 和 `journal/*.py`、`journal/RULES.md` 复制进去
6. 重启 DSH

## 排查

| 现象 | 原因 |
| --- | --- |
| 面板没出现 | 没重启，或 profile 的 bundles 里没登记 |
| 面板出现但提示「未配置账本目录」 | `cordis.patch.yml` 的 `dataDir` 是空的 |
| `/journal/api/state` 404 | 插件没加载；看 DSH 启动日志里的 `[journal-panel]` |
| 微信消息没回执 | Python 没找到，或 `journalDir` 路径不对 |
| 发送返回 `prepare failed` | 腾讯侧会话失效，重连或重新扫码 |

## 升级

```
git pull
node install.mjs     # 会把新的 .py 同步进数据目录
```

Python 代码会更新；已有 `RULES.md` 保留，升级后需自行对比仓库规则。账本数据只补缺，`store.json`、`capture/`、`projects/` 里已有的内容一律不动。

## 卸载

删掉 profile `cordis.patch.yml` 里那段 `# >>> dsh-journal installer >>>` 注释块，从 `package.json` 移除两个依赖和 bundle，删掉 `node_modules/@local/` 下两个链接，重启。数据目录留着即可——它是纯文件，任何编辑器都能读。
