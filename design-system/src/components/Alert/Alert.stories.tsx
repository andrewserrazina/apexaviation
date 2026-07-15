import type { Meta, StoryObj } from '@storybook/react-vite'
import { Alert } from './Alert'

const meta: Meta<typeof Alert> = {
  title: 'Components/Alert',
  component: Alert,
}
export default meta
type Story = StoryObj<typeof Alert>

export const Error: Story = { args: { variant: 'error', children: 'Invalid email or password.' } }
export const Success: Story = { args: { variant: 'success', children: 'Check your email for a password reset link.' } }
