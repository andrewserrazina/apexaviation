import Constants from 'expo-constants'

// Sprint 1C Phase 5 stop gate: this repo has no eas.json and app.json has
// no extra.eas.projectId (confirmed by searching the whole repo) -- a
// real Expo push token cannot be obtained on this SDK without one
// (getExpoPushTokenAsync requires it). Deliberately reads this
// defensively rather than assuming it exists, so the rest of the push
// registration flow can fail safely with a clear "not configured yet"
// state instead of throwing when it's absent.
export function getEasProjectId(): string | null {
  const projectId = Constants.expoConfig?.extra?.eas?.projectId
  return typeof projectId === 'string' && projectId.length > 0 ? projectId : null
}
