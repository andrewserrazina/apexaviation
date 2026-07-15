import type { Meta, StoryObj } from '@storybook/react-vite'
import { Input } from './Input'

const meta: Meta<typeof Input> = {
  title: 'Components/Input',
  component: Input,
}
export default meta
type Story = StoryObj<typeof Input>

export const Basic: Story = { args: { label: 'Email', type: 'email', placeholder: 'you@email.com' } }
export const WithError: Story = {
  args: { label: 'Email', type: 'email', defaultValue: 'not-an-email', error: 'Enter a valid email address.' },
}
