export default function LoadingState({ label = 'Loading…', fullScreen = false }) {
  return (
    <div className={fullScreen ? 'loading-screen' : 'loading-state'} role="status" aria-live="polite">
      <div className="spinner" aria-hidden="true" />
      <span className="sr-only">{label}</span>
    </div>
  )
}
