import { useEffect, useRef, useState } from 'react'
import { supabase } from '../lib/supabase'
import { useAuth } from '../context/AuthContext'
import Layout from '../components/Layout'
import Modal from '../components/Modal'

export default function Messages() {
  const { profile } = useAuth()
  const [users, setUsers] = useState([])
  const [threads, setThreads] = useState([]) // [{other, messages, unread}]
  const [activeThread, setActiveThread] = useState(null) // other user id
  const [messages, setMessages] = useState([])
  const [loading, setLoading] = useState(true)
  const [text, setText] = useState('')
  const [sending, setSending] = useState(false)
  const [composeModal, setComposeModal] = useState(false)
  const [composeRecipient, setComposeRecipient] = useState('')
  const [composeText, setComposeText] = useState('')
  const bottomRef = useRef()
  const channelRef = useRef()

  useEffect(() => {
    if (!profile) return
    loadUsers()
    loadThreads()

    // Real-time subscription
    channelRef.current = supabase
      .channel('messages')
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'messages', filter: `recipient_id=eq.${profile.id}` }, () => {
        loadThreads()
        if (activeThread) loadMessages(activeThread)
      })
      .subscribe()

    return () => { channelRef.current?.unsubscribe() }
  }, [profile])

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages])

  async function loadUsers() {
    const { data } = await supabase.from('profiles').select('id, full_name, role').neq('id', profile.id).order('full_name')
    setUsers(data ?? [])
  }

  async function loadThreads() {
    const { data: sent } = await supabase.from('messages').select('id, sender_id, recipient_id, body, created_at, read_at').eq('sender_id', profile.id).order('created_at', { ascending: false })
    const { data: received } = await supabase.from('messages').select('id, sender_id, recipient_id, body, created_at, read_at').eq('recipient_id', profile.id).order('created_at', { ascending: false })

    const all = [...(sent ?? []), ...(received ?? [])]
    const threadMap = {}
    for (const m of all) {
      const other = m.sender_id === profile.id ? m.recipient_id : m.sender_id
      if (!threadMap[other] || new Date(m.created_at) > new Date(threadMap[other].latest)) {
        threadMap[other] = { otherId: other, latest: m.created_at, preview: m.body }
      }
    }

    const { data: allProfiles } = await supabase.from('profiles').select('id, full_name').in('id', Object.keys(threadMap))
    const profileMap = Object.fromEntries((allProfiles ?? []).map(p => [p.id, p]))

    const { data: unreadMsgs } = await supabase.from('messages').select('id, sender_id').eq('recipient_id', profile.id).is('read_at', null)
    const unreadCounts = {}
    for (const m of unreadMsgs ?? []) {
      unreadCounts[m.sender_id] = (unreadCounts[m.sender_id] ?? 0) + 1
    }

    const result = Object.values(threadMap).map(t => ({
      ...t,
      otherName: profileMap[t.otherId]?.full_name ?? 'Unknown',
      unread: unreadCounts[t.otherId] ?? 0,
    })).sort((a, b) => new Date(b.latest) - new Date(a.latest))

    setThreads(result)
    setLoading(false)
  }

  async function loadMessages(otherId) {
    const { data } = await supabase
      .from('messages')
      .select('*')
      .or(`and(sender_id.eq.${profile.id},recipient_id.eq.${otherId}),and(sender_id.eq.${otherId},recipient_id.eq.${profile.id})`)
      .order('created_at')
    setMessages(data ?? [])
    // Mark received messages as read
    await supabase.from('messages').update({ read_at: new Date().toISOString() })
      .eq('sender_id', otherId).eq('recipient_id', profile.id).is('read_at', null)
    loadThreads()
  }

  async function openThread(otherId) {
    setActiveThread(otherId)
    await loadMessages(otherId)
  }

  async function sendMessage(e) {
    e.preventDefault()
    if (!text.trim() || !activeThread) return
    setSending(true)
    await supabase.from('messages').insert({ sender_id: profile.id, recipient_id: activeThread, body: text.trim() })
    setText('')
    setSending(false)
    loadMessages(activeThread)
    loadThreads()
  }

  async function startNewThread(e) {
    e.preventDefault()
    if (!composeRecipient || !composeText.trim()) return
    setSending(true)
    await supabase.from('messages').insert({ sender_id: profile.id, recipient_id: composeRecipient, body: composeText.trim() })
    setSending(false)
    setComposeModal(false)
    setComposeText('')
    await loadThreads()
    openThread(composeRecipient)
  }

  const activeUser = users.find(u => u.id === activeThread)
  const totalUnread = threads.reduce((s, t) => s + t.unread, 0)

  return (
    <Layout>
      <div className="page-header">
        <div>
          <h2 className="page-title">Messages {totalUnread > 0 && <span className="notif-badge" style={{ fontSize: 13, marginLeft: 8 }}>{totalUnread}</span>}</h2>
          <p className="page-sub">Direct messages with staff & students</p>
        </div>
        <button className="btn-primary-sm" onClick={() => { setComposeRecipient(''); setComposeText(''); setComposeModal(true) }}>+ New Message</button>
      </div>

      <div className="messages-layout">
        {/* Thread list */}
        <div className="messages-sidebar">
          {loading ? <p className="empty-state" style={{ padding: 16 }}>Loading…</p> : threads.length === 0 ? (
            <p className="empty-state" style={{ padding: 16 }}>No conversations yet.</p>
          ) : threads.map(t => (
            <button
              key={t.otherId}
              className={`thread-item${activeThread === t.otherId ? ' thread-item--active' : ''}`}
              onClick={() => openThread(t.otherId)}
            >
              <div className="thread-item__avatar">{t.otherName[0]}</div>
              <div className="thread-item__body">
                <div className="thread-item__name">
                  {t.otherName}
                  {t.unread > 0 && <span className="thread-item__unread">{t.unread}</span>}
                </div>
                <p className="thread-item__preview">{t.preview}</p>
              </div>
            </button>
          ))}
        </div>

        {/* Message thread */}
        <div className="messages-main">
          {!activeThread ? (
            <div className="messages-empty">
              <p>Select a conversation or start a new one.</p>
            </div>
          ) : (
            <>
              <div className="messages-header">
                <div className="thread-item__avatar" style={{ width: 36, height: 36, fontSize: 16 }}>{activeUser?.full_name?.[0] ?? '?'}</div>
                <div>
                  <p style={{ fontWeight: 700 }}>{activeUser?.full_name ?? 'Unknown'}</p>
                  <p style={{ fontSize: 12, color: 'var(--muted)' }}>{activeUser?.role}</p>
                </div>
              </div>
              <div className="messages-thread">
                {messages.map(m => {
                  const isMine = m.sender_id === profile.id
                  return (
                    <div key={m.id} className={`message-bubble${isMine ? ' message-bubble--mine' : ''}`}>
                      <p className="message-bubble__text">{m.body}</p>
                      <p className="message-bubble__time">{new Date(m.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })} · {new Date(m.created_at).toLocaleDateString()}</p>
                    </div>
                  )
                })}
                <div ref={bottomRef} />
              </div>
              <form className="messages-compose" onSubmit={sendMessage}>
                <input
                  type="text" value={text} onChange={e => setText(e.target.value)}
                  placeholder={`Message ${activeUser?.full_name ?? ''}…`}
                  required className="messages-compose__input"
                />
                <button type="submit" className="btn-primary-sm" disabled={sending || !text.trim()}>Send</button>
              </form>
            </>
          )}
        </div>
      </div>

      {composeModal && (
        <Modal title="New Message" onClose={() => setComposeModal(false)}>
          <form onSubmit={startNewThread} className="modal-form">
            <div className="form-group">
              <label>To</label>
              <select value={composeRecipient} onChange={e => setComposeRecipient(e.target.value)} required>
                <option value="">Select recipient</option>
                {users.map(u => <option key={u.id} value={u.id}>{u.full_name} ({u.role})</option>)}
              </select>
            </div>
            <div className="form-group">
              <label>Message</label>
              <textarea value={composeText} onChange={e => setComposeText(e.target.value)} rows={4} required placeholder="Type your message…" />
            </div>
            <div className="modal-form__actions">
              <div style={{ marginLeft: 'auto', display: 'flex', gap: 8 }}>
                <button type="button" className="btn-secondary" onClick={() => setComposeModal(false)}>Cancel</button>
                <button type="submit" className="btn-primary-sm" disabled={sending}>{sending ? 'Sending…' : 'Send Message'}</button>
              </div>
            </div>
          </form>
        </Modal>
      )}
    </Layout>
  )
}
