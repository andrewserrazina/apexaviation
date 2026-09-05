// LargeSecureStore -- Supabase's own officially documented session storage
// adapter for Expo/React Native (supabase.com/docs "Expo React Native"
// tutorial), reviewed against the CURRENT docs as of this Sprint.
//
// WHY THIS OVER PLAIN AsyncStorage: Supabase's plain React Native
// quickstart uses @react-native-async-storage/async-storage directly,
// which is simple but stores the session (including the refresh token)
// as cleartext JSON on disk. Supabase's dedicated Expo tutorial instead
// documents this exact pattern: encrypt the session blob with AES-256
// before it ever reaches AsyncStorage, and keep the AES key itself in
// expo-secure-store (iOS Keychain / Android Keystore). expo-secure-store
// alone cannot hold the session directly -- it caps individual values at
// 2048 bytes, and a Supabase session (access token + refresh token +
// user metadata) routinely exceeds that. This hybrid gets SecureStore's
// hardware-backed key protection AND AsyncStorage's unbounded size limit.
// Chosen here over plain AsyncStorage specifically because this app
// persists a real learner session (Checkride Prep is paid, premium
// content) on a personal phone that may be lost, shared, or backed up
// unencrypted by the OS -- the encryption-at-rest this buys is worth the
// small extra complexity for that threat model.
import * as SecureStore from 'expo-secure-store'
import AsyncStorage from '@react-native-async-storage/async-storage'
import * as aesjs from 'aes-js'
import 'react-native-get-random-values'

const KEY_PREFIX = 'apex-advantage-session-key-'

export class LargeSecureStore {
  private async getEncryptionKey(storageKey: string): Promise<Uint8Array> {
    const secureKeyName = KEY_PREFIX + storageKey
    const existingKeyHex = await SecureStore.getItemAsync(secureKeyName)
    if (existingKeyHex) return aesjs.utils.hex.toBytes(existingKeyHex)

    const keyBytes = new Uint8Array(32)
    crypto.getRandomValues(keyBytes)
    const generatedKeyHex: string = aesjs.utils.hex.fromBytes(keyBytes)
    await SecureStore.setItemAsync(secureKeyName, generatedKeyHex)
    return aesjs.utils.hex.toBytes(generatedKeyHex)
  }

  async getItem(key: string): Promise<string | null> {
    const encrypted = await AsyncStorage.getItem(key)
    if (!encrypted) return null

    try {
      const encryptionKey = await this.getEncryptionKey(key)
      const [ivHex, dataHex] = encrypted.split(':')
      if (!ivHex || !dataHex) return null
      const iv = aesjs.utils.hex.toBytes(ivHex)
      const encryptedBytes = aesjs.utils.hex.toBytes(dataHex)
      const cipher = new aesjs.ModeOfOperation.ctr(encryptionKey, new aesjs.Counter(iv))
      const decryptedBytes = cipher.decrypt(encryptedBytes)
      return aesjs.utils.utf8.fromBytes(decryptedBytes)
    } catch {
      // A key that can no longer decrypt this value (device restore,
      // corrupted keychain entry, app reinstall that cleared SecureStore
      // but not AsyncStorage) means the stored session is unusable --
      // treat it as "no session" rather than crash. supabase-js will then
      // behave exactly as it does for any signed-out device.
      await this.removeItem(key)
      return null
    }
  }

  async setItem(key: string, value: string): Promise<void> {
    const encryptionKey = await this.getEncryptionKey(key)
    const iv = new Uint8Array(16)
    crypto.getRandomValues(iv)
    const cipher = new aesjs.ModeOfOperation.ctr(encryptionKey, new aesjs.Counter(iv))
    const encryptedBytes = cipher.encrypt(aesjs.utils.utf8.toBytes(value))
    const ivHex = aesjs.utils.hex.fromBytes(iv)
    const dataHex = aesjs.utils.hex.fromBytes(encryptedBytes)
    await AsyncStorage.setItem(key, `${ivHex}:${dataHex}`)
  }

  async removeItem(key: string): Promise<void> {
    await AsyncStorage.removeItem(key)
    await SecureStore.deleteItemAsync(KEY_PREFIX + key)
  }
}
