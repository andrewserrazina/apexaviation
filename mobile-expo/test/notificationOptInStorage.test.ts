// Sprint 1C Rev2: this flag is the actual fix for "OS permission !=
// account consent" -- these tests use AsyncStorage's own official Jest
// mock (a real in-memory implementation), matching
// activePracticeStorage.test.ts's precedent, so they exercise genuine
// read/write/corruption behavior rather than just proving mocked calls
// happened.
jest.mock('@react-native-async-storage/async-storage', () => require('@react-native-async-storage/async-storage/jest/async-storage-mock'))

import AsyncStorage from '@react-native-async-storage/async-storage'
import { loadNotificationOptIn, saveNotificationOptIn } from '../lib/notificationOptInStorage'

beforeEach(async () => {
  await AsyncStorage.clear()
})

it('defaults to false/not-opted-in for an account that has never enabled notifications', async () => {
  await expect(loadNotificationOptIn('u1')).resolves.toBe(false)
})

it('persists true after an explicit opt-in and loads it back for the same user', async () => {
  await saveNotificationOptIn('u1', true)
  await expect(loadNotificationOptIn('u1')).resolves.toBe(true)
})

it('persists false after an explicit opt-out', async () => {
  await saveNotificationOptIn('u1', true)
  await saveNotificationOptIn('u1', false)
  await expect(loadNotificationOptIn('u1')).resolves.toBe(false)
})

it('scopes opt-in per user -- a different user id never inherits another user’s true value', async () => {
  await saveNotificationOptIn('user-a', true)
  await expect(loadNotificationOptIn('user-b')).resolves.toBe(false)
  await expect(loadNotificationOptIn('user-a')).resolves.toBe(true)
})

it('fails closed to not-opted-in on corrupted stored JSON', async () => {
  await AsyncStorage.setItem('apex-advantage-notifications-opt-in:u1', '{not valid json')
  await expect(loadNotificationOptIn('u1')).resolves.toBe(false)
})

it('fails closed to not-opted-in on a malformed (non-boolean) stored value', async () => {
  await AsyncStorage.setItem('apex-advantage-notifications-opt-in:u1', JSON.stringify('yes'))
  await expect(loadNotificationOptIn('u1')).resolves.toBe(false)
  await AsyncStorage.setItem('apex-advantage-notifications-opt-in:u1', JSON.stringify(1))
  await expect(loadNotificationOptIn('u1')).resolves.toBe(false)
  await AsyncStorage.setItem('apex-advantage-notifications-opt-in:u1', JSON.stringify(null))
  await expect(loadNotificationOptIn('u1')).resolves.toBe(false)
})
