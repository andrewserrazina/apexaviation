import type { AnchorHTMLAttributes, ButtonHTMLAttributes, ReactNode } from 'react'
import { cx } from '../../utils/cx'
import './Button.css'

export type ButtonVariant = 'primary' | 'ghost' | 'outline'

interface SharedProps {
  /** Visual style. Primary is solid gold, ghost is transparent with a white
   * border, outline is transparent with a gold border. */
  variant?: ButtonVariant
  /** Shrinks padding/font-size for use in the top nav bar. */
  nav?: boolean
  /** Stretches the button to fill its container width. */
  fullWidth?: boolean
  children: ReactNode
  className?: string
}

export type ButtonProps = SharedProps &
  Omit<ButtonHTMLAttributes<HTMLButtonElement>, keyof SharedProps> & { href?: undefined }

export type ButtonLinkProps = SharedProps &
  Omit<AnchorHTMLAttributes<HTMLAnchorElement>, keyof SharedProps> & { href: string }

/** Primary call-to-action control. Renders a `<button>` by default, or an
 * `<a>` when an `href` is supplied (e.g. "Create Your Free Account" CTAs
 * that navigate to portal-login.html). */
export function Button(props: ButtonProps | ButtonLinkProps) {
  const { variant = 'primary', nav = false, fullWidth = false, className, children, ...rest } = props
  const classes = cx(
    'apex-btn',
    `apex-btn--${variant}`,
    nav && 'apex-btn--nav',
    fullWidth && 'apex-btn--full',
    className,
  )

  if ('href' in rest && rest.href !== undefined) {
    const { href, ...anchorRest } = rest as AnchorHTMLAttributes<HTMLAnchorElement>
    return (
      <a href={href} className={classes} {...anchorRest}>
        {children}
      </a>
    )
  }

  return (
    <button className={classes} {...(rest as ButtonHTMLAttributes<HTMLButtonElement>)}>
      {children}
    </button>
  )
}
