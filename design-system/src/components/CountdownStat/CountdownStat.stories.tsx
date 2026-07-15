import type { Meta, StoryObj } from '@storybook/react-vite'
import { CountdownStat } from './CountdownStat'

const meta: Meta<typeof CountdownStat> = {
  title: 'Components/CountdownStat',
  component: CountdownStat,
}
export default meta
type Story = StoryObj<typeof CountdownStat>

export const Normal: Story = { args: { daysRemaining: 45 } }
export const Soon: Story = { args: { daysRemaining: 10 } }
export const Urgent: Story = { args: { daysRemaining: 2 } }
