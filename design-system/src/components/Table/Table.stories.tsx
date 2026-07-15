import type { Meta, StoryObj } from '@storybook/react-vite'
import { Table } from './Table'

type Student = { id: string; name: string; program: string; nextTopic: string }

const rows: Student[] = [
  { id: '1', name: 'Jane Doe', program: 'Private Pilot (4/12)', nextTopic: 'Steep Turns' },
  { id: '2', name: 'Sam Rivera', program: 'Instrument Rating (2/9)', nextTopic: 'Holding Patterns' },
]

const meta: Meta<typeof Table<Student>> = {
  title: 'Components/Table',
  component: Table<Student>,
}
export default meta
type Story = StoryObj<typeof Table<Student>>

export const Basic: Story = {
  args: {
    rowKey: (row: Student) => row.id,
    columns: [
      { key: 'name', header: 'Student', render: (row: Student) => row.name },
      { key: 'program', header: 'Program', render: (row: Student) => row.program },
      { key: 'next', header: 'Next Topic', render: (row: Student) => row.nextTopic },
    ],
    rows,
  },
}
