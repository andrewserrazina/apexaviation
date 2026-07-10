// Structured from PrivateCurriculum.md (Apex Advantage Ground School
// Framework -- 21 modules, 7 phases). PrivateCurriculum.md previously
// held a different, incorrect 14-module document that didn't reflect
// the actual curriculum; both this file and the live syllabus data
// were built from that wrong version until corrected. Keep this file
// aligned with PrivateCurriculum.md; do not invent or rewrite module
// content here.
//
// Each module is the schedulable unit (one 2-hour class session per
// module, per the framework's own Class Duration Recommendation), so
// there's no finer-grained "lessons within a module" list the way the
// old, wrong source document had -- one module = one lesson here.

export const PRIVATE_PILOT_COURSE = {
  id: 'PPL',
  title: 'Apex Advantage Private Pilot Ground School',
}

export const privatePilotModules = [
  { id: 'PPL-M01', phase: 'Phase 1: Pilot Foundations', title: 'Becoming a Pilot', purpose: 'Orient the student to the certification path, the learning model they\'re entering, and the mindset of professional pilots — before a single regulation or system is taught.' },
  { id: 'PPL-M02', phase: 'Phase 1: Pilot Foundations', title: 'Aerodynamics', purpose: 'Build an intuitive, physically-grounded understanding of why an airplane flies and how pilot inputs change its behavior — the foundation for every maneuver discussed later.' },
  { id: 'PPL-M03', phase: 'Phase 1: Pilot Foundations', title: 'Aircraft Systems', purpose: 'Give students a working, troubleshooting-level understanding of the systems in their training aircraft, with emphasis on the PA-28 family and glass-panel variants.' },
  { id: 'PPL-M04', phase: 'Phase 2: Airspace & Regulations', title: 'FARs Simplified', purpose: 'Translate the regulations a private pilot actually uses day-to-day into plain language and operational habits, rather than rote rule memorization.' },
  { id: 'PPL-M05', phase: 'Phase 2: Airspace & Regulations', title: 'Airspace Mastery', purpose: 'Build fluent, chart-independent recall of the U.S. airspace system so students can identify requirements and make go/no-go decisions instantly.' },
  { id: 'PPL-M06', phase: 'Phase 2: Airspace & Regulations', title: 'Airport Operations', purpose: 'Develop safe, professional airport operating habits — from taxi to pattern entry to radio communication — at both towered and non-towered fields.' },
  { id: 'PPL-M07', phase: 'Phase 3: Navigation', title: 'Sectional Charts', purpose: 'Build fluency reading and interpreting sectional charts as a primary situational awareness tool, independent of GPS.' },
  { id: 'PPL-M08', phase: 'Phase 3: Navigation', title: 'Pilotage & Dead Reckoning', purpose: 'Teach the foundational, no-technology navigation skills every pilot needs as a backup when electronics fail.' },
  { id: 'PPL-M09', phase: 'Phase 3: Navigation', title: 'Navigation Systems', purpose: 'Build proficient, real-world use of modern avionics for navigation, building on the manual skills from Module 8.' },
  { id: 'PPL-M10', phase: 'Phase 4: Weather', title: 'Weather Theory', purpose: 'Build a physical, intuitive understanding of atmospheric behavior so weather products become predictable instead of memorized symbols.' },
  { id: 'PPL-M11', phase: 'Phase 4: Weather', title: 'Weather Products', purpose: 'Build fast, confident interpretation of the weather briefing products a private pilot uses for every go/no-go decision.' },
  { id: 'PPL-M12', phase: 'Phase 4: Weather', title: 'Weather Decision Making', purpose: 'Convert weather knowledge into real go/no-go and in-flight diversion judgment — the single highest-stakes decision category for private pilots.' },
  { id: 'PPL-M13', phase: 'Phase 5: Performance & Flight Planning', title: 'Weight & Balance', purpose: 'Build precise, error-checked weight and balance calculation skills and an understanding of why CG location matters aerodynamically.' },
  { id: 'PPL-M14', phase: 'Phase 5: Performance & Flight Planning', title: 'Aircraft Performance', purpose: 'Build the ability to predict and verify real aircraft performance for takeoff, landing, and cruise — and to recognize when performance is marginal.' },
  { id: 'PPL-M15', phase: 'Phase 5: Performance & Flight Planning', title: 'Cross-Country Planning', purpose: 'Integrate navigation, weather, performance, and regulatory knowledge into a single complete cross-country flight plan, mirroring the checkride planning task.' },
  { id: 'PPL-M16', phase: 'Phase 6: Risk Management', title: 'Aeronautical Decision Making', purpose: 'Teach structured decision-making frameworks that hold up under time pressure, building the judgment the checkride oral is specifically designed to probe.' },
  { id: 'PPL-M17', phase: 'Phase 6: Risk Management', title: 'Human Factors', purpose: 'Build awareness of the physiological and psychological factors that degrade pilot performance, many of which are invisible without training.' },
  { id: 'PPL-M18', phase: 'Phase 6: Risk Management', title: 'Emergency Procedures', purpose: 'Build calm, checklist-driven emergency response habits through repetition, so reaction under real stress defaults to trained procedure rather than panic.' },
  { id: 'PPL-M19', phase: 'Phase 7: Checkride Success', title: 'ACS Mastery', purpose: 'Make the ACS itself a working tool the student can navigate confidently, understanding exactly how they\'ll be evaluated on both knowledge and skill.' },
  { id: 'PPL-M20', phase: 'Phase 7: Checkride Success', title: 'Mock Oral Exam', purpose: 'Simulate the real pressure, pacing, and unpredictability of a DPE oral exam in a low-stakes setting, with direct feedback on both content and communication style.' },
  { id: 'PPL-M21', phase: 'Phase 7: Checkride Success', title: 'Practical Test Success', purpose: 'Finalize logistical, procedural, and psychological readiness for checkride day itself, closing the loop on "Train Beyond the Checkride."' },
]

export const privatePilotLessons = privatePilotModules.map((module, index) => ({
  id: module.id,
  courseId: PRIVATE_PILOT_COURSE.id,
  courseTitle: PRIVATE_PILOT_COURSE.title,
  moduleId: module.id,
  // The module's own name (e.g. "Aerodynamics"), not the phase --
  // this flows straight into scheduled_ground_classes.module_title,
  // which is the category badge students see when browsing Ground
  // School. Phase grouping is exposed separately (below) for dropdown
  // context only, so every module keeps a distinct, meaningful badge
  // instead of 3+ modules all showing the same phase name.
  moduleTitle: module.title,
  phase: module.phase,
  title: `Module ${index + 1}: ${module.title}`,
  overview: module.purpose,
}))

export function getPrivatePilotLesson(lessonId) {
  return privatePilotLessons.find(lesson => lesson.id === lessonId)
}
