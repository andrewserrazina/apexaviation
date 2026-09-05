// React 19's `act()` gates all state-update warnings behind
// `globalThis.IS_REACT_ACT_ENVIRONMENT` (see
// https://github.com/reactwg/react-18/discussions/102). @testing-library/
// react-native's `render`/`renderHook` only flips this flag on for the
// duration of their own synchronous `act()` wrapper -- an async state
// update inside a hook's own `useEffect` (e.g. AuthContext's
// getSession().then(...)) resolves after that window closes, which is
// exactly the "not configured to support act(...)" warning this fixes by
// keeping the flag on for the whole test file.
;(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
