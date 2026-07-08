// Structured from PrivateCurriculum.md (Apex Advantage Private Pilot Master Curriculum, July 2026).
// Keep this file aligned with the source curriculum document; do not invent or rewrite lesson content here.

const PRIVATE_PILOT_COURSE = {
  id: 'PPL',
  title: 'Apex Advantage Private Pilot Ground School',
}

const privatePilotModules = [
  {
    id: 'PPL-M01',
    title: 'Introduction to Aviation',
    objectives: ['Understand certificate requirements', 'Explain pilot privileges and limitations', 'Understand training expectations', 'Identify required documents and records'],
    lessons: ['Pilot Certificates', 'Student Pilot Requirements', 'Medical Certificates', 'Currency vs Proficiency', 'Required Documents', 'Logging Flight Time'],
    resources: ['Certificate Path Guide', 'Training Roadmap'],
  },
  {
    id: 'PPL-M02',
    title: 'Aerodynamics',
    objectives: ['Explain how aircraft fly', 'Understand lift, weight, thrust, and drag', 'Explain stall behavior', 'Understand stability and control'],
    lessons: ['Four Forces of Flight', 'Bernoulli and Newton', 'Angle of Attack', 'Stalls and Spins', 'Stability', 'Load Factor'],
    resources: ['Aerodynamics Quick Reference Sheet'],
  },
  {
    id: 'PPL-M03',
    title: 'Aircraft Systems',
    objectives: ['Explain major aircraft systems', 'Identify system failures', 'Understand operational implications'],
    lessons: ['Engine System', 'Fuel System', 'Electrical System', 'Vacuum System', 'Pitot-Static System', 'Environmental Systems'],
    resources: ['Aircraft Systems Cheat Sheet'],
  },
  {
    id: 'PPL-M04',
    title: 'Flight Instruments',
    objectives: ['Explain all six flight instruments', 'Understand instrument failures', 'Understand pitot-static errors'],
    lessons: ['Airspeed Indicator', 'Attitude Indicator', 'Altimeter', 'Turn Coordinator', 'Heading Indicator', 'VSI'],
    resources: ['Instrument Systems Reference Guide'],
  },
  {
    id: 'PPL-M05',
    title: 'Airspace',
    objectives: ['Identify all airspace classifications', 'Explain operating requirements', 'Interpret sectional charts'],
    lessons: ['Class A', 'Class B', 'Class C', 'Class D', 'Class E', 'Class G', 'Special Use Airspace'],
    resources: ['Airspace Quick Reference Guide'],
  },
  {
    id: 'PPL-M06',
    title: 'Weather',
    objectives: ['Interpret weather products', 'Understand weather hazards', 'Make sound go/no-go decisions'],
    lessons: ['Atmosphere Basics', 'Fronts', 'Clouds', 'Thunderstorms', 'Icing', 'Fog', 'Weather Briefings', 'METARs', 'TAFs'],
    resources: ['Weather Decoding Guide'],
  },
  {
    id: 'PPL-M07',
    title: 'Performance and Limitations',
    objectives: ['Calculate aircraft performance', 'Understand environmental impacts', 'Identify aircraft limitations'],
    lessons: ['Density Altitude', 'Takeoff Performance', 'Landing Performance', 'Climb Performance', 'Aircraft Limitations'],
    resources: ['Performance Planning Worksheet'],
  },
  {
    id: 'PPL-M08',
    title: 'Weight and Balance',
    objectives: ['Calculate weight and balance', 'Explain CG effects', 'Identify unsafe loading conditions'],
    lessons: ['Weight Definitions', 'Moment Calculations', 'Center of Gravity', 'Loading Scenarios'],
    resources: ['Weight and Balance Worksheet'],
  },
  {
    id: 'PPL-M09',
    title: 'Navigation',
    objectives: ['Navigate using charts and pilotage', 'Use dead reckoning techniques', 'Understand VOR navigation', 'Understand GPS fundamentals'],
    lessons: ['Sectional Charts', 'Pilotage', 'Dead Reckoning', 'VOR Navigation', 'GPS Navigation'],
    resources: ['Navigation Planning Guide'],
  },
  {
    id: 'PPL-M10',
    title: 'Regulations',
    objectives: ['Understand Part 61 and Part 91', 'Explain pilot responsibilities', 'Apply regulations to real-world situations'],
    lessons: ['Certificates and Documents', 'Required Inspections', 'Required Equipment', 'Flight Review Requirements', 'Passenger Carrying Currency'],
    resources: ['Regulations Cheat Sheet'],
  },
  {
    id: 'PPL-M11',
    title: 'Aeromedical Factors',
    objectives: ['Recognize physiological hazards', 'Apply risk mitigation strategies'],
    lessons: ['Hypoxia', 'Hyperventilation', 'Spatial Disorientation', 'Motion Sickness', 'Fatigue', 'IMSAFE Checklist'],
    resources: ['IMSAFE Reference Card'],
  },
  {
    id: 'PPL-M12',
    title: 'Aeronautical Decision Making',
    objectives: ['Apply risk management principles', 'Make sound aeronautical decisions'],
    lessons: ['ADM Fundamentals', 'PAVE', 'CARE', 'TEAM', 'DECIDE Model', 'Risk Assessment'],
    resources: ['ADM Quick Reference Guide'],
  },
  {
    id: 'PPL-M13',
    title: 'Cross Country Planning',
    objectives: ['Plan complete VFR cross-country flights', 'Calculate fuel and performance', 'Conduct flight planning'],
    lessons: ['Route Selection', 'Weather Planning', 'Fuel Planning', 'Diversion Planning', 'Flight Logs'],
    resources: ['Cross Country Planning Workbook'],
  },
  {
    id: 'PPL-M14',
    title: 'Checkride Preparation',
    objectives: ['Prepare for the oral exam', 'Understand checkride expectations', 'Build confidence'],
    lessons: ['Checkride Process', 'ACS Overview', 'Common DPE Questions', 'Common Applicant Errors', 'Day-of-Checkride Strategy'],
    resources: ['Apex Advantage Checkride Prep Pack', 'Oral Exam Study Guide', 'ACS Success Checklist'],
  },
]


const privatePilotLessons = privatePilotModules.flatMap(function (module) {
  return module.lessons.map(function (lessonTitle, index) {
    return {
      id: module.id + '-L' + String(index + 1).padStart(2, '0'),
      courseId: PRIVATE_PILOT_COURSE.id,
      courseTitle: PRIVATE_PILOT_COURSE.title,
      moduleId: module.id,
      moduleTitle: module.title,
      title: lessonTitle,
      overview: 'Module: ' + module.title + '. Objectives: ' + module.objectives.join('; ') + '.',
    };
  });
});

window.APEX_PRIVATE_PILOT_CURRICULUM = {
  course: PRIVATE_PILOT_COURSE,
  modules: privatePilotModules,
  lessons: privatePilotLessons,
  getLesson: function (lessonId) {
    return privatePilotLessons.find(function (lesson) { return lesson.id === lessonId; });
  }
};
