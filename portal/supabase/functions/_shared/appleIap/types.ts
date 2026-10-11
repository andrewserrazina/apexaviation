// Field names and enum values below are transcribed field-for-field from
// Apple's own open-source, MIT-licensed app-store-server-library (Node),
// not guessed or approximated -- see e.g.
// https://github.com/apple/app-store-server-library-node/blob/main/models/JWSTransactionDecodedPayload.ts
// and the sibling Environment.ts/Type.ts/RevocationReason.ts/
// NotificationTypeV2.ts/Data.ts/ResponseBodyV2DecodedPayload.ts in that
// same repo. Only the fields this codebase actually reads are kept; the
// full payload has many more (subscription/offer/Advanced-Commerce
// fields) that don't apply to a single non-consumable product.

export enum AppleEnvironment {
  Sandbox = 'Sandbox',
  Production = 'Production',
  Xcode = 'Xcode',
  LocalTesting = 'LocalTesting',
}

export enum AppleProductType {
  AutoRenewableSubscription = 'Auto-Renewable Subscription',
  NonConsumable = 'Non-Consumable',
  Consumable = 'Consumable',
  NonRenewingSubscription = 'Non-Renewing Subscription',
}

export enum AppleRevocationReason {
  RefundedDueToIssue = 1,
  RefundedForOtherReason = 0,
}

export enum AppleNotificationTypeV2 {
  Subscribed = 'SUBSCRIBED',
  DidChangeRenewalPref = 'DID_CHANGE_RENEWAL_PREF',
  DidChangeRenewalStatus = 'DID_CHANGE_RENEWAL_STATUS',
  OfferRedeemed = 'OFFER_REDEEMED',
  DidRenew = 'DID_RENEW',
  Expired = 'EXPIRED',
  DidFailToRenew = 'DID_FAIL_TO_RENEW',
  GracePeriodExpired = 'GRACE_PERIOD_EXPIRED',
  PriceIncrease = 'PRICE_INCREASE',
  Refund = 'REFUND',
  RefundDeclined = 'REFUND_DECLINED',
  ConsumptionRequest = 'CONSUMPTION_REQUEST',
  RenewalExtended = 'RENEWAL_EXTENDED',
  Revoke = 'REVOKE',
  Test = 'TEST',
  RenewalExtension = 'RENEWAL_EXTENSION',
  RefundReversed = 'REFUND_REVERSED',
  ExternalPurchaseToken = 'EXTERNAL_PURCHASE_TOKEN',
  OneTimeCharge = 'ONE_TIME_CHARGE',
  RescindConsent = 'RESCIND_CONSENT',
  MetadataUpdate = 'METADATA_UPDATE',
  Migration = 'MIGRATION',
  PriceChange = 'PRICE_CHANGE',
}

// https://developer.apple.com/documentation/appstoreserverapi/jwstransactiondecodedpayload
export interface AppleJWSTransactionDecodedPayload {
  originalTransactionId?: string
  transactionId?: string
  webOrderLineItemId?: string
  bundleId?: string
  productId?: string
  purchaseDate?: number
  originalPurchaseDate?: number
  quantity?: number
  type?: AppleProductType | string
  appAccountToken?: string
  inAppOwnershipType?: string
  signedDate?: number
  revocationReason?: AppleRevocationReason | number
  revocationDate?: number
  isUpgraded?: boolean
  environment?: AppleEnvironment | string
  storefront?: string
  storefrontId?: string
  currency?: string
  price?: number
  appTransactionId?: string
}

// https://developer.apple.com/documentation/appstoreservernotifications/data
export interface AppleNotificationData {
  environment?: AppleEnvironment | string
  appAppleId?: number
  bundleId?: string
  bundleVersion?: string
  signedTransactionInfo?: string
  signedRenewalInfo?: string
}

// https://developer.apple.com/documentation/appstoreservernotifications/responsebodyv2decodedpayload
export interface AppleResponseBodyV2DecodedPayload {
  notificationType?: AppleNotificationTypeV2 | string
  subtype?: string
  notificationUUID?: string
  data?: AppleNotificationData
  version?: string
  signedDate?: number
}

// https://developer.apple.com/documentation/appstoreserverapi/transactioninforesponse
export interface AppleTransactionInfoResponse {
  signedTransactionInfo?: string
}
