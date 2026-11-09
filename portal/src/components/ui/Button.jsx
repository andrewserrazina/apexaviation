const VARIANT_CLASS = {
  primary: 'btn-primary-sm',
  secondary: 'btn-secondary',
  danger: 'btn-danger',
  link: 'btn-link',
}

export default function Button({ variant = 'secondary', className = '', as: Component = 'button', ...props }) {
  const base = VARIANT_CLASS[variant] ?? VARIANT_CLASS.secondary
  return <Component className={`${base}${className ? ` ${className}` : ''}`} {...props} />
}
