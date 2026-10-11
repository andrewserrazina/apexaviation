// Apex Advantage native design tokens.
//
// Colors are taken verbatim from AGENTS.md's "Follow Apex branding
// exactly" section. Typography is NOT taken verbatim from AGENTS.md:
// that doc states Body = Inter, but both shipped apps (site/styles.css
// and portal/src/styles.css) import and use Montserrat for body text
// (Playfair Display for headings, matching AGENTS.md) -- there is zero
// trace of Inter anywhere in either real, deployed app. Per this Sprint's
// own instruction to inspect shipped typography and report a conflict
// rather than guess: this is a real conflict between AGENTS.md and the
// actually-shipped brand, and the shipped brand wins here (Montserrat),
// exactly as it does on the web and portal today. See
// SPRINT_1A_MOBILE_VERTICAL_SLICE_REPORT.md for the full writeup.
//
// Dark re-theme (parity pass): the mobile app previously ran an inverted
// color scheme from the real web/portal -- light gray screens, white
// cards, navy text. Web's actual shipped design (site/styles.css,
// portal/src/styles.css) is a DARK navy theme: near-black page
// background (#080f1e), navy-2/navy-3 card surfaces, translucent white
// text, gold as the one accent. Every value below is taken from that
// real, deployed CSS, not invented -- background/surface/surfaceAlt
// mirror web's three navy elevation tiers exactly, textPrimary/
// textSecondary mirror its translucent-white text tokens, and success/
// warning/danger/info mirror its actual semantic colors (which are
// brighter pastel tones tuned to read on navy, not mobile's old
// darker-for-white-backgrounds versions). goldDeep is updated to web's
// own --gold-2 hex rather than mobile's previously independently-chosen
// shade.
export const colors = {
  navy: '#0B1F3A',
  gold: '#F4B400',
  white: '#FFFFFF',
  lightGray: '#F5F7FA',
  darkGray: '#2D3748',

  // Three-tier dark elevation system, darkest to lightest -- matches
  // web's --off-white/body-bg, --navy-2, --navy-3 exactly (site/
  // styles.css, portal/src/styles.css). Screens sit on `background`;
  // cards float above it on `surface`; a card nested inside a card (rare)
  // uses `surfaceAlt`. `navy` itself (#0B1F3A) sits between background
  // and surface in lightness, which is why hero bars/headers using it
  // directly already read correctly as their own elevation tier.
  background: '#080F1E',
  surface: '#162C4F',
  surfaceAlt: '#1E3B68',

  // Derived, not in AGENTS.md verbatim, but needed for a real interface --
  // tints/shades of the two brand colors and the neutral scale only,
  // never a hue AGENTS.md doesn't already name.
  navyDeep: '#071527',
  // Soft neutral overlay (icon badges, inactive pills, etc.) -- was a
  // light tint of navy for a white background; now the equivalent role
  // on a dark background is a light tint of white, matching web's own
  // rgba(255,255,255,…) overlay convention.
  navySoft: 'rgba(255, 255, 255, 0.08)',
  navyBorder: 'rgba(255, 255, 255, 0.09)',
  goldSoft: 'rgba(244, 180, 0, 0.14)',
  goldLight: '#F9D04A',
  goldDeep: '#D4920A',
  border: 'rgba(255, 255, 255, 0.09)',
  // Primary translucent-white body text and secondary/muted text --
  // web's --text and --gray tokens exactly.
  textPrimary: 'rgba(255, 255, 255, 0.85)',
  mutedText: 'rgba(255, 255, 255, 0.55)',
  // Label text for content sitting on a solid gold fill (buttons,
  // avatar initials) -- matches the portal app's own gold-button
  // convention (dark navy text on gold), not the marketing site's white-
  // on-gold variant, since this is the portal experience being ported.
  textOnGold: '#0B1F3A',
  success: '#34D399',
  successSoft: 'rgba(52, 211, 153, 0.15)',
  warning: '#F4B400',
  warningSoft: 'rgba(244, 180, 0, 0.15)',
  danger: '#F87171',
  dangerSoft: 'rgba(239, 68, 68, 0.15)',
  info: '#60A5FA',
  infoSoft: 'rgba(96, 165, 250, 0.15)',
} as const

export const fonts = {
  // Headings -- matches AGENTS.md and both shipped apps.
  heading: 'PlayfairDisplay_700Bold',
  headingItalic: 'PlayfairDisplay_400Regular_Italic',
  // Body -- matches the ACTUALLY SHIPPED brand (Montserrat), not
  // AGENTS.md's stated "Inter" (see the header comment above).
  body: 'Montserrat_400Regular',
  bodyMedium: 'Montserrat_500Medium',
  bodySemiBold: 'Montserrat_600SemiBold',
  bodyBold: 'Montserrat_700Bold',
  bodyExtraBold: 'Montserrat_800ExtraBold',
} as const

export const spacing = {
  xs: 4,
  sm: 8,
  md: 16,
  lg: 24,
  xl: 32,
  xxl: 48,
} as const

export const radii = {
  sm: 8,
  md: 12,
  // Matches web's --radius-lg (20px) exactly.
  lg: 20,
  pill: 999,
} as const

export const type = {
  display: { fontSize: 28, lineHeight: 34 },
  title: { fontSize: 22, lineHeight: 28 },
  subtitle: { fontSize: 17, lineHeight: 24 },
  body: { fontSize: 15, lineHeight: 22 },
  caption: { fontSize: 13, lineHeight: 18 },
  label: { fontSize: 12, lineHeight: 16, letterSpacing: 0.6 },
} as const

// Dark-theme shadows read very differently than light-theme ones -- a
// navy-tinted shadow against a navy/near-black background barely shows
// at all, so this is now a true black shadow at low opacity (matching
// web's own --shadow: 0 4px 24px rgba(0,0,0,.4)), with the card's
// border doing most of the work of separating it from the background
// rather than the shadow alone.
export const shadow = {
  card: {
    shadowColor: '#000000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.4,
    shadowRadius: 12,
    elevation: 4,
  },
} as const
