/**
 * Smoke test for the Host half: drives both routes through a stub Cordis
 * context and asserts the two text surgeries are byte-faithful.
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
}
const ctx = {
  get: (name) => services[name],
  inject: (_deps, callback) => callback({
    webServer: { register: (route) => { routes.set(route.path, route); return () => routes.delete(route.path) } },
    effect: (factory) => factory(),
  }),
}

apply(ctx, { dshHome, agentsHome, projectRoot })

/** One fake request with an optional JSON body. */
function request(method, body) {
  const req = { method, headers: body === undefined ? {} : { 'content-type': 'application/json' }, resume: () => {} }
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

/** Call one route. */
async function call(path, method, body) {
  const route = routes.get(path)
  assert.ok(route, `route ${path} is registered`)
  const res = response()
  await route.handler(request(method, body === undefined ? undefined : JSON.stringify(body)), res)
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

const mcpOff = await call('/skills-mcp/toggle', 'POST', { kind: 'mcp', id: 'mcp-playwright', enabled: false })
assert.equal(mcpOff.status, 200)
assert.equal(mcpOff.payload.applied, 'hot')
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
console.log('smoke: all assertions passed')
