import type { Meta, StoryObj } from '@storybook/react-vite'
import { ProgressBar } from './ProgressBar'

const meta: Meta<typeof ProgressBar> = {
  title: 'Components/ProgressBar',
  component: ProgressBar,
  render: (args) => (
    <div style={{ width: 240 }}>
      <ProgressBar {...args} />
    </div>
  ),
}
export default meta
type Story = StoryObj<typeof ProgressBar>

export const Quarter: Story = { args: { percent: 25 } }
export const Half: Story = { args: { percent: 50 } }
export const Full: Story = { args: { percent: 100 } }
