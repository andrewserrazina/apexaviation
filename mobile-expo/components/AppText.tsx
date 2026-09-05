import { Text, type TextProps, type TextStyle } from 'react-native'
import { colors, fonts, type as typeScale } from '../constants/theme'

type Variant = 'display' | 'title' | 'subtitle' | 'body' | 'caption' | 'label'
type Weight = 'regular' | 'medium' | 'semibold' | 'bold'

interface AppTextProps extends TextProps {
  variant?: Variant
  weight?: Weight
  heading?: boolean
  color?: string
  center?: boolean
}

const weightToFont: Record<Weight, string> = {
  regular: fonts.body,
  medium: fonts.bodyMedium,
  semibold: fonts.bodySemiBold,
  bold: fonts.bodyBold,
}

// Every piece of text in the app should render through this component
// rather than raw <Text> with ad-hoc styles -- it's what keeps Playfair
// Display reserved for headings and Montserrat for body text consistent
// everywhere, and gives every screen automatic dynamic-type support
// (allowFontScaling defaults true on RN <Text>, so this doesn't disable
// it -- see Sprint 1A section 19, accessibility).
export function AppText({ variant = 'body', weight = 'regular', heading = false, color, center, style, ...rest }: AppTextProps) {
  const scale = typeScale[variant]
  const textStyle: TextStyle = {
    fontFamily: heading ? fonts.heading : weightToFont[weight],
    fontSize: scale.fontSize,
    lineHeight: scale.lineHeight,
    color: color ?? colors.navy,
    textAlign: center ? 'center' : undefined,
    letterSpacing: 'letterSpacing' in scale ? scale.letterSpacing : undefined,
  }
  return <Text style={[textStyle, style]} {...rest} />
}
