// Checkride Prep's Apple in-app purchase product id. This is NOT a
// price or a guess -- it's a plain string identifier that must be
// registered, exactly as written here, as a non-consumable in-app
// purchase in App Store Connect before any purchase can succeed. The
// server independently validates every verified transaction's
// productId against its own copy of this same string
// (APPLE_IAP_PRODUCT_ID, see apple-iap-verify-purchase/index.ts) --
// changing it here alone does nothing without also updating that env
// var and App Store Connect's own product record.
//
// See this project's Apple IAP implementation report for the exact
// App Store Connect setup checklist.
export const CHECKRIDE_PREP_PRODUCT_ID = 'com.apexaviationtx.advantage.checkride_prep'
