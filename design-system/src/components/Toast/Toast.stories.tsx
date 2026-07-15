import type { Meta, StoryObj } from '@storybook/react-vite'
import { Toast } from './Toast'

const meta: Meta<typeof Toast> = {
  title: 'Components/Toast',
  component: Toast,
  args: { static: true },
}
export default meta
type Story = StoryObj<typeof Toast>

export const Basic: Story = { args: { children: 'Saved.' } }
export const Achievement: Story = { args: { children: '🏅 Achievement unlocked: 50 Questions Studied' } }
