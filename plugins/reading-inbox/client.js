/**
 * 碎片阅读收件箱 — Client half.
 *
 * Renders a full-page panel (sidebar entry `reading-inbox`) that lists links
 * captured from WeChat, lets the user add or triage them, and shows the weekly
 * digest the agent saved.
 */
window.__ModuleLoader__.load({
  id: '@local/reading-inbox',
  factory(require) {
    const React = require('react')
    const h = React.createElement
    const { useCallback, useEffect, useMemo, useState } = React

    const DICT = {
      zh: {
        panelLabel: '碎片阅读',
        title: '碎片阅读',
        subtitle: '微信里转存的推送先落在这一页，每周整理一次。',
        addPlaceholder: '粘贴文章链接，回车收进队列',
        addButton: '收进队列',
        adding: '收件中…',
        tabDigest: '周报',
        tabInbox: '待读',
        tabLater: '稍后',
        tabRead: '已读',
        tabAll: '全部',
        statInbox: '待读',
        statWeek: '本周新增',
        emptyDigest: '还没有周报。攒够一周的链接后，让我整理一次就会出现在这里。',
        emptyInbox: '队列空了。把想看的推送转给文件传输助手，或者直接在上面粘贴链接。',
        emptyLater: '没有标记稍后的条目。',
        emptyRead: '还没有读完的条目。',
        markRead: '读完了',
        markLater: '稍后',
        markDrop: '不要了',
        markInbox: '放回待读',
        open: '打开',
        addedAt: '收于',
        minutes: '分钟',
        topPick: '如果只读一条',
        loadFailed: '读取收件箱失败：',
        addFailed: '收链接失败：',
        weekOf: '本周整理',
        wxConnected: '微信已连接',
        wxWaiting: '等待你在微信里确认',
        wxIdle: '微信未连接',
        wxError: '微信连接异常',
        wxConnect: '接入微信',
        wxCopy: '复制链接',
        wxCopied: '已复制',
        wxDisconnect: '断开',
        wxLast: '最近一条',
        wxHint: '在微信里打开这个链接，确认后把推送转给这个机器人即可。',
        wxHowTo: '微信不允许把文章直接转发给机器人：长按文章 → 复制链接 → 发给机器人即可。',
        pushDigest: '发到微信',
        pushing: '发送中…',
        pushed: '已发送',
        unparsed: '最近一条没识别出链接：',
      },
      en: {
        panelLabel: 'Reading',
        title: 'Reading Inbox',
        subtitle: 'Links forwarded from WeChat land here, curated once a week.',
        addPlaceholder: 'Paste a link and press Enter',
        addButton: 'Add',
        adding: 'Adding…',
        tabDigest: 'Digest',
        tabInbox: 'To read',
        tabLater: 'Later',
        tabRead: 'Read',
        tabAll: 'All',
        statInbox: 'to read',
        statWeek: 'this week',
        emptyDigest: 'No digest yet. Once a week of links piles up, ask me to curate them.',
        emptyInbox: 'Inbox is empty. Forward articles to WeChat File Transfer, or paste a link above.',
        emptyLater: 'Nothing parked for later.',
        emptyRead: 'Nothing finished yet.',
        markRead: 'Read',
        markLater: 'Later',
        markDrop: 'Drop',
        markInbox: 'Back to inbox',
        open: 'Open',
        addedAt: 'added',
        minutes: 'min',
        topPick: 'If you read only one',
        loadFailed: 'Failed to load the inbox: ',
        addFailed: 'Failed to add link: ',
        weekOf: 'Weekly digest',
        wxConnected: 'WeChat connected',
        wxWaiting: 'Waiting for confirmation in WeChat',
        wxIdle: 'WeChat not connected',
        wxError: 'WeChat connection problem',
        wxConnect: 'Connect WeChat',
        wxCopy: 'Copy link',
        wxCopied: 'Copied',
        wxDisconnect: 'Disconnect',
        wxLast: 'last message',
        wxHint: 'Open this link in WeChat, confirm, then forward articles to the bot.',
        wxHowTo: 'WeChat does not allow forwarding an article to a bot: long-press it, copy the link, then send it to the bot.',
        pushDigest: 'Send to WeChat',
        pushing: 'Sending…',
        pushed: 'Sent',
        unparsed: 'Latest message had no link: ',
      },
    }

    function makeT(ctx) {
      try {
        ctx.locale.register('reading-inbox', DICT)
        const bound = ctx.locale.bind('reading-inbox')
        return (key) => {
          try {
            return bound(key) || DICT.zh[key] || key
          } catch {
            return DICT.zh[key] || key
          }
        }
      } catch {
        return (key) => DICT.zh[key] || key
      }
    }

    const CSS = `
.ri-root { height: 100%; overflow-y: auto; box-sizing: border-box; }
.ri-inner { max-width: 880px; margin: 0 auto; padding: 34px 32px 72px; }
.ri-head { display: flex; align-items: flex-start; justify-content: space-between; gap: 24px; }
.ri-title { margin: 0; font-size: 22px; line-height: 1.3; font-weight: 650; color: var(--dsw-alias-label-primary); letter-spacing: -0.01em; }
.ri-sub { margin: 6px 0 0; font-size: 13px; line-height: 1.5; color: var(--dsw-alias-label-secondary); }
.ri-stats { display: flex; gap: 18px; flex-shrink: 0; padding-top: 4px; }
.ri-stat { display: flex; flex-direction: column; align-items: flex-end; gap: 2px; }
.ri-stat b { font-size: 20px; font-weight: 600; color: var(--dsw-alias-label-primary); font-variant-numeric: tabular-nums; }
.ri-stat span { font-size: 11px; color: var(--dsw-alias-label-secondary); }
.ri-add { display: flex; gap: 8px; margin-top: 22px; }
.ri-input { flex: 1; min-width: 0; height: 38px; padding: 0 12px; border-radius: 9px; border: 1px solid var(--dsw-alias-border-l1); background: var(--dsw-alias-bg-layer-1); color: var(--dsw-alias-label-primary); font-size: 13px; outline: none; }
.ri-input::placeholder { color: var(--dsw-alias-label-secondary); opacity: .8; }
.ri-input:focus { border-color: var(--dsw-alias-brand-primary); }
.ri-btn { height: 38px; padding: 0 16px; border-radius: 9px; border: 1px solid transparent; background: var(--dsw-alias-brand-primary); color: #fff; font-size: 13px; font-weight: 550; cursor: pointer; white-space: nowrap; }
.ri-btn:disabled { opacity: .55; cursor: default; }
.ri-tabs { display: flex; gap: 6px; margin: 26px 0 18px; border-bottom: 1px solid var(--dsw-alias-border-l1); padding-bottom: 0; }
.ri-tab { appearance: none; background: none; border: none; border-bottom: 2px solid transparent; padding: 8px 10px 10px; margin-bottom: -1px; font-size: 13px; color: var(--dsw-alias-label-secondary); cursor: pointer; display: inline-flex; align-items: center; gap: 6px; }
.ri-tab[data-active="true"] { color: var(--dsw-alias-label-primary); border-bottom-color: var(--dsw-alias-brand-primary); font-weight: 550; }
.ri-tab i { font-style: normal; font-size: 11px; color: var(--dsw-alias-label-secondary); background: var(--dsw-alias-bg-layer-2); border-radius: 999px; padding: 1px 6px; }
.ri-card { border: 1px solid var(--dsw-alias-border-l1); background: var(--dsw-alias-bg-layer-1); border-radius: 11px; padding: 14px 16px 12px; margin-bottom: 10px; }
.ri-card:hover { border-color: var(--dsw-alias-border-l2); }
.ri-card-top { display: flex; align-items: center; gap: 8px; font-size: 11px; color: var(--dsw-alias-label-secondary); }
.ri-site { font-weight: 550; }
.ri-dot { width: 3px; height: 3px; border-radius: 50%; background: currentColor; opacity: .5; }
.ri-link { display: block; margin: 7px 0 0; font-size: 15px; line-height: 1.45; font-weight: 560; color: var(--dsw-alias-label-primary); text-decoration: none; word-break: break-word; }
.ri-link:hover { color: var(--dsw-alias-brand-primary); }
.ri-note { margin: 7px 0 0; font-size: 12.5px; line-height: 1.55; color: var(--dsw-alias-label-secondary); white-space: pre-wrap; }
.ri-summary { margin: 7px 0 0; font-size: 13px; line-height: 1.6; color: var(--dsw-alias-label-primary); opacity: .9; display: -webkit-box; -webkit-line-clamp: 3; -webkit-box-orient: vertical; overflow: hidden; }
.ri-card-foot { display: flex; align-items: center; justify-content: space-between; gap: 12px; margin-top: 11px; }
.ri-tags { display: flex; gap: 6px; flex-wrap: wrap; }
.ri-tag { font-size: 11px; color: var(--dsw-alias-label-secondary); background: var(--dsw-alias-bg-layer-2); border-radius: 6px; padding: 2px 7px; }
.ri-actions { display: flex; gap: 4px; opacity: 0; transition: opacity .12s; }
.ri-card:hover .ri-actions, .ri-actions:focus-within { opacity: 1; }
.ri-act { appearance: none; background: none; border: 1px solid transparent; border-radius: 7px; padding: 4px 8px; font-size: 12px; color: var(--dsw-alias-label-secondary); cursor: pointer; }
.ri-act:hover { background: var(--dsw-alias-bg-layer-2); color: var(--dsw-alias-label-primary); }
.ri-act[data-primary="true"]:hover { color: var(--dsw-alias-state-success-primary); }
.ri-empty { padding: 44px 8px; text-align: center; font-size: 13px; line-height: 1.7; color: var(--dsw-alias-label-secondary); }
.ri-error { margin: 14px 0 0; font-size: 12.5px; color: var(--dsw-alias-state-error-primary); }
.ri-digest { border: 1px solid var(--dsw-alias-border-l1); background: var(--dsw-alias-bg-layer-1); border-radius: 12px; padding: 22px 24px; }
.ri-digest-meta { font-size: 11px; color: var(--dsw-alias-label-secondary); letter-spacing: .04em; text-transform: uppercase; }
.ri-digest-title { margin: 6px 0 0; font-size: 19px; line-height: 1.4; font-weight: 620; color: var(--dsw-alias-label-primary); }
.ri-digest-intro { margin: 10px 0 0; font-size: 13.5px; line-height: 1.75; color: var(--dsw-alias-label-primary); opacity: .92; }
.ri-section { margin-top: 24px; padding-top: 20px; border-top: 1px solid var(--dsw-alias-border-l1); }
.ri-section h3 { margin: 0; font-size: 14px; font-weight: 600; color: var(--dsw-alias-label-primary); }
.ri-section p { margin: 7px 0 0; font-size: 13px; line-height: 1.75; color: var(--dsw-alias-label-primary); opacity: .9; white-space: pre-wrap; }
.ri-refs { display: flex; flex-direction: column; gap: 6px; margin-top: 12px; }
.ri-ref { display: flex; align-items: baseline; gap: 8px; font-size: 12.5px; line-height: 1.5; }
.ri-ref a { color: var(--dsw-alias-brand-primary); text-decoration: none; word-break: break-word; }
.ri-ref a:hover { text-decoration: underline; }
.ri-ref span { color: var(--dsw-alias-label-secondary); font-size: 11px; flex-shrink: 0; }
.ri-pick { margin-top: 22px; padding: 14px 16px; border-radius: 10px; background: var(--dsw-alias-bg-layer-2); }
.ri-pick-label { font-size: 11px; color: var(--dsw-alias-label-secondary); }
.ri-pick-title { display: block; margin-top: 4px; font-size: 14px; font-weight: 560; color: var(--dsw-alias-label-primary); text-decoration: none; }
.ri-pick-title:hover { color: var(--dsw-alias-brand-primary); }
.ri-pick p { margin: 6px 0 0; font-size: 12.5px; line-height: 1.65; color: var(--dsw-alias-label-secondary); }
.ri-loading { padding: 40px 0; font-size: 13px; color: var(--dsw-alias-label-secondary); }
.ri-wx { display: flex; align-items: center; gap: 10px; flex-wrap: wrap; margin-top: 18px; padding: 9px 12px; border: 1px dashed var(--dsw-alias-border-l1); border-radius: 9px; font-size: 12.5px; color: var(--dsw-alias-label-secondary); }
.ri-wx.is-ok { border-style: solid; }
.ri-wx-dot { width: 7px; height: 7px; border-radius: 50%; background: var(--dsw-alias-state-idle-primary); flex-shrink: 0; }
.ri-wx.is-ok .ri-wx-dot { background: var(--dsw-alias-state-success-primary); }
.ri-wx.is-wait .ri-wx-dot { background: var(--dsw-alias-state-warn-primary); }
.ri-wx.is-error .ri-wx-dot { background: var(--dsw-alias-state-error-primary); }
.ri-wx-url { max-width: 360px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; color: var(--dsw-alias-label-primary); opacity: .75; }
.ri-wx-spacer { flex: 1; }
.ri-wx-btn { appearance: none; background: none; border: 1px solid var(--dsw-alias-border-l1); border-radius: 7px; padding: 3px 9px; font-size: 12px; color: var(--dsw-alias-label-secondary); cursor: pointer; }
.ri-wx-btn:hover { color: var(--dsw-alias-label-primary); border-color: var(--dsw-alias-border-l2); }
.ri-wx-note { margin-top: 6px; font-size: 11.5px; line-height: 1.5; color: var(--dsw-alias-state-warn-primary); }
.ri-wx-hint { margin-top: 6px; font-size: 11.5px; line-height: 1.5; color: var(--dsw-alias-label-secondary); }
.ri-digest-foot { display: flex; align-items: center; justify-content: flex-end; gap: 10px; margin-top: 20px; }
.ri-digest-status { font-size: 11.5px; color: var(--dsw-alias-label-secondary); }
.ri-archive { display: flex; flex-wrap: wrap; gap: 6px; margin-top: 14px; }
.ri-arch-chip { appearance: none; border: 1px solid var(--dsw-alias-border-l1); background: none; color: var(--dsw-alias-label-secondary); border-radius: 999px; padding: 4px 10px; font-size: 11.5px; cursor: pointer; max-width: 260px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.ri-arch-chip:hover { color: var(--dsw-alias-label-primary); border-color: var(--dsw-alias-border-l2); }
.ri-arch-chip[data-active="true"] { color: var(--dsw-alias-brand-primary); border-color: var(--dsw-alias-brand-primary); }
`

    const STATUS_ORDER = ['inbox', 'later', 'read', 'dropped']

    function formatDay(iso, lang) {
      const time = Date.parse(iso)
      if (!Number.isFinite(time)) return ''
      const diff = Date.now() - time
      const day = 24 * 60 * 60 * 1000
      if (diff < day) return lang === 'en' ? 'today' : '今天'
      if (diff < 2 * day) return lang === 'en' ? 'yesterday' : '昨天'
      if (diff < 7 * day) return lang === 'en' ? `${Math.floor(diff / day)}d ago` : `${Math.floor(diff / day)} 天前`
      const date = new Date(time)
      return `${date.getMonth() + 1}-${String(date.getDate()).padStart(2, '0')}`
    }

    function useInbox() {
      const [state, setState] = useState({ items: [], digests: [], counts: {}, wechat: null })
      const [loading, setLoading] = useState(true)
      const [error, setError] = useState('')

      const refresh = useCallback(async () => {
        try {
          const res = await fetch('/reading-inbox/api/state', { headers: { accept: 'application/json' } })
          if (!res.ok) throw new Error(`HTTP ${res.status}`)
          const data = await res.json()
          setState({
            items: Array.isArray(data.items) ? data.items : [],
            digests: Array.isArray(data.digests) ? data.digests : [],
            counts: data.counts || {},
            wechat: data.wechat || null,
          })
          setError('')
        } catch (err) {
          setError(err && err.message ? err.message : String(err))
        } finally {
          setLoading(false)
        }
      }, [])

      useEffect(() => {
        refresh()
        const timer = setInterval(() => {
          if (typeof document === 'undefined' || document.visibilityState === 'visible') refresh()
        }, 30000)
        return () => clearInterval(timer)
      }, [refresh])

      const call = useCallback(async (path, body) => {
        const res = await fetch(path, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify(body || {}),
        })
        const data = await res.json().catch(() => ({}))
        if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`)
        return data
      }, [])

      const act = useCallback(
        async (payload) => {
          const data = await call('/reading-inbox/api/action', payload)
          await refresh()
          return data
        },
        [call, refresh],
      )

      return { state, loading, error, refresh, act, call }
    }

    function ItemCard({ item, t, lang, onAct }) {
      const statusText = {
        inbox: t('markRead'),
        later: t('markRead'),
        read: t('markInbox'),
        dropped: t('markInbox'),
      }[item.status]
      return h(
        'article',
        { className: 'ri-card' },
        h(
          'div',
          { className: 'ri-card-top' },
          h('span', { className: 'ri-site' }, item.site || '—'),
          h('span', { className: 'ri-dot' }),
          h('span', null, formatDay(item.addedAt, lang)),
          item.minutes ? h('span', { className: 'ri-dot' }) : null,
          item.minutes ? h('span', null, `${item.minutes} ${t('minutes')}`) : null,
        ),
        h(
          'a',
          { className: 'ri-link', href: item.url, target: '_blank', rel: 'noreferrer' },
          item.title || item.url,
        ),
        item.summary ? h('p', { className: 'ri-summary' }, item.summary) : null,
        item.note ? h('p', { className: 'ri-note' }, item.note) : null,
        h(
          'div',
          { className: 'ri-card-foot' },
          h(
            'div',
            { className: 'ri-tags' },
            ...(item.tags || []).map((tag) => h('span', { className: 'ri-tag', key: tag }, tag)),
          ),
          h(
            'div',
            { className: 'ri-actions' },
            onAct && statusText
              ? h(
                  'button',
                  {
                    className: 'ri-act',
                    'data-primary': 'true',
                    onClick: () => onAct(item, item.status === 'inbox' || item.status === 'later' ? 'read' : 'inbox'),
                  },
                  statusText,
                )
              : null,
            onAct && item.status !== 'later' && item.status !== 'read'
              ? h('button', { className: 'ri-act', onClick: () => onAct(item, 'later') }, t('markLater'))
              : null,
            onAct && item.status !== 'dropped'
              ? h('button', { className: 'ri-act', onClick: () => onAct(item, 'dropped') }, t('markDrop'))
              : null,
          ),
        ),
      )
    }

    function digestToText(digest, items) {
      const byId = new Map(items.map((item) => [item.id, item]))
      const lines = [digest.title, '']
      if (digest.intro) lines.push(digest.intro, '')
      for (const section of digest.sections || []) {
        lines.push(`· ${section.heading}`)
        if (section.body) lines.push(section.body)
        for (const id of section.itemIds || []) {
          const item = byId.get(id)
          if (item) lines.push(`  ${item.title}\n  ${item.url}`)
        }
        lines.push('')
      }
      const top = digest.topPickId ? byId.get(digest.topPickId) : null
      if (top) {
        lines.push(`先读这条：${top.title}`)
        lines.push(top.url)
        if (digest.topPickReason) lines.push(digest.topPickReason)
      }
      return lines.join('\n').slice(0, 3900)
    }

    function DigestView({ digest, items, t, lang, onPush }) {
      const [pushState, setPushState] = useState('idle')
      const byId = new Map(items.map((item) => [item.id, item]))
      const created = new Date(Date.parse(digest.createdAt))
      const dateText = Number.isFinite(created.getTime())
        ? `${created.getFullYear()}-${String(created.getMonth() + 1).padStart(2, '0')}-${String(created.getDate()).padStart(2, '0')}`
        : ''
      const top = digest.topPickId ? byId.get(digest.topPickId) : null

      const push = async () => {
        if (!onPush) return
        setPushState('sending')
        try {
          await onPush(digest)
          setPushState('sent')
          setTimeout(() => setPushState('idle'), 2500)
        } catch {
          setPushState('idle')
        }
      }

      return h(
        'div',
        { className: 'ri-digest' },
        h('div', { className: 'ri-digest-meta' }, `${t('weekOf')}${dateText ? ` · ${dateText}` : ''}`),
        h('h2', { className: 'ri-digest-title' }, digest.title),
        digest.intro ? h('p', { className: 'ri-digest-intro' }, digest.intro) : null,
        ...(digest.sections || []).map((section, index) =>
          h(
            'section',
            { className: 'ri-section', key: `${section.heading}-${index}` },
            h('h3', null, section.heading),
            section.body ? h('p', null, section.body) : null,
            (section.itemIds || []).length > 0
              ? h(
                  'div',
                  { className: 'ri-refs' },
                  ...section.itemIds.map((id) => {
                    const item = byId.get(id)
                    if (!item) return null
                    return h(
                      'div',
                      { className: 'ri-ref', key: id },
                      h('span', null, item.site || ''),
                      h('a', { href: item.url, target: '_blank', rel: 'noreferrer' }, item.title),
                    )
                  }),
                )
              : null,
          ),
        ),
        top
          ? h(
              'div',
              { className: 'ri-pick' },
              h('div', { className: 'ri-pick-label' }, t('topPick')),
              h('a', { className: 'ri-pick-title', href: top.url, target: '_blank', rel: 'noreferrer' }, top.title),
              digest.topPickReason ? h('p', null, digest.topPickReason) : null,
            )
          : null,
        onPush
          ? h(
              'div',
              { className: 'ri-digest-foot' },
              pushState === 'sent' ? h('span', { className: 'ri-digest-status' }, t('pushed')) : null,
              h(
                'button',
                {
                  className: 'ri-wx-btn',
                  type: 'button',
                  disabled: pushState === 'sending',
                  onClick: push,
                },
                pushState === 'sending' ? t('pushing') : t('pushDigest'),
              ),
            )
          : null,
      )
    }

    function WeChatBar({ wechat, call, refresh, t, lang, onError }) {
      const [copied, setCopied] = useState(false)
      const [busy, setBusy] = useState(false)
      if (!wechat) return null
      const connected = wechat.status === 'connected'
      const waiting = wechat.status === 'waiting' && Boolean(wechat.url)
      const failed = wechat.status === 'error'
      const cls = `ri-wx${connected ? ' is-ok' : waiting ? ' is-wait' : failed ? ' is-error' : ''}`
      const label = connected ? t('wxConnected') : waiting ? t('wxWaiting') : failed ? t('wxError') : t('wxIdle')

      const copy = async () => {
        try {
          await navigator.clipboard.writeText(wechat.url)
          setCopied(true)
          setTimeout(() => setCopied(false), 1800)
        } catch (err) {
          onError(`${t('wxCopy')}：${err.message}`)
        }
      }

      const run = async (path) => {
        setBusy(true)
        try {
          await call(path, {})
          await refresh()
        } catch (err) {
          onError(err.message)
        } finally {
          setBusy(false)
        }
      }

      const last = connected && wechat.events && wechat.events.length > 0 ? wechat.events[0] : null
      const unparsed = last && (!last.urls || last.urls.length === 0) ? last : null
      const preview = unparsed ? String(unparsed.text || '').replace(/\s+/g, ' ').slice(0, 60) : ''

      return h(
        React.Fragment,
        null,
        h(
          'div',
          { className: cls, title: waiting ? t('wxHint') : undefined },
          h('span', { className: 'ri-wx-dot' }),
          h('span', null, label),
          waiting ? h('span', { className: 'ri-wx-url' }, wechat.url) : null,
          connected && wechat.lastMessageAt
            ? h('span', null, `${t('wxLast')} · ${formatDay(new Date(wechat.lastMessageAt).toISOString(), lang)}`)
            : null,
          h('span', { className: 'ri-wx-spacer' }),
          waiting
            ? h('button', { className: 'ri-wx-btn', type: 'button', onClick: copy }, copied ? t('wxCopied') : t('wxCopy'))
            : null,
          connected
            ? h('button', { className: 'ri-wx-btn', type: 'button', disabled: busy, onClick: () => run('/reading-inbox/wechat/logout') }, t('wxDisconnect'))
            : waiting
              ? null
              : h('button', { className: 'ri-wx-btn', type: 'button', disabled: busy, onClick: () => run('/reading-inbox/wechat/login') }, busy ? '…' : t('wxConnect')),
        ),
        unparsed ? h('div', { className: 'ri-wx-note' }, `${t('unparsed')}${preview}`) : null,
        connected && !unparsed ? h('div', { className: 'ri-wx-hint' }, t('wxHowTo')) : null,
      )
    }

    function Page({ panelLocale }) {
      const ctx = React.useContext(LocaleContext) || { t: (k) => DICT.zh[k] || k, lang: 'zh' }
      const { t, lang } = ctx
      const { state, loading, error, act, call, refresh } = useInbox()
      const [tab, setTab] = useState('digest')
      const [digestIndex, setDigestIndex] = useState(0)
      const [draft, setDraft] = useState('')
      const [busy, setBusy] = useState(false)
      const [formError, setFormError] = useState('')

      useEffect(() => {
        fetch('/reading-inbox/api/heartbeat', { method: 'POST' }).catch(() => {})
      }, [])

      const items = state.items || []
      const digests = state.digests || []
      const counts = state.counts || {}
      const visible = useMemo(() => {
        if (tab === 'all') return items
        if (tab === 'inbox') return items.filter((item) => item.status === 'inbox')
        if (tab === 'later') return items.filter((item) => item.status === 'later')
        if (tab === 'read') return items.filter((item) => item.status === 'read')
        return []
      }, [items, tab])

      const onAct = useCallback(
        async (item, status) => {
          try {
            await act({ action: 'update', id: item.id, status })
          } catch (err) {
            setFormError(`${t('addFailed')}${err.message}`)
          }
        },
        [act, t],
      )

      const submit = useCallback(
        async (event) => {
          event.preventDefault()
          const value = draft.trim()
          if (!value || busy) return
          setBusy(true)
          setFormError('')
          try {
            await act({ action: 'add', url: value })
            setDraft('')
          } catch (err) {
            setFormError(`${t('addFailed')}${err.message}`)
          } finally {
            setBusy(false)
          }
        },
        [act, busy, draft, t],
      )

      const tabs = [
        { id: 'digest', label: t('tabDigest'), count: digests.length },
        { id: 'inbox', label: t('tabInbox'), count: counts.inbox || 0 },
        { id: 'later', label: t('tabLater'), count: counts.later || 0 },
        { id: 'read', label: t('tabRead'), count: counts.read || 0 },
        { id: 'all', label: t('tabAll'), count: counts.total || 0 },
      ]

      const emptyText = {
        digest: t('emptyDigest'),
        inbox: t('emptyInbox'),
        later: t('emptyLater'),
        read: t('emptyRead'),
        all: t('emptyInbox'),
      }[tab]

      return h(
        'div',
        { className: 'ri-root' },
        h('style', { dangerouslySetInnerHTML: { __html: CSS } }),
        h(
          'div',
          { className: 'ri-inner' },
          h(
            'header',
            { className: 'ri-head' },
            h(
              'div',
              null,
              h('h1', { className: 'ri-title' }, t('title')),
              h('p', { className: 'ri-sub' }, t('subtitle')),
            ),
            h(
              'div',
              { className: 'ri-stats' },
              h('div', { className: 'ri-stat' }, h('b', null, String(counts.inbox || 0)), h('span', null, t('statInbox'))),
              h('div', { className: 'ri-stat' }, h('b', null, String(counts.week || 0)), h('span', null, t('statWeek'))),
            ),
          ),
          h(WeChatBar, {
            wechat: state.wechat,
            call,
            refresh,
            t,
            lang,
            onError: (message) => setFormError(message),
          }),
          h(
            'form',
            { className: 'ri-add', onSubmit: submit },
            h('input', {
              className: 'ri-input',
              value: draft,
              placeholder: t('addPlaceholder'),
              onChange: (event) => setDraft(event.target.value),
              spellCheck: false,
            }),
            h('button', { className: 'ri-btn', type: 'submit', disabled: busy || !draft.trim() }, busy ? t('adding') : t('addButton')),
          ),
          formError ? h('p', { className: 'ri-error' }, formError) : null,
          error ? h('p', { className: 'ri-error' }, `${t('loadFailed')}${error}`) : null,
          h(
            'nav',
            { className: 'ri-tabs' },
            ...tabs.map((entry) =>
              h(
                'button',
                {
                  key: entry.id,
                  className: 'ri-tab',
                  'data-active': tab === entry.id ? 'true' : 'false',
                  onClick: () => setTab(entry.id),
                  type: 'button',
                },
                entry.label,
                entry.count ? h('i', null, String(entry.count)) : null,
              ),
            ),
          ),
          loading
            ? h('div', { className: 'ri-loading' }, '…')
            : tab === 'digest'
              ? digests.length > 0
                ? h(
                    React.Fragment,
                    null,
                    h(DigestView, {
                      digest: digests[Math.min(digestIndex, digests.length - 1)],
                      items,
                      t,
                      lang,
                      onPush:
                        state.wechat && state.wechat.status === 'connected'
                          ? (digest) => call('/reading-inbox/wechat/send', { text: digestToText(digest, items) })
                          : null,
                    }),
                    digests.length > 1
                      ? h(
                          'div',
                          { className: 'ri-archive' },
                          ...digests.map((entry, index) =>
                            h(
                              'button',
                              {
                                key: entry.id,
                                type: 'button',
                                className: 'ri-arch-chip',
                                'data-active': String(index === digestIndex),
                                title: entry.title,
                                onClick: () => setDigestIndex(index),
                              },
                              `${formatDay(entry.createdAt, lang)} · ${entry.title}`,
                            ),
                          ),
                        )
                      : null,
                  )
                : h('div', { className: 'ri-empty' }, emptyText)
              : visible.length === 0
                ? h('div', { className: 'ri-empty' }, emptyText)
                : visible.map((item) =>
                    h(ItemCard, { key: item.id, item, t, lang, onAct: tab === 'read' || tab === 'all' ? onAct : onAct }),
                  ),
        ),
      )
    }

    function PanelIcon(props) {
      const size = (props && props.size) || 18
      return h(
        'svg',
        {
          width: size,
          height: size,
          viewBox: '0 0 24 24',
          fill: 'none',
          stroke: 'currentColor',
          strokeWidth: 1.6,
          strokeLinecap: 'round',
          strokeLinejoin: 'round',
          'aria-hidden': true,
        },
        h('path', { d: 'M4 5.5h16' }),
        h('path', { d: 'M4 10.5h16v7.5a1.5 1.5 0 0 1-1.5 1.5h-13A1.5 1.5 0 0 1 4 18z' }),
        h('path', { d: 'M9.5 14.5h5' }),
      )
    }

    const LocaleContext = React.createContext(null)

    return {
      inject: ['slots', 'locale'],
      apply(ctx) {
        const t = makeT(ctx)
        let lang = 'zh'
        try {
          lang = String(ctx.locale.getLocale().id || 'zh').startsWith('zh') ? 'zh' : 'en'
        } catch {
          lang = 'zh'
        }

        function PageWithLocale(props) {
          return h(LocaleContext.Provider, { value: { t, lang } }, h(Page, props))
        }

        ctx.slots.inject('main', () =>
          ctx.slots.register({ name: 'main', key: 'reading-inbox' }, PageWithLocale),
        )
        ctx.slots.inject('sidebar.panellist', () =>
          ctx.slots.register(
            {
              name: 'sidebar.panellist',
              id: 'reading-inbox',
              order: 20,
              label: () => t('panelLabel'),
            },
            PanelIcon,
          ),
        )
      },
    }
  },
})
