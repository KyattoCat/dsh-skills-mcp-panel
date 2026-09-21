# dsh-skills-mcp-panel

[English](README.md) | 中文

**DeepSeek Harness Web GUI 的「技能与 MCP」面板。** 在设置页的「Agent 预设」下新增一个分页，列出本部署已组合的每一个技能和每一个 MCP 服务器，并带有搜索框、每行状态灯、状态选择器，以及展开详情的箭头。

两类条目都是**不重启进程**即可改变：

| | 选择器写入了什么 | 何时生效 |
|---|---|---|
| **技能** | 该技能 `SKILL.md` 前言里的 `disable-model-invocation` 与 `user-invocable`——这两个位拼出的四种状态 | 技能提供方监听扫描根，下一次 `agent/pre-step` 会重新发布目录——同一个会话内即可见 |
| **MCP 服务器** | 往 profile 自己的 `cordis.patch.yml` 写入一条按 id 定向的 `disabled: true` | `patchReload: live` 的 profile 会通过配置 HMR 重新应用补丁，就地重载该服务器的连接——同一个会话内即可见 |

除此之外什么都不动：面板从不删除技能、从不修改服务器的配置，也从不会重新格式化你的 patch 文件——详见[写入内容](#写入内容)。

## 安装

本包开箱即跑：`lib/` 就是真源，没有构建步骤，git 安装也不需要 `allowBuilds` 放行。

```sh
# 从 GitHub 安装——目前唯一的分发渠道
dsh plugin --profile web add github:KyattoCat/dsh-skills-mcp-panel

# 开发时从本地目录安装
dsh plugin --profile web add link:/absolute/path/to/dsh-skills-mcp-panel
```

尚未发布到 npm：`dsh plugin --profile web add dsh-skills-mcp-panel` 在包发布前解析不到任何东西，因为 `dsh plugin` 是把参数直接转发给 pnpm，而 registry 上没有这个名字。

无论走哪条路，装下来的包只含 `lib/`、两份 README、`cordis.patch.yml` 和许可证；`tests/` 留在仓库里。

之后需要重启一次 `dsh web` 进程——安装**新的 bundle 层**是实时 patch 重载唯一覆盖不了的操作，因为 `dsh.profile.bundles` 是启动时读取的。此后的每一次改变都是热的。

卸载：

```sh
dsh plugin --profile web remove dsh-skills-mcp-panel
```

## 使用

打开**设置 → Agent 预设 → 技能/MCP**（入口就排在 preset 页下面）。页面包含：

- 一个**搜索框**，按名称、描述和路径过滤；
- 两个**分页**并带实时计数——技能与 MCP 服务器；
- **分组**：条目来自哪个目录就归到哪一组（见下），每组有自己的标题、路径和计数；
- 每行一张**卡片**：标题、来源、彩色状态灯、**状态选择器**，以及一个与选择器同款样式的详情开关（`+` / `−`）；
- 每张卡片的**详情**面板：技能显示描述 / 何时使用 / 来源根 / 路径 / 正文行数 / 模型可调用 / 用户可调用；MCP 服务器显示条目 id / 传输方式 / 命令或 URL / 连接状态 / 工具数 / 工具名；
- 没有常驻页脚：只有当一次改动落在"下次启动 `dsh` 才生效"的 profile 上时，页面才会加一行提示。

### 分组

条目按它所属的目录分组，因此"你为某个项目写的技能"和"你为所有项目装的技能"一眼可分。

**技能。** 每个被扫描的根对应一个组：

| 分组 | 根 |
|---|---|
| **全局** | `$DSH_HOME/skills` 与 `$DSH_AGENTS_HOME/skills`——不论项目都归你的技能 |
| **每个项目一组** | `<项目>/.dsh/skills` 与 `<项目>/.agents/skills`，覆盖本部署知道的所有项目：Web GUI 打开过的每个工作区，加上 harness 进程自己的工作目录 |
| **每个配置根一组** | `skillRoots` 的每一项，以它自己的目录名命名 |

组标题会带上组名、完整路径和条目数。

**MCP 服务器。** 服务器本身没有目录，因此面板取它的运行目录：`cwd` 落在上述某个项目内的 `stdio` 服务器归入该项目组，其余服务器——HTTP 服务器，以及继承 harness 进程目录的 `stdio` 服务器——都归**全局**。

### 技能状态

技能的两个前言键彼此独立，因此共有四种状态，选择器把它们全部列出：

| 选择 | `disable-model-invocation` | `user-invocable` | 谁能加载它 |
|---|---|---|---|
| **已启用** | 不存在（默认） | 不存在（默认） | 模型会自行路由到它，你也可以敲 `/名字` |
| **仅手动** | `true` | 不存在 | **只有你**——模型在目录里看不到它，也无法用 `skill` 工具加载 |
| **仅模型** | 不存在 | `false` | 只有模型——它不会出现在 `/` 菜单里，`/名字` 也调不到 |
| **已停用** | `true` | `false` | 两个界面都够不到；只剩受信的 `ctx.skills.get()` 调用方 |

### MCP 状态

MCP 行只有一个启用位，因此它的选择器只有**已启用**和**已停用**。连接已稳定并处于 active 的服务器不再挂第二个标签；只有连接尚未稳定（`loading` 或 `failed`）时，选择器旁边才会出现一个标签——因为那是实时事实而不是设置。详情面板里的长工具列表同理：一行一个名字，超出卡片高度后列表内部滚动。

状态灯含义：绿色 = 模型够得到（技能）或服务器已连接（MCP），琥珀色 = 仅手动（技能）或仍在连接中（MCP），红色 = 解析失败（技能）或连接失败（MCP），灰色 = 已停用。

## 写入内容

**技能。** 只动那两个调用相关的键。`true` 是提供方自己的默认值，因此需要它的状态会**删除**该键而不是写一个冗余值：**已启用**两个键都不写，**仅手动**写 `disable-model-invocation: true`，**仅模型**写 `user-invocable: false`，**已停用**两个都写。所以一个技能离开默认态再回到默认态会恢复成原始字节，而无关的键永远不会被移动。

**MCP 服务器。** 面板在 profile 的 `cordis.patch.yml` 末尾独占一个带标记的块：

```yaml
# >>> dsh-skills-mcp-panel (managed — edit these rows from the panel)
- id: "mcp-playwright"
  disabled: true
# <<< dsh-skills-mcp-panel
```

两道栅栏之外的所有内容都逐字节保留——包括注释、格式和你自己的条目。每次改变都会整体重写这个块，因此它始终只列出当前被面板停用的服务器；把最后一个也重新启用时，块会被移除，文件回到最初的字节。写入走临时文件加 rename，所以 patch watcher 永远不会看到写了一半的文档。

## 配置

所有字段都是可选的；默认值就是原版 `dsh web` 需要的。

| 字段 | 默认值 | 含义 |
|---|---|---|
| `patchPath` | 自动探测 | MCP 选择写入的 patch 文件。探测会选 `$DSH_HOME/profiles` 下 `dsh.profile.bundles` 里列了本插件的那个 profile，并优先选 `patchReload: live` 的。如果你保留多个 profile，请显式指定。 |
| `dshHome` | `$DSH_HOME` 或 `~/.dsh` | Harness 主目录；会扫描其 `skills` 子目录，并在其 `profiles` 目录下查找。 |
| `agentsHome` | `$DSH_AGENTS_HOME` 或 `~/.agents` | 共享 agent 根目录；会扫描其 `skills` 子目录。 |
| `projectRoot` | `process.cwd()` | harness 进程自己所在的项目；它的 `.dsh/skills` 与 `.agents/skills` 会和本部署知道的每个工作区一起被扫描。 |
| `skillRoots` | `[]` | 额外的技能根，每个自成一个分组。 |
| `maxSkillProjects` | `64` | 单次扫描覆盖的工作区上限；先按路径排序再截断。 |

```yaml
- id: skills-mcp-panel
  name: dsh-skills-mcp-panel
  config:
    projectRoot: /home/me/work
    skillRoots:
      - /home/me/team-skills
```

## 实现方式

一个包里的两个半边，都是纯 JavaScript，无依赖：

- **Host 半**（`lib/index.js`）在 `ctx.webServer` 上注册两条 exact 路由，并在组合的 `connection` 信任闸之后应答（浏览器会话 cookie 加 Host/Origin 校验）。`GET /skills-mcp/state` 扫描技能根、遍历 Loader 找 `@deepseek-ai/dsh-mcp-client` 行；`POST /skills-mcp/toggle` 执行上面描述的写入。
- **浏览器半**（`lib/client.js`）直接以客户端模块系统的 lazy-CJS 工厂形式书写（`window.__ModuleLoader__.load({ id, factory })`），因此不需要打包器，也不需要共享构建 preset。它注册一个 `settings.section` 贡献，并且只从模块表取 `react`。

## 已知限制

- **面板的改动不等于编辑 preset。** 由 preset 的 `agent.cordis.yml` 提供的技能或 MCP 行，仍然是在创建会话时组合的；面板的 MCP 选择作用于 profile 的 patch 层，对所有会话生效。要隐藏整个由 preset 提供的行，仍然得改 preset，并由新会话拾取。
- **启动即冻结的 profile。** `headless`、`sdk`、`acp` 默认是 `patchReload: startup`；面板的 MCP 写入会落盘，但要到下次启动才应用，改动之后页面会立即说明这一点。技能在所有 profile 上都是热的，因为技能提供方监听的是文件而不是配置。
- **技能是从磁盘读的，不是从注册表读的。** 面板复刻了文件系统提供方的发现规则（顶层 `SKILL.md` 目录包和扁平的 `<name>.md`，跳过点号目录），因为它要改写的是真正控制可见性的那个文件。由其他提供方提供的技能会出现在模型目录里，但没有文件可供本面板改动。
- **没有导入、新建和删除。** 这页只改变已经存在的东西，既不新增也不移除技能或服务器。
- **MCP 没有项目级配置源。** DSH 的 MCP 服务器来自 profile、harness 主目录和内置组合包——没有"每个项目一份 MCP 文件"可读——所以只有当某个服务器自己的 `cwd` 指向项目内部时，它才会落进项目组。其余的一律归全局，这是事实，不是缺口。

## 开发

```sh
node tests/smoke.mjs   # 在临时目录里用桩 Cordis 上下文驱动两条路由
```

冒烟测试断言两件最关键的事：四种技能状态都能往返（含回到默认态时逐字节还原原始文件），以及 patch 文件在托管块之外保持字节不变。

## 发布到 npm

`npm publish` 可以直接用——`files` 已经把发布内容钉死，也没有需要先跑的构建步骤。这个名字目前是空的：

```sh
npm view dsh-skills-mcp-panel   # 未发布时返回 404
npm login
npm publish --access public
```

发布之后，[安装](#安装)里那条 `dsh plugin --profile web add dsh-skills-mcp-panel` 也就生效了。如果要改包名，`package.json` 与 `lib/client.js` 两处都要改——后者的 `__ModuleLoader__.load({ id })` 必须等于包名，客户端模块表按这个 id 匹配。

## 许可证

MIT
