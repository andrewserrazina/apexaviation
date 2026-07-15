import type { Meta, StoryObj } from '@storybook/react-vite'
import { Select } from './Select'

const meta: Meta<typeof Select> = {
  title: 'Components/Select',
  component: Select,
}
export default meta
type Story = StoryObj<typeof Select>

export const Basic: Story = {
  render: (args) => (
    <Select {...args}>
      <option value="apex_advantage">Apex Advantage</option>
      <option value="flight_student">Flight Student</option>
    </Select>
  ),
  args: { label: 'Student Type' },
}
