# dsh-skills-mcp-panel

English | [中文](README.zh.md)

**Skills & MCP panel for the DeepSeek Harness Web GUI.** One Settings page under
**Agent 预设** that lists every skill and every MCP server this deployment
composed, with a search box, a per-row status light, a state selector, and a
details toggle.

Both kinds change **without restarting the process**:

| | What the selector writes | When it lands |
|---|---|---|
| **Skill** | `disable-model-invocation` and `user-invocable` in the skill's `SKILL.md` frontmatter — the four states those two bits spell out | the skill provider watches the roots, so the next `agent/pre-step` republishes the catalog — same session |
| **MCP server** | an id-targeted `disabled: true` row in the profile's own `cordis.patch.yml` | a `patchReload: live` profile re-applies the patch through config HMR, which reloads that server's connection in place — same session |

Nothing else is touched: the panel never deletes a skill, never edits a server's
configuration, and never reformats your patch file — see
[What it writes](#what-it-writes).

## Install

The package ships ready to run: `lib/` is the source of truth, there is no build
step, and a git install needs no `allowBuilds` permission.

```sh
# from npm
dsh plugin --profile web add dsh-skills-mcp-panel

# from a GitHub checkout
dsh plugin --profile web add github:<you>/dsh-skills-mcp-panel

# from a local checkout while developing
dsh plugin --profile web add link:/absolute/path/to/dsh-skills-mcp-panel
```

Then restart the `dsh web` process once — installing a **new bundle layer** is
the one operation the live patch reload cannot cover, because
`dsh.profile.bundles` is read at boot. Every change after that is hot.

Remove it with:

```sh
dsh plugin --profile web remove dsh-skills-mcp-panel
```

## Use it

Open **设置 → Agent 预设 → 技能/MCP** (the entry sits directly under the preset
page). The page has:

- a **search box** filtering by name, description, and path;
- two **tabs** with live counts — skills and MCP servers;
- **groups**, one per place a row comes from (see below), each with its own
  header, path, and count;
- one **card per row**: title, source, a colored status light, a state
  selector, and a details toggle (`+` / `−`) styled like the selector beside it;
- a **details** panel per card, showing description / when-to-use /
  root / path / body lines / model-invocable / user-invocable for a skill, and
  entry id / transport / command-or-URL / connection phase / tool count / tool
  names for an MCP server;
- no standing footer: the page adds a message only when a change lands on a
  profile that will not act on it until the next `dsh` start.

### Groups

Rows are grouped by the directory they belong to, so a skill you wrote for one
project never looks like one you installed for every project.

**Skills.** Every scanned root maps to a group:

| Group | Roots |
|---|---|
| **Global** | `$DSH_HOME/skills` and `$DSH_AGENTS_HOME/skills` — the skills you own regardless of project |
| **One per project** | `<project>/.dsh/skills` and `<project>/.agents/skills`, for every project the deployment knows: each workspace the Web GUI has opened, plus the harness process's own working directory |
| **One per configured root** | each entry of `skillRoots`, named after its directory |

A group header carries the group's name, its full path, and its row count.

**MCP servers.** A server has no directory of its own, so the panel takes the
directory it runs in: a `stdio` server whose `cwd` sits inside one of those
projects is grouped under that project, and every other server — HTTP servers,
and stdio servers that inherit the harness process's directory — is **Global**.

### Skill states

A skill's two frontmatter keys are independent, so it has four states and the
selector offers all four:

| Selection | `disable-model-invocation` | `user-invocable` | Who can load it |
|---|---|---|---|
| **Enabled** | absent (the default) | absent (the default) | the model routes to it on its own, and you can type `/name` |
| **Manual only** | `true` | absent | **you only** — the model never sees it in the catalog and cannot load it with the `skill` tool |
| **Model only** | absent | `false` | the model only — it is not offered in the `/` menu or to `/name` |
| **Disabled** | `true` | `false` | neither surface; only trusted `ctx.skills.get()` callers |

### MCP states

An MCP row is a single enablement, so its selector offers **Enabled** and
**Disabled** (localized to the interface language). A settled, active server
carries no second label; a tag appears beside the selector only while the
connection is unsettled — `loading` or `failed` — because that is a live fact
rather than a setting. The same holds for a long tool list in the details
panel: one name per line, and the box scrolls once it outgrows the card.

Status lights: green = the model can reach it (skill) or the server is
connected (MCP), amber = manual-only (skill) or still connecting (MCP), red = a
parse error (skill) or a failed connection (MCP), grey = disabled.

## What it writes

**Skills.** Only the two invocation keys move. `true` is the provider's own
default, so a state that needs it REMOVES the key instead of writing a
redundant value: **Enabled** writes neither key, **Manual only** writes
`disable-model-invocation: true`, **Model only** writes `user-invocable: false`,
and **Disabled** writes both. A skill taken away from its default state and put
back therefore returns to its original bytes, and an unrelated key never moves.

**MCP servers.** The panel owns one marked block at the end of the profile's
`cordis.patch.yml`:

```yaml
# >>> dsh-skills-mcp-panel (managed — edit these rows from the panel)
- id: "mcp-playwright"
  disabled: true
# <<< dsh-skills-mcp-panel
```

Everything outside those two fences is preserved byte for byte — comments,
formatting, and your own rows included. The block is rewritten wholesale on
every change, so it always lists exactly the servers currently disabled by the
panel; re-enabling the last one removes the block and the file returns to its
original bytes. The write goes through a temp file and a rename, so the patch
watcher never sees a half-written document.

## Configuration

All fields are optional; the defaults are what a stock `dsh web` needs.

| Field | Default | Meaning |
|---|---|---|
| `patchPath` | auto-detected | The patch file MCP selections are written to. Detection picks the profile under `$DSH_HOME/profiles` whose `dsh.profile.bundles` lists this plugin, preferring one with `patchReload: live`. Set it explicitly if you keep several profiles. |
| `dshHome` | `$DSH_HOME` or `~/.dsh` | Harness home; its `skills` subdirectory is scanned and its `profiles` directory is searched. |
| `agentsHome` | `$DSH_AGENTS_HOME` or `~/.agents` | Shared agent root; its `skills` subdirectory is scanned. |
| `projectRoot` | `process.cwd()` | The harness process's own project; its `.dsh/skills` and `.agents/skills` are scanned alongside every workspace the deployment knows. |
| `skillRoots` | `[]` | Extra skill roots, each forming its own group. |
| `maxSkillProjects` | `64` | Ceiling on how many workspaces one scan covers; project roots are sorted before the cap applies. |

```yaml
- id: skills-mcp-panel
  name: dsh-skills-mcp-panel
  config:
    projectRoot: /home/me/work
    skillRoots:
      - /home/me/team-skills
```

## How it works

Two halves in one package, both plain JavaScript, no dependencies:

- **Host half** (`lib/index.js`) registers two exact routes on `ctx.webServer`
  and answers them behind the composition's `connection` trust fence (the
  browser session cookie plus the Host/Origin check). `GET /skills-mcp/state`
  scans the skill roots and walks the Loader for `@deepseek-ai/dsh-mcp-client`
  rows; `POST /skills-mcp/toggle` performs the write described above.
- **Browser half** (`lib/client.js`) is written directly in the client module
  system's lazy-CJS factory form
  (`window.__ModuleLoader__.load({ id, factory })`), so it needs no bundler and
  no shared build preset. It registers one `settings.section` contribution and
  takes only `react` from the module table.

## Known limitations

- **A panel change is not a preset edit.** A skill or MCP row that a preset's
  `agent.cordis.yml` provides is still composed at session creation; the panel's
  MCP selections target the profile patch layer, which applies to every session.
  Hiding a whole preset-provided row remains a preset edit, and a new session is
  what picks it up.
- **Startup-frozen profiles.** `headless`, `sdk`, and `acp` default to
  `patchReload: startup`; the panel's MCP writes land there but apply at the next
  launch, and the page says so right after such a change. Skills stay hot
  everywhere, because the skill provider watches files rather than configuration.
- **Skills are read from disk, not from the registry.** The panel mirrors the
  filesystem provider's discovery (top-level `SKILL.md` bundles and flat
  `<name>.md` files, dot-directories skipped) so it can rewrite the file that
  actually controls visibility. A skill supplied by a different provider appears
  in the model's catalog but has no file for this panel to change.
- **No import, create, or delete.** The page changes what already exists; it
  never adds or removes a skill or a server.
- **MCP has no project-level source.** DSH composes MCP servers from the profile,
  the harness home, and bundles — there is no per-project MCP file to read — so a
  server lands in a project group only when its own `cwd` points into that
  project. Everything else is Global, which is the truth rather than a gap.

## Development

```sh
node tests/smoke.mjs   # drives both routes through a stub Cordis context in a temp dir
```

The smoke test asserts the two properties that matter most: disabling and
re-enabling a skill restores the original bytes, and the same is true of the
patch file around the managed block.

## License

MIT
