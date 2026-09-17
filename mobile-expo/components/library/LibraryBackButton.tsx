import { Button } from '../Button'

// The pack detail screen switches between its own local sub-views
// (lesson/scenario/checkride corner/mastery check/quick reference)
// without an Expo Router navigation -- there is no screen-stack "back" to
// rely on there, so every sub-view needs this explicit in-content back
// control, matching the web Study Pack renderer's own
// `data-sp-back-home` button (site/portal-stable.js).
export function LibraryBackButton({ label, onPress }: { label: string; onPress: () => void }) {
  return <Button label={`← ${label}`} variant="ghost" onPress={onPress} />
}
