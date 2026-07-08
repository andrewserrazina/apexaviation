/**
 * @typedef {Object} OperationsEvent
 * @property {string} time
 * @property {string} type
 * @property {string} resource
 * @property {string} status
 *
 * @typedef {Object} Aircraft
 * @property {string} tail
 * @property {string} model
 * @property {string} status
 * @property {string} due
 *
 * @typedef {Object} InstructorProfile
 * @property {string} name
 * @property {string} role
 * @property {string} status
 *
 * @typedef {Object} StudentOperationsProfile
 * @property {string} name
 * @property {string} stage
 * @property {string} next
 *
 * @typedef {Object} MaintenanceItem
 * @property {string} item
 * @property {string} status
 */

export const operationsRoles = ['admin', 'instructor']

export const operationsNavItems = [
  { to: '/operations/dashboard', label: 'Dashboard' },
  { to: '/operations/schedule', label: 'Schedule' },
  { to: '/operations/simulator', label: 'Simulator' },
  { to: '/operations/aircraft', label: 'Aircraft' },
  { to: '/operations/instructors', label: 'Instructors' },
  { to: '/operations/students', label: 'Students' },
  { to: '/operations/maintenance', label: 'Maintenance' },
  { to: '/operations/leads', label: 'Leads' },
  { to: '/operations/settings', label: 'Settings' },
]

export const operationsStats = [
  { label: 'Today’s Schedule', value: '6 events', detail: 'Flights, simulator, and ground lessons' },
  { label: 'Simulator Status', value: 'Ready', detail: 'Redbird FMX / AATD workflow placeholder' },
  { label: 'Aircraft Status', value: '3 available', detail: 'Fleet availability snapshot' },
  { label: 'Instructor Availability', value: '4 on duty', detail: 'Availability model pending' },
  { label: 'Active Students', value: '28', detail: 'Operations-side student roster' },
  { label: 'Recent Activity', value: '12 updates', detail: 'Schedule, squawk, and lead activity' },
]

export const todaySchedule = [
  { time: '08:00', type: 'Flight', resource: 'N172AP', status: 'Scheduled' },
  { time: '10:30', type: 'Simulator', resource: 'Redbird FMX', status: 'Ready' },
  { time: '13:00', type: 'Ground Lesson', resource: 'Briefing Room', status: 'Scheduled' },
]

export const aircraftList = [
  { tail: 'N172AP', model: 'Cessna 172', status: 'Available', due: '100-hour due in 18.2 hrs' },
  { tail: 'N738AV', model: 'Cessna 172', status: 'Reserved', due: 'Annual due next month' },
  { tail: 'N901AX', model: 'Piper Archer', status: 'Maintenance', due: 'Open squawk review' },
]

export const instructorList = [
  { name: 'Instructor Roster', role: 'CFI / CFII', status: 'Availability pending' },
  { name: 'Check Instructor', role: 'Senior CFI', status: 'Assigned students pending' },
  { name: 'Ground Instructor', role: 'AGI', status: 'Ground school availability pending' },
]

export const operationsStudents = [
  { name: 'Active Student', stage: 'Pre-solo', next: 'Upcoming lesson placeholder' },
  { name: 'Instrument Student', stage: 'Cross-country', next: 'Documents placeholder' },
  { name: 'Discovery Lead Converted', stage: 'Onboarding', next: 'Training plan setup' },
]

export const maintenanceItems = [
  { item: 'Aircraft inspections', status: 'Upcoming due items placeholder' },
  { item: 'Simulator maintenance', status: 'Maintenance notes placeholder' },
  { item: 'Open squawks', status: 'Squawk triage placeholder' },
  { item: 'Due items', status: 'No due tracking connected yet' },
]

export const leadPipeline = [
  'New Inquiry',
  'Discovery Call Scheduled',
  'Tour Scheduled',
  'Enrollment Pending',
  'Enrolled',
  'Lost / Not a Fit',
]

export const operationsSettings = [
  'Location settings',
  'Scheduling rules',
  'Instructor permissions',
  'Resource settings',
  'Notification settings',
]
