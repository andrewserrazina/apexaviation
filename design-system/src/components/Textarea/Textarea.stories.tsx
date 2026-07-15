import type { Meta, StoryObj } from '@storybook/react-vite'
import { Textarea } from './Textarea'

const meta: Meta<typeof Textarea> = {
  title: 'Components/Textarea',
  component: Textarea,
}
export default meta
type Story = StoryObj<typeof Textarea>

export const Basic: Story = {
  args: {
    label: 'Debrief Notes',
    placeholder: 'Visible to the student on their dashboard — what went well, what to work on next…',
  },
}
