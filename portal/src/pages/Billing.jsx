import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'
import { useAuth } from '../context/AuthContext'
import Layout from '../components/Layout'
import Modal from '../components/Modal'

const BLANK = { student_id: '', description: '', amount: '', status: 'unpaid' }

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

export default function Billing() {
  const { profile } = useAuth()
  const [invoices, setInvoices] = useState([])
  const [loading, setLoading] = useState(true)
  const [students, setStudents] = useState([])
  const [studentId, setStudentId] = useState('')
  const [modal, setModal] = useState(null)
  const [form, setForm] = useState(BLANK)
  const [saving, setSaving] = useState(false)
  const [formError, setFormError] = useState('')

  const isAdmin = profile?.role === 'admin'
  const isInstructor = profile?.role === 'instructor'
  const canEdit = isAdmin

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

  async function loadInvoices(id) {
    if (!id) { setLoading(false); return }
    setLoading(true)
    const { data } = await supabase
      .from('invoices')
      .select('*')
      .eq('student_id', id)
      .order('issued_at', { ascending: false })
    setInvoices(data ?? [])
    setLoading(false)
  }

  useEffect(() => {
    if (!profile) return
    const id = (isAdmin || isInstructor) ? studentId : profile.id
    loadInvoices(id)
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
    const id = (isAdmin || isInstructor) ? studentId : profile.id
    loadInvoices(id)
  }

  async function handleDelete() {
    if (!window.confirm('Delete this invoice?')) return
    await supabase.from('invoices').delete().eq('id', modal.inv.id)
    closeModal()
    const id = (isAdmin || isInstructor) ? studentId : profile.id
    loadInvoices(id)
  }

  const statusClass = s => ({ paid: 'badge badge--green', unpaid: 'badge badge--red', pending: 'badge badge--yellow' }[s] ?? 'badge')

  const showSelector = isAdmin || isInstructor
  const showTable = !showSelector || studentId

  const totalOwed = invoices.filter(i => i.status !== 'paid').reduce((sum, i) => sum + (i.amount_cents ?? 0), 0)
  const totalPaid = invoices.filter(i => i.status === 'paid').reduce((sum, i) => sum + (i.amount_cents ?? 0), 0)

  const currentStudentName = showSelector
    ? students.find(s => s.id === studentId)?.full_name
    : profile?.full_name

  return (
    <Layout>
      <div className="page-header">
        <h2 className="page-title">Billing</h2>
        <div style={{ display: 'flex', gap: 12, alignItems: 'center' }}>
          {canEdit && showTable && (
            <button className="btn-primary-sm" onClick={openCreate}>+ New Invoice</button>
          )}
          {showSelector && (
            <select className="select-input" value={studentId} onChange={e => setStudentId(e.target.value)}>
              <option value="">Select a student</option>
              {students.map(s => <option key={s.id} value={s.id}>{s.full_name}</option>)}
            </select>
          )}
        </div>
      </div>

      {showTable && invoices.length > 0 && (
        <div className="stat-grid stat-grid--sm" style={{ marginBottom: 24 }}>
          <div className="stat-card">
            <p className="stat-card__label">Balance Due</p>
            <p className="stat-card__value" style={{ color: totalOwed > 0 ? '#f87171' : 'var(--text)' }}>${(totalOwed / 100).toFixed(2)}</p>
          </div>
          <div className="stat-card">
            <p className="stat-card__label">Total Paid</p>
            <p className="stat-card__value" style={{ color: '#4ade80' }}>${(totalPaid / 100).toFixed(2)}</p>
          </div>
          <div className="stat-card">
            <p className="stat-card__label">Total Invoiced</p>
            <p className="stat-card__value">${((totalOwed + totalPaid) / 100).toFixed(2)}</p>
          </div>
        </div>
      )}

      {loading ? <p className="empty-state">Loading…</p> : (
        <div className="table-wrap">
          <table className="data-table">
            <thead>
              <tr>
                <th>Invoice #</th>
                <th>Issued</th>
                <th>Description</th>
                <th>Amount</th>
                <th>Status</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {invoices.length === 0 ? (
                <tr><td colSpan={6} className="empty-state">No invoices yet.</td></tr>
              ) : invoices.map(inv => (
                <tr key={inv.id}>
                  <td>#{inv.id.slice(0, 8).toUpperCase()}</td>
                  <td>{new Date(inv.issued_at).toLocaleDateString()}</td>
                  <td>{inv.description}</td>
                  <td>${Number(inv.amount_cents / 100).toFixed(2)}</td>
                  <td><span className={statusClass(inv.status)}>{inv.status}</span></td>
                  <td style={{ display: 'flex', gap: 10 }}>
                    <button className="btn-link" onClick={() => printInvoice(inv, currentStudentName)}>Print</button>
                    {canEdit && <button className="btn-link" onClick={() => openEdit(inv)}>Edit</button>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
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
