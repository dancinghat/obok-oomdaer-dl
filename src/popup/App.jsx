import { useState, useEffect, useRef, useCallback } from 'react'
import './App.css'

const PLATFORMS = [
  { id: 'books',   label: 'Books.com.tw' },
  { id: 'readmoo', label: 'Readmoo' },
]

const FORMATS = [
  { id: 'epub',  label: 'EPUB',       ext: 'epub' },
  { id: 'kepub', label: 'Kobo KEPUB', ext: 'kepub.epub' },
]

const DEFAULT_SETTINGS = { apiDelay: 1000, readmooDelay: 0 }

const COVER_HUES = [216, 174, 24, 282, 338, 130, 198]
function coverGradient(i) {
  const h = COVER_HUES[i % COVER_HUES.length]
  return { background: `linear-gradient(155deg, hsl(${h} 48% 46%), hsl(${(h + 24) % 360} 44% 32%))` }
}

// Normalise a Readmoo `included` book entry (type === "books") into the shape BookRow expects.
// book_uni_id is prefixed with 'readmoo_' to avoid collisions with books.com.tw IDs.
function normalizeReadmooBook(item) {
  if (!item?.id) return null
  const attrs = item.attributes ?? {}
  const rawId = String(item.id)
  // author is a pipe-separated string: "Author A|Author B" → take the first name
  const authorName = (attrs.author ?? '').split('|')[0].trim() || null
  const cover = attrs.cover ?? {}
  const coverUrl = cover.medium?.href ?? cover.large?.href ?? cover.small?.href ?? null
  return {
    book_uni_id: `readmoo_${rawId}`,
    _source: 'readmoo',
    _title: attrs.title ?? rawId,  // kept for download filename
    item_info: {
      c_title: attrs.title ?? rawId,
      author_name: authorName,
      cover_img_url: coverUrl,
    },
  }
}

// Books live in `included` with type === "books" in the library_items API response.
function extractReadmooItems(raw) {
  return (raw?.included ?? []).filter(i => i?.type === 'books' && i?.id)
}

/* ── Icons ── */
const Ico = {
  grid: (p) => (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor" {...p}>
      <rect x="2"    y="2"    width="3.4" height="3.4"/>
      <rect x="6.3"  y="2"    width="3.4" height="3.4"/>
      <rect x="10.6" y="2"    width="3.4" height="3.4"/>
      <rect x="2"    y="6.3"  width="3.4" height="3.4"/>
      <rect x="6.3"  y="6.3"  width="3.4" height="3.4"/>
      <rect x="10.6" y="6.3"  width="3.4" height="3.4"/>
      <rect x="2"    y="10.6" width="3.4" height="3.4"/>
      <rect x="6.3"  y="10.6" width="3.4" height="3.4"/>
      <rect x="10.6" y="10.6" width="3.4" height="3.4"/>
    </svg>
  ),
  overflow: (p) => (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor" {...p}>
      <circle cx="8" cy="3"  r="1.4"/>
      <circle cx="8" cy="8"  r="1.4"/>
      <circle cx="8" cy="13" r="1.4"/>
    </svg>
  ),
  back: (p) => (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" {...p}>
      <path d="M10 3 4 8l6 5"/>
    </svg>
  ),
  search: (p) => (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.4" {...p}>
      <circle cx="7" cy="7" r="4.6"/>
      <path d="m11 11 3.4 3.4" strokeLinecap="round"/>
    </svg>
  ),
  download: (p) => (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" {...p}>
      <path d="M8 2v8m0 0 3-3m-3 3-3-3"/>
      <path d="M2.5 13.5h11"/>
    </svg>
  ),
  check: (p) => (
    <svg width="11" height="11" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" {...p}>
      <path d="M13 4.5 6.5 12 3 8.5"/>
    </svg>
  ),
  open: (p) => (
    <svg width="15" height="15" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" {...p}>
      <path d="M9 2.5h4.5V7"/>
      <path d="M13.5 2.5 7 9"/>
      <path d="M11 9v3.5a1 1 0 0 1-1 1H3.5a1 1 0 0 1-1-1V6a1 1 0 0 1 1-1H7"/>
    </svg>
  ),
  retry: (p) => (
    <svg width="15" height="15" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" {...p}>
      <path d="M13.5 8a5.5 5.5 0 1 1-1.6-3.9"/>
      <path d="M13.5 2.5V5h-2.5"/>
    </svg>
  ),
  settings: (p) => (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" {...p}>
      <circle cx="8" cy="8" r="2"/>
      <path d="M8 1v2M8 13v2M1 8h2M13 8h2M3.05 3.05l1.42 1.42M11.54 11.54l1.41 1.41M3.05 12.95l1.42-1.41M11.54 4.46l1.41-1.41"/>
    </svg>
  ),
  cancel: (p) => (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" {...p}>
      <circle cx="8" cy="8" r="6"/>
      <path d="m5 5 6 6M11 5l-6 6"/>
    </svg>
  ),
  warn: (p) => (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor" {...p}>
      <path d="M8 1 .5 14.5h15L8 1zm0 3.5 5.5 9h-11L8 4.5z" opacity=".001"/>
      <path d="M7.25 6h1.5v4.5h-1.5zM8 12.5a.75.75 0 1 0 0-1.5.75.75 0 0 0 0 1.5z"/>
      <path d="M8 1 .5 14.5h15L8 1zm0 2 6 11H2L8 3z"/>
    </svg>
  ),
}

/* ── Content Switcher (reused for both platform and format) ── */
function ContentSwitcher({ items, value, onChange }) {
  return (
    <div className="switcher" role="tablist">
      {items.map(f => (
        <button key={f.id} role="tab" aria-selected={value === f.id}
          className={value === f.id ? 'active' : ''}
          onClick={() => onChange(f.id)}>
          {f.label}
        </button>
      ))}
    </div>
  )
}

/* ── Per-book download control ── */
function DownloadControl({ status, progress, onStart }) {
  if (status === 'downloading') {
    return (
      <div className="prog">
        <div className="pbar-wrap"><div className="pbar-fill" style={{ width: `${progress}%` }}/></div>
        <span className="pct">{progress}%</span>
      </div>
    )
  }
  if (status === 'done') {
    return (
      <button className="btn-ghost success" onClick={onStart}>
        [DONE]
      </button>
    )
  }
  if (status === 'error') {
    return (
      <button className="btn-ghost danger" onClick={onStart}>
        [RETRY]
      </button>
    )
  }
  if (status === 'queued') {
    return (
      <button className="btn-ghost" disabled>
        [QUEUED]
      </button>
    )
  }
  return (
    <button className="btn-ghost" onClick={onStart}>
      [DL]
    </button>
  )
}

/* ── Book row ── */
function BookRow({ book, index, status, progress, selected, onToggleSelect, onStart }) {
  const info = book.item_info ?? {}
  const title    = info.c_title ?? info.o_title ?? book.book_uni_id
  const author   = info.author_name ?? info.author ?? null
  const size     = info.file_size   != null ? `${(info.file_size / 1024 / 1024).toFixed(1)} MB` : null
  const pages    = info.page_count  ?? info.page ?? null
  const coverUrl = info.cover_img_url ?? info.img_url ?? null
  const glyph    = title.replace(/[【「（(].*$/, '').trim().charAt(0) || '?'

  return (
    <li className={`row${selected ? ' selected' : ''}`}>
      <div className={`check${selected ? ' on' : ''}`}
        onClick={onToggleSelect} role="checkbox" aria-checked={selected}>
        <Ico.check/>
      </div>
      <div className="cover" style={!coverUrl ? coverGradient(index) : undefined}>
        {coverUrl ? <img src={coverUrl} alt=""/> : <span className="glyph">{glyph}</span>}
      </div>
      <div className="info">
        <div className="title" title={title}>{title}</div>
        {(author || size || pages) && (
          <div className="meta">
            {author && <span className="author">{author}</span>}
            {author && (size || pages) && <span className="sep">/</span>}
            {size   && <span>{size}</span>}
            {size && pages && <span className="sep">/</span>}
            {pages  && <span>{pages} pp.</span>}
          </div>
        )}
      </div>
      <div className="dl">
        <DownloadControl status={status} progress={progress} onStart={onStart}/>
      </div>
    </li>
  )
}

/* ── Settings panel ── */
function SettingsPanel({ settings, onSave, onBack }) {
  const [apiDelay,     setApiDelay]     = useState(settings.apiDelay)
  const [readmooDelay, setReadmooDelay] = useState(settings.readmooDelay ?? 0)
  const [saved,        setSaved]        = useState(false)

  const warningLevel = apiDelay < 300 ? 'danger' : apiDelay < 600 ? 'warn' : null

  const handleSave = () => {
    onSave({ ...settings, apiDelay, readmooDelay })
    setSaved(true)
    setTimeout(() => setSaved(false), 1500)
  }

  return (
    <div className="settings-panel">
      <div className="settings-section">
        <div className="settings-label">Books.com.tw</div>
        <div>
          <div className="settings-field-label">File request delay</div>
          <div className="settings-field-desc">Delay between per-file requests within a book</div>
          <div className="settings-number-row">
            <input
              type="number" className="settings-number-input"
              value={apiDelay} min="100" step="100"
              onChange={e => { setSaved(false); setApiDelay(Number(e.target.value)) }}
            />
            <span className="settings-unit">ms</span>
          </div>
        </div>

        {warningLevel === 'danger' && (
          <div className="inline-notif danger">
            <Ico.warn className="notif-icon" style={{ color: 'var(--error)' }}/>
            <span>Delay &lt; 300 ms will very likely trigger rate limiting and may suspend your account. Strongly recommend 800 ms or above.</span>
          </div>
        )}
        {warningLevel === 'warn' && (
          <div className="inline-notif warn">
            <Ico.warn className="notif-icon" style={{ color: '#f1c21b' }}/>
            <span>300–599 ms still carries rate-limiting risk. Recommend 800 ms or above for reliability.</span>
          </div>
        )}
      </div>

      <div className="settings-section">
        <div className="settings-label">Readmoo</div>
        <div>
          <div className="settings-field-label">File request delay</div>
          <div className="settings-field-desc">CloudFront files rarely need a delay — 0 ms is fine</div>
          <div className="settings-number-row">
            <input
              type="number" className="settings-number-input"
              value={readmooDelay} min="0" step="100"
              onChange={e => { setSaved(false); setReadmooDelay(Number(e.target.value)) }}
            />
            <span className="settings-unit">ms</span>
          </div>
        </div>
      </div>

      <div className="settings-actions">
        <button className="btn-secondary" onClick={onBack}>Cancel</button>
        <button className="btn-primary" style={{ minWidth: 80, gap: 0, justifyContent: 'center' }} onClick={handleSave}>
          {saved ? 'Saved' : 'Save'}
        </button>
      </div>
    </div>
  )
}

/* ── Header dropdown ── */
function HeaderDropdown({ queue, onSettings, onCancelAll, onClose }) {
  const ref = useRef(null)
  useEffect(() => {
    const handler = e => { if (ref.current && !ref.current.contains(e.target)) onClose() }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [onClose])

  return (
    <div className="dropdown" ref={ref}>
      <button className="dropdown-item" onClick={() => { onSettings(); onClose() }}>
        <Ico.settings/> Settings
      </button>
      <hr className="dropdown-divider"/>
      <button
        className="dropdown-item danger"
        disabled={queue.length === 0}
        onClick={() => { onCancelAll(); onClose() }}
      >
        <Ico.cancel/> Cancel all downloads
      </button>
    </div>
  )
}

/* ── Main App ── */
export default function App() {
  const [platform,     setPlatform]     = useState('books')
  const [books,        setBooks]        = useState([])
  const [booksTotal,   setBooksTotal]   = useState(0)
  const [booksLoading, setBooksLoading] = useState(false)
  const [booksError,   setBooksError]   = useState(null)
  const [format,       setFormat]       = useState('kepub')
  const [queue,        setQueue]        = useState([])
  const [dlStates,     setDlStates]     = useState({})
  const [query,        setQuery]        = useState('')
  const [selected,     setSelected]     = useState(() => new Set())
  const [dropdownOpen, setDropdownOpen] = useState(false)
  const [showSettings, setShowSettings] = useState(false)
  const [settings,     setSettings]     = useState(DEFAULT_SETTINGS)

  /* init */
  useEffect(() => {
    chrome.storage.session.get(null, items => {
      const restored = {}
      for (const [key, val] of Object.entries(items ?? {})) {
        if (key.startsWith('dl_')) {
          const bookId = key.slice(3)
          restored[bookId] = {
            msg: val.msg,
            pct: val.pct,
            done: val.stage === 'done',
            error: null,
            downloadId: val.downloadId ?? null,
          }
        }
      }
      if (Object.keys(restored).length) setDlStates(restored)
      if (items?.downloadQueue?.length)  setQueue(items.downloadQueue)
    })
    chrome.runtime.sendMessage({ action: 'getSettings' }, resp => {
      if (resp?.settings) setSettings(resp.settings)
    })
    // Auto-switch to Readmoo when the popup is opened from a readmoo.com tab
    chrome.tabs.query({ active: true, currentWindow: true }, tabs => {
      const isReadmoo = tabs[0]?.url?.includes('readmoo.com') ?? false
      if (isReadmoo) {
        setPlatform('readmoo')
        loadBooks(0, 'readmoo')
      } else {
        loadBooks(0, 'books')
      }
    })
  }, [])

  /* chrome message listener */
  useEffect(() => {
    const listener = msg => {
      if (msg.action === 'queueUpdate') {
        setQueue(msg.queue)
      }
      if (msg.action === 'progress') {
        const { bookId, data: { stage, msg: text, pct, downloadId } } = msg
        setQueue(prev =>
          prev[0] === bookId ? prev : [bookId, ...prev.filter(id => id !== bookId)]
        )
        setDlStates(prev => ({
          ...prev,
          [bookId]: stage === 'done'
            ? { msg: text, pct: 1, done: true, error: null, downloadId: downloadId ?? null }
            : { msg: text, pct: pct ?? null, done: false, error: null },
        }))
      }
      if (msg.action === 'error') {
        setDlStates(prev => ({
          ...prev,
          [msg.bookId]: { msg: null, pct: null, done: false, error: msg.error },
        }))
      }
      if (msg.action === 'cancelledAll') {
        setQueue([])
        setDlStates(prev => {
          const n = { ...prev }
          for (const id of msg.bookIds) delete n[id]
          return n
        })
      }
    }
    chrome.runtime.onMessage.addListener(listener)
    return () => chrome.runtime.onMessage.removeListener(listener)
  }, [])

  const startDownload = useCallback((id, src, bookTitle) => {
    if (queue.includes(id)) return
    setQueue(prev => [...prev, id])
    chrome.runtime.sendMessage({ action: 'startDownload', bookId: id, format, source: src, bookTitle: bookTitle ?? null })
  }, [queue, format])

  const loadBooks = async (offset = 0, targetPlatform) => {
    const src = targetPlatform ?? platform
    setBooksLoading(true)
    if (offset === 0) { setBooksError(null); setBooks([]) }

    if (src === 'readmoo') {
      try {
        const timeout = new Promise((_, rej) =>
          setTimeout(() => rej(new Error('TIMEOUT')), 15000)
        )
        const resp = await Promise.race([
          chrome.runtime.sendMessage({ action: 'getReadmooList' }),
          timeout,
        ])
        setBooksLoading(false)
        if (resp?.error) { setBooksError(resp.error); return }
        const list = extractReadmooItems(resp?.data).map(normalizeReadmooBook).filter(Boolean)
        setBooksTotal(resp?.data?.meta?.total_count ?? list.length)
        setBooks(list)
      } catch (e) {
        setBooksLoading(false)
        setBooksError(e.message)
      }
      return
    }

    // books.com.tw
    try {
      const timeout = new Promise((_, rej) =>
        setTimeout(() => rej(new Error('TIMEOUT')), 15000)
      )
      const resp = await Promise.race([
        chrome.runtime.sendMessage({ action: 'getReadList', offset }),
        timeout,
      ])
      setBooksLoading(false)
      if (resp?.error) { setBooksError(resp.error); return }
      const list  = resp?.data?.records       ?? []
      const total = resp?.data?.total_records ?? list.length
      setBooksTotal(total)
      setBooks(prev => offset === 0 ? list : [...prev, ...list])
    } catch (e) {
      setBooksLoading(false)
      setBooksError(e.message)
    }
  }

  const handlePlatformChange = (p) => {
    setPlatform(p)
    setSelected(new Set())
    setQuery('')
    loadBooks(0, p)
  }

  const cancelAll = () => {
    chrome.runtime.sendMessage({ action: 'cancelAll' })
  }

  const saveSettings = (newSettings) => {
    setSettings(newSettings)
    chrome.runtime.sendMessage({ action: 'saveSettings', settings: newSettings })
  }

  /* derived */
  const filtered = books.filter(b => {
    if (!query.trim()) return true
    const info   = b.item_info ?? {}
    const title  = (info.c_title ?? info.o_title ?? '').toLowerCase()
    const author = (info.author_name ?? info.author ?? '').toLowerCase()
    const q = query.toLowerCase()
    return title.includes(q) || author.includes(q)
  })

  const getStatus = useCallback(id => {
    const dl = dlStates[id]
    if (dl?.done)  return { status: 'done',       progress: 100 }
    if (dl?.error) return { status: 'error',       progress: 0   }
    const idx = queue.indexOf(id)
    if (idx === 0) return { status: 'downloading', progress: Math.round((dl?.pct ?? 0) * 100) }
    if (idx > 0)   return { status: 'queued',      progress: 0   }
    return           { status: 'idle',            progress: 0   }
  }, [queue, dlStates])

  const toggleSelect = id => setSelected(prev => {
    const n = new Set(prev)
    n.has(id) ? n.delete(id) : n.add(id)
    return n
  })

  const downloadAll = () => {
    const src = platform
    const targets = (selected.size > 0
      ? filtered.filter(b => selected.has(b.book_uni_id))
      : filtered
    ).filter(b => {
      const { status } = getStatus(b.book_uni_id)
      return status === 'idle' || status === 'error'
    })
    targets.forEach((b, i) => setTimeout(() => startDownload(b.book_uni_id, src, b._title ?? null), i * 200))
  }

  const activeCount = queue.length
  const doneCount   = Object.values(dlStates).filter(d => d.done).length
  const curFmt      = FORMATS.find(f => f.id === format) ?? FORMATS[0]
  const curPlatform = PLATFORMS.find(p => p.id === platform) ?? PLATFORMS[0]

  /* ── Error message by code ── */
  const renderError = (err) => {
    if (err === 'TIMEOUT') {
      if (platform === 'readmoo')
        return <>Timed out — open <a href="https://read.readmoo.com" target="_blank" rel="noreferrer">read.readmoo.com</a> and log in, then retry</>
      return <>Timed out — open <a href="https://viewer-ebook.books.com.tw" target="_blank" rel="noreferrer">books.com.tw</a> and log in, then retry</>
    }
    if (platform === 'readmoo') {
      if (err === 'NO_READMOO_AUTH' || err === 'API_HTTP_401' || err === 'API_HTTP_403')
        return <>Open <a href="https://read.readmoo.com" target="_blank" rel="noreferrer">read.readmoo.com</a> and log in, then retry</>
      if (err === 'NEED_READMOO_TAB' || err === 'NO_READMOO_COOKIES')
        return <>Open <a href="https://read.readmoo.com" target="_blank" rel="noreferrer">read.readmoo.com</a> and log in, then retry</>
      if (err === 'NEED_READER_TAB')
        return <>Open a book in the <a href="https://new-read.readmoo.com" target="_blank" rel="noreferrer">Readmoo reader</a> before downloading</>
      if (err?.startsWith('API_HTTP_'))
        return <>Readmoo API error ({err}) — please try again later</>
    } else {
      if (err === 'NO_CMS_TOKEN')
        return <>Please <a href="https://viewer-ebook.books.com.tw" target="_blank" rel="noreferrer">log in to books.com.tw</a> first</>
      if (err === 'NEED_BOOKS_TAB')
        return <>Open <a href="https://viewer-ebook.books.com.tw" target="_blank" rel="noreferrer">books.com.tw</a> before retrying</>
    }
    return `Error: ${err}`
  }

  /* ── Render ── */
  return (
    <div className="ui">

      {/* UI Shell header */}
      <header className="shell">
        {showSettings ? (
          <>
            <button className="hbtn" style={{ marginLeft: -8 }} onClick={() => setShowSettings(false)}>
              <Ico.back/>
            </button>
            <span className="brand" style={{ color: '#f4f4f4', fontSize: 14 }}>Settings</span>
            <span className="spacer"/>
          </>
        ) : (
          <>
            <span className="grid-ico"><Ico.grid/></span>
            <span className="brand"><b>books</b><span>-download</span></span>
            <span className="spacer"/>
            <span className="count">{filtered.length}</span>
            <span className="shell-end">
              <span
                className="hbtn"
                onClick={() => setDropdownOpen(o => !o)}
                aria-haspopup="true"
                aria-expanded={dropdownOpen}
              >
                <Ico.overflow/>
              </span>
              {dropdownOpen && (
                <HeaderDropdown
                  queue={queue}
                  onSettings={() => setShowSettings(true)}
                  onCancelAll={cancelAll}
                  onClose={() => setDropdownOpen(false)}
                />
              )}
            </span>
          </>
        )}
      </header>

      {/* Main content */}
      {showSettings ? (
        <SettingsPanel
          settings={settings}
          onSave={saveSettings}
          onBack={() => setShowSettings(false)}
        />
      ) : (
        <>
          {/* Toolbar */}
          <div className="toolbar">
            <div>
              <div className="field-label">Platform</div>
              <ContentSwitcher items={PLATFORMS} value={platform} onChange={handlePlatformChange}/>
            </div>
            <div>
              <div className="field-label">Format</div>
              <ContentSwitcher items={FORMATS} value={format} onChange={setFormat}/>
            </div>
            <div className="row-actions">
              <label className="search">
                <Ico.search/>
                <input
                  value={query}
                  onChange={e => setQuery(e.target.value)}
                  placeholder="Search title or author…"
                />
              </label>
              <button
                className="btn-primary"
                onClick={downloadAll}
                disabled={!filtered.length}
              >
                {selected.size > 0 ? `DL_SEL(${selected.size})` : 'DL_ALL'}
                <Ico.download/>
              </button>
            </div>
          </div>

          {/* Book list or error */}
          {booksError ? (
            <div className="error-banner">
              {renderError(booksError)}
            </div>
          ) : filtered.length > 0 ? (
            <ul className="list">
              {filtered.map((b, i) => {
                const id = b.book_uni_id
                const src = b._source ?? platform
                const { status, progress } = getStatus(id)
                return (
                  <BookRow key={id} book={b} index={i}
                    status={status} progress={progress}
                    selected={selected.has(id)}
                    onToggleSelect={() => toggleSelect(id)}
                    onStart={() => startDownload(id, src, b._title ?? null)}
                  />
                )
              })}
              {booksLoading && <li className="loading-row">Loading…</li>}
              {!booksLoading && platform === 'books' && books.length < booksTotal && (
                <li>
                  <button className="load-more-btn" onClick={() => loadBooks(books.length)}>
                    Load more ({books.length} / {booksTotal})
                  </button>
                </li>
              )}
            </ul>
          ) : (
            <ul className="list">
              <div className="empty">
                {booksLoading
                  ? 'Loading…'
                  : query.trim()
                  ? `No results for "${query}"`
                  : 'No books'}
              </div>
            </ul>
          )}
        </>
      )}

      {/* Footer */}
      <div className="footer">
        <span>{curPlatform.label} · {curFmt.label}</span>
        {activeCount > 0
          ? <span className="live"><span className="dotpulse"/>Downloading {activeCount}</span>
          : <span>{doneCount > 0 ? `Done ${doneCount}` : 'Ready'}</span>}
        <span className="version">v{chrome.runtime.getManifest().version}</span>
      </div>

    </div>
  )
}
