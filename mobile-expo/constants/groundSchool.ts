// Ground School curriculum metadata (Phase 3) -- a hand-ported copy of
// site/portal-stable.js's own GUIDED_NOTES_MODULES catalog-level fields
// (courseId/moduleId/moduleLabel only; the courseLabel is always
// 'Private Pilot' and every guided-note PROMPT text itself lives
// server-side in module_companion_content.content.guidedNotes, never
// duplicated here). This is a table of contents, not lesson content --
// AGENTS.md's "never rewrite aviation lessons" instruction is about the
// authored curriculum text itself, which stays exclusively server-side
// and is never edited by this file.
//
// Mirrors mobile-ground-school's own MODULE_IDS list (kept independently
// server-side, same as get-module-companion-content never sharing a
// canonical module list with the client today) -- if a module is ever
// added or renamed, update both.
export interface GroundSchoolModuleDef {
  courseId: 'PPL'
  moduleId: string
  moduleLabel: string
}

export const GROUND_SCHOOL_MODULES: GroundSchoolModuleDef[] = [
  { courseId: 'PPL', moduleId: 'PPL-M01', moduleLabel: 'Module 01 · Becoming a Pilot' },
  { courseId: 'PPL', moduleId: 'PPL-M02', moduleLabel: 'Module 02 · Aerodynamics' },
  { courseId: 'PPL', moduleId: 'PPL-M03', moduleLabel: 'Module 03 · Aircraft Systems' },
  { courseId: 'PPL', moduleId: 'PPL-M04', moduleLabel: 'Module 04 · FARs Simplified' },
  { courseId: 'PPL', moduleId: 'PPL-M05', moduleLabel: 'Module 05 · Airspace Mastery' },
  { courseId: 'PPL', moduleId: 'PPL-M06', moduleLabel: 'Module 06 · Airport Operations' },
  { courseId: 'PPL', moduleId: 'PPL-M07', moduleLabel: 'Module 07 · Sectional Charts' },
  { courseId: 'PPL', moduleId: 'PPL-M08', moduleLabel: 'Module 08 · Pilotage & Dead Reckoning' },
  { courseId: 'PPL', moduleId: 'PPL-M09', moduleLabel: 'Module 09 · Navigation Systems' },
  { courseId: 'PPL', moduleId: 'PPL-M10', moduleLabel: 'Module 10 · Weather Theory' },
  { courseId: 'PPL', moduleId: 'PPL-M11', moduleLabel: 'Module 11 · Weather Products' },
  { courseId: 'PPL', moduleId: 'PPL-M12', moduleLabel: 'Module 12 · Weather Decision Making' },
  { courseId: 'PPL', moduleId: 'PPL-M13', moduleLabel: 'Module 13 · Weight & Balance' },
  { courseId: 'PPL', moduleId: 'PPL-M14', moduleLabel: 'Module 14 · Aircraft Performance' },
  { courseId: 'PPL', moduleId: 'PPL-M15', moduleLabel: 'Module 15 · Cross-Country Planning' },
  { courseId: 'PPL', moduleId: 'PPL-M16', moduleLabel: 'Module 16 · Aeronautical Decision Making' },
  { courseId: 'PPL', moduleId: 'PPL-M17', moduleLabel: 'Module 17 · Human Factors' },
  { courseId: 'PPL', moduleId: 'PPL-M18', moduleLabel: 'Module 18 · Emergency Procedures' },
  { courseId: 'PPL', moduleId: 'PPL-M19', moduleLabel: 'Module 19 · ACS Mastery' },
  { courseId: 'PPL', moduleId: 'PPL-M20', moduleLabel: 'Module 20 · Mock Oral Exam' },
]

export function groundSchoolModuleDef(moduleId: string): GroundSchoolModuleDef | null {
  return GROUND_SCHOOL_MODULES.find((m) => m.moduleId === moduleId) ?? null
}
