import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'
import Layout from '../components/Layout'
import Modal from '../components/Modal'

const BLANK_CATEGORY = { id: '', label: '', section_label: '', intro: '', sort_order: 0 }
const BLANK_QUESTION = {
  id: '', question: '', model_answer: '', common_mistakes: '', dpe_evaluating: '',
  acs_reference: '', real_world_application: '', is_scenario: false, scenario_order: '', sort_order: 0,
}

// New categories start with no questions of their own, so there's no
// existing id prefix to continue -- falling back to the category id
// itself (e.g. "commercial-maneuvers-1") is a reasonable default that
// stays unique and legible without requiring the admin to invent one.
function suggestQuestionId(categoryId, questions) {
  const inCategory = questions.filter(q => q.category === categoryId)
  let prefix = categoryId
  let maxNum = 0
  for (const q of inCategory) {
    const m = q.id.match(/^(.+)-(\d+)$/)
    if (m) {
      prefix = m[1]
      const n = parseInt(m[2], 10)
      if (n > maxNum) maxNum = n
    }
  }
  return `${prefix}-${maxNum + 1}`
}

function nextSortOrder(items) {
  return items.reduce((max, item) => Math.max(max, item.sort_order ?? -1), -1) + 1
}

export default function DpeContent() {
  const [categories, setCategories] = useState([])
  const [questions, setQuestions] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  const [categoryModal, setCategoryModal] = useState(null) // { mode: 'create' | 'edit', category }
  const [categoryForm, setCategoryForm] = useState(BLANK_CATEGORY)

  const [questionsModal, setQuestionsModal] = useState(null) // { category }
  const [questionModal, setQuestionModal] = useState(null) // { mode: 'create' | 'edit', category, question }
  const [questionForm, setQuestionForm] = useState(BLANK_QUESTION)

  const [saving, setSaving] = useState(false)
  const [formError, setFormError] = useState('')

  async function load() {
    setError('')
    const [{ data: cats, error: catErr }, { data: qs, error: qErr }] = await Promise.all([
      supabase.from('dpe_categories').select('*').order('sort_order'),
      supabase.from('dpe_questions').select('*').order('sort_order'),
    ])
    if (catErr) setError(catErr.message)
    else if (qErr) setError(qErr.message)
    setCategories(cats ?? [])
    setQuestions(qs ?? [])
    setLoading(false)
  }

  useEffect(() => { load() }, [])

  // ── Category CRUD ──
  function openCreateCategory() {
    setCategoryForm({ ...BLANK_CATEGORY, sort_order: nextSortOrder(categories) })
    setFormError('')
    setCategoryModal({ mode: 'create' })
  }

  function openEditCategory(category) {
    setCategoryForm({
      id: category.id, label: category.label, section_label: category.section_label,
      intro: category.intro ?? '', sort_order: category.sort_order ?? 0,
    })
    setFormError('')
    setCategoryModal({ mode: 'edit', category })
  }

  function closeCategoryModal() { setCategoryModal(null); setFormError('') }

  async function handleCategorySave(e) {
    e.preventDefault(); setSaving(true); setFormError('')
    const payload = {
      label: categoryForm.label,
      section_label: categoryForm.section_label,
      intro: categoryForm.intro || null,
      sort_order: parseInt(categoryForm.sort_order, 10) || 0,
    }
    let saveError
    if (categoryModal.mode === 'create') {
      ;({ error: saveError } = await supabase.from('dpe_categories').insert({ id: categoryForm.id, ...payload }))
    } else {
      ;({ error: saveError } = await supabase.from('dpe_categories').update(payload).eq('id', categoryModal.category.id))
    }
    setSaving(false)
    if (saveError) { setFormError(saveError.message); return }
    closeCategoryModal(); load()
  }

  async function handleDeleteCategory() {
    const count = questions.filter(q => q.category === categoryModal.category.id).length
    if (count > 0) {
      setFormError(`Move or delete its ${count} question(s) first.`)
      return
    }
    if (!window.confirm(`Delete the "${categoryModal.category.label}" category?`)) return
    const { error: delError } = await supabase.from('dpe_categories').delete().eq('id', categoryModal.category.id)
    if (delError) { setFormError(delError.message); return }
    closeCategoryModal(); load()
  }

  // ── Question CRUD ──
  function openQuestions(category) {
    setQuestionsModal({ category })
  }

  function closeQuestionsModal() { setQuestionsModal(null) }

  function openCreateQuestion(category) {
    const catQuestions = questions.filter(q => q.category === category.id)
    setQuestionForm({
      ...BLANK_QUESTION,
      id: suggestQuestionId(category.id, questions),
      sort_order: nextSortOrder(catQuestions),
    })
    setFormError('')
    setQuestionModal({ mode: 'create', category })
  }

  function openEditQuestion(category, question) {
    setQuestionForm({
      id: question.id,
      question: question.question,
      model_answer: question.model_answer ?? '',
      common_mistakes: question.common_mistakes ?? '',
      dpe_evaluating: question.dpe_evaluating ?? '',
      acs_reference: question.acs_reference ?? '',
      real_world_application: question.real_world_application ?? '',
      is_scenario: !!question.is_scenario,
      scenario_order: question.scenario_order ?? '',
      sort_order: question.sort_order ?? 0,
    })
    setFormError('')
    setQuestionModal({ mode: 'edit', category, question })
  }

  function closeQuestionModal() { setQuestionModal(null); setFormError('') }

  async function handleQuestionSave(e) {
    e.preventDefault(); setSaving(true); setFormError('')
    const payload = {
      category: questionModal.category.id,
      question: questionForm.question,
      model_answer: questionForm.model_answer,
      common_mistakes: questionForm.common_mistakes || null,
      dpe_evaluating: questionForm.dpe_evaluating || null,
      acs_reference: questionForm.acs_reference || null,
      real_world_application: questionForm.real_world_application || null,
      is_scenario: questionForm.is_scenario,
      scenario_order: questionForm.scenario_order === '' ? null : parseInt(questionForm.scenario_order, 10),
      sort_order: parseInt(questionForm.sort_order, 10) || 0,
    }
    let saveError
    if (questionModal.mode === 'create') {
      ;({ error: saveError } = await supabase.from('dpe_questions').insert({ id: questionForm.id, ...payload }))
    } else {
      ;({ error: saveError } = await supabase.from('dpe_questions').update(payload).eq('id', questionModal.question.id))
    }
    setSaving(false)
    if (saveError) { setFormError(saveError.message); return }
    closeQuestionModal()
    await load()
    // Keep the questions list modal open and in sync with the same category.
    setQuestionsModal(m => m ? { category: m.category } : m)
  }

  async function handleDeleteQuestion() {
    if (!window.confirm('Delete this question?')) return
    const { error: delError } = await supabase.from('dpe_questions').delete().eq('id', questionModal.question.id)
    if (delError) { setFormError(delError.message); return }
    closeQuestionModal()
    await load()
    setQuestionsModal(m => m ? { category: m.category } : m)
  }

  const modalQuestions = questionsModal
    ? questions.filter(q => q.category === questionsModal.category.id).sort((a, b) => (a.sort_order ?? 0) - (b.sort_order ?? 0))
    : []

  return (
    <Layout>
      <div className="page-header">
        <div>
          <h2 className="page-title">DPE Question Bank</h2>
          <p className="page-sub">Manage the categories and oral-exam questions shown in the Apex Advantage portal</p>
        </div>
        <button className="btn-primary-sm" onClick={openCreateCategory}>+ New Category</button>
      </div>

      {error && <div className="form-error" style={{ marginBottom: 20 }}>{error}</div>}

      {loading ? <p className="empty-state">Loading…</p> : categories.length === 0 ? (
        <p className="empty-state">No categories yet.</p>
      ) : (
        <div className="syllabus-grid">
          {categories.map(cat => {
            const count = questions.filter(q => q.category === cat.id).length
            return (
              <div key={cat.id} className="syllabus-card">
                <div className="syllabus-card__head">
                  <p className="syllabus-card__name">{cat.label}</p>
                  <span className="badge">{count} question{count === 1 ? '' : 's'}</span>
                </div>
                <p className="syllabus-card__desc">{cat.section_label}</p>
                {cat.intro && <p className="syllabus-card__desc">{cat.intro}</p>}
                <div className="syllabus-card__actions">
                  <button className="btn-link" onClick={() => openQuestions(cat)}>Questions</button>
                  <button className="btn-link" onClick={() => openEditCategory(cat)}>Edit</button>
                </div>
              </div>
            )
          })}
        </div>
      )}

      {/* ── CATEGORY MODAL ── */}
      {categoryModal && (
        <Modal title={categoryModal.mode === 'create' ? 'New Category' : 'Edit Category'} onClose={closeCategoryModal}>
          <form onSubmit={handleCategorySave} className="modal-form">
            {formError && <div className="form-error">{formError}</div>}
            <div className="form-group">
              <label>Category ID</label>
              <input
                type="text" value={categoryForm.id}
                onChange={e => setCategoryForm(f => ({ ...f, id: e.target.value.trim() }))}
                required disabled={categoryModal.mode === 'edit'}
                placeholder="e.g. commercial-maneuvers"
              />
            </div>
            <div className="form-group">
              <label>Label</label>
              <input type="text" value={categoryForm.label} onChange={e => setCategoryForm(f => ({ ...f, label: e.target.value }))} required placeholder="e.g. Commercial Maneuvers" />
            </div>
            <div className="form-group">
              <label>Section Label</label>
              <input type="text" value={categoryForm.section_label} onChange={e => setCategoryForm(f => ({ ...f, section_label: e.target.value }))} required placeholder="e.g. Section 11" />
            </div>
            <div className="form-group">
              <label>Intro</label>
              <textarea value={categoryForm.intro} onChange={e => setCategoryForm(f => ({ ...f, intro: e.target.value }))} rows={3} placeholder="Optional framing shown above this section's questions…" />
            </div>
            <div className="form-group">
              <label>Sort Order</label>
              <input type="number" value={categoryForm.sort_order} onChange={e => setCategoryForm(f => ({ ...f, sort_order: e.target.value }))} />
            </div>
            <div className="modal-form__actions">
              {categoryModal.mode === 'edit' && <button type="button" className="btn-danger" onClick={handleDeleteCategory}>Delete</button>}
              <div style={{ marginLeft: 'auto', display: 'flex', gap: 8 }}>
                <button type="button" className="btn-secondary" onClick={closeCategoryModal}>Cancel</button>
                <button type="submit" className="btn-primary-sm" disabled={saving}>{saving ? 'Saving…' : categoryModal.mode === 'create' ? 'Create' : 'Save'}</button>
              </div>
            </div>
          </form>
        </Modal>
      )}

      {/* ── QUESTIONS LIST MODAL ── */}
      {questionsModal && (
        <Modal title={`Questions — ${questionsModal.category.label}`} onClose={closeQuestionsModal} wide>
          <div className="modal-form__actions" style={{ marginBottom: 16, paddingTop: 0, borderTop: 'none' }}>
            <div style={{ marginLeft: 'auto' }}>
              <button className="btn-primary-sm" onClick={() => openCreateQuestion(questionsModal.category)}>+ New Question</button>
            </div>
          </div>
          {modalQuestions.length === 0 ? (
            <p className="empty-state" style={{ padding: '12px 0' }}>No questions in this category yet.</p>
          ) : (
            modalQuestions.map((q, i) => (
              <div key={q.id} className="activity-row">
                <div style={{ flex: 1 }}>
                  <p className="activity-row__primary">{i + 1}. {q.question}</p>
                  <p className="activity-row__sub">
                    {q.id}{q.is_scenario ? ' · 🎬 Scenario' : ''}{q.acs_reference ? ` · ${q.acs_reference}` : ''}
                  </p>
                </div>
                <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexShrink: 0 }}>
                  <button className="btn-link" onClick={() => openEditQuestion(questionsModal.category, q)}>Edit</button>
                </div>
              </div>
            ))
          )}
        </Modal>
      )}

      {/* ── QUESTION FORM MODAL ── */}
      {questionModal && (
        <Modal title={questionModal.mode === 'create' ? 'New Question' : 'Edit Question'} onClose={closeQuestionModal} wide>
          <form onSubmit={handleQuestionSave} className="modal-form">
            {formError && <div className="form-error">{formError}</div>}
            <div className="form-group">
              <label>Question ID</label>
              <input
                type="text" value={questionForm.id}
                onChange={e => setQuestionForm(f => ({ ...f, id: e.target.value.trim() }))}
                required disabled={questionModal.mode === 'edit'}
              />
            </div>
            <div className="form-group">
              <label>Question</label>
              <textarea value={questionForm.question} onChange={e => setQuestionForm(f => ({ ...f, question: e.target.value }))} rows={2} required placeholder="The question as read aloud by the DPE…" />
            </div>
            <div className="form-group">
              <label>Model Answer</label>
              <textarea value={questionForm.model_answer} onChange={e => setQuestionForm(f => ({ ...f, model_answer: e.target.value }))} rows={4} required />
            </div>
            <div className="form-group">
              <label>Common Student Mistakes</label>
              <textarea value={questionForm.common_mistakes} onChange={e => setQuestionForm(f => ({ ...f, common_mistakes: e.target.value }))} rows={2} />
            </div>
            <div className="form-group">
              <label>What the DPE Is Evaluating</label>
              <textarea value={questionForm.dpe_evaluating} onChange={e => setQuestionForm(f => ({ ...f, dpe_evaluating: e.target.value }))} rows={2} />
            </div>
            <div className="form-group">
              <label>ACS Reference</label>
              <input type="text" value={questionForm.acs_reference} onChange={e => setQuestionForm(f => ({ ...f, acs_reference: e.target.value }))} placeholder="e.g. Area of Operation I, Task A — Pilot Qualifications (Knowledge)." />
            </div>
            <div className="form-group">
              <label>Real-World Application</label>
              <textarea value={questionForm.real_world_application} onChange={e => setQuestionForm(f => ({ ...f, real_world_application: e.target.value }))} rows={2} />
            </div>
            <div className="form-row">
              <div className="form-group">
                <label style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer' }}>
                  <input type="checkbox" checked={questionForm.is_scenario} onChange={e => setQuestionForm(f => ({ ...f, is_scenario: e.target.checked }))} />
                  Scenario-style question
                </label>
              </div>
              <div className="form-group">
                <label>Sort Order</label>
                <input type="number" value={questionForm.sort_order} onChange={e => setQuestionForm(f => ({ ...f, sort_order: e.target.value }))} />
              </div>
            </div>
            <div className="modal-form__actions">
              {questionModal.mode === 'edit' && <button type="button" className="btn-danger" onClick={handleDeleteQuestion}>Delete</button>}
              <div style={{ marginLeft: 'auto', display: 'flex', gap: 8 }}>
                <button type="button" className="btn-secondary" onClick={closeQuestionModal}>Cancel</button>
                <button type="submit" className="btn-primary-sm" disabled={saving}>{saving ? 'Saving…' : questionModal.mode === 'create' ? 'Create' : 'Save'}</button>
              </div>
            </div>
          </form>
        </Modal>
      )}
    </Layout>
  )
}
