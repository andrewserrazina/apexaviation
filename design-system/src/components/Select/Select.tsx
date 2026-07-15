import type { ReactNode, SelectHTMLAttributes } from 'react'
import { useId } from 'react'
import { cx } from '../../utils/cx'
import '../Input/Input.css'

export interface SelectProps extends Omit<SelectHTMLAttributes<HTMLSelectElement>, 'className'> {
  label?: string
  className?: string
  fieldClassName?: string
  children: ReactNode
}

/** Labeled select, sharing the Input field's border/focus treatment
 * (e.g. Students.jsx's student-type dropdown). */
export function Select({ label, id, className, fieldClassName, children, ...rest }: SelectProps) {
  const generatedId = useId()
  const selectId = id ?? generatedId
  return (
    <div className={cx('apex-field', fieldClassName)}>
      {label && (
        <label className="apex-field__label" htmlFor={selectId}>
          {label}
        </label>
      )}
      <select id={selectId} className={cx('apex-field__control', className)} {...rest}>
        {children}
      </select>
    </div>
  )
}
