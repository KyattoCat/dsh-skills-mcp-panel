/**
 * Skills & MCP panel — browser half.
 *
 * Hand-written in the client module system's lazy-CJS factory form: executing
 * this file only REGISTERS the factory; the whole body runs on first
 * materialization. Everything it may import must be a module-table word, and
 * the only two it uses are the shell baseline `react` (for `createElement`) and
 * nothing else — the `slots` and `locale` services arrive through Cordis.
 *
 * The panel is one Settings page: `settings.section` with id `skills-mcp`. It
 * owns its chrome, its copy, and its data loading through the Host half's two
 * routes.
 *
 * The registration id below MUST equal the package name: the client module
 * table matches a graph row on it, so a rename that misses this line leaves the
 * panel silently unmounted.
 */
window.__ModuleLoader__.load({
  id: 'dsh-skills-mcp-panel',
  factory: (require) => {
    var module = { exports: {} }
    var exports = module.exports

    const React = require('react')
    const h = React.createElement

    const NS = 'settings.skillsMcp'
    const STATE_URL = '/skills-mcp/state'
    const TOGGLE_URL = '/skills-mcp/toggle'
    const STYLE_ID = 'dsh-skills-mcp-panel'

    const DICTIONARIES = {
      zh: {
        nav: '技能/MCP',
        title: '技能与 MCP',
        intro: '查看并开关本部署已发现的技能与 MCP 服务器。改动不需要重启进程。',
        search: '搜索名称、描述或路径',
        skillsTab: '技能',
        mcpTab: 'MCP 服务',
        refresh: '刷新',
        loading: '正在读取…',
        retry: '重试',
        loadFailed: '读取失败',
        empty: '没有匹配的条目',
        emptyRoots: '没有发现技能。扫描根：',
        enabled: '已启用',
        disabled: '已停用',
        policyTitle: '调用方式',
        policyManual: '仅手动',
        policyModel: '仅模型',
        details: '详情',
        source: '来源',
        path: '路径',
        description: '描述',
        whenToUse: '何时使用',
        bodyLines: '正文行数',
        userInvocable: '用户可调用',
        modelInvocable: '模型可调用',
        yes: '是',
        no: '否',
        entryId: '条目 id',
        transport: '传输',
        target: '目标',
        phase: '连接状态',
        toolCount: '工具数',
        tools: '工具',
        none: '无',
        globalGroup: '全局',
        restartHint: '该 profile 不会热重载 patch 层，本次改动将在下次启动 dsh 时生效。',
        errorRow: '该条目无法解析',
      },
      en: {
        nav: 'Skills/MCP',
        title: 'Skills & MCP',
        intro: 'Inspect and toggle the skills and MCP servers this deployment discovered. Changes need no process restart.',
        search: 'Search name, description, or path',
        skillsTab: 'Skills',
        mcpTab: 'MCP servers',
        refresh: 'Refresh',
        loading: 'Reading…',
        retry: 'Retry',
        loadFailed: 'Read failed',
        empty: 'Nothing matches',
        emptyRoots: 'No skills discovered. Scanned roots: ',
        enabled: 'Enabled',
        disabled: 'Disabled',
        policyTitle: 'Invocation',
        policyManual: 'Manual only',
        policyModel: 'Model only',
        details: 'Details',
        source: 'Source',
        path: 'Path',
        description: 'Description',
        whenToUse: 'When to use',
        bodyLines: 'Body lines',
        userInvocable: 'User invocable',
        modelInvocable: 'Model invocable',
        yes: 'yes',
        no: 'no',
        entryId: 'Entry id',
        transport: 'Transport',
        target: 'Target',
        phase: 'Connection',
        toolCount: 'Tools',
        tools: 'Tools',
        none: 'none',
        globalGroup: 'Global',
        restartHint: 'This profile does not reload its patch layer live, so the change applies at the next dsh start.',
        errorRow: 'This entry cannot be parsed',
      },
    }

    const STYLES = `
.dsm-root { display: flex; flex-direction: column; gap: 14px; padding: 2px 0 24px; }
.dsm-head { display: flex; flex-direction: column; gap: 4px; }
.dsm-title { font-size: 16px; font-weight: 500; color: var(--dsw-alias-label-primary, #e6e6e6); }
.dsm-intro { font-size: 13px; line-height: 20px; color: var(--dsw-alias-label-tertiary, #8a8f98); }
/* One row, always: the search field is the only part that gives ground. */
.dsm-toolbar { display: flex; align-items: center; gap: 8px; flex-wrap: nowrap; }
.dsm-search { flex: 1 1 auto; min-width: 0; height: 34px; padding: 0 12px; border-radius: 8px;
  border: 1px solid var(--dsw-alias-border-l2, rgba(255,255,255,0.12));
  background: var(--dsw-alias-bg-layer-2, rgba(255,255,255,0.04));
  color: var(--dsw-alias-label-primary, #e6e6e6); font-size: 13px; outline: none; }
.dsm-search:focus { border-color: var(--dsw-alias-border-l4, rgba(255,255,255,0.24)); }
.dsm-tabs { display: flex; gap: 6px; flex: 0 0 auto; }
.dsm-tab { height: 34px; padding: 0 12px; border-radius: 8px; cursor: pointer; font-size: 13px;
  white-space: nowrap;
  border: 1px solid var(--dsw-alias-border-l2, rgba(255,255,255,0.12));
  background: transparent; color: var(--dsw-alias-label-secondary, #a9adb6); }
.dsm-tab.is-active { background: var(--dsw-alias-bg-layer-3, rgba(255,255,255,0.08));
  color: var(--dsw-alias-label-primary, #e6e6e6); }
/* A bare number: the tab label already names the unit, and the worded form is
   what made a longer locale's toolbar wrap. */
.dsm-tab-count { margin-left: 6px; padding: 0 5px; border-radius: 6px; font-size: 11px;
  background: var(--dsw-alias-bg-layer-2, rgba(255,255,255,0.06)); opacity: 0.85; }
.dsm-refresh { flex: 0 0 auto; width: 34px; height: 34px; border-radius: 8px; cursor: pointer;
  font-size: 15px; line-height: 1;
  border: 1px solid var(--dsw-alias-border-l2, rgba(255,255,255,0.12));
  background: transparent; color: var(--dsw-alias-label-secondary, #a9adb6); }
.dsm-refresh:hover { background: var(--dsw-alias-bg-layer-3, rgba(255,255,255,0.08));
  color: var(--dsw-alias-label-primary, #e6e6e6); }
.dsm-banner { padding: 10px 12px; border-radius: 8px; font-size: 13px;
  border: 1px solid var(--dsw-alias-border-l2, rgba(255,255,255,0.12));
  background: var(--dsw-alias-bg-layer-2, rgba(255,255,255,0.04));
  color: var(--dsw-alias-label-secondary, #a9adb6); }
.dsm-banner.is-error { color: var(--dsw-static-red-400, #ff6b6b); border-color: currentColor; }
.dsm-banner.is-warn { color: var(--dsw-static-amber-400, #f7ad31); border-color: currentColor; }
.dsm-grid { display: grid; grid-template-columns: 1fr; gap: 8px; }
.dsm-groups { display: flex; flex-direction: column; gap: 18px; }
.dsm-group-head { display: flex; align-items: baseline; gap: 8px; padding: 0 2px 6px; }
.dsm-group-label { font-size: 12px; font-weight: 500; color: var(--dsw-alias-label-secondary, #a9adb6); }
.dsm-group-path { flex: 1 1 auto; min-width: 0; font-size: 11px; color: var(--dsw-alias-label-tertiary, #8a8f98);
  white-space: nowrap; overflow: hidden; text-overflow: ellipsis; direction: rtl; text-align: left; }
.dsm-group-count { flex: 0 0 auto; font-size: 11px; color: var(--dsw-alias-label-tertiary, #8a8f98); }
.dsm-card { border-radius: 10px; overflow: hidden;
  border: 1px solid var(--dsw-alias-border-l1, rgba(255,255,255,0.06));
  background: var(--dsw-alias-bg-layer-2, rgba(255,255,255,0.04)); }
.dsm-card-main { display: flex; align-items: center; gap: 10px; padding: 10px 12px; }
.dsm-card-text { flex: 1 1 auto; min-width: 0; }
.dsm-card-title { font-size: 13px; font-weight: 500; color: var(--dsw-alias-label-primary, #e6e6e6);
  white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.dsm-card-sub { font-size: 12px; line-height: 18px; color: var(--dsw-alias-label-tertiary, #8a8f98);
  white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.dsm-card-right { display: flex; align-items: center; gap: 8px; flex: 0 0 auto; }
.dsm-dot { width: 8px; height: 8px; border-radius: 50%; flex: 0 0 auto; background: #7f828a; }
.dsm-dot.is-on { background: var(--dsw-static-green-400, #4ed17e); }
.dsm-dot.is-warn { background: var(--dsw-static-amber-400, #f7ad31); }
.dsm-dot.is-error { background: var(--dsw-static-red-400, #ff6b6b); }
.dsm-tag { font-size: 12px; color: var(--dsw-alias-label-secondary, #a9adb6); white-space: nowrap; }
.dsm-select { height: 26px; max-width: 132px; padding: 0 6px; border-radius: 6px; cursor: pointer; font-size: 12px;
  border: 1px solid var(--dsw-alias-border-l2, rgba(255,255,255,0.12));
  background: var(--dsw-alias-bg-layer-3, rgba(255,255,255,0.08));
  color: var(--dsw-alias-label-primary, #e6e6e6); }
.dsm-select:disabled { opacity: 0.5; cursor: default; }
/* Same chip as the selector beside it, but a plus/minus rather than a chevron:
   a <select> already draws its own arrow, and a second one right next to it
   reads as a second dropdown instead of "show me more". */
.dsm-more { flex: 0 0 auto; display: inline-flex; align-items: center; justify-content: center;
  width: 26px; height: 26px; padding: 0; border-radius: 6px; cursor: pointer;
  border: 1px solid var(--dsw-alias-border-l2, rgba(255,255,255,0.12));
  background: var(--dsw-alias-bg-layer-3, rgba(255,255,255,0.08));
  color: var(--dsw-alias-label-secondary, #a9adb6); }
.dsm-more:hover { color: var(--dsw-alias-label-primary, #e6e6e6); }
.dsm-more .dsm-more-bar { transform-origin: center; transition: transform 120ms ease; }
.dsm-more.is-open .dsm-more-bar { transform: scaleY(0); }
.dsm-details { margin: 0; padding: 4px 12px 12px; border-top: 1px solid var(--dsw-alias-border-l1, rgba(255,255,255,0.06));
  display: grid; grid-template-columns: 92px minmax(0, 1fr); gap: 4px 10px; font-size: 12px; }
.dsm-details dt { color: var(--dsw-alias-label-tertiary, #8a8f98); }
/* min-width:0 lets the value column shrink below its content, so a long command
   or tool name wraps inside the card instead of widening the row. */
.dsm-details dd { margin: 0; min-width: 0; color: var(--dsw-alias-label-secondary, #a9adb6);
  overflow-wrap: anywhere; word-break: break-word; }
.dsm-details dd.is-error { color: var(--dsw-static-red-400, #ff6b6b); }
/* One line per tool name, capped in height: past the cap the box scrolls. */
.dsm-details dd.dsm-scroll { max-height: 156px; overflow-y: auto; overscroll-behavior: contain; }
.dsm-tool { line-height: 18px; }
.dsm-mono { font-family: var(--ds-font-family-code, ui-monospace, monospace); }
`

    /** A bare observable snapshot source: the renderer binds it to a hook. */
    function createSource(initial) {
      let snapshot = initial
      const listeners = new Set()
      return {
        getSnapshot: () => snapshot,
        subscribe: (listener) => {
          listeners.add(listener)
          return () => { listeners.delete(listener) }
        },
        set: (next) => {
          snapshot = next
          for (const listener of [...listeners]) listener()
        },
      }
    }

    /**
     * The four skill invocation states, as the two frontmatter bits they are.
     * The value IS the pair, so decoding a selection needs no lookup table.
     * Module scope: the cards read it while rendering, before their own
     * component body would have initialized a local constant.
     */
    const POLICY_STATES = [
      { value: '11', key: 'enabled', dot: 'is-on' },
      { value: '01', key: 'policyManual', dot: 'is-warn' },
      { value: '10', key: 'policyModel', dot: 'is-on' },
      { value: '00', key: 'disabled', dot: 'is-off' },
    ]

    /** One MCP row's state, from enablement and the Loader's fiber phase. */
    function mcpState(row) {
      if (!row.enabled) return 'off'
      if (row.phase === 'failed') return 'error'
      if (row.phase === 'active') return 'on'
      return 'pending'
    }

    /**
     * The Settings page. Props are the four framework shares: `useSkillsMcp`
     * (the data source bound to a hook), the injected face (`load`, `toggle`),
     * `t` from the registered locale namespace, and `close` from the slot.
     */
    function SkillsMcpSection(props) {
      // The hooks compartment binds a bare snapshot SOURCE to a selector hook,
      // so the selector is required; identity is enough because the source
      // replaces its snapshot object wholesale on every change.
      const state = props.useSkillsMcp((snapshot) => snapshot)
      const t = props.t
      const [query, setQuery] = React.useState('')
      const [tab, setTab] = React.useState('skills')
      const [open, setOpen] = React.useState({})

      React.useEffect(() => {
        if (state.status === 'idle') void props.load()
      }, [state.status])

      const toggleOpen = (id) => {
        setOpen((current) => ({ ...current, [id]: current[id] !== true }))
      }

      const needle = query.trim().toLowerCase()
      const matches = (haystack) => needle.length === 0 || haystack.toLowerCase().includes(needle)
      const skills = state.skills.filter(row => matches(`${row.name} ${row.description} ${row.whenToUse} ${row.path}`))
      const servers = state.mcp.filter(row => matches(`${row.serverName} ${row.detail} ${row.entryId}`))
      const rows = tab === 'skills' ? skills : servers

      const header = h('div', { className: 'dsm-head' },
        h('div', { className: 'dsm-title' }, t('title')),
        h('div', { className: 'dsm-intro' }, t('intro')))

      const toolbar = h('div', { className: 'dsm-toolbar' },
        h('input', {
          className: 'dsm-search',
          type: 'search',
          value: query,
          placeholder: t('search'),
          'aria-label': t('search'),
          spellCheck: false,
          onChange: (event) => { setQuery(event.target.value) },
        }),
        h('div', { className: 'dsm-tabs', role: 'tablist' },
          tabButton('skills', t('skillsTab'), state.skills.length),
          tabButton('mcp', t('mcpTab'), state.mcp.length)),
        // Icon-only: a worded button is what pushed the row onto two lines in a
        // locale whose labels are longer, and the tooltip carries the meaning.
        h('button', {
          className: 'dsm-refresh',
          type: 'button',
          title: t('refresh'),
          'aria-label': t('refresh'),
          onClick: () => { void props.load() },
        }, '↻'))

      function tabButton(id, label, count) {
        return h('button', {
          key: id,
          type: 'button',
          role: 'tab',
          'aria-selected': tab === id,
          className: tab === id ? 'dsm-tab is-active' : 'dsm-tab',
          onClick: () => { setTab(id) },
        }, label, count === 0 ? null : h('span', { className: 'dsm-tab-count' }, String(count)))
      }

      const body = []
      if (state.status === 'error') {
        body.push(h('div', { key: 'error', className: 'dsm-banner is-error' },
          `${t('loadFailed')}: ${state.error ?? ''}`))
      }
      if (state.status === 'loading' || state.status === 'idle') {
        body.push(h('div', { key: 'loading', className: 'dsm-banner' }, t('loading')))
      } else if (rows.length === 0) {
        const scanned = tab === 'skills' && needle.length === 0 && state.roots.length > 0
          ? `${t('emptyRoots')}${state.roots.map(root => root.path).join('  ·  ')}`
          : t('empty')
        body.push(h('div', { key: 'empty', className: 'dsm-banner' }, scanned))
      } else {
        // Group headers come from the host's group menu, so the order is the
        // host's (global first, then projects); a row whose group is missing
        // from the menu still renders, under its own id, rather than vanishing.
        const byGroup = new Map()
        for (const row of rows) {
          const id = row.groupId ?? 'global'
          if (!byGroup.has(id)) byGroup.set(id, [])
          byGroup.get(id).push(row)
        }
        const menu = [...(state.groups ?? [])]
        const known = new Set(menu.map(group => group.id))
        // Synthesized fallback groups name themselves from the id, except the
        // global bucket, whose name belongs to this dictionary.
        for (const id of byGroup.keys()) {
          if (known.has(id)) continue
          menu.push({ id, kind: 'custom', label: id === 'global' ? null : id, path: null })
        }
        body.push(h('div', { key: 'groups', className: 'dsm-groups' },
          menu.filter(group => byGroup.has(group.id)).map(group => h('section', {
            key: group.id,
            className: 'dsm-group',
          },
          h('div', { className: 'dsm-group-head', title: group.path ?? undefined },
            h('span', { className: 'dsm-group-label' }, group.label ?? t('globalGroup')),
            group.path === null || group.path === undefined
              ? null
              : h('span', { className: 'dsm-group-path' }, group.path),
            h('span', { className: 'dsm-group-count' }, String(byGroup.get(group.id).length))),
          h('div', { className: 'dsm-grid' },
            byGroup.get(group.id).map(row => (tab === 'skills' ? skillCard(row) : mcpCard(row))))))))
      }

      function card(kind, key, title, subtitle, dotClass, tag, options, details) {
        const isOpen = open[key] === true
        const busy = state.pending === `${kind}:${key}`
        return h('div', { className: 'dsm-card', key },
          h('div', { className: 'dsm-card-main' },
            h('div', { className: 'dsm-card-text' },
              h('div', { className: 'dsm-card-title', title }, title),
              h('div', { className: 'dsm-card-sub', title: subtitle }, subtitle)),
            h('div', { className: 'dsm-card-right' },
              h('span', { className: `dsm-dot ${dotClass}`, 'aria-hidden': true }),
              tag === null ? null : h('span', { className: 'dsm-tag' }, tag),
              h('select', {
                className: 'dsm-select',
                value: options.value,
                disabled: busy,
                'aria-label': options.label,
                title: options.label,
                onChange: (event) => { void options.apply(event.target.value) },
              }, options.entries.map(entry => h('option', { key: entry.value, value: entry.value }, entry.label))),
              h('button', {
                type: 'button',
                className: isOpen ? 'dsm-more is-open' : 'dsm-more',
                'aria-expanded': isOpen,
                'aria-label': t('details'),
                title: t('details'),
                onClick: () => { toggleOpen(key) },
              }, h('svg', {
                viewBox: '0 0 16 16',
                width: 12,
                height: 12,
                'aria-hidden': true,
                focusable: false,
              }, h('path', {
                d: 'M3.5 8H12.5',
                fill: 'none',
                stroke: 'currentColor',
                strokeWidth: 1.5,
                strokeLinecap: 'round',
              }), h('path', {
                className: 'dsm-more-bar',
                d: 'M8 3.5V12.5',
                fill: 'none',
                stroke: 'currentColor',
                strokeWidth: 1.5,
                strokeLinecap: 'round',
              }))))),
          isOpen ? details() : null)
      }

      function skillCard(row) {
        const current = `${row.modelInvocable ? '1' : '0'}${row.userInvocable ? '1' : '0'}`
        const stateOf = POLICY_STATES.find(entry => entry.value === current)
        const dot = row.error !== null ? 'is-error' : (stateOf?.dot ?? 'is-off')
        return card('skill', row.id, row.name, `${row.root} · ${row.path}`, dot,
          row.error === null ? null : t('errorRow'),
          {
            value: current,
            label: t('policyTitle'),
            entries: POLICY_STATES.map(entry => ({ value: entry.value, label: t(entry.key) })),
            apply: (value) => props.toggle('skill', row.id, { model: value[0] === '1', user: value[1] === '1' }),
          },
          () => detailsList([
            [t('description'), row.description],
            [t('whenToUse'), row.whenToUse],
            [t('source'), row.rootPath],
            [t('path'), row.path, false, true],
            [t('bodyLines'), String(row.bodyLines)],
            [t('modelInvocable'), row.modelInvocable ? t('yes') : t('no')],
            [t('userInvocable'), row.userInvocable ? t('yes') : t('no')],
            ...(row.error ? [[t('errorRow'), row.error, true]] : []),
          ]))
      }

      function mcpCard(row) {
        const status = mcpState(row)
        // The selector already spells enablement, so the tag appears only while
        // the connection is unsettled: a settled, active server needs no label.
        const tag = row.enabled && row.phase !== null && row.phase !== 'active' ? row.phase : null
        const dot = status === 'on' ? 'is-on' : status === 'pending' ? 'is-warn' : status === 'error' ? 'is-error' : 'is-off'
        return card('mcp', row.id, row.serverName, `${row.transport} · ${row.detail || t('none')}`, dot, tag,
          {
            value: row.enabled ? '1' : '0',
            label: t('enabled'),
            entries: [{ value: '1', label: t('enabled') }, { value: '0', label: t('disabled') }],
            apply: (value) => props.toggle('mcp', row.id, { enabled: value === '1' }),
          },
          () => detailsList([
            [t('entryId'), row.entryId, false, true],
            [t('transport'), row.transport],
            [t('target'), row.detail, false, true],
            [t('phase'), row.phase ?? t('none')],
            [t('toolCount'), String(row.tools)],
            // An array renders one name per line inside a scroll box: a server
            // with dozens of long tool names would otherwise stretch the row.
            [t('tools'), row.toolNames.length === 0 ? t('none') : row.toolNames, false, true],
          ]))
      }

      function detailsList(pairs) {
        const children = []
        for (const [label, value, isError, isMono] of pairs) {
          if (value === undefined || value === null || value === '') continue
          const isList = Array.isArray(value)
          const classes = [
            isError ? 'is-error' : null,
            isMono ? 'dsm-mono' : null,
            isList ? 'dsm-scroll' : null,
          ].filter(part => part !== null)
          children.push(h('dt', { key: `${label}-t` }, label))
          children.push(h('dd', { key: `${label}-d`, className: classes.join(' ') || undefined },
            isList
              ? value.map(name => h('div', { key: name, className: 'dsm-tool' }, name))
              : value))
        }
        return h('dl', { className: 'dsm-details' }, children)
      }

      // No standing footer: the write path is an implementation fact, and the
      // "applies immediately" reassurance says nothing a user needs. The one
      // thing worth saying is that a change did NOT take effect yet, and that
      // arrives from the host as `applied: 'restart'` right after the change.
      return h('div', { className: 'dsm-root' },
        header, toolbar, ...body,
        state.notice === null
          ? null
          : h('div', { key: 'notice', className: 'dsm-banner is-warn' }, t(state.notice)))
    }

    /**
     * Register the panel: the locale dictionary, its own stylesheet, and the
     * one Settings section contribution.
     * @param ctx - the browser plugin context.
     */
    function apply(ctx) {
      const source = createSource({
        status: 'idle',
        error: null,
        notice: null,
        skills: [],
        mcp: [],
        groups: [],
        roots: [],
        profile: null,
        pending: null,
      })

      const setState = (patch) => { source.set({ ...source.getSnapshot(), ...patch }) }

      const adopt = (payload) => {
        setState({
          status: 'ready',
          error: null,
          skills: Array.isArray(payload.skills) ? payload.skills : [],
          mcp: Array.isArray(payload.mcp) ? payload.mcp : [],
          // The group menu is what names and orders the headers; a payload that
          // carries none (an older host) falls back to per-id groups.
          groups: Array.isArray(payload.groups) ? payload.groups : [],
          roots: Array.isArray(payload.roots) ? payload.roots : [],
          profile: payload.profile ?? null,
        })
      }

      const load = async () => {
        setState({ status: source.getSnapshot().status === 'ready' ? 'ready' : 'loading', error: null })
        try {
          const response = await fetch(STATE_URL, { credentials: 'same-origin', headers: { accept: 'application/json' } })
          const payload = await response.json().catch(() => ({}))
          if (!response.ok) throw new Error(payload.message ?? `HTTP ${response.status}`)
          adopt(payload)
        } catch (error) {
          setState({ status: 'error', error: messageOf(error) })
        }
      }

      /**
       * Write one row's selection: a skill carries both invocation bits, an MCP
       * row a single enablement.
       * @param kind - 'skill' or 'mcp'.
       * @param id - the row's id (a skill file path, or a declared entry id).
       * @param request - the bits to write.
       */
      const toggle = async (kind, id, request) => {
        setState({ pending: `${kind}:${id}`, error: null, notice: null })
        try {
          const response = await fetch(TOGGLE_URL, {
            method: 'POST',
            credentials: 'same-origin',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ kind, id, ...request }),
          })
          const payload = await response.json().catch(() => ({}))
          if (!response.ok || payload.ok !== true) throw new Error(payload.message ?? `HTTP ${response.status}`)
          adopt(payload)
          // A profile that does not reload its patch layer accepted the write
          // but will not act on it until the next launch. Say so once, here,
          // rather than carrying a standing footer that says it always. The
          // state holds the dictionary KEY; the component translates it.
          if (payload.applied === 'restart') setState({ notice: 'restartHint' })
        } catch (error) {
          setState({ status: 'error', error: messageOf(error) })
        } finally {
          setState({ pending: null })
        }
      }

      ctx.effect(() => ctx.locale.register(NS, DICTIONARIES), 'skills-mcp-panel: dictionaries')
      ctx.effect(() => {
        if (document.querySelector(`style[data-plugin-css="${STYLE_ID}"]`) !== null) return () => {}
        const tag = document.createElement('style')
        tag.dataset.plugin = 'dsh-skills-mcp-panel'
        tag.dataset.pluginCss = STYLE_ID
        tag.textContent = STYLES
        document.head.appendChild(tag)
        return () => { tag.remove() }
      }, 'skills-mcp-panel: styles')

      // `slots.inject` waits for the Settings shell to declare the slot, so the
      // panel appears whether or not the shell mounted before this plugin.
      ctx.slots.inject('settings.section', () => ctx.slots.register({
        name: 'settings.section',
        id: 'skills-mcp',
        order: 21,
        label: () => ctx.locale.bind(NS)('nav'),
        locale: NS,
        inject: () => ({
          hooks: { skillsMcp: source },
          load,
          toggle,
        }),
      }, SkillsMcpSection))
    }

    /** Readable message for one thrown value. */
    function messageOf(error) {
      return error instanceof Error ? error.message : String(error)
    }

    exports.name = 'skills-mcp-panel-client'
    exports.inject = ['slots', 'locale']
    exports.apply = apply
    return module.exports
  },
})
