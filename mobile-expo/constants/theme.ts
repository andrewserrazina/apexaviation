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

export const colors = {
  navy: '#0B1F3A',
  gold: '#F4B400',
  white: '#FFFFFF',
  lightGray: '#F5F7FA',
  darkGray: '#2D3748',

  // Derived, not in AGENTS.md verbatim, but needed for a real interface --
  // tints/shades of the two brand colors and the neutral scale only,
  // never a hue AGENTS.md doesn't already name.
  navyDeep: '#071527',
  navySoft: 'rgba(11, 31, 58, 0.06)',
  navyBorder: 'rgba(11, 31, 58, 0.12)',
  goldSoft: 'rgba(244, 180, 0, 0.14)',
  goldDeep: '#C48F00',
  border: '#E2E8F0',
  mutedText: '#64748B',
  success: '#1E7A4C',
  successSoft: 'rgba(30, 122, 76, 0.12)',
  warning: '#B7791F',
  warningSoft: 'rgba(183, 121, 31, 0.12)',
  danger: '#B42318',
  dangerSoft: 'rgba(180, 35, 24, 0.10)',
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
  lg: 16,
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

export const shadow = {
  card: {
    shadowColor: colors.navy,
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.08,
    shadowRadius: 12,
    elevation: 2,
  },
} as const
