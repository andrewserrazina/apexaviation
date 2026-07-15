import type { ReactNode } from 'react'
import { cx } from '../../utils/cx'
import './Table.css'

export interface TableColumn<T> {
  key: string
  header: ReactNode
  render: (row: T) => ReactNode
}

export interface TableProps<T> {
  columns: TableColumn<T>[]
  rows: T[]
  rowKey: (row: T) => string
  className?: string
}

/** Roster/admin data table — used for the Instructor Hub student roster,
 * Students, and similar CRM list views. */
export function Table<T>({ columns, rows, rowKey, className }: TableProps<T>) {
  return (
    <table className={cx('apex-table', className)}>
      <thead>
        <tr>
          {columns.map((col) => (
            <th key={col.key}>{col.header}</th>
          ))}
        </tr>
      </thead>
      <tbody>
        {rows.map((row) => (
          <tr key={rowKey(row)}>
            {columns.map((col) => (
              <td key={col.key}>{col.render(row)}</td>
            ))}
          </tr>
        ))}
      </tbody>
    </table>
  )
}
