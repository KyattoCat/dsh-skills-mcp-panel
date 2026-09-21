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
directory, then materializes the browser half against a stub module table and a
React stand-in. It covers what is easy to get wrong:

- discovery of both skill forms (a `SKILL.md` bundle and a flat `<name>.md`),
  dot-directories skipped;
- all four invocation states, including that a skill returns to its original
  bytes when it goes back to the default;
- grouping: a user-root skill is global, a project skill belongs to its project,
  and an MCP row without a project `cwd` is global;
- the group menu: the reported project is the one pinned first, an unreported or
  unregistered one falls back to the process project, and a toggle answer keeps
  the same pin;
- the panel's group behavior: only the pinned group starts expanded, a header
  click expands its own group, a manual collapse outlives the next load, and a
  host that flags no project leaves every group open;
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

### Verifying a release

A fresh release looks missing for three separate reasons, and the registry
document is the only authority:

- The registry processes a provenance-attested publish asynchronously and says
  so — "your package is being processed and may take a few minutes to become
  available". `time[<version>]` shows up about two minutes after the publish
  step prints its success line.
- The packument is served with `Cache-Control: public, max-age=300`, so a check
  seconds later may return the previous document. Add a cache-busting query when
  reading it by hand: `curl "https://registry.npmjs.org/dsh-skills-mcp-panel?t=$(date +%s)"`.
- Package managers refuse to resolve a version published moments ago — a
  supply-chain default (`minimumReleaseAge`). `pnpm add dsh-skills-mcp-panel`
  silently resolves the previous version instead; verify an exact new version
  with `pnpm add dsh-skills-mcp-panel@<version> --config.minimumReleaseAge=0`.

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
