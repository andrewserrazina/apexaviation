import { useEffect, useState } from 'react'
import NetInfo from '@react-native-community/netinfo'

// Thin wrapper over NetInfo -- the app's first connectivity-aware hook
// (confirmed zero existing connectivity code before Phase 4). Optimistic
// default (true) until the first event arrives, matching how every other
// mobile-* hook in this codebase starts from a non-blocking assumption
// rather than a defensive loading gate for something that resolves in a
// single tick on a real device.
//
// isInternetReachable can be `null` on some platforms/timings (NetInfo
// hasn't finished its reachability probe yet) -- only an explicit
// `false` on either field is treated as offline, never null-as-offline,
// so a transient probe gap can't flip a genuinely online device into a
// false "offline copy" banner.
export function useIsOnline(): boolean {
  const [isOnline, setIsOnline] = useState(true)

  useEffect(() => {
    const unsubscribe = NetInfo.addEventListener((state) => {
      setIsOnline(state.isConnected !== false && state.isInternetReachable !== false)
    })
    return unsubscribe
  }, [])

  return isOnline
}
