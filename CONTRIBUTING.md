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

A release is a tag. [`.github/workflows/release.yml`](.github/workflows/release.yml)
checks the tag against the manifest, runs the smoke test, publishes with
provenance, and opens a GitHub release:

```sh
npm version patch        # or minor / major — a published version is burned
git push --follow-tags
```

It authenticates through **trusted publishing**, so the repository holds no
`NPM_TOKEN`: npm exchanges the workflow's OIDC token for a short-lived
credential and attaches the attestation. That trust is registered once, against
this exact repository and workflow filename:

```sh
npm trust github dsh-skills-mcp-panel --file release.yml --repo KyattoCat/dsh-skills-mcp-panel
npm trust list dsh-skills-mcp-panel   # what is registered
```

Renaming the workflow file breaks the trust, because npm matches on that
filename — re-register it after a rename.

### Publishing by hand

Only when the workflow cannot run. A local `npm publish` still needs the
account's 2FA code, and a non-interactive shell cannot complete npm's browser
exchange, so pass the code explicitly:

```sh
npm version patch
npm publish --otp=<code>
```

Check the payload first: `npm pack --dry-run` prints exactly what npm will
distribute — 7 files, `lib/`, `cordis.patch.yml`, both READMEs, the license, and
`package.json`. A local publish cannot attach provenance; only CI can.

The repository is a distribution channel in its own right — a git install
receives the same committed `lib/`, so the two routes ship identical code:

```sh
dsh plugin --profile web add github:KyattoCat/dsh-skills-mcp-panel
```
