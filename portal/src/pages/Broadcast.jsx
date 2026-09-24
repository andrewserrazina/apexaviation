import { useEffect, useMemo, useState } from 'react'
import { supabase } from '../lib/supabase'
import { useAuth } from '../context/AuthContext'
import Layout from '../components/Layout'
import { sendAdminEmail, sendSegmentedBroadcast, sendTestEmail } from '../lib/email'
import {
  CURRENT_RATING_OPTIONS, TRAINING_STAGE_OPTIONS, STUDENT_TYPE_OPTIONS, NEXT_RATING_INTEREST_OPTIONS,
  PRIMARY_FOCUS_AREA_OPTIONS, PRIMARY_AIRCRAFT_CLASS_OPTIONS, CHECKRIDE_TIMING_OPTIONS,
  READINESS_LEVEL_OPTIONS, READINESS_CATEGORY_OPTIONS, CHECKRIDE_WITHIN_DAYS_OPTIONS, ENGAGEMENT_DAY_OPTIONS,
  buildSegmentDefinition, isSegmentEmpty, describeAudience, isBroadAudience, isPreviewStale,
} from '../lib/audienceSegment'

const FILTER_OPTIONS = [
  { value: 'all', label: 'All Students' },
  { value: 'flight_student', label: 'Flight Students' },
  { value: 'apex_advantage', label: 'Apex Advantage Students' },
]

function studentQuery(filter) {
  let query = supabase.from('profiles').select('id, email').eq('role', 'student')
  if (filter !== 'all') query = query.eq('student_type', filter)
  return query
}

// A separate query builder, rather than chaining .select('*', {count, head})
// onto studentQuery()'s already-filtered result, because postgrest-js only
// honors the {count, head} options on the *first* select() call on a fresh
// query -- select() called again after .eq() filters silently ignores that
// second argument and runs a second, uncounted request instead, so count
// always came back undefined (read as 0) regardless of how many students
// actually matched.
function studentCountQuery(filter) {
  let query = supabase.from('profiles').select('*', { count: 'exact', head: true }).eq('role', 'student')
  if (filter !== 'all') query = query.eq('student_type', filter)
  return query
}

// ── Audience Builder field configuration ──────────────────────────
// Each group (except checkride/products, which have bespoke shapes --
// see their dedicated render blocks below) is a flat list of optional
// fields an admin can add one at a time via "+ Add filter". Adding a
// field seeds it with a usable default value immediately, since an
// empty/invalid value would otherwise silently filter on nothing (see
// audienceSegment.js's pruneEmpty, which drops empty values entirely).
function groupFieldConfigs(attributionOptions) {
  return {
    acquisition: [
      { key: 'signup_utm_source', label: 'Signup UTM Source', type: 'multiselect-dynamic' },
      { key: 'signup_utm_medium', label: 'Signup UTM Medium', type: 'multiselect-dynamic' },
      { key: 'signup_utm_campaign', label: 'Signup UTM Campaign', type: 'multiselect-dynamic' },
      { key: 'signup_utm_content', label: 'Signup UTM Content', type: 'multiselect-dynamic' },
      { key: 'first_touch_landing_page', label: 'First-Touch Landing Page', type: 'multiselect-dynamic' },
      { key: 'last_touch_source', label: 'Last-Touch Source', type: 'multiselect-dynamic' },
      { key: 'last_touch_campaign', label: 'Last-Touch Campaign', type: 'multiselect-dynamic' },
      { key: 'last_touch_landing_page', label: 'Last-Touch Landing Page', type: 'multiselect-dynamic' },
    ].map(f => ({ ...f, options: (attributionOptions?.[f.key] ?? []).map(v => ({ value: v, label: v })) })),
    training: [
      { key: 'current_rating', label: 'Current Rating', type: 'multiselect', options: CURRENT_RATING_OPTIONS },
      { key: 'training_stage', label: 'Training Stage', type: 'multiselect', options: TRAINING_STAGE_OPTIONS },
      { key: 'student_type', label: 'Student Type', type: 'multiselect', options: STUDENT_TYPE_OPTIONS },
      { key: 'next_rating_interest', label: 'Next Rating Interest', type: 'multiselect', options: NEXT_RATING_INTEREST_OPTIONS },
      { key: 'primary_focus_area', label: 'Primary Focus Area', type: 'multiselect', options: PRIMARY_FOCUS_AREA_OPTIONS },
      { key: 'primary_aircraft_class', label: 'Primary Aircraft Class', type: 'multiselect', options: PRIMARY_AIRCRAFT_CLASS_OPTIONS },
    ],
    engagement: [
      { key: 'active_within_days', label: 'Portal Active Within', type: 'days-select' },
      { key: 'inactive_at_least_days', label: 'Inactive At Least', type: 'days-select' },
      { key: 'never_logged_in', label: 'Never Logged In', type: 'flag' },
      { key: 'activated', label: 'Activated', type: 'boolean-select', trueLabel: 'Activated', falseLabel: 'Not Activated' },
      { key: 'signed_up_within_days', label: 'Signed Up Within (days)', type: 'number' },
    ],
    readiness: [
      { key: 'completed', label: 'Readiness Assessment', type: 'boolean-select', trueLabel: 'Completed', falseLabel: 'Not completed' },
      { key: 'score_min', label: 'Readiness Score — Min', type: 'number' },
      { key: 'score_max', label: 'Readiness Score — Max', type: 'number' },
      { key: 'readiness_level', label: 'Readiness Level', type: 'multiselect', options: READINESS_LEVEL_OPTIONS },
      { key: 'strongest_category', label: 'Strongest Category', type: 'multiselect', options: READINESS_CATEGORY_OPTIONS },
      { key: 'weakest_category', label: 'Weakest Category', type: 'multiselect', options: READINESS_CATEGORY_OPTIONS },
    ],
    suppression: [
      { key: 'emailed_within_days', label: 'Emailed Within (days)', type: 'number' },
      { key: 'received_email_type', label: 'Received Email Type', type: 'text' },
    ],
  }
}

const DEFAULT_FOR_TYPE = { 'multiselect-dynamic': [], multiselect: [], 'days-select': ENGAGEMENT_DAY_OPTIONS[2], flag: true, 'boolean-select': true, number: '', text: '' }

const BLANK_BUILDER_FILTERS = { checkride: null, acquisition: {}, training: {}, products: {}, engagement: {}, readiness: {}, suppression: {} }

function MultiSelect({ options, value, onChange }) {
  return (
    <select
      multiple
      value={value ?? []}
      onChange={e => onChange(Array.from(e.target.selectedOptions).map(o => o.value))}
      style={{ minWidth: 180, minHeight: 60 }}
    >
      {options.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
    </select>
  )
}

function FilterRow({ label, onRemove, children }) {
  return (
    <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap', padding: '6px 0' }}>
      <span style={{ fontSize: 12, fontWeight: 700, minWidth: 160 }}>{label}</span>
      {children}
      <button type="button" className="btn-link" onClick={onRemove} aria-label={`Remove ${label} filter`}>×</button>
    </div>
  )
}

function GenericFilterGroup({ title, fields, values, onChange }) {
  const activeKeys = Object.keys(values ?? {})
  const availableFields = fields.filter(f => !activeKeys.includes(f.key))

  function addField(key) {
    const field = fields.find(f => f.key === key)
    if (!field) return
    onChange({ ...values, [key]: DEFAULT_FOR_TYPE[field.type] ?? '' })
  }
  function removeField(key) {
    const next = { ...values }
    delete next[key]
    onChange(next)
  }
  function setFieldValue(key, v) {
    onChange({ ...values, [key]: v })
  }

  return (
    <div className="portal-card" style={{ marginBottom: 16 }}>
      <h4 style={{ marginBottom: 8 }}>{title}</h4>
      {activeKeys.map(key => {
        const field = fields.find(f => f.key === key)
        if (!field) return null
        return (
          <FilterRow key={key} label={field.label} onRemove={() => removeField(key)}>
            {field.type === 'multiselect' || field.type === 'multiselect-dynamic' ? (
              <MultiSelect options={field.options} value={values[key]} onChange={v => setFieldValue(key, v)} />
            ) : field.type === 'days-select' ? (
              <select value={values[key]} onChange={e => setFieldValue(key, Number(e.target.value))}>
                {ENGAGEMENT_DAY_OPTIONS.map(d => <option key={d} value={d}>{d} days</option>)}
              </select>
            ) : field.type === 'flag' ? null : field.type === 'boolean-select' ? (
              <select value={String(values[key])} onChange={e => setFieldValue(key, e.target.value === 'true')}>
                <option value="true">{field.trueLabel ?? 'Yes'}</option>
                <option value="false">{field.falseLabel ?? 'No'}</option>
              </select>
            ) : field.type === 'number' ? (
              <input type="number" value={values[key]} onChange={e => setFieldValue(key, e.target.value === '' ? '' : Number(e.target.value))} style={{ width: 90 }} />
            ) : (
              <input type="text" value={values[key]} onChange={e => setFieldValue(key, e.target.value)} />
            )}
          </FilterRow>
        )
      })}
      {availableFields.length > 0 && (
        <select value="" onChange={e => { if (e.target.value) addField(e.target.value) }} style={{ marginTop: 8 }}>
          <option value="">+ Add filter…</option>
          {availableFields.map(f => <option key={f.key} value={f.key}>{f.label}</option>)}
        </select>
      )}
    </div>
  )
}

export default function Broadcast() {
  const { profile } = useAuth()

  const [mode, setMode] = useState('simple') // 'simple' | 'builder'

  // Simple mode (unchanged behavior)
  const [filter, setFilter] = useState('all')
  const [recipientCount, setRecipientCount] = useState(null)
  const [countError, setCountError] = useState('')

  // Shared compose fields
  const [subject, setSubject] = useState('')
  const [message, setMessage] = useState('')
  const [isHtml, setIsHtml] = useState(false)
  const [sending, setSending] = useState(false)
  const [result, setResult] = useState('')
  const [error, setError] = useState('')
  const [testSending, setTestSending] = useState(false)
  const [testResult, setTestResult] = useState('')

  const [history, setHistory] = useState([])
  const [loadingHistory, setLoadingHistory] = useState(true)

  // Audience Builder state
  const [builderFilters, setBuilderFilters] = useState(BLANK_BUILDER_FILTERS)
  const [attributionOptions, setAttributionOptions] = useState(null)
  const [studyPacks, setStudyPacks] = useState([])
  const [preview, setPreview] = useState(null) // { matched_count, eligible_count, opted_out_count, missing_email_count }
  const [previewedSegment, setPreviewedSegment] = useState(null)
  const [previewLoading, setPreviewLoading] = useState(false)
  const [previewError, setPreviewError] = useState('')
  const [showRecipients, setShowRecipients] = useState(false)
  const [recipients, setRecipients] = useState([])
  const [recipientsPage, setRecipientsPage] = useState(0)
  const [recipientsLoading, setRecipientsLoading] = useState(false)
  const [confirmOpen, setConfirmOpen] = useState(false)

  const segment = useMemo(() => buildSegmentDefinition(builderFilters), [builderFilters])
  const audienceLabel = useMemo(() => describeAudience(segment), [segment])
  const stale = isPreviewStale(previewedSegment, segment)
  const RECIPIENTS_PAGE_SIZE = 25

  async function loadHistory() {
    const { data } = await supabase
      .from('admin_broadcasts')
      .select('*, sender:sent_by(full_name)')
      .order('created_at', { ascending: false })
      .limit(20)
    setHistory(data ?? [])
    setLoadingHistory(false)
  }

  useEffect(() => { loadHistory() }, [])

  useEffect(() => {
    let cancelled = false
    setRecipientCount(null)
    setCountError('')
    studentCountQuery(filter).then(({ count, error: countErr }) => {
      if (cancelled) return
      if (countErr) {
        setCountError(countErr.message)
        setRecipientCount(0)
      } else {
        setRecipientCount(count ?? 0)
      }
    })
    return () => { cancelled = true }
  }, [filter])

  useEffect(() => {
    if (mode !== 'builder' || attributionOptions) return
    supabase.rpc('admin_distinct_attribution_values').then(({ data, error: rpcError }) => {
      if (!rpcError && data?.[0]) setAttributionOptions(data[0])
    })
    supabase.from('study_packs').select('id, name').then(({ data }) => setStudyPacks(data ?? []))
  }, [mode, attributionOptions])

  async function runPreview() {
    setPreviewLoading(true)
    setPreviewError('')
    setShowRecipients(false)
    const { data, error: rpcError } = await supabase.rpc('admin_preview_broadcast_audience', { p_segment: segment })
    setPreviewLoading(false)
    if (rpcError) { setPreviewError(rpcError.message); setPreview(null); return }
    setPreview(data?.[0] ?? null)
    setPreviewedSegment(segment)
  }

  async function loadRecipientsPage(page) {
    setRecipientsLoading(true)
    const { data, error: rpcError } = await supabase.rpc('admin_preview_broadcast_recipients', {
      p_segment: previewedSegment, p_limit: RECIPIENTS_PAGE_SIZE, p_offset: page * RECIPIENTS_PAGE_SIZE,
    })
    setRecipientsLoading(false)
    if (rpcError) { setPreviewError(rpcError.message); return }
    setRecipients(data ?? [])
    setRecipientsPage(page)
  }

  async function togglePreviewRecipients() {
    if (showRecipients) { setShowRecipients(false); return }
    setShowRecipients(true)
    await loadRecipientsPage(0)
  }

  async function handleSendTest() {
    if (!profile?.email) { setTestResult("Your admin profile has no email on file."); return }
    setTestSending(true)
    setTestResult('')
    try {
      await sendTestEmail({ toEmail: profile.email, subject, message, isHtml })
      setTestResult(`Test email sent to ${profile.email}.`)
    } catch (err) {
      setTestResult(`Test send failed: ${err.message}`)
    } finally {
      setTestSending(false)
    }
  }

  async function handleSimpleSend(e) {
    e.preventDefault()
    if (!recipientCount) return
    if (!window.confirm(`Send this email to ${recipientCount} student(s)?`)) return

    setSending(true)
    setError('')
    setResult('')
    try {
      const { data: recipients, error: fetchError } = await studentQuery(filter)
      if (fetchError) throw fetchError
      if (!recipients || recipients.length === 0) throw new Error('No matching students to email.')

      const { sent, failed } = await sendAdminEmail({ recipients, subject, message, senderId: profile.id, isHtml })
      if (sent === 0 && failed > 0) {
        setError(`All ${failed} send(s) failed. Nothing was delivered.`)
      } else {
        setResult(failed > 0 ? `Sent to ${sent} student(s) — ${failed} failed to send.` : `Sent to ${sent} student(s).`)
      }
      setSubject('')
      setMessage('')
      setIsHtml(false)
      loadHistory()
    } catch (err) {
      setError(err.message)
    } finally {
      setSending(false)
    }
  }

  async function confirmSendBuilder() {
    setConfirmOpen(false)
    setSending(true)
    setError('')
    setResult('')
    try {
      const { sent, failed, eligibleCount } = await sendSegmentedBroadcast({
        segmentDefinition: previewedSegment, subject, message, isHtml, audienceLabel,
      })
      setResult(failed > 0 ? `Sent to ${sent} of ${eligibleCount} recipients — ${failed} failed to send.` : `Sent to ${sent} recipient(s).`)
      setSubject('')
      setMessage('')
      setIsHtml(false)
      setBuilderFilters(BLANK_BUILDER_FILTERS)
      setPreview(null)
      setPreviewedSegment(null)
      loadHistory()
    } catch (err) {
      setError(err.message)
    } finally {
      setSending(false)
    }
  }

  const fieldConfigs = groupFieldConfigs(attributionOptions)
  const canSendBuilder = !stale && preview && preview.eligible_count > 0 && subject.trim() && message.trim()

  return (
    <Layout>
      <div className="page-header">
        <div>
          <h2 className="page-title">Broadcast</h2>
          <p className="page-sub">Email students directly from the portal</p>
        </div>
      </div>

      <div className="tab-bar" style={{ marginBottom: 20 }}>
        <button className={`tab-btn${mode === 'simple' ? ' tab-btn--active' : ''}`} onClick={() => setMode('simple')}>Simple</button>
        <button className={`tab-btn${mode === 'builder' ? ' tab-btn--active' : ''}`} onClick={() => setMode('builder')}>Audience Builder</button>
      </div>

      {mode === 'simple' ? (
        <form onSubmit={handleSimpleSend} className="modal-form" style={{ maxWidth: 640 }}>
          {error && <div className="form-error">{error}</div>}
          {result && <div className="form-success">{result}</div>}

          <div className="form-group">
            <label>Send To</label>
            <select value={filter} onChange={e => setFilter(e.target.value)}>
              {FILTER_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
            </select>
            <p style={{ fontSize: 12, color: countError ? '#f87171' : 'var(--muted)', marginTop: 6 }}>
              {recipientCount === null ? 'Counting recipients…' : countError ? `Couldn't count recipients: ${countError}` : `${recipientCount} recipient(s)`}
            </p>
          </div>

          <ComposeFields subject={subject} setSubject={setSubject} message={message} setMessage={setMessage} isHtml={isHtml} setIsHtml={setIsHtml} />

          <div className="modal-form__actions">
            <div style={{ marginLeft: 'auto' }}>
              <button type="submit" className="btn-primary-sm" disabled={sending || !recipientCount}>
                {sending ? 'Sending…' : recipientCount ? `Send to ${recipientCount}` : 'Send'}
              </button>
            </div>
          </div>
        </form>
      ) : (
        <div>
          {error && <div className="form-error" style={{ marginBottom: 16 }}>{error}</div>}
          {result && <div className="form-success" style={{ marginBottom: 16 }}>{result}</div>}

          <h3 style={{ marginBottom: 12 }}>Audience</h3>

          {/* Checkride -- bespoke, mode-based shape */}
          <div className="portal-card" style={{ marginBottom: 16 }}>
            <h4 style={{ marginBottom: 8 }}>Checkride</h4>
            {builderFilters.checkride ? (
              <FilterRow label="Checkride Date" onRemove={() => setBuilderFilters({ ...builderFilters, checkride: null })}>
                <select
                  value={builderFilters.checkride.mode}
                  onChange={e => setBuilderFilters({ ...builderFilters, checkride: { mode: e.target.value } })}
                >
                  <option value="within_days">Within Next</option>
                  <option value="exact_range">Exact Date Range</option>
                  <option value="past">Has Passed</option>
                  <option value="none_set">No Date Set</option>
                  <option value="timing_value">Self-Reported Timing</option>
                </select>
                {builderFilters.checkride.mode === 'within_days' && (
                  <select
                    value={builderFilters.checkride.within_days ?? 45}
                    onChange={e => setBuilderFilters({ ...builderFilters, checkride: { ...builderFilters.checkride, within_days: Number(e.target.value) } })}
                  >
                    {CHECKRIDE_WITHIN_DAYS_OPTIONS.map(d => <option key={d} value={d}>{d} days</option>)}
                  </select>
                )}
                {builderFilters.checkride.mode === 'exact_range' && (
                  <>
                    <input type="date" value={builderFilters.checkride.from ?? ''} onChange={e => setBuilderFilters({ ...builderFilters, checkride: { ...builderFilters.checkride, from: e.target.value } })} />
                    <span style={{ fontSize: 12 }}>to</span>
                    <input type="date" value={builderFilters.checkride.to ?? ''} onChange={e => setBuilderFilters({ ...builderFilters, checkride: { ...builderFilters.checkride, to: e.target.value } })} />
                  </>
                )}
                {builderFilters.checkride.mode === 'timing_value' && (
                  <select
                    value={builderFilters.checkride.timing_value ?? CHECKRIDE_TIMING_OPTIONS[0].value}
                    onChange={e => setBuilderFilters({ ...builderFilters, checkride: { ...builderFilters.checkride, timing_value: e.target.value } })}
                  >
                    {CHECKRIDE_TIMING_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
                  </select>
                )}
              </FilterRow>
            ) : (
              <button type="button" className="btn-link" onClick={() => setBuilderFilters({ ...builderFilters, checkride: { mode: 'within_days', within_days: 45 } })}>+ Add filter…</button>
            )}
          </div>

          {/* Products -- bespoke per-field shapes */}
          <div className="portal-card" style={{ marginBottom: 16 }}>
            <h4 style={{ marginBottom: 8 }}>Products</h4>
            {'checkride_prep' in builderFilters.products && (
              <FilterRow label="Checkride Prep" onRemove={() => { const p = { ...builderFilters.products }; delete p.checkride_prep; setBuilderFilters({ ...builderFilters, products: p }) }}>
                <select value={builderFilters.products.checkride_prep} onChange={e => setBuilderFilters({ ...builderFilters, products: { ...builderFilters.products, checkride_prep: e.target.value } })}>
                  <option value="owns">Owns</option>
                  <option value="not_owns">Does Not Own</option>
                </select>
              </FilterRow>
            )}
            {'ground_school' in builderFilters.products && (
              <FilterRow label="Ground School" onRemove={() => { const p = { ...builderFilters.products }; delete p.ground_school; setBuilderFilters({ ...builderFilters, products: p }) }}>
                <select value={builderFilters.products.ground_school} onChange={e => setBuilderFilters({ ...builderFilters, products: { ...builderFilters.products, ground_school: e.target.value } })}>
                  <option value="owns">Owns / Has Access</option>
                  <option value="not_owns">Does Not Own</option>
                </select>
              </FilterRow>
            )}
            {'study_pack' in builderFilters.products && (
              <FilterRow label="Study Pack" onRemove={() => { const p = { ...builderFilters.products }; delete p.study_pack; setBuilderFilters({ ...builderFilters, products: p }) }}>
                <select
                  value={builderFilters.products.study_pack.mode}
                  onChange={e => setBuilderFilters({ ...builderFilters, products: { ...builderFilters.products, study_pack: { ...builderFilters.products.study_pack, mode: e.target.value } } })}
                >
                  <option value="owns_any">Owns Any</option>
                  <option value="owns_specific">Owns Specific</option>
                  <option value="not_owns_specific">Does Not Own Specific</option>
                </select>
                {builderFilters.products.study_pack.mode !== 'owns_any' && (
                  <select
                    value={builderFilters.products.study_pack.pack_id ?? ''}
                    onChange={e => setBuilderFilters({ ...builderFilters, products: { ...builderFilters.products, study_pack: { ...builderFilters.products.study_pack, pack_id: e.target.value } } })}
                  >
                    <option value="">Select pack…</option>
                    {studyPacks.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
                  </select>
                )}
              </FilterRow>
            )}
            {'mock_oral' in builderFilters.products && (
              <FilterRow label="Mock Oral Booking" onRemove={() => { const p = { ...builderFilters.products }; delete p.mock_oral; setBuilderFilters({ ...builderFilters, products: p }) }}>
                <select value={builderFilters.products.mock_oral} onChange={e => setBuilderFilters({ ...builderFilters, products: { ...builderFilters.products, mock_oral: e.target.value } })}>
                  <option value="any">Booked (Any)</option>
                  <option value="none">No Booking</option>
                  <option value="upcoming">Upcoming Booking</option>
                  <option value="completed">Completed Booking</option>
                </select>
              </FilterRow>
            )}
            {'customer_status' in builderFilters.products && (
              <FilterRow label="Customer Status" onRemove={() => { const p = { ...builderFilters.products }; delete p.customer_status; setBuilderFilters({ ...builderFilters, products: p }) }}>
                <select value={builderFilters.products.customer_status} onChange={e => setBuilderFilters({ ...builderFilters, products: { ...builderFilters.products, customer_status: e.target.value } })}>
                  <option value="purchased_any">Has Purchased Any Product</option>
                  <option value="never_purchased">Has Never Purchased</option>
                </select>
              </FilterRow>
            )}
            {(() => {
              const missing = ['checkride_prep', 'ground_school', 'study_pack', 'mock_oral', 'customer_status'].filter(k => !(k in builderFilters.products))
              if (!missing.length) return null
              const labels = { checkride_prep: 'Checkride Prep', ground_school: 'Ground School', study_pack: 'Study Pack', mock_oral: 'Mock Oral Booking', customer_status: 'Customer Status' }
              const defaults = { checkride_prep: 'owns', ground_school: 'owns', study_pack: { mode: 'owns_any' }, mock_oral: 'none', customer_status: 'purchased_any' }
              return (
                <select value="" onChange={e => { if (e.target.value) setBuilderFilters({ ...builderFilters, products: { ...builderFilters.products, [e.target.value]: defaults[e.target.value] } }) }}>
                  <option value="">+ Add filter…</option>
                  {missing.map(k => <option key={k} value={k}>{labels[k]}</option>)}
                </select>
              )
            })()}
          </div>

          <GenericFilterGroup title="Acquisition" fields={fieldConfigs.acquisition} values={builderFilters.acquisition} onChange={v => setBuilderFilters({ ...builderFilters, acquisition: v })} />
          <GenericFilterGroup title="Training" fields={fieldConfigs.training} values={builderFilters.training} onChange={v => setBuilderFilters({ ...builderFilters, training: v })} />
          <GenericFilterGroup title="Engagement" fields={fieldConfigs.engagement} values={builderFilters.engagement} onChange={v => setBuilderFilters({ ...builderFilters, engagement: v })} />
          <GenericFilterGroup title="Readiness" fields={fieldConfigs.readiness} values={builderFilters.readiness} onChange={v => setBuilderFilters({ ...builderFilters, readiness: v })} />
          <GenericFilterGroup title="Suppression" fields={fieldConfigs.suppression} values={builderFilters.suppression} onChange={v => setBuilderFilters({ ...builderFilters, suppression: v })} />

          {isSegmentEmpty(segment) && (
            <p style={{ fontSize: 13, color: 'var(--muted)', marginBottom: 12 }}>
              No filters added. This audience currently includes all marketing-eligible members.
            </p>
          )}

          <div className="portal-card" style={{ marginBottom: 20, background: 'rgba(11,31,58,0.03)' }}>
            <h4 style={{ marginBottom: 8 }}>Audience Preview</h4>
            <p style={{ fontSize: 13, fontWeight: 700, marginBottom: 10 }}>{audienceLabel}</p>
            <button type="button" className="btn-secondary" onClick={runPreview} disabled={previewLoading}>
              {previewLoading ? 'Previewing…' : 'Preview Audience'}
            </button>
            {previewError && <div className="form-error" style={{ marginTop: 10 }}>{previewError}</div>}
            {preview && !stale && (
              <div style={{ marginTop: 14, fontSize: 14 }}>
                <p>Matched: <strong>{preview.matched_count}</strong></p>
                <p>Eligible: <strong>{preview.eligible_count}</strong></p>
                <p>Opted out: {preview.opted_out_count}</p>
                <p>No email: {preview.missing_email_count}</p>
                {isBroadAudience(preview.eligible_count) && (
                  <div className="form-error" style={{ marginTop: 8 }}>
                    This audience contains {preview.eligible_count} recipients. Review the recipient list before sending.
                  </div>
                )}
                <button type="button" className="btn-link" onClick={togglePreviewRecipients} style={{ marginTop: 8 }}>
                  {showRecipients ? 'Hide Recipients' : 'Preview Recipients'}
                </button>
              </div>
            )}
            {preview && stale && (
              <p style={{ marginTop: 10, fontSize: 13, color: '#f59e0b' }}>Filters changed since the last preview — preview again before sending.</p>
            )}
          </div>

          {showRecipients && !stale && (
            <div className="table-scroll" style={{ marginBottom: 20 }}>
              <table className="admin-table">
                <thead>
                  <tr>
                    <th>Name</th><th>Email</th><th>Checkride</th><th>Rating</th><th>Stage</th>
                    <th>Source</th><th>Last Active</th><th>Products</th><th>Readiness</th>
                  </tr>
                </thead>
                <tbody>
                  {recipientsLoading ? (
                    <tr><td colSpan={9} style={{ color: 'var(--muted)' }}>Loading…</td></tr>
                  ) : recipients.length === 0 ? (
                    <tr><td colSpan={9} style={{ color: 'var(--muted)' }}>No recipients on this page.</td></tr>
                  ) : recipients.map(r => (
                    <tr key={r.profile_id}>
                      <td>{r.full_name || '—'}</td>
                      <td>{r.email}</td>
                      <td>{r.checkride_date ?? '—'}</td>
                      <td>{r.current_rating ?? '—'}</td>
                      <td>{r.training_stage ?? '—'}</td>
                      <td>{r.last_touch_source ?? '—'}</td>
                      <td>{r.portal_last_active_at ? new Date(r.portal_last_active_at).toLocaleDateString() : 'Never'}</td>
                      <td>
                        {[r.checkride_prep_unlocked && 'Prep', r.ground_school_unlocked && 'GS', r.mock_oral_status !== 'none' && `Mock Oral: ${r.mock_oral_status}`].filter(Boolean).join(', ') || '—'}
                      </td>
                      <td>{r.readiness_score != null ? `${r.readiness_score} (${r.readiness_level})` : '—'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              <div style={{ display: 'flex', gap: 10, marginTop: 10 }}>
                <button type="button" className="btn-secondary" disabled={recipientsPage === 0} onClick={() => loadRecipientsPage(recipientsPage - 1)}>Previous</button>
                <button type="button" className="btn-secondary" disabled={recipients.length < RECIPIENTS_PAGE_SIZE} onClick={() => loadRecipientsPage(recipientsPage + 1)}>Next</button>
              </div>
            </div>
          )}

          <h3 style={{ marginBottom: 12 }}>Compose</h3>
          <div className="modal-form" style={{ maxWidth: 640, marginBottom: 20 }}>
            <ComposeFields subject={subject} setSubject={setSubject} message={message} setMessage={setMessage} isHtml={isHtml} setIsHtml={setIsHtml} />
            {testResult && <p style={{ fontSize: 13, marginBottom: 10 }}>{testResult}</p>}
            <div className="modal-form__actions">
              <button type="button" className="btn-secondary" disabled={testSending || !subject.trim() || !message.trim()} onClick={handleSendTest}>
                {testSending ? 'Sending Test…' : 'Send Test Email'}
              </button>
              <div style={{ marginLeft: 'auto' }}>
                <button type="button" className="btn-primary-sm" disabled={!canSendBuilder || sending} onClick={() => setConfirmOpen(true)}>
                  {sending ? 'Sending…' : 'Send Broadcast'}
                </button>
              </div>
            </div>
          </div>

          {confirmOpen && (
            <div className="modal-overlay" onClick={() => setConfirmOpen(false)}>
              <div className="modal" onClick={e => e.stopPropagation()}>
                <div className="modal__header"><h3 className="modal__title">Send broadcast?</h3></div>
                <div className="modal__body">
                  <p><strong>Subject:</strong> {subject}</p>
                  <p><strong>Audience:</strong> {audienceLabel}</p>
                  <p><strong>Recipients:</strong> {preview?.eligible_count} eligible members</p>
                  <div className="modal-form__actions" style={{ marginTop: 20 }}>
                    <button type="button" className="btn-secondary" onClick={() => setConfirmOpen(false)}>Cancel</button>
                    <button type="button" className="btn-primary-sm" disabled={sending} onClick={confirmSendBuilder}>
                      {sending ? 'Sending…' : `Send ${preview?.eligible_count} Emails`}
                    </button>
                  </div>
                </div>
              </div>
            </div>
          )}
        </div>
      )}

      <h3 style={{ marginTop: 40, marginBottom: 16 }}>Recent Broadcasts</h3>
      {loadingHistory ? <p className="empty-state">Loading…</p> : history.length === 0 ? (
        <p className="empty-state">No broadcasts sent yet.</p>
      ) : (
        <div className="table-wrap">
          <table className="data-table">
            <thead>
              <tr><th>Subject</th><th>Audience</th><th>Recipients</th><th>Sent By</th><th>Date</th></tr>
            </thead>
            <tbody>
              {history.map(b => (
                <tr key={b.id}>
                  <td>{b.subject}</td>
                  <td>{b.audience_label ?? 'All Students (simple)'}</td>
                  <td>{b.recipient_count}</td>
                  <td>{b.sender?.full_name ?? '—'}</td>
                  <td>{new Date(b.created_at).toLocaleString()}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Layout>
  )
}

function ComposeFields({ subject, setSubject, message, setMessage, isHtml, setIsHtml }) {
  return (
    <>
      <div className="form-group">
        <label>Subject</label>
        <input type="text" value={subject} onChange={e => setSubject(e.target.value)} required placeholder="e.g. New feature in your portal" />
      </div>

      <div className="form-group">
        <label>Message</label>
        <textarea
          value={message}
          onChange={e => setMessage(e.target.value)}
          rows={8}
          required
          placeholder={isHtml ? '<p>Write your HTML…</p>' : 'Write your message…'}
          style={isHtml ? { fontFamily: 'monospace', fontSize: 13 } : undefined}
        />
      </div>

      <div className="form-group">
        <label style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer' }}>
          <input type="checkbox" checked={isHtml} onChange={e => setIsHtml(e.target.checked)} />
          This message is HTML
        </label>
      </div>

      {isHtml && message && (
        <div className="form-group">
          <label>Preview</label>
          <iframe
            title="Email HTML preview"
            srcDoc={message}
            sandbox=""
            style={{ width: '100%', height: 220, border: '1px solid var(--border, #333)', borderRadius: 6, background: '#fff' }}
          />
        </div>
      )}
    </>
  )
}
