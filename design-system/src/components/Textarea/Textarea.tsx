import type { TextareaHTMLAttributes } from 'react'
import { useId } from 'react'
import { cx } from '../../utils/cx'
import '../Input/Input.css'

export interface TextareaProps extends Omit<TextareaHTMLAttributes<HTMLTextAreaElement>, 'className'> {
  label?: string
  className?: string
  fieldClassName?: string
}

/** Multi-line field matching the testimonial / debrief-notes textareas. */
export function Textarea({ label, id, className, fieldClassName, rows = 3, ...rest }: TextareaProps) {
  const generatedId = useId()
  const textareaId = id ?? generatedId
  return (
    <div className={cx('apex-field', fieldClassName)}>
      {label && (
        <label className="apex-field__label" htmlFor={textareaId}>
          {label}
        </label>
      )}
      <textarea
        id={textareaId}
        rows={rows}
        className={cx('apex-field__control', className)}
        style={{ resize: 'vertical' }}
        {...rest}
      />
    </div>
  )
}
