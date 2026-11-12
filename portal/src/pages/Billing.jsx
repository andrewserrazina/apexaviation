import { useEffect, useMemo, useState } from 'react'
import { supabase } from '../lib/supabase'
import { useAuth } from '../context/AuthContext'
import { useSelectedStudent } from '../context/SelectedStudentContext'
import Layout from '../components/Layout'
import Modal from '../components/Modal'
import { PageHeader, StatsRow, Button, Table } from '../components/ui'
import { toOne } from '../lib/postgrestEmbed'

const BLANK = { student_id: '', description: '', status: 'unpaid' }
const BLANK_LINE_ITEM = { description: '', amount: '' }
const STATUS_OPTIONS = [{ value: '', label: 'All statuses' }, { value: 'unpaid', label: 'Unpaid' }, { value: 'pending', label: 'Pending' }, { value: 'paid', label: 'Paid' }]

function lineItemsOf(inv) {
  return [...(inv.invoice_line_items ?? [])].sort((a, b) => a.sort_order - b.sort_order)
}

function summaryOf(inv) {
  const items = lineItemsOf(inv)
  if (items.length === 0) return inv.description || '—'
  if (items.length === 1) return items[0].description
  return `${items[0].description} +${items.length - 1} more`
}

function printInvoice(inv, studentName) {
  const items = lineItemsOf(inv)
  const win = window.open('', '_blank')
  win.document.write(`
    <!DOCTYPE html>
    <html>
    <head>
      <title>Invoice #${inv.id.slice(0, 8).toUpperCase()}</title>
      <style>
        body { font-family: sans-serif; padding: 40px; max-width: 600px; margin: 0 auto; color: #111; }
        .header { border-bottom: 2px solid #F4B400; padding-bottom: 16px; margin-bottom: 24px; }
        .title { font-size: 24px; font-weight: 700; letter-spacing: 2px; }
        .subtitle { color: #666; font-size: 13px; }
        .row { display: flex; justify-content: space-between; margin: 8px 0; }
        .label { color: #666; font-size: 13px; }
        .amount { font-size: 28px; font-weight: 700; margin: 24px 0; text-align: right; }
        .status { display: inline-block; padding: 4px 12px; border-radius: 4px; font-size: 12px; font-weight: 700; text-transform: uppercase; background: ${inv.status === 'paid' ? '#bbf7d0' : '#fee2e2'}; color: ${inv.status === 'paid' ? '#166534' : '#991b1b'}; }
        .items { margin: 16px 0; border: 1px solid #e5e7eb; border-radius: 6px; overflow: hidden; }
        .item { display: flex; justify-content: space-between; padding: 10px 16px; border-bottom: 1px solid #e5e7eb; }
        .item:last-child { border-bottom: none; }
        @media print { body { padding: 20px; } }
      </style>
    </head>
    <body>
      <div class="header">
        <div class="title">APEX <em>Advantage</em></div>
        <div class="subtitle">Apex Aviation · Austin, TX</div>
      </div>
      <div class="row"><span class="label">Invoice #</span><strong>#${inv.id.slice(0, 8).toUpperCase()}</strong></div>
      <div class="row"><span class="label">Student</span><strong>${studentName ?? '—'}</strong></div>
      <div class="row"><span class="label">Issued</span><strong>${new Date(inv.issued_at).toLocaleDateString()}</strong></div>
      <div class="row"><span class="label">Status</span><span class="status">${inv.status}</span></div>
      <div class="items">
        ${items.map(i => `<div class="item"><span>${i.description}</span><strong>$${(i.amount_cents / 100).toFixed(2)}</strong></div>`).join('')}
      </div>
      <div class="amount">Total: $${(inv.amount_cents / 100).toFixed(2)}</div>
      <script>window.onload = () => { window.print(); }</script>
    </body>
    </html>
  `)
  win.document.close()
}

function daysOutstanding(issuedAt) {
  return Math.max(0, Math.round((Date.now() - new Date(issuedAt).getTime()) / 86400000))
}

// Same shape every supabase.functions.invoke() caller in this codebase
// uses (e.g. GroundSchedule.jsx) -- Edge Functions here return
// jsonError({ error: '...' }) either in res.data or inside a non-2xx
// res.error's response body, depending on which layer caught it.
function extractInvokeError(res) {
  if (res.data && res.data.error) return Promise.resolve(res.data.error)
  const fallback = (res.error && res.error.message) || 'Could not start checkout. Please try again.'
  if (res.error && res.error.context && typeof res.error.context.json === 'function') {
    return res.error.context.json().then(body => (body && body.error) || fallback).catch(() => fallback)
  }
  return Promise.resolve(fallback)
}

export default function Billing() {
  const { profile } = useAuth()
  const [invoices, setInvoices] = useState([])
  const [loading, setLoading] = useState(true)
  const [students, setStudents] = useState([])
  const { selectedStudentId: studentId, setSelectedStudentId: setStudentId } = useSelectedStudent()
  const [search, setSearch] = useState('')
  const [statusFilter, setStatusFilter] = useState('')
  const [payingId, setPayingId] = useState(null)
  const [payBanner, setPayBanner] = useState(null) // 'paid' | 'cancelled'
  const [modal, setModal] = useState(null)
  const [form, setForm] = useState(BLANK)
  const [saving, setSaving] = useState(false)
  const [formError, setFormError] = useState('')

  const isAdmin = profile?.role === 'admin'
  const isInstructor = profile?.role === 'instructor'
  const canEdit = isAdmin
  // Admins see every invoice across the whole school by default (no
  // student has to be picked first) -- instructors still pick one of
  // their own students, since they can't see the rest of the roster.
  const adminWideView = isAdmin

  async function loadStudents() {
    if (isAdmin) {
      const { data } = await supabase.from('profiles').select('id, full_name').eq('role', 'student').order('full_name')
      setStudents(data ?? [])
    } else if (isInstructor) {
      const { data: lessonData } = await supabase.from('lessons').select('student_id, student:profiles!student_id(id, full_name)').eq('instructor_id', profile.id)
      const seen = new Set()
      const unique = []
      for (const l of lessonData ?? []) {
        if (l.student && !seen.has(l.student.id)) { seen.add(l.student.id); unique.push(l.student) }
      }
      setStudents(unique.sort((a, b) => a.full_name.localeCompare(b.full_name)))
    }
  }

  useEffect(() => {
    if (!profile) return
    if (isAdmin || isInstructor) loadStudents()
  }, [profile])

  async function loadInvoices() {
    setLoading(true)
    let query = supabase.from('invoices').select('*, student:profiles!student_id(full_name), invoice_line_items(id, description, amount_cents, sort_order)').order('issued_at', { ascending: false })
    if (adminWideView) {
      if (studentId) query = query.eq('student_id', studentId)
    } else {
      const id = isInstructor ? studentId : profile.id
      if (!id) { setInvoices([]); setLoading(false); return }
      query = query.eq('student_id', id)
    }
    const { data } = await query
    setInvoices((data ?? []).map(inv => ({ ...inv, student: toOne(inv.student) })))
    setLoading(false)
  }

  useEffect(() => {
    if (!profile) return
    loadInvoices()
  }, [studentId, profile])

  // Stripe redirects back here after checkout -- success_url/cancel_url
  // in create-checkout-session's 'pay-invoice' branch both point at
  // /billing. Strips the query params after reading them so a page
  // refresh doesn't re-show the banner or re-trigger a reload.
  useEffect(() => {
    const params = new URLSearchParams(window.location.search)
    if (params.has('paid')) {
      setPayBanner('paid')
      window.history.replaceState({}, '', window.location.pathname)
      loadInvoices()
    } else if (params.has('checkout_cancelled')) {
      setPayBanner('cancelled')
      window.history.replaceState({}, '', window.location.pathname)
    }
  }, [])

  async function payInvoice(inv) {
    setPayingId(inv.id)
    const res = await supabase.functions.invoke('create-checkout-session', {
      body: { purpose: 'pay-invoice', invoice_id: inv.id, origin: window.location.origin },
    })
    if (res.error || !res.data?.url) {
      setPayingId(null)
      const message = await extractInvokeError(res)
      alert(message)
      return
    }
    window.location.href = res.data.url
  }

  function openCreate() {
    setForm({ ...BLANK, student_id: studentId, lineItems: [{ ...BLANK_LINE_ITEM }] })
    setFormError('')
    setModal({ mode: 'create' })
  }

  function openEdit(inv) {
    const items = lineItemsOf(inv)
    setForm({
      student_id: inv.student_id ?? '',
      description: inv.description ?? '',
      status: inv.status ?? 'unpaid',
      lineItems: items.length > 0
        ? items.map(i => ({ description: i.description, amount: (i.amount_cents / 100).toFixed(2) }))
        : [{ ...BLANK_LINE_ITEM }],
    })
    setFormError('')
    setModal({ mode: 'edit', inv })
  }

  function openView(inv) {
    setModal({ mode: 'view', inv })
  }

  function closeModal() { setModal(null); setFormError('') }
  function field(key, val) { setForm(f => ({ ...f, [key]: val })) }

  function addLineItem() { setForm(f => ({ ...f, lineItems: [...f.lineItems, { ...BLANK_LINE_ITEM }] })) }
  function removeLineItem(i) { setForm(f => ({ ...f, lineItems: f.lineItems.filter((_, idx) => idx !== i) })) }
  function updateLineItem(i, key, val) {
    setForm(f => ({ ...f, lineItems: f.lineItems.map((li, idx) => idx === i ? { ...li, [key]: val } : li) }))
  }

  const formTotalCents = (form.lineItems ?? []).reduce((sum, li) => sum + Math.round((parseFloat(li.amount) || 0) * 100), 0)

  async function handleSave(e) {
    e.preventDefault()
    setFormError('')
    const items = (form.lineItems ?? []).filter(li => li.description.trim() && li.amount !== '')
    if (items.length === 0) { setFormError('Add at least one line item.'); return }
    setSaving(true)
    const totalCents = items.reduce((sum, li) => sum + Math.round(parseFloat(li.amount) * 100), 0)
    const payload = {
      student_id: form.student_id || null,
      description: form.description || items[0].description,
      amount_cents: totalCents,
      status: form.status,
    }

    let invoiceId = modal.inv?.id
    let error
    if (modal.mode === 'create') {
      const { data, error: insertErr } = await supabase.from('invoices').insert({ ...payload, issued_at: new Date().toISOString() }).select('id').single()
      error = insertErr
      invoiceId = data?.id
    } else {
      ;({ error } = await supabase.from('invoices').update(payload).eq('id', invoiceId))
    }
    if (error) { setSaving(false); setFormError(error.message); return }

    if (modal.mode === 'edit') {
      await supabase.from('invoice_line_items').delete().eq('invoice_id', invoiceId)
    }
    const { error: itemsError } = await supabase.from('invoice_line_items').insert(
      items.map((li, i) => ({ invoice_id: invoiceId, description: li.description.trim(), amount_cents: Math.round(parseFloat(li.amount) * 100), sort_order: i }))
    )
    setSaving(false)
    if (itemsError) { setFormError(itemsError.message); return }
    closeModal()
    loadInvoices()
  }

  async function handleDelete() {
    if (!window.confirm('Delete this invoice?')) return
    await supabase.from('invoices').delete().eq('id', modal.inv.id)
    closeModal()
    loadInvoices()
  }

  const statusClass = s => ({ paid: 'badge badge--green', unpaid: 'badge badge--red', pending: 'badge badge--yellow' }[s] ?? 'badge')

  const showSelector = isAdmin || isInstructor
  const showTable = adminWideView || !showSelector || studentId

  const filteredInvoices = useMemo(() => {
    return invoices.filter(inv => {
      if (statusFilter && inv.status !== statusFilter) return false
      if (search) {
        const haystack = `${inv.student?.full_name ?? ''} ${inv.description ?? ''}`.toLowerCase()
        if (!haystack.includes(search.toLowerCase())) return false
      }
      return true
    })
  }, [invoices, statusFilter, search])

  const totalOwed = invoices.filter(i => i.status !== 'paid').reduce((sum, i) => sum + (i.amount_cents ?? 0), 0)
  const totalPaid = invoices.filter(i => i.status === 'paid').reduce((sum, i) => sum + (i.amount_cents ?? 0), 0)
  const overdueCount = invoices.filter(i => i.status !== 'paid' && daysOutstanding(i.issued_at) > 30).length

  return (
    <Layout>
      <PageHeader
        eyebrow="Apex Operations"
        title="Billing"
        description={adminWideView ? 'Every student invoice across the school.' : 'Student invoice ledger.'}
        actions={canEdit && showTable && <Button variant="primary" onClick={openCreate}>+ New Invoice</Button>}
      />

      {payBanner === 'paid' && (
        <div className="status-badge status-badge--success" style={{ display: 'block', padding: '10px 14px', marginBottom: 16, fontSize: 13 }}>
          Payment received — thanks! It may take a moment to show as paid below.
        </div>
      )}
      {payBanner === 'cancelled' && (
        <div className="status-badge status-badge--warning" style={{ display: 'block', padding: '10px 14px', marginBottom: 16, fontSize: 13 }}>
          Checkout was cancelled — no payment was made.
        </div>
      )}

      <div style={{ display: 'flex', gap: 12, alignItems: 'center', flexWrap: 'wrap', marginBottom: 20 }}>
        {showSelector && (
          <select className="select-input" value={studentId} onChange={e => setStudentId(e.target.value)}>
            <option value="">{adminWideView ? 'All students' : 'Select a student'}</option>
            {students.map(s => <option key={s.id} value={s.id}>{s.full_name}</option>)}
          </select>
        )}
        {showTable && (
          <>
            <input
              className="search-input"
              type="text"
              placeholder="Search student or description…"
              value={search}
              onChange={e => setSearch(e.target.value)}
            />
            <select className="select-input" value={statusFilter} onChange={e => setStatusFilter(e.target.value)}>
              {STATUS_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
            </select>
          </>
        )}
      </div>

      {showTable && invoices.length > 0 && (
        <StatsRow
          size="sm"
          stats={[
            { label: 'Balance Due', value: `$${(totalOwed / 100).toFixed(2)}`, sub: overdueCount > 0 ? `${overdueCount} overdue 30+ days` : undefined },
            { label: 'Total Paid', value: `$${(totalPaid / 100).toFixed(2)}` },
            { label: 'Total Invoiced', value: `$${((totalOwed + totalPaid) / 100).toFixed(2)}` },
          ]}
        />
      )}

      {!showTable ? (
        <p className="empty-state">Select a student to view their invoices.</p>
      ) : loading ? (
        <p className="empty-state">Loading…</p>
      ) : (
        <Table>
          <thead>
            <tr>
              <th>Invoice #</th>
              {adminWideView && <th>Student</th>}
              <th>Issued</th>
              <th>Description</th>
              <th>Amount</th>
              <th>Status</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {filteredInvoices.length === 0 ? (
              <tr><td colSpan={adminWideView ? 7 : 6} className="empty-state">No invoices match.</td></tr>
            ) : filteredInvoices.map(inv => (
              <tr key={inv.id}>
                <td>#{inv.id.slice(0, 8).toUpperCase()}</td>
                {adminWideView && <td>{inv.student?.full_name ?? '—'}</td>}
                <td>
                  {new Date(inv.issued_at).toLocaleDateString()}
                  {inv.status !== 'paid' && daysOutstanding(inv.issued_at) > 30 && (
                    <span className="status-badge status-badge--danger" style={{ marginLeft: 8 }}>{daysOutstanding(inv.issued_at)}d</span>
                  )}
                </td>
                <td>{summaryOf(inv)}</td>
                <td>${Number(inv.amount_cents / 100).toFixed(2)}</td>
                <td><span className={statusClass(inv.status)}>{inv.status}</span></td>
                <td style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
                  <button className="btn-link" onClick={() => printInvoice(inv, inv.student?.full_name)}>Print</button>
                  {canEdit ? (
                    <button className="btn-link" onClick={() => openEdit(inv)}>Edit</button>
                  ) : (
                    <button className="btn-link" onClick={() => openView(inv)}>View</button>
                  )}
                  {!canEdit && inv.status !== 'paid' && profile?.id === inv.student_id && (
                    <button className="btn-link" disabled={payingId === inv.id} onClick={() => payInvoice(inv)}>
                      {payingId === inv.id ? 'Redirecting…' : 'Pay Now'}
                    </button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </Table>
      )}

      {/* Read-only itemized view (instructor/student) */}
      {modal?.mode === 'view' && (
        <Modal title={`Invoice #${modal.inv.id.slice(0, 8).toUpperCase()}`} onClose={closeModal}>
          <p className="activity-row__sub" style={{ marginBottom: 16 }}>
            {modal.inv.student?.full_name ? `${modal.inv.student.full_name} · ` : ''}{new Date(modal.inv.issued_at).toLocaleDateString()} · <span className={statusClass(modal.inv.status)}>{modal.inv.status}</span>
          </p>
          <div className="agenda-list">
            {lineItemsOf(modal.inv).map(li => (
              <div key={li.id} className="agenda-row" style={{ borderLeftColor: 'var(--gold)' }}>
                <span>{li.description}</span>
                <span style={{ fontWeight: 700 }}>${(li.amount_cents / 100).toFixed(2)}</span>
              </div>
            ))}
          </div>
          <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 16, fontSize: 16, fontWeight: 700 }}>
            Total: ${(modal.inv.amount_cents / 100).toFixed(2)}
          </div>
          <div className="modal-form__actions">
            <div style={{ marginLeft: 'auto', display: 'flex', gap: 8 }}>
              <button type="button" className="btn-secondary" onClick={closeModal}>Close</button>
              {modal.inv.status !== 'paid' && profile?.id === modal.inv.student_id && (
                <button type="button" className="btn-primary-sm" disabled={payingId === modal.inv.id} onClick={() => payInvoice(modal.inv)}>
                  {payingId === modal.inv.id ? 'Redirecting…' : 'Pay Now'}
                </button>
              )}
            </div>
          </div>
        </Modal>
      )}

      {/* Create/edit (admin) */}
      {modal && modal.mode !== 'view' && (
        <Modal title={modal.mode === 'create' ? 'New Invoice' : 'Edit Invoice'} onClose={closeModal} wide>
          <form onSubmit={handleSave} className="modal-form">
            {formError && <div className="form-error">{formError}</div>}
            <div className="form-row">
              <div className="form-group">
                <label>Student</label>
                <select value={form.student_id} onChange={e => field('student_id', e.target.value)} required>
                  <option value="">Select student</option>
                  {students.map(s => <option key={s.id} value={s.id}>{s.full_name}</option>)}
                </select>
              </div>
              <div className="form-group">
                <label>Status</label>
                <select value={form.status} onChange={e => field('status', e.target.value)}>
                  <option value="unpaid">Unpaid</option>
                  <option value="pending">Pending</option>
                  <option value="paid">Paid</option>
                </select>
              </div>
            </div>
            <div className="form-group">
              <label>Invoice Label (optional)</label>
              <input type="text" value={form.description} onChange={e => field('description', e.target.value)} placeholder="Defaults to the first line item" />
            </div>

            <div className="form-group">
              <label>Line Items</label>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                {form.lineItems.map((li, i) => (
                  <div key={i} style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                    <input
                      type="text"
                      style={{ flex: 1 }}
                      value={li.description}
                      onChange={e => updateLineItem(i, 'description', e.target.value)}
                      placeholder="e.g. Flight lesson – 1.5 hrs"
                    />
                    <input
                      type="number" step="0.01" min="0"
                      style={{ width: 110 }}
                      value={li.amount}
                      onChange={e => updateLineItem(i, 'amount', e.target.value)}
                      placeholder="0.00"
                    />
                    <button
                      type="button"
                      className="btn-link"
                      style={{ color: 'var(--tone-danger)', flexShrink: 0 }}
                      onClick={() => removeLineItem(i)}
                      disabled={form.lineItems.length === 1}
                    >
                      Remove
                    </button>
                  </div>
                ))}
              </div>
              <button type="button" className="btn-secondary" style={{ marginTop: 10 }} onClick={addLineItem}>+ Add Line Item</button>
            </div>

            <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 4, marginBottom: 4, fontSize: 15, fontWeight: 700 }}>
              Total: ${(formTotalCents / 100).toFixed(2)}
            </div>

            <div className="modal-form__actions">
              {modal.mode === 'edit' && (
                <button type="button" className="btn-danger" onClick={handleDelete}>Delete</button>
              )}
              <div style={{ marginLeft: 'auto', display: 'flex', gap: 8 }}>
                <button type="button" className="btn-secondary" onClick={closeModal}>Cancel</button>
                <button type="submit" className="btn-primary-sm" disabled={saving}>{saving ? 'Saving…' : modal.mode === 'create' ? 'Create Invoice' : 'Save Changes'}</button>
              </div>
            </div>
          </form>
        </Modal>
      )}
    </Layout>
  )
}
