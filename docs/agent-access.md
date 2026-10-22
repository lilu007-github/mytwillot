# 让 AI agent 使用你的收藏数据

扩展的数据存在 Chrome 的 IndexedDB 里，浏览器之外的程序读不到。Agent 访问功能分三层：

1. **扩展**把数据镜像成普通文件，写到你选的本地文件夹。
2. **`twillot` 命令行**读取这个文件夹，可以搜索、统计、分析趋势。
3. **MCP 服务**让 Claude Code / Claude Desktop 直接调用这些能力，用中文提问即可。

全部在本机完成，数据不会离开你的电脑。Agent 只能读，不能改。

## 第一步：在扩展里设置镜像文件夹（只做一次）

1. 构建并重新加载扩展：

   ```bash
   cd x-bookmarks && pnpm build
   ```

   打开 `chrome://extensions`，在 Twillot 扩展上点"重新加载"。

2. 打开扩展的设置页，进入 **Export**，滚到 **Agent access (CLI / MCP)**。
3. 点 **Choose mirror folder**，选一个文件夹（比如新建 `~/twillot-mirror`）。Chrome 询问写入权限时选"允许"；如果有"每次访问都允许"，选它，以后才能自动刷新。
4. 选好后会立即写入一次，页面显示 "Last mirrored … N items" 就说明成功了。

之后只要扩展设置页开着，镜像会在页面打开时和每 15 分钟自动刷新一次。点 **Mirror now** 可以立刻刷新。

## 第二步：安装命令行工具（只做一次）

在仓库根目录执行：

```bash
pnpm install && pnpm --filter twillot-cli build
node packages/cli/dist/twillot.mjs init ~/twillot-mirror
```

`init` 输出 "Found 1 mirrored account" 就对了。想直接敲 `twillot` 而不写完整路径，可以再执行：

```bash
cd packages/cli && pnpm link --global
```

### 常用命令

```bash
twillot search "AI agent" --since 30d       # 搜最近 30 天
twillot search '"向量数据库" -广告 from:simonw' # 短语、排除词、指定作者
twillot search --folder AI -f md            # AI 文件夹（含子文件夹）全文，Markdown 格式
twillot search --unsorted --category bookmarks  # 还没分类的书签
twillot show 1811044379643293932            # 看某条推文的完整内容和整个对话串
twillot trends --period month --since 6m    # 近半年每月关注的话题和上升词
twillot stats                               # 总量、常收藏的作者、文件夹分布
twillot folders                             # 文件夹及条数
twillot sql "select author, count(*) n from tweets group by 1 order by 2 desc limit 10"
twillot sql --schema                        # 能查哪些表和字段
```

**通用筛选参数**

| 参数 | 说明 |
| --- | --- |
| `--category` | `all` / `bookmarks` / `likes` / `posts` / `replies` / `media` |
| `--folder` | 按文件夹筛选，包含子文件夹 |
| `--unsorted` | 只看没分文件夹的 |
| `--tag`、`--untagged` | 按标签筛选、只看没打标签的 |
| `--author` | 按作者筛选 |
| `--since`、`--until` | `7d`、`2w`、`3m`、`1y`，或 `2026-01-01`、`2026-01` |
| `--has` | 内容类型：`media` / `link` / `thread` / `quote` |

**输出格式**：`--format text|md|json`，`--json` 是 `--format json` 的简写。

**多账号**：用 `--account <用户名>` 切换账号，默认是最近一次镜像的账号。

完整用法见 `twillot --help`。

### 全文索引和 SQL

第一次搜索时，CLI 会从镜像自动生成一个本地 SQLite 索引，放在 `~/.cache/twillot/`；镜像有更新时会自动重建。它带来两样东西：

- **更准的搜索**：按词匹配，并用 bm25 算法排序相关度；中文会先分词再建索引。"rust" 也能匹配到 "rustacean"。索引没命中、但原文里包含查询字符串的结果也不会漏，会排在后面。
- **SQL 查询**：`twillot sql` 可以对数据跑任意只读 SQL，适合预设命令覆盖不到的分析。写操作会被拒绝。

全文检索要配合 `fts_query()`，它会按和索引相同的方式给中英文分词：

```sql
SELECT t.author, t.text FROM tweets_fts
JOIN tweets t ON t.rowid = tweets_fts.rowid
WHERE tweets_fts MATCH fts_query('agent 记忆')
ORDER BY bm25(tweets_fts) LIMIT 20
```

`twillot index` 查看索引位置和条数，`twillot index --rebuild` 强制重建。需要 Node 22.13 或更新版本（用的是 Node 内置的 SQLite）；版本太旧时搜索会自动退回逐条扫描，`sql` 命令会提示升级。

## 第三步：接入 Claude（只做一次）

### Claude Code

```bash
claude mcp add --scope user twillot -- node /绝对路径/mytwillot-1/packages/cli/dist/twillot.mjs mcp
```

`--scope user` 表示在任何目录下启动 Claude Code 都能用。加完后重启 Claude Code，输入 `/mcp`，看到 twillot 显示已连接就成功了。

### Claude Desktop

编辑 `~/Library/Application Support/Claude/claude_desktop_config.json`，加入下面这段，然后重启 Claude Desktop：

```json
{
  "mcpServers": {
    "twillot": {
      "command": "node",
      "args": ["/绝对路径/mytwillot-1/packages/cli/dist/twillot.mjs", "mcp"]
    }
  }
}
```

## 怎么问

接好之后直接用中文问，Claude 会自己调用工具读你的数据：

- **查资料**："我收藏过哪些讲 RAG 的帖子？挑最有价值的 5 条，说说各自的观点"
- **自由分析**："每个月我收藏最多的 3 个作者是谁？"（Claude 会自己写 SQL）
- **总结**："把我这周收藏的内容按主题总结一下，附上原帖链接"（也可以用预设提示 `digest`）
- **整理分类**："看看我没分类的书签，建议放进哪些文件夹、打什么标签"（也可以用预设提示 `organize`）
- **看趋势**："对比我近半年每个月关注的话题，哪些在升温？"

### MCP 工具一览

| 工具 | 作用 |
| --- | --- |
| `mirror_info` | 有哪些账号、上次镜像时间、条数，用来判断数据新不新 |
| `search_tweets` | 搜索，查询语法和筛选参数同 `twillot search` |
| `get_tweets` | 按 ID 或链接取完整内容（对话串、引用推文、媒体、互动数据） |
| `list_folders`、`list_tags` | 文件夹、标签及条数 |
| `stats` | 按类型、月份统计，常收藏的作者、文件夹、标签 |
| `trends` | 每个时期的高频词（中英文）、话题标签、作者，以及"上升词" |
| `query_sql` | 只读 SQL，用于预设工具覆盖不到的分析；表结构写在工具说明里，agent 能直接看到 |

"上升词"指最近一个时期里出现次数达到以往平均 2 倍以上的词，至少出现 3 次。

## 注意事项

- **数据新鲜度**：Claude 看到的是最近一次镜像的数据。想让它看到最新收藏，先打开扩展设置页或点 Mirror now。`mirror_info` 会告诉它上次镜像的时间。
- **只读**：整理分类只会给建议，需要你回到扩展里手动应用。
- **自动刷新停了**：Chrome 可能在重启后收回文件夹权限，页面会提示 "Reconnect needed"，点一次 Mirror now 重新授权即可。

## 直接读文件

镜像是普通文件，不用 CLI 也能读：

```
~/twillot-mirror/
├── README.md                     字段说明
├── index.json                    已镜像的账号列表
└── accounts/<用户ID>/
    ├── tweets.jsonl              每行一条推文（JSON），按时间倒序
    ├── folders.json              文件夹（含完整路径和条数）
    ├── tags.json                 标签
    └── meta.json                 镜像时间、各类型条数
```

例如用 `jq` 或 DuckDB：

```bash
jq -r 'select(.folder=="AI") | .url' ~/twillot-mirror/accounts/*/tweets.jsonl
duckdb -c "select author.screen_name, count(*) from '$HOME/twillot-mirror/accounts/*/tweets.jsonl' group by 1 order by 2 desc limit 10"
```

数据格式定义在 `packages/utils/agent-mirror.ts`（`AGENT_MIRROR_SCHEMA`）。
