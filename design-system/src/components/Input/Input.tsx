import type { InputHTMLAttributes } from 'react'
import { useId } from 'react'
import { cx } from '../../utils/cx'
import './Input.css'

export interface InputProps extends Omit<InputHTMLAttributes<HTMLInputElement>, 'className'> {
  label?: string
  error?: string
  className?: string
  fieldClassName?: string
}

/** Labeled text input matching the sign-in / sign-up form fields. */
export function Input({ label, error, id, className, fieldClassName, ...rest }: InputProps) {
  const generatedId = useId()
  const inputId = id ?? generatedId
  return (
    <div className={cx('apex-field', fieldClassName)}>
      {label && (
        <label className="apex-field__label" htmlFor={inputId}>
          {label}
        </label>
      )}
      <input id={inputId} className={cx('apex-field__control', className)} {...rest} />
      {error && <span className="apex-field__error">{error}</span>}
    </div>
  )
}
