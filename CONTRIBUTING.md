# Contributing

Maintainer notes for `dsh-skills-mcp-panel`. Users need [README.md](README.md)
only — it covers installing, using, and configuring the plugin.

## No build step, and keep it that way

`lib/` is the source of truth: `lib/index.js` is the Host half and
`lib/client.js` is the browser half, both hand-written plain JavaScript, both
committed. That is deliberate, and it is what makes installation a single
`dsh plugin ... add` with no `allowBuilds` prompt and no install-time code
execution.

The browser half is written directly in the client module system's lazy-CJS
factory form (`window.__ModuleLoader__.load({ id, factory })`). The plugin does
not need the repository's unpublished `clientBundle` preset, and it must not
grow a dependency on any unpublished build helper.

Constraints that follow from this:

- **No `prepare` / `prepublishOnly` script.** A git install that runs a build
  script requires the user to allowlist it, which is exactly the friction this
  shape removes.
- **`files` pins the payload.** It lists `lib`, `cordis.patch.yml`, both
  READMEs, and the license. `tests/` and this file stay out of the package.
- **The client bundle id equals the package name.** `lib/client.js` registers
  `__ModuleLoader__.load({ id: '<package name>' })`, and the client module table
  matches a graph row on that id. Renaming the package means renaming it in
  `package.json` **and** in that one line, or the panel silently never mounts.

## Verify a change

```sh
node tests/smoke.mjs
```

The smoke test drives both HTTP routes through a stub Cordis context in a temp
directory. It covers what is easy to get wrong:

- discovery of both skill forms (a `SKILL.md` bundle and a flat `<name>.md`),
  dot-directories skipped;
- all four invocation states, including that a skill returns to its original
  bytes when it goes back to the default;
- grouping: a user-root skill is global, a project skill belongs to its project,
  and an MCP row without a project `cwd` is global;
- the `disabled` patch block: the user's patch file survives byte for byte
  outside the managed fences, and re-enabling the last server restores it;
- refusals: a path outside the scanned roots, an unknown MCP entry, an
  incomplete skill request, and a wrong HTTP method.

To exercise it against a live harness, install the checkout into a profile and
open the panel:

```sh
dsh plugin --profile web add link:$PWD
# restart dsh web once, then: Settings → Agent presets → Skills/MCP
```

## Releasing

The npm name is free as of this writing (`npm view dsh-skills-mcp-panel` returns
404). Nothing needs building first:

```sh
npm login
npm publish --access public
```

Publishing is optional. The repository is already a working distribution
channel, since a git install receives the same committed `lib/`:

```sh
dsh plugin --profile web add github:KyattoCat/dsh-skills-mcp-panel
```

After an npm publish, `dsh plugin --profile web add dsh-skills-mcp-panel` starts
working too — the installation section of the README should then list it as a
third route.
