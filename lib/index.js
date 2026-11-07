/**
 * Skills & MCP panel — Host half.
 *
 * Serves two exact HTTP routes on the composition's `webServer`:
 *
 * - `GET  /skills-mcp/state`  — every discovered skill and MCP server row, plus
 *   the group menu. An optional `?cwd=` names the browser's current project and
 *   decides which group leads the menu.
 * - `POST /skills-mcp/toggle` — flip one row's enablement; the body carries the
 *   same optional `cwd`, so the answer keeps the menu the page already shows.
 *
 * Toggling is the point of the plugin, and both kinds are HOT:
 *
 * - a skill flips by rewriting `disable-model-invocation` in its frontmatter,
 *   which `dsh-skill-filesystem` watches, so the next `agent/pre-step` republishes
 *   the catalog without a restart;
 * - an MCP server flips by writing an id-targeted `disabled:` row into the
 *   profile's own `cordis.patch.yml`, which a `patchReload: live` profile
 *   re-applies through config HMR, reloading that server's connection in place.
 *
 * The toggle write is text surgery, never a YAML round-trip: the file belongs to
 * the user and every comment and formatting choice outside the managed block
 * survives byte for byte.
 *
 * @module dsh-skills-mcp-panel
 */

import { readFile, writeFile, readdir, rename } from 'node:fs/promises'
import { join, resolve, basename } from 'node:path'
import { homedir } from 'node:os'

/** Cordis function-plugin name. */
export const name = 'skills-mcp-panel'

/** The module name an MCP server row is composed from. */
const MCP_MODULE = '@deepseek-ai/dsh-mcp-client'

/** This package's own name, used to find the profile it is installed in. */
const OWN_PACKAGE = 'dsh-skills-mcp-panel'

const STATE_ROUTE = '/skills-mcp/state'
const TOGGLE_ROUTE = '/skills-mcp/toggle'

/** Managed-block fences for the profile patch file. */
const BLOCK_START = '# >>> dsh-skills-mcp-panel (managed — edit these rows from the panel)'
const BLOCK_END = '# <<< dsh-skills-mcp-panel'

/** A skill file larger than this is not worth reading; the provider would too. */
const MAX_SKILL_BYTES = 512 * 1024

/** Toggle request bodies are two short fields; anything larger is hostile. */
const MAX_BODY_BYTES = 64 * 1024

/** The field a request reports its current project in (query string or body). */
const CURRENT_CWD_KEY = 'cwd'

/** No project root is this long; the field is a display hint, not data. */
const MAX_CWD_BYTES = 4096

/** Cordis fiber states, in the order the enum declares them. */
const PHASES = ['pending', 'loading', 'active', 'failed', 'disposed', 'unloading']

/** Frontmatter keys this panel reads and writes. */
const KEY_DISABLE_MODEL = 'disable-model-invocation'
const KEY_USER_INVOCABLE = 'user-invocable'

/**
 * Mount the panel: register the two routes once a webserver exists.
 *
 * `webServer` is read through `ctx.inject` rather than a fiber-level `inject`
 * so a profile without a browser transport (headless, sdk, acp) simply mounts
 * nothing instead of holding the fiber pending forever.
 *
 * @param ctx - the plugin context.
 * @param config - optional deployment overrides (see the README).
 */
export function apply(ctx, config = {}) {
  const settings = resolveSettings(config)
  ctx.inject(['webServer'], (webCtx) => {
    webCtx.effect(() => webCtx.webServer.register({
      kind: 'exact',
      path: STATE_ROUTE,
      // The webserver awaits the handler inside its own try/catch, so returning
      // the promise keeps a late failure contained instead of unhandled.
      handler: (req, res) => handleState(ctx, settings, req, res),
    }), `skills-mcp-panel: GET ${STATE_ROUTE}`)
    webCtx.effect(() => webCtx.webServer.register({
      kind: 'exact',
      path: TOGGLE_ROUTE,
      handler: (req, res) => handleToggle(ctx, settings, req, res),
    }), `skills-mcp-panel: POST ${TOGGLE_ROUTE}`)
  })
}

/**
 * Resolve the deployment-varying paths once, at mount.
 * @param config - raw plugin configuration.
 * @returns absolute paths and extra skill roots.
 */
function resolveSettings(config) {
  if (config === null || typeof config !== 'object') {
    throw new TypeError('skills-mcp-panel: config must be an object')
  }
  const patchPath = optionalPath(config.patchPath, 'patchPath')
  const extraRoots = config.skillRoots === undefined ? [] : config.skillRoots
  if (!Array.isArray(extraRoots)) throw new TypeError('skills-mcp-panel: skillRoots must be a string array')
  const maxProjects = config.maxSkillProjects ?? DEFAULT_MAX_PROJECTS
  if (!Number.isSafeInteger(maxProjects) || maxProjects < 1) {
    throw new TypeError('skills-mcp-panel: maxSkillProjects must be a positive integer')
  }
  return {
    dshHome: optionalPath(config.dshHome, 'dshHome') ?? resolve(process.env.DSH_HOME ?? join(homedir(), '.dsh')),
    agentsHome: optionalPath(config.agentsHome, 'agentsHome') ?? resolve(process.env.DSH_AGENTS_HOME ?? join(homedir(), '.agents')),
    projectRoot: optionalPath(config.projectRoot, 'projectRoot') ?? resolve(process.cwd()),
    patchPath,
    maxProjects,
    extraRoots: extraRoots.map((root, index) => {
      const path = optionalPath(root, `skillRoots[${index}]`)
      if (path === undefined) throw new TypeError(`skills-mcp-panel: skillRoots[${index}] must be a non-empty string`)
      return path
    }),
  }
}

/**
 * Every project root this deployment knows about: the workspaces the Web GUI
 * has opened (so each project gets its own group) plus this process's own
 * working directory, deduplicated and bounded.
 * @param ctx - plugin context, for the optional workspace registry.
 * @param settings - resolved paths.
 * @returns absolute project roots, sorted.
 */
function projectRoots(ctx, settings) {
  const roots = [settings.projectRoot]
  const registry = ctx.get('workspaceRegistry')
  if (registry !== undefined && typeof registry.list === 'function') {
    try {
      for (const workspace of registry.list()) {
        if (typeof workspace?.path === 'string' && workspace.path.length > 0) roots.push(resolve(workspace.path))
      }
    } catch {
      // A registry that cannot answer is not this panel's failure: the panel
      // still lists the process's own project instead of failing the request.
    }
  }
  return [...new Set(roots)].sort().slice(0, settings.maxProjects)
}

/**
 * One optional absolute path from configuration.
 * @param value - the raw value.
 * @param label - field name for the diagnostic.
 * @returns the resolved absolute path, or undefined when absent.
 */
function optionalPath(value, label) {
  if (value === undefined || value === null) return undefined
  if (typeof value !== 'string' || value.length === 0) {
    throw new TypeError(`skills-mcp-panel: ${label} must be a non-empty string`)
  }
  return resolve(value)
}

/**
 * Answer `GET /skills-mcp/state`.
 * @param ctx - plugin context (for the Loader and tool registry).
 * @param settings - resolved paths.
 * @param req - the incoming request.
 * @param res - the response to write.
 */
async function handleState(ctx, settings, req, res) {
  if (refuse(ctx, req, res)) return
  if (req.method !== 'GET') {
    sendMethodNotAllowed(res, 'GET')
    return
  }
  try {
    const projects = projectRoots(ctx, settings)
    const requested = requestedProject(queryParam(req, CURRENT_CWD_KEY))
    sendJson(res, 200, await statePayload(ctx, settings, projects, requested))
  } catch (error) {
    sendJson(res, 500, { code: 'state-failed', message: messageOf(error) })
  }
}

/**
 * Answer `POST /skills-mcp/toggle`.
 * @param ctx - plugin context.
 * @param settings - resolved paths.
 * @param req - the incoming request.
 * @param res - the response to write.
 */
async function handleToggle(ctx, settings, req, res) {
  if (refuse(ctx, req, res)) return
  if (req.method !== 'POST') {
    sendMethodNotAllowed(res, 'POST')
    return
  }
  const essence = String(req.headers['content-type']).split(';', 1)[0]?.trim().toLowerCase()
  if (essence !== 'application/json') {
    sendJson(res, 415, { code: 'unsupported-media-type', message: 'content-type must be application/json' })
    return
  }
  const text = await readBoundedBody(req)
  if (text === null) {
    sendJson(res, 413, { code: 'payload-too-large', message: 'request body is too large' })
    return
  }
  let parsed
  try {
    parsed = JSON.parse(text)
  } catch {
    sendJson(res, 400, { code: 'bad-json', message: 'request body must be JSON' })
    return
  }
  const kind = parsed?.kind
  const id = parsed?.id
  if ((kind !== 'skill' && kind !== 'mcp') || typeof id !== 'string' || id.length === 0) {
    sendJson(res, 400, { code: 'bad-request', message: 'expected { kind: "skill" | "mcp", id: string, ... }' })
    return
  }
  // A skill carries BOTH invocation bits, because the two frontmatter keys are
  // independent; an MCP row is a single enablement.
  const policy = kind === 'skill' ? { model: parsed.model, user: parsed.user } : undefined
  if (kind === 'skill' && (typeof policy.model !== 'boolean' || typeof policy.user !== 'boolean')) {
    sendJson(res, 400, { code: 'bad-request', message: 'a skill request needs boolean "model" and "user"' })
    return
  }
  if (kind === 'mcp' && typeof parsed.enabled !== 'boolean') {
    sendJson(res, 400, { code: 'bad-request', message: 'an MCP request needs boolean "enabled"' })
    return
  }
  try {
    const projects = projectRoots(ctx, settings)
    if (kind === 'skill') await writeSkillPolicy(settings, projects, id, policy)
    else await toggleMcp(ctx, settings, projects, id, parsed.enabled)
    const payload = await statePayload(ctx, settings, projects, requestedProject(parsed.cwd))
    sendJson(res, 200, {
      ok: true,
      applied: kind === 'mcp' && payload.profile?.patchReload === 'startup' ? 'restart' : 'hot',
      ...payload,
    })
  } catch (error) {
    sendJson(res, 409, { code: 'toggle-failed', message: messageOf(error) })
  }
}

/**
 * The full payload both routes answer with. Building it in one place is what
 * keeps a toggle answer identical to a state answer: the page replaces its
 * whole snapshot on every change, so a menu that arrived with a different pin
 * would re-order and re-collapse the groups under the user's cursor.
 *
 * @param ctx - plugin context (for the Loader).
 * @param settings - resolved paths.
 * @param projects - absolute project roots.
 * @param requested - the requested current project, if any.
 * @returns the JSON payload.
 */
async function statePayload(ctx, settings, projects, requested) {
  const [skills, profile] = await Promise.all([collectSkills(settings, projects), resolveProfile(settings)])
  return {
    skills,
    mcp: collectMcp(ctx, projects),
    groups: groupsFor(settings, projects, pinnedProject(settings, projects, requested)),
    roots: skillRoots(settings, projects).map(root => ({ id: root.id, path: root.path })),
    profile: profile === undefined
      ? null
      : { name: profile.name, patchPath: profile.patchPath, patchReload: profile.patchReload, detected: profile.detected },
  }
}

/**
 * One query parameter of a request, for the routes that take a GET hint.
 * @param req - the incoming request.
 * @param name - parameter name.
 * @returns the decoded value, or undefined when the request has no such field.
 */
function queryParam(req, name) {
  const url = typeof req.url === 'string' ? req.url : ''
  const query = url.indexOf('?')
  if (query < 0) return undefined
  return new URLSearchParams(url.slice(query + 1)).get(name) ?? undefined
}

/**
 * The current project a request reports, as an absolute path.
 *
 * This is a display hint — it only decides which group leads the menu and opens
 * by default — so a value that is not a plausible path is ignored rather than
 * rejected: refusing the whole page over a cosmetic field would trade a wrong
 * pin for no panel at all.
 *
 * @param value - raw query-string or body value.
 * @returns the resolved absolute path, or undefined.
 */
function requestedProject(value) {
  if (typeof value !== 'string' || value.length === 0 || value.length > MAX_CWD_BYTES) return undefined
  if (value.includes('\0')) return undefined
  return resolve(value)
}

/**
 * The project whose group the page pins.
 *
 * A GUI with no Session open reports no directory, and a Session in a workspace
 * this deployment never registered would name a project that has no group; both
 * fall back to this process's own project, so exactly one project group leads
 * the page rather than none.
 *
 * @param settings - resolved paths.
 * @param projects - absolute project roots.
 * @param requested - the requested current project, if any.
 * @returns one of `projects`, or undefined when there are none.
 */
function pinnedProject(settings, projects, requested) {
  if (requested !== undefined) {
    const match = projects.find(project => samePath(project, requested))
    if (match !== undefined) return match
  }
  return projects.find(project => samePath(project, settings.projectRoot)) ?? projects[0]
}

/** Whether two absolute paths name the same directory on this platform. */
function samePath(left, right) {
  if (left === right) return true
  // Windows resolves either separator and ignores case, so a browser path and a
  // `resolve()`d one can differ in both and still be the same directory.
  return process.platform === 'win32' && left.toLowerCase() === right.toLowerCase()
}

/**
 * Apply the composition's trust fence to one request: the browser session
 * cookie plus the Host/Origin check that defeats cross-site and rebinding
 * callers. Fails closed when no connection service is composed.
 * @param ctx - plugin context.
 * @param req - the incoming request.
 * @param res - the response to write on refusal.
 * @returns true when the request was refused and answered.
 */
function refuse(ctx, req, res) {
  const connection = ctx.get('connection')
  if (connection === undefined || typeof connection.requestRejection !== 'function') {
    sendJson(res, 403, { code: 'no-trust-surface', message: 'this deployment composes no connection service' })
    return true
  }
  const rejection = connection.requestRejection(req)
  if (rejection === undefined) return false
  res.statusCode = rejection
  res.end()
  return true
}

/** JSON response; live facts are never cached. */
function sendJson(res, status, payload) {
  res.statusCode = status
  res.setHeader('content-type', 'application/json; charset=utf-8')
  res.setHeader('cache-control', 'no-store')
  res.end(JSON.stringify(payload))
}

/** 405 naming the route's one supported method. */
function sendMethodNotAllowed(res, allow) {
  res.statusCode = 405
  res.setHeader('allow', allow)
  res.end()
}

/**
 * Read a bounded request body as UTF-8 text.
 * @param req - the incoming request.
 * @returns the body, or null past the ceiling (stream drained).
 */
async function readBoundedBody(req) {
  const chunks = []
  let size = 0
  for await (const chunk of req) {
    size += chunk.byteLength
    if (size > MAX_BODY_BYTES) {
      req.resume()
      return null
    }
    chunks.push(chunk)
  }
  return Buffer.concat(chunks).toString('utf8')
}

/** Readable message for one thrown value. */
function messageOf(error) {
  return error instanceof Error ? error.message : String(error)
}

/**
 * The group every row belongs to when no project owns it: the user's own skill
 * roots and every globally declared MCP server.
 */
const GLOBAL_GROUP = 'global'

/** Default ceiling on how many workspaces one scan covers. */
const DEFAULT_MAX_PROJECTS = 64

/** The group id for one project root. */
function projectGroupId(project) {
  return `project:${project}`
}

/** Whether a path is the project itself or something inside it. */
function isInside(project, path) {
  return path === project || path.startsWith(project + sep(project))
}

/**
 * The groups a page renders: the current project first, then the global group,
 * the other project roots, and the configured extra roots. A group with no rows
 * is dropped by the page, so this list is the complete menu rather than a claim
 * that every group has content.
 *
 * The pin and the order are the host's to state because the host is what knows
 * the project paths: the page only reads `current` off the leading row.
 *
 * @param settings - resolved paths.
 * @param projects - absolute project roots.
 * @param pinned - the project group to lead the menu, if any.
 * @returns group descriptors; `label` is absent for the global group, which the
 * page names from its own dictionary.
 */
function groupsFor(settings, projects, pinned) {
  const groups = [{ id: GLOBAL_GROUP, kind: 'global', path: null, current: false }]
  for (const project of projects) {
    groups.push({
      id: projectGroupId(project),
      kind: 'project',
      label: basename(project),
      path: project,
      current: pinned !== undefined && samePath(project, pinned),
    })
  }
  for (const path of settings.extraRoots) {
    groups.push({ id: `root:${path}`, kind: 'custom', label: basename(path), path, current: false })
  }
  return [...groups.filter(group => group.current), ...groups.filter(group => !group.current)]
}

/**
 * The skill roots scanned, each tagged with the group it feeds.
 *
 * Grouping is the whole point: a root under the user's home is global, while a
 * root under a project belongs to that project. The provider's own rank order
 * (project before user) is irrelevant to a list that shows every root.
 *
 * @param settings - resolved paths.
 * @param projects - absolute project roots.
 * @returns ordered roots.
 */
function skillRoots(settings, projects) {
  const roots = [
    { id: 'user-dsh', path: join(settings.dshHome, 'skills'), groupId: GLOBAL_GROUP },
    { id: 'user-agents', path: join(settings.agentsHome, 'skills'), groupId: GLOBAL_GROUP },
  ]
  for (const project of projects) {
    const groupId = projectGroupId(project)
    roots.push({ id: 'project-dsh', path: join(project, '.dsh', 'skills'), groupId })
    roots.push({ id: 'project-agents', path: join(project, '.agents', 'skills'), groupId })
  }
  for (const path of settings.extraRoots) roots.push({ id: 'custom', path, groupId: `root:${path}` })
  return roots
}

/**
 * Discover every skill on disk, highest-priority root first.
 *
 * The scan mirrors `dsh-skill-filesystem`: a directory bundle holding
 * `SKILL.md`, or a flat `<name>.md`, at the top level of a scanned root. Nested
 * bundles are deliberately not discovered, and a `.`-prefixed entry is skipped
 * (the user root keeps its `.system` child).
 *
 * @param settings - resolved paths.
 * @param projects - absolute project roots.
 * @returns one row per discovered skill, in root then name order.
 */
async function collectSkills(settings, projects) {
  const rows = []
  for (const root of skillRoots(settings, projects)) {
    let entries
    try {
      entries = await readdir(root.path, { withFileTypes: true })
    } catch {
      continue // an absent root is the normal case, not a failure
    }
    const found = []
    for (const entry of entries) {
      if (entry.name.startsWith('.')) continue
      if (entry.isDirectory()) {
        found.push(await readSkill(join(root.path, entry.name, 'SKILL.md'), root, entry.name))
      } else if (entry.isFile() && entry.name.endsWith('.md')) {
        found.push(await readSkill(join(root.path, entry.name), root, basename(entry.name, '.md')))
      }
    }
    found.sort((left, right) => left.name.localeCompare(right.name))
    rows.push(...found)
  }
  return rows
}

/**
 * Parse one skill file into a panel row.
 * @param path - absolute path of the `SKILL.md` or flat `<name>.md` file.
 * @param root - the root that produced it.
 * @param fallbackName - the directory or file name, used when frontmatter has no name.
 * @returns a row; a parse failure is reported on the row instead of thrown.
 */
async function readSkill(path, root, fallbackName) {
  let text
  try {
    text = await readFile(path, 'utf8')
  } catch (error) {
    return failedRow(path, root, fallbackName, messageOf(error))
  }
  if (text.length > MAX_SKILL_BYTES) {
    return failedRow(path, root, fallbackName, `file exceeds ${MAX_SKILL_BYTES} bytes`)
  }
  const front = frontmatterOf(text)
  if (front.error !== undefined) return failedRow(path, root, fallbackName, front.error)
  const fields = parseFields(front.lines)
  const name = fields.get('name') ?? fallbackName
  const disableModel = readBoolean(fields.get(KEY_DISABLE_MODEL))
  const userInvocable = readBoolean(fields.get(KEY_USER_INVOCABLE))
  if (disableModel.error !== undefined) return failedRow(path, root, name, disableModel.error)
  if (userInvocable.error !== undefined) return failedRow(path, root, name, userInvocable.error)
  return {
    id: path,
    name,
    description: fields.get('description') ?? '',
    whenToUse: fields.get('whenToUse') ?? fields.get('when-to-use') ?? '',
    groupId: root.groupId,
    root: root.id,
    rootPath: root.path,
    path,
    bodyLines: front.body.trim().length === 0 ? 0 : front.body.trim().split(/\r?\n/).length,
    modelInvocable: disableModel.value !== true,
    userInvocable: userInvocable.value !== false,
    hasFrontmatter: true,
    error: null,
  }
}

/** One row for a skill that could not be read or parsed. */
function failedRow(path, root, name, error) {
  return {
    id: path,
    name,
    description: '',
    whenToUse: '',
    groupId: root.groupId,
    root: root.id,
    rootPath: root.path,
    path,
    bodyLines: 0,
    modelInvocable: false,
    userInvocable: false,
    hasFrontmatter: false,
    error,
  }
}

/**
 * Split a document into lines that remember where they sit, so a rewrite can
 * replace exactly one line and leave every other byte alone.
 *
 * A line's terminator is its own slice: `text` excludes it, `eol` is it. That
 * is what makes a CRLF file survive a rewrite — a writer re-emits the
 * terminator it found instead of a `\n` of its own.
 *
 * @param text - the whole document.
 * @returns one entry per line, including the empty last line a trailing
 * terminator produces.
 */
function scanLines(text) {
  const lines = []
  let start = 0
  for (;;) {
    const newline = text.indexOf('\n', start)
    if (newline < 0) {
      lines.push({ start, end: text.length, eol: '', text: text.slice(start) })
      return lines
    }
    const carriage = newline > start && text[newline - 1] === '\r' ? newline - 1 : newline
    lines.push({
      start,
      end: carriage,
      eol: text.slice(carriage, newline + 1),
      text: text.slice(start, carriage),
    })
    start = newline + 1
  }
}

/**
 * The line terminator new lines should use in one document.
 * @param text - the whole document.
 * @returns `\r\n` for a document that uses it anywhere, else `\n`.
 */
function dominantEol(text) {
  return text.includes('\r\n') ? '\r\n' : '\n'
}

/**
 * Locate a skill file's frontmatter: the two fences, the lines between them,
 * and the body after the closing fence.
 *
 * Everything is reported as offsets into the original text, which is what lets
 * the writer cut one line out and keep every other byte — including the line
 * endings of lines it never touched.
 *
 * @param text - the whole file.
 * @returns the region, or an `error` when the fences are missing or unmatched.
 */
function frontmatterOf(text) {
  const lines = scanLines(text)
  if (lines[0]?.text.trim() !== '---') {
    return { error: 'missing YAML frontmatter', lines: [], body: text }
  }
  for (let index = 1; index < lines.length; index += 1) {
    if (lines[index].text.trim() !== '---') continue
    const close = lines[index]
    return {
      error: undefined,
      open: lines[0],
      close,
      lines: lines.slice(1, index),
      body: text.slice(close.end + close.eol.length),
    }
  }
  return { error: 'unterminated YAML frontmatter', lines: [], body: text }
}

/** The header of a block scalar: `>`, `|`, and their chomping/indent variants. */
const BLOCK_SCALAR_HEADER = /^[|>][+-]?\d*$/

/**
 * Read the `key: value` pairs of a frontmatter block, including the two
 * multi-line shapes a description is actually written in.
 *
 * Only a top-level key (column zero) opens a field, which is also what keeps
 * `parseFields` out of nested mappings and out of block-scalar content: a
 * scalar's own lines are indented, so they can never be mistaken for a field.
 *
 * @param lines - frontmatter lines, terminators excluded.
 * @returns value text by key, last occurrence winning.
 */
function parseFields(lines) {
  const fields = new Map()
  for (let index = 0; index < lines.length; index += 1) {
    const match = /^(?<key>[A-Za-z][A-Za-z0-9_-]*)\s*:\s*(?<value>.*)$/.exec(lines[index].text)
    if (match?.groups === undefined) continue
    const raw = match.groups.value.trim()
    if (BLOCK_SCALAR_HEADER.test(raw)) {
      const [text, next] = readBlockScalar(lines, index + 1, raw)
      fields.set(match.groups.key, text)
      index = next - 1
      continue
    }
    fields.set(match.groups.key, unquote(stripInlineComment(raw)))
  }
  return fields
}

/**
 * Collect one block scalar's lines and apply its style.
 * @param lines - all frontmatter lines.
 * @param from - index of the first line after the header.
 * @param header - the header text (`>`, `|-`, …).
 * @returns the scalar's text, and the index of the first line after it.
 */
function readBlockScalar(lines, from, header) {
  const body = []
  let index = from
  for (; index < lines.length; index += 1) {
    const text = lines[index].text
    if (text.trim().length === 0) {
      body.push('')
      continue
    }
    if (!/^\s/.test(text)) break
    body.push(text)
  }
  // Trailing blank lines belong to the document, not to a clip/keep scalar;
  // their difference is not worth carrying into a one-line summary.
  while (body.length > 0 && body[body.length - 1].length === 0) body.pop()
  const populated = body.filter(line => line.trim().length > 0)
  const indent = populated.length === 0
    ? 0
    : Math.min(...populated.map(line => line.length - line.trimStart().length))
  const dedented = body.map(line => (line.length === 0 ? '' : line.slice(indent)))
  return [header.startsWith('>') ? foldScalar(dedented) : dedented.join('\n'), index]
}

/**
 * Fold a `>` scalar: one paragraph is one line, a blank line is a break.
 * @param lines - the scalar's dedented lines.
 * @returns the folded text.
 */
function foldScalar(lines) {
  let text = ''
  for (const line of lines) {
    if (line.length === 0) {
      text += '\n'
      continue
    }
    text += text.length === 0 || text.endsWith('\n') ? line : ` ${line}`
  }
  return text
}

/**
 * Drop a YAML inline comment from one value.
 * @param value - the trimmed value text.
 * @returns the value without ` #…`, or the value unchanged when it is quoted.
 */
function stripInlineComment(value) {
  if (value.startsWith('"') || value.startsWith("'")) return value
  const hash = value.search(/\s#/)
  return hash < 0 ? value : value.slice(0, hash)
}

/** Strip one layer of matching quotes. */
function unquote(value) {
  if (value.length >= 2 && ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'")))) {
    return value.slice(1, -1)
  }
  return value
}

/**
 * Read a frontmatter boolean using the spellings the local provider accepts.
 * @param value - the raw value, or undefined when the key is absent.
 * @returns the parsed value, or a local error for a rejected spelling.
 */
function readBoolean(value) {
  if (value === undefined) return { value: undefined, error: undefined }
  const normalized = value.toLowerCase()
  if (['true', 'yes', 'on', '1'].includes(normalized)) return { value: true, error: undefined }
  if (['false', 'no', 'off', '0'].includes(normalized)) return { value: false, error: undefined }
  return { value: undefined, error: `invalid boolean for a frontmatter key: ${value}` }
}

/**
 * Write one skill's invocation policy into its frontmatter.
 *
 * The two keys are independent, so this is a four-state writer: `true` is the
 * provider default and REMOVES the key (a file returns to its original bytes
 * when a skill goes back to the default), while `false` writes the key
 * explicitly. A rejected spelling or a missing key already reads as the
 * default, so only the bits the caller actually changed move.
 *
 * The path must be a skill this panel discovered, so a malformed request can
 * never target an arbitrary file.
 *
 * @param settings - resolved paths.
 * @param projects - absolute project roots.
 * @param path - absolute path of the skill file.
 * @param policy - the requested `{ model, user }` invocation bits.
 */
async function writeSkillPolicy(settings, projects, path, policy) {
  const roots = skillRoots(settings, projects)
  const root = roots.find(candidate => path.startsWith(candidate.path + sep(candidate.path)))
  if (root === undefined) throw new Error(`${path} is not inside a scanned skill root`)
  const skills = await collectSkills(settings, projects)
  const row = skills.find(skill => skill.id === path)
  if (row === undefined) throw new Error(`unknown skill: ${path}`)
  if (row.error !== null) throw new Error(`${path}: ${row.error}`)
  if (row.modelInvocable === policy.model && row.userInvocable === policy.user) return
  const text = await readFile(path, 'utf8')
  const front = frontmatterOf(text)
  if (front.error !== undefined) throw new Error(`${path}: ${front.error}`)
  const eol = dominantEol(text)
  const openEnd = front.open.end + front.open.eol.length
  // Only a column-zero line is a field this panel owns: an indented
  // `disable-model-invocation:` belongs to some nested mapping or to a block
  // scalar's body, and cutting it would silently delete the user's content.
  const kept = front.lines
    .filter(line => !OWNED_KEY_LINE.test(line.text))
    .map(line => line.text + line.eol)
    .join('')
  const inserted = []
  if (!policy.model) inserted.push(`${KEY_DISABLE_MODEL}: true${eol}`)
  if (!policy.user) inserted.push(`${KEY_USER_INVOCABLE}: false${eol}`)
  const next = text.slice(0, openEnd) + kept + inserted.join('') + text.slice(front.close.start)
  if (next === text) return
  await atomicWrite(path, next)
}

/** A frontmatter line this panel owns, in the only form it may take: column 0. */
const OWNED_KEY_LINE = new RegExp(`^(?:${KEY_DISABLE_MODEL}|${KEY_USER_INVOCABLE})\\s*:`)

/** The separator that must follow a root path for it to contain a child. */
function sep(path) {
  return path.endsWith('\\') || path.endsWith('/') ? '' : (process.platform === 'win32' ? '\\' : '/')
}

/**
 * Flip one MCP server by writing an id-targeted `disabled:` row into the
 * profile's own patch file.
 * @param ctx - plugin context, for validating the entry id.
 * @param settings - resolved paths.
 * @param projects - absolute project roots (the row's group is not part of the target).
 * @param entryId - the declared id of the MCP row.
 * @param enabled - the requested enablement.
 * @returns the profile the write landed in.
 */
async function toggleMcp(ctx, settings, projects, entryId, enabled) {
  if (!collectMcp(ctx, projects).some(row => row.id === entryId)) throw new Error(`unknown MCP entry: ${entryId}`)
  const profile = await resolveProfile(settings)
  if (profile === undefined) {
    throw new Error(`no profile under ${join(settings.dshHome, 'profiles')} lists ${OWN_PACKAGE}; set config.patchPath`)
  }
  const ids = await readManagedIds(profile.patchPath)
  if (enabled) ids.delete(entryId)
  else ids.add(entryId)
  await writeManagedBlock(profile.patchPath, ids)
  return profile
}

/**
 * Locate the profile this plugin is installed in: the one whose bundle list
 * names this package. Configuration wins over detection.
 * @param settings - resolved paths.
 * @returns the profile facts, or undefined when nothing matches.
 */
async function resolveProfile(settings) {
  if (settings.patchPath !== undefined) {
    return {
      name: basename(join(settings.patchPath, '..')),
      patchPath: settings.patchPath,
      patchReload: 'unknown',
      detected: false,
    }
  }
  const profilesDir = join(settings.dshHome, 'profiles')
  let names
  try {
    names = await readdir(profilesDir)
  } catch {
    return undefined
  }
  const candidates = []
  for (const entry of names) {
    try {
      const manifest = JSON.parse(await readFile(join(profilesDir, entry, 'package.json'), 'utf8'))
      const bundles = manifest?.dsh?.profile?.bundles
      if (!Array.isArray(bundles) || !bundles.includes(OWN_PACKAGE)) continue
      candidates.push({ name: entry, patchReload: stringOr(manifest?.dsh?.profile?.patchReload, 'startup') })
    } catch {
      continue // not a profile directory
    }
  }
  const chosen = candidates.find(candidate => candidate.patchReload === 'live') ?? candidates[0]
  if (chosen === undefined) return undefined
  return {
    name: chosen.name,
    patchPath: join(profilesDir, chosen.name, 'cordis.patch.yml'),
    patchReload: chosen.patchReload,
    detected: true,
  }
}

/** One string value or a fallback. */
function stringOr(value, fallback) {
  return typeof value === 'string' && value.length > 0 ? value : fallback
}

/**
 * The span one managed block occupies, separator included, so removing it
 * removes exactly what adding it inserted.
 *
 * The block is appended after a two-line separator; that separator is part of
 * the span. Reading it back with the same rule is what makes a round trip
 * byte-exact even when the user's own file ends with blank lines.
 *
 * @param text - the patch document.
 * @returns the span and its inner lines, or undefined when there is no block.
 */
function managedRegion(text) {
  const lines = scanLines(text)
  const open = lines.findIndex(line => line.text.trim() === BLOCK_START)
  if (open < 0) return undefined
  const close = lines.findIndex((line, index) => index > open && line.text.trim() === BLOCK_END)
  if (close < 0) return undefined
  const separator = dominantEol(text).repeat(2)
  const start = lines[open].start
  return {
    start: text.slice(Math.max(0, start - separator.length), start) === separator ? start - separator.length : start,
    end: lines[close].end + lines[close].eol.length,
    lines: lines.slice(open + 1, close),
  }
}

/**
 * Read the entry ids the managed block currently disables.
 * @param patchPath - the profile patch file.
 * @returns disabled entry ids; empty when the file or block is absent.
 */
async function readManagedIds(patchPath) {
  let text
  try {
    text = await readFile(patchPath, 'utf8')
  } catch {
    return new Set()
  }
  const region = managedRegion(text)
  if (region === undefined) return new Set()
  const ids = new Set()
  for (const line of region.lines) {
    const match = /^\s*-\s*id\s*:\s*(?<id>.+?)\s*$/.exec(line.text)
    if (match?.groups !== undefined) ids.add(unquote(match.groups.id))
  }
  return ids
}

/**
 * Replace the managed block with one that disables exactly `ids`, preserving
 * every other byte of the user's patch file — line endings and the file's own
 * trailing blank lines included.
 * @param patchPath - the profile patch file.
 * @param ids - the entry ids to disable.
 */
async function writeManagedBlock(patchPath, ids) {
  let original = ''
  try {
    original = await readFile(patchPath, 'utf8')
  } catch {
    original = ''
  }
  const region = managedRegion(original)
  const body = region === undefined
    ? original
    : original.slice(0, region.start) + original.slice(region.end)
  const eol = dominantEol(body)
  // An explicit empty array (`[]`) cannot carry appended items; the block replaces it.
  const base = body.trim() === '[]' ? '' : body
  const block = ids.size === 0
    ? ''
    : [
        `${BLOCK_START}${eol}`,
        ...[...ids].sort().map(id => `- id: ${JSON.stringify(id)}${eol}  disabled: true${eol}`),
        `${BLOCK_END}${eol}`,
      ].join('')
  const separator = block.length === 0 || base.length === 0 ? '' : `${eol}${eol}`
  const next = `${base}${separator}${block}`
  if (next === original) return
  await atomicWrite(patchPath, next)
}

/**
 * Write a file through a sibling temp file and a rename, so a reader (and the
 * patch watcher) never observes a half-written document.
 * @param path - destination path.
 * @param content - complete new content.
 */
async function atomicWrite(path, content) {
  const temporary = `${path}.skills-mcp-panel.tmp`
  await writeFile(temporary, content, 'utf8')
  await rename(temporary, path)
}

/**
 * Every MCP server row currently composed, with its effective enablement.
 *
 * An MCP row has no directory of its own, so its group comes from the working
 * directory the server is launched in: a stdio server whose `cwd` sits inside
 * one of this deployment's projects belongs to that project, and every other
 * server — including HTTP servers and stdio servers that inherit the harness
 * process's directory — is global.
 *
 * @param ctx - plugin context.
 * @param projects - absolute project roots.
 * @returns one row per `dsh-mcp-client` Loader entry.
 */
function collectMcp(ctx, projects) {
  const loader = ctx.get('loader')
  if (loader === undefined || typeof loader.entries !== 'function') return []
  const schemas = toolSchemas(ctx)
  const rows = []
  for (const entry of loader.entries()) {
    if (entry.options?.group) continue
    if (entry.options?.name !== MCP_MODULE) continue
    const declaredId = typeof entry.options.id === 'string' ? entry.options.id : entry.id
    const config = entry.options?.config ?? {}
    const serverName = typeof config.serverName === 'string' ? config.serverName : ''
    const prefix = serverName.length === 0 ? '' : `mcp__${serverName}__`
    const names = prefix.length === 0 ? [] : schemas.filter(schema => schema.name.startsWith(prefix)).map(schema => schema.name)
    const cwd = typeof config.cwd === 'string' && config.cwd.length > 0 ? resolve(config.cwd) : undefined
    const owner = cwd === undefined ? undefined : projects.find(project => isInside(project, cwd))
    rows.push({
      // The patch algorithm matches the id a composition DECLARED, which is
      // `entry.options.id`; `entry.id` is the tree-qualified path
      // (`include:<declared>`), so writing that back would match no row.
      id: declaredId,
      entryId: declaredId,
      treeId: entry.id,
      groupId: owner === undefined ? GLOBAL_GROUP : projectGroupId(owner),
      serverName: serverName.length === 0 ? '(unnamed)' : serverName,
      transport: typeof config.transport === 'string' ? config.transport : 'stdio',
      detail: describeMcp(config),
      enabled: entry.disabled !== true,
      phase: entry.fiber === undefined ? null : PHASES[entry.fiber.state] ?? null,
      tools: names.length,
      toolNames: names,
    })
  }
  return rows
}

/** One-line transport description for a row's subtitle and details panel. */
function describeMcp(config) {
  if (config.transport === 'streamable-http') return String(config.url ?? '')
  const args = Array.isArray(config.args) ? config.args.map(String) : []
  const cwd = typeof config.cwd === 'string' && config.cwd.length > 0 ? ` (cwd: ${config.cwd})` : ''
  return [config.command, ...args].filter(part => typeof part === 'string' && part.length > 0).join(' ') + cwd
}

/**
 * The model-visible tool schemas of the global view, used to count one
 * server's tools. A missing registry or a scope-shaped failure is not this
 * panel's business: an empty list simply reports zero tools.
 * @param ctx - plugin context.
 * @returns schemas, or an empty list.
 */
function toolSchemas(ctx) {
  const tools = ctx.get('tools')
  if (tools === undefined || typeof tools.schemas !== 'function') return []
  try {
    return tools.schemas()
  } catch {
    return []
  }
}
