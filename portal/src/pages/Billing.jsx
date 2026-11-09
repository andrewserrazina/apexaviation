import { useEffect, useMemo, useState } from 'react'
import { supabase } from '../lib/supabase'
import { useAuth } from '../context/AuthContext'
import Layout from '../components/Layout'
import Modal from '../components/Modal'
import { PageHeader, StatsRow, Button, Table } from '../components/ui'
import { toOne } from '../lib/postgrestEmbed'

const BLANK = { student_id: '', description: '', amount: '', status: 'unpaid' }
const STATUS_OPTIONS = [{ value: '', label: 'All statuses' }, { value: 'unpaid', label: 'Unpaid' }, { value: 'pending', label: 'Pending' }, { value: 'paid', label: 'Paid' }]

function printInvoice(inv, studentName) {
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
        .amount { font-size: 28px; font-weight: 700; margin: 24px 0; }
        .status { display: inline-block; padding: 4px 12px; border-radius: 4px; font-size: 12px; font-weight: 700; text-transform: uppercase; background: ${inv.status === 'paid' ? '#bbf7d0' : '#fee2e2'}; color: ${inv.status === 'paid' ? '#166534' : '#991b1b'}; }
        .desc { margin: 16px 0; padding: 16px; background: #f9fafb; border-radius: 6px; }
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
      <div class="desc">${inv.description}</div>
      <div class="amount">$${(inv.amount_cents / 100).toFixed(2)}</div>
      <script>window.onload = () => { window.print(); }</script>
    </body>
    </html>
  `)
  win.document.close()
}

function daysOutstanding(issuedAt) {
  return Math.max(0, Math.round((Date.now() - new Date(issuedAt).getTime()) / 86400000))
}

export default function Billing() {
  const { profile } = useAuth()
  const [invoices, setInvoices] = useState([])
  const [loading, setLoading] = useState(true)
  const [students, setStudents] = useState([])
  const [studentId, setStudentId] = useState('')
  const [search, setSearch] = useState('')
  const [statusFilter, setStatusFilter] = useState('')
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
    let query = supabase.from('invoices').select('*, student:profiles!student_id(full_name)').order('issued_at', { ascending: false })
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

  function openCreate() {
    setForm({ ...BLANK, student_id: studentId })
    setFormError('')
    setModal({ mode: 'create' })
  }

  function openEdit(inv) {
    setForm({
      student_id: inv.student_id ?? '',
      description: inv.description ?? '',
      amount: (inv.amount_cents / 100).toFixed(2),
      status: inv.status ?? 'unpaid',
    })
    setFormError('')
    setModal({ mode: 'edit', inv })
  }

  function closeModal() { setModal(null); setFormError('') }
  function field(key, val) { setForm(f => ({ ...f, [key]: val })) }

  async function handleSave(e) {
    e.preventDefault()
    setSaving(true)
    setFormError('')
    const payload = {
      student_id: form.student_id || null,
      description: form.description,
      amount_cents: Math.round(parseFloat(form.amount) * 100),
      status: form.status,
    }
    let error
    if (modal.mode === 'create') {
      ;({ error } = await supabase.from('invoices').insert({ ...payload, issued_at: new Date().toISOString() }))
    } else {
      ;({ error } = await supabase.from('invoices').update(payload).eq('id', modal.inv.id))
    }
    setSaving(false)
    if (error) { setFormError(error.message); return }
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
                <td>{inv.description}</td>
                <td>${Number(inv.amount_cents / 100).toFixed(2)}</td>
                <td><span className={statusClass(inv.status)}>{inv.status}</span></td>
                <td style={{ display: 'flex', gap: 10 }}>
                  <button className="btn-link" onClick={() => printInvoice(inv, inv.student?.full_name)}>Print</button>
                  {canEdit && <button className="btn-link" onClick={() => openEdit(inv)}>Edit</button>}
                </td>
              </tr>
            ))}
          </tbody>
        </Table>
      )}

      {modal && (
        <Modal title={modal.mode === 'create' ? 'New Invoice' : 'Edit Invoice'} onClose={closeModal}>
          <form onSubmit={handleSave} className="modal-form">
            {formError && <div className="form-error">{formError}</div>}
            <div className="form-group">
              <label>Student</label>
              <select value={form.student_id} onChange={e => field('student_id', e.target.value)} required>
                <option value="">Select student</option>
                {students.map(s => <option key={s.id} value={s.id}>{s.full_name}</option>)}
              </select>
            </div>
            <div className="form-group">
              <label>Description</label>
              <input type="text" value={form.description} onChange={e => field('description', e.target.value)} required placeholder="e.g. Flight lesson – 1.5 hrs" />
            </div>
            <div className="form-row">
              <div className="form-group">
                <label>Amount ($)</label>
                <input type="number" step="0.01" min="0" value={form.amount} onChange={e => field('amount', e.target.value)} required placeholder="0.00" />
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
