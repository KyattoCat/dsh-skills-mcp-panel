/**
 * Smoke test for both halves: drives the two HTTP routes through a stub Cordis
 * context and asserts the two text surgeries are byte-faithful, then renders
 * the browser half against a stub module table to assert the group behavior.
 *
 * Run with `node tests/smoke.mjs`. It uses only a temp directory.
 */

import { mkdtemp, mkdir, readFile, writeFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import assert from 'node:assert/strict'
import { apply } from '../lib/index.js'

const root = await mkdtemp(join(tmpdir(), 'skills-mcp-panel-'))
const dshHome = join(root, 'home')
const agentsHome = join(root, 'agents')
const projectRoot = join(root, 'project')
// A second workspace the GUI has opened: the page pins one project, so the test
// needs a project it can pin INSTEAD of the process's own.
const otherProject = join(root, 'other')
const profileDir = join(dshHome, 'profiles', 'web')
const patchPath = join(profileDir, 'cordis.patch.yml')

const ORIGINAL_PATCH = `# Your patch layer for this dsh profile.
- insert:
    - id: mcp-playwright
      name: '@deepseek-ai/dsh-mcp-client'
      config:
        serverName: playwright
        transport: stdio
        command: npx
`

await mkdir(profileDir, { recursive: true })
await writeFile(patchPath, ORIGINAL_PATCH, 'utf8')
await writeFile(join(profileDir, 'package.json'), JSON.stringify({
  name: 'dsh-profile-web',
  dsh: { profile: { bundles: ['@deepseek-ai/dsh-base', 'dsh-skills-mcp-panel'], patchReload: 'live' } },
}, null, 2), 'utf8')

const skillDir = join(dshHome, 'skills', 'demo-skill')
await mkdir(skillDir, { recursive: true })
const SKILL_ORIGINAL = `---
name: demo-skill
description: A demo skill.
whenToUse: never, really
---

# Demo

Body line.
`
await writeFile(join(skillDir, 'SKILL.md'), SKILL_ORIGINAL, 'utf8')
await writeFile(join(dshHome, 'skills', 'flat.md'), '---\nname: flat\ndescription: Flat skill.\n---\n\nText.\n', 'utf8')
await mkdir(join(dshHome, 'skills', '.system'), { recursive: true })
await writeFile(join(dshHome, 'skills', '.system', 'hidden.md'), '---\nname: hidden\n---\n', 'utf8')

// One skill under the project, to prove a second group forms.
const projectSkillDir = join(projectRoot, '.agents', 'skills', 'project-skill')
await mkdir(projectSkillDir, { recursive: true })
await writeFile(join(projectSkillDir, 'SKILL.md'), '---\nname: project-skill\ndescription: Lives in the project.\n---\n\nText.\n', 'utf8')

/** Routes registered by the plugin. */
const routes = new Map()
// The Loader's tree-qualified id is NOT the id a patch matches: the declared
// `options.id` is. Rows composed through an include carry the prefix.
const mcpEntry = {
  id: 'include:mcp-playwright',
  disabled: false,
  fiber: { state: 2 },
  options: {
    id: 'mcp-playwright',
    name: '@deepseek-ai/dsh-mcp-client',
    config: { serverName: 'playwright', transport: 'stdio', command: 'npx', args: ['-y', '@playwright/mcp@latest'] },
  },
}
const services = {
  loader: { entries: () => [mcpEntry, { id: 'other', options: { name: 'unrelated' }, disabled: false }] },
  connection: { requestRejection: () => undefined },
  tools: { schemas: () => [{ name: 'mcp__playwright__browser_navigate' }, { name: 'mcp__playwright__browser_click' }, { name: 'bash' }] },
  workspaceRegistry: { list: () => [{ path: otherProject }] },
}
const ctx = {
  get: (name) => services[name],
  inject: (_deps, callback) => callback({
    webServer: { register: (route) => { routes.set(route.path, route); return () => routes.delete(route.path) } },
    effect: (factory) => factory(),
  }),
}

apply(ctx, { dshHome, agentsHome, projectRoot })

/** One fake request with an optional JSON body, addressed by a full URL. */
function request(url, method, body) {
  const req = { url, method, headers: body === undefined ? {} : { 'content-type': 'application/json' }, resume: () => {} }
  req[Symbol.asyncIterator] = async function* () { if (body !== undefined) yield Buffer.from(body, 'utf8') }
  return req
}

/** One fake response capturing status and body. */
function response() {
  return {
    statusCode: 0, headers: {}, body: undefined,
    setHeader(key, value) { this.headers[key] = value },
    end(chunk) { this.body = chunk === undefined ? '' : String(chunk) },
  }
}

/** Call one route, with an optional query string. */
async function call(path, method, body, query = '') {
  const route = routes.get(path)
  assert.ok(route, `route ${path} is registered`)
  const res = response()
  await route.handler(request(`${path}${query}`, method, body === undefined ? undefined : JSON.stringify(body)), res)
  return { status: res.statusCode, payload: res.body === undefined || res.body === '' ? undefined : JSON.parse(res.body) }
}

const state = await call('/skills-mcp/state', 'GET')
assert.equal(state.status, 200)
const names = state.payload.skills.map(row => row.name)
assert.deepEqual(names, ['flat', 'demo-skill', 'project-skill'].sort((a, b) => a.localeCompare(b)).sort(), 'every skill discovered')
assert.equal(names.includes('hidden'), false, 'dot-prefixed roots are skipped')
assert.equal(state.payload.skills.find(row => row.name === 'demo-skill').modelInvocable, true)
assert.equal(state.payload.skills.find(row => row.name === 'demo-skill').whenToUse, 'never, really')

// Grouping: user roots are global, a project root is that project's group.
const groupIds = new Map(state.payload.skills.map(row => [row.name, row.groupId]))
assert.equal(groupIds.get('demo-skill'), 'global', 'a user-root skill is global')
assert.equal(groupIds.get('flat'), 'global', 'an agent-home skill is global')
assert.equal(groupIds.get('project-skill'), `project:${projectRoot}`, 'a project skill belongs to its project')
const globalGroup = state.payload.groups.find(group => group.id === 'global')
const projectGroup = state.payload.groups.find(group => group.id === `project:${projectRoot}`)
assert.equal(globalGroup.kind, 'global')
assert.equal(projectGroup.kind, 'project', 'the project is its own group')
assert.equal(projectGroup.label, 'project', 'the group is named after the project directory')
assert.equal(projectGroup.path, projectRoot)

// The menu flags the current project and leads with it. A request that names no
// project — an older client, or a GUI with no Session open — pins this
// process's own project rather than pinning nothing.
const pinnedIds = state.payload.groups.filter(group => group.current === true).map(group => group.id)
assert.deepEqual(pinnedIds, [`project:${projectRoot}`], 'the process project is the default pin')
assert.equal(state.payload.groups[0].id, `project:${projectRoot}`, 'the pinned group leads the menu')

// The browser reports the Session's own workspace, which moves the pin.
const elsewhere = await call('/skills-mcp/state', 'GET', undefined, `?cwd=${encodeURIComponent(otherProject)}`)
assert.deepEqual(elsewhere.payload.groups.filter(group => group.current === true).map(group => group.id),
  [`project:${otherProject}`], 'the reported project is the pin')
assert.equal(elsewhere.payload.groups[0].id, `project:${otherProject}`, 'the reported project leads the menu')

// A workspace this deployment never registered has no group to pin; the page
// still needs one project group open, so the fallback stands.
const absent = await call('/skills-mcp/state', 'GET', undefined, `?cwd=${encodeURIComponent(join(root, 'absent'))}`)
assert.equal(absent.payload.groups[0].id, `project:${projectRoot}`, 'an unknown project falls back to the process project')

assert.equal(state.payload.mcp.length, 1, 'one MCP row')
assert.equal(state.payload.mcp[0].serverName, 'playwright')
assert.equal(state.payload.mcp[0].id, 'mcp-playwright', 'the row is addressed by its declared id')
assert.equal(state.payload.mcp[0].treeId, 'include:mcp-playwright', 'the tree-qualified id is reported separately')
assert.equal(state.payload.mcp[0].tools, 2, 'tools counted by server prefix')
assert.equal(state.payload.mcp[0].groupId, 'global', 'a server without a project cwd is global')
assert.equal(state.payload.profile.patchPath, patchPath)
assert.equal(state.payload.profile.patchReload, 'live')

const skillId = state.payload.skills.find(row => row.name === 'demo-skill').id
const policyOf = async () => {
  const row = (await call('/skills-mcp/state', 'GET')).payload.skills.find(skill => skill.name === 'demo-skill')
  return { model: row.modelInvocable, user: row.userInvocable }
}

// Manual only: the model loses it, the human keeps it.
const manual = await call('/skills-mcp/toggle', 'POST', { kind: 'skill', id: skillId, model: false, user: true })
assert.equal(manual.status, 200)
const manualText = await readFile(join(skillDir, 'SKILL.md'), 'utf8')
assert.ok(manualText.includes('disable-model-invocation: true'), 'the model key is written')
assert.equal(manualText.includes('user-invocable'), false, 'the user key stays at its default')
assert.ok(manualText.includes('description: A demo skill.'), 'other frontmatter preserved')
assert.ok(manualText.includes('# Demo\n\nBody line.'), 'body preserved')
assert.deepEqual(await policyOf(), { model: false, user: true })

// Disabled: neither surface reaches it.
await call('/skills-mcp/toggle', 'POST', { kind: 'skill', id: skillId, model: false, user: false })
const offText = await readFile(join(skillDir, 'SKILL.md'), 'utf8')
assert.ok(offText.includes('disable-model-invocation: true') && offText.includes('user-invocable: false'), 'both keys are written')
assert.deepEqual(await policyOf(), { model: false, user: false })

// Model only: the inverse state the binary switch could not express.
await call('/skills-mcp/toggle', 'POST', { kind: 'skill', id: skillId, model: true, user: false })
const modelText = await readFile(join(skillDir, 'SKILL.md'), 'utf8')
assert.equal(modelText.includes('disable-model-invocation'), false, 'the model key is removed again')
assert.ok(modelText.includes('user-invocable: false'), 'the user key is written')
assert.deepEqual(await policyOf(), { model: true, user: false })

// Back to the default: both keys gone, the file returns to its original bytes.
const on = await call('/skills-mcp/toggle', 'POST', { kind: 'skill', id: skillId, model: true, user: true })
assert.equal(on.status, 200)
assert.equal(await readFile(join(skillDir, 'SKILL.md'), 'utf8'), SKILL_ORIGINAL, 'the default policy restores the exact original bytes')
assert.deepEqual(await policyOf(), { model: true, user: true })

const mcpOff = await call('/skills-mcp/toggle', 'POST', { kind: 'mcp', id: 'mcp-playwright', enabled: false, cwd: otherProject })
assert.equal(mcpOff.status, 200)
assert.equal(mcpOff.payload.applied, 'hot')
// A toggle answer replaces the whole snapshot, so it must carry the same pinned
// menu: a page that re-ordered there would collapse the open group mid-click.
assert.equal(mcpOff.payload.groups[0].id, `project:${otherProject}`, 'the toggle answer keeps the pin')
const patched = await readFile(patchPath, 'utf8')
assert.ok(patched.startsWith(ORIGINAL_PATCH), 'the user patch file is preserved byte for byte')
assert.ok(patched.includes('# >>> dsh-skills-mcp-panel'))
assert.ok(patched.includes('- id: "mcp-playwright"\n  disabled: true'))

const mcpOn = await call('/skills-mcp/toggle', 'POST', { kind: 'mcp', id: 'mcp-playwright', enabled: true })
assert.equal(mcpOn.status, 200)
assert.equal(await readFile(patchPath, 'utf8'), ORIGINAL_PATCH, 're-enabling restores the exact original bytes')

const bogus = await call('/skills-mcp/toggle', 'POST', { kind: 'skill', id: join(root, 'nope.md'), model: false, user: true })
assert.equal(bogus.status, 409, 'a path outside the scanned roots is refused')

const incomplete = await call('/skills-mcp/toggle', 'POST', { kind: 'skill', id: skillId, model: false })
assert.equal(incomplete.status, 400, 'a skill request needs both bits')

const badMcp = await call('/skills-mcp/toggle', 'POST', { kind: 'mcp', id: 'not-a-row', enabled: false })
assert.equal(badMcp.status, 409, 'an unknown MCP entry is refused')

const wrongMethod = await call('/skills-mcp/state', 'POST', {})
assert.equal(wrongMethod.status, 405)

await rm(root, { recursive: true, force: true })

// ---------------------------------------------------------------------------
// Browser half: group expand/collapse.
//
// `lib/client.js` registers a lazy-CJS factory rather than being a module, so
// materializing it needs a stub module table and a React stand-in. That is
// enough to render the page and assert what this behavior is about: which
// group is open on arrival, and what a header click does to that.
// ---------------------------------------------------------------------------

/** Hook slots, addressed by call index: the component's hook order is fixed. */
const hooks = { slots: [], index: 0 }

const React = {
  createElement: (type, props, ...children) => ({ type, props: props ?? {}, children: children.flat(Infinity) }),
  useState: (initial) => {
    const index = hooks.index++
    if (!(index in hooks.slots)) hooks.slots[index] = initial
    return [hooks.slots[index], (next) => {
      hooks.slots[index] = typeof next === 'function' ? next(hooks.slots[index]) : next
    }]
  },
  // The panel loads through an effect; the test seeds the source instead.
  useEffect: () => {},
}

const registered = new Map()
globalThis.window = { __ModuleLoader__: { load: (entry) => { registered.set(entry.id, entry) } } }
globalThis.document = {
  querySelector: () => null,
  createElement: () => ({ dataset: {}, remove: () => {} }),
  head: { appendChild: () => {} },
}

await import('../lib/client.js')

const clientEntry = registered.get('dsh-skills-mcp-panel')
assert.ok(clientEntry, 'the browser half registers its factory under the package name')
const clientHalf = clientEntry.factory((specifier) => {
  if (specifier === 'react') return React
  throw new Error(`the browser half required an unexpected module: ${specifier}`)
})

let contribution = null
let Section = null
clientHalf.apply({
  effect: (factory) => { factory() },
  get: () => undefined,
  locale: { register: () => {}, bind: () => (key) => key },
  slots: {
    inject: (_name, callback) => { callback() },
    register: (registeredContribution, component) => {
      contribution = registeredContribution
      Section = component
      return () => {}
    },
  },
})
assert.ok(Section, 'the panel registers one Settings section')

const injected = contribution.inject()
const source = injected.hooks.skillsMcp

const skillRow = (name, groupId) => ({
  id: `/roots/${name}.md`, name, description: '', whenToUse: '', groupId,
  root: 'user-dsh', rootPath: '/roots', path: `/roots/${name}.md`,
  bodyLines: 0, modelInvocable: true, userInvocable: true, hasFrontmatter: true, error: null,
})

/** A ready snapshot with one row per listed group, so those groups render. */
const stateWith = (groups, withRows = groups) => ({
  status: 'ready', error: null, notice: null, mcp: [], roots: [], profile: null, pending: null,
  skills: withRows.map((group, index) => skillRow(`skill-${index}`, group.id)),
  groups,
})

/** Render once, seeding the source the way a load would. */
const render = (snapshot) => {
  source.set(snapshot)
  hooks.index = 0
  return Section({
    ...injected,
    useSkillsMcp: (select) => select(source.getSnapshot()),
    t: (key) => key,
    close: () => {},
  })
}

const walk = (node, visit) => {
  if (node === null || node === undefined || typeof node !== 'object') return
  visit(node)
  for (const child of node.children ?? []) walk(child, visit)
}
const nodesWhere = (tree, predicate) => {
  const found = []
  walk(tree, (node) => { if (predicate(node)) found.push(node) })
  return found
}
const headersOf = (tree) => nodesWhere(tree, node => node.type === 'button'
  && String(node.props?.className).startsWith('dsm-group-head'))
const expandedOf = (tree) => headersOf(tree).map(node => node.props['aria-expanded'])
const gridsOf = (tree) => nodesWhere(tree, node => node.props?.className === 'dsm-grid')

const groups = [
  { id: `project:${otherProject}`, kind: 'project', label: 'other', path: otherProject, current: true },
  { id: 'global', kind: 'global', path: null, current: false },
  { id: `project:${projectRoot}`, kind: 'project', label: 'project', path: projectRoot, current: false },
]

// The pinned project leads, and it is the only group that opens on arrival.
let tree = render(stateWith(groups))
assert.deepEqual(nodesWhere(tree, node => node.type === 'section').map(node => node.props.key),
  groups.map(group => group.id), 'the page keeps the host order, so the pinned group leads')
assert.deepEqual(expandedOf(tree), [true, false, false], 'only the current project group starts open')
assert.equal(gridsOf(tree).length, 1, 'a collapsed group renders no rows at all')
assert.equal(nodesWhere(tree, node => node.props?.className === 'dsm-group-current').length, 1,
  'the badge marks the one pinned group')

// A header click expands that group, and the rows come with it.
headersOf(tree)[1].props.onClick()
tree = render(stateWith(groups))
assert.deepEqual(expandedOf(tree), [true, true, false], 'clicking a header expands its own group')
assert.equal(gridsOf(tree).length, 2, 'the expanded group renders its rows')

// The current group closes like any other, and the choice outranks the pin on
// the next load: the state is the user's, and a load does not reset it.
headersOf(tree)[0].props.onClick()
tree = render(stateWith(groups))
assert.deepEqual(expandedOf(tree), [false, true, false], 'a manual collapse survives the next load')

// The scenarios below each start from a fresh mount (`hooks.slots = []`), so a
// choice made above cannot leak into them.

// A host that flags no current project (an older half) leaves the page as it
// always was: every group open.
hooks.slots = []
tree = render(stateWith(groups.map(group => ({ ...group, current: false }))))
assert.deepEqual(expandedOf(tree), [true, true, true], 'no pin means no collapse')

// A pinned project with no rows of its own has no group on the page, and the
// page must not land fully collapsed — nor open everything — because of it:
// the first group that does have rows takes the pin.
hooks.slots = []
tree = render(stateWith(groups, groups.filter(group => group.id !== `project:${otherProject}`)))
assert.deepEqual(nodesWhere(tree, node => node.type === 'section').map(node => node.props.key),
  ['global', `project:${projectRoot}`], 'a group with no rows is still dropped')
assert.deepEqual(expandedOf(tree), [true, false], 'the first rendered group opens when the pinned one is absent')

console.log('smoke: all assertions passed')
