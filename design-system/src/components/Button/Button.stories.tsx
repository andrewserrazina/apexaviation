import type { Meta, StoryObj } from '@storybook/react-vite'
import { Button } from './Button'

const meta: Meta<typeof Button> = {
  title: 'Components/Button',
  component: Button,
  args: { children: 'Create Your Free Account' },
}
export default meta
type Story = StoryObj<typeof Button>

export const Primary: Story = { args: { variant: 'primary' } }
export const Ghost: Story = { args: { variant: 'ghost', children: 'Explore Training' } }
export const Outline: Story = { args: { variant: 'outline', children: 'Unlock the Complete Prep Pack' } }
export const NavSize: Story = { args: { variant: 'primary', nav: true, children: 'Book a Session' } }
export const FullWidth: Story = { args: { variant: 'primary', fullWidth: true, children: 'Sign In' } }
export const Disabled: Story = { args: { variant: 'primary', disabled: true, children: 'Notify Me' } }
export const AsLink: Story = {
  render: (args) => <Button {...args} href="portal-login.html?view=signup" />,
  args: { variant: 'primary', children: 'Create Your Free Account' },
}
