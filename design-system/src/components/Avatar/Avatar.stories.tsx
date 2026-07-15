import type { Meta, StoryObj } from '@storybook/react-vite'
import { Avatar } from './Avatar'

const meta: Meta<typeof Avatar> = {
  title: 'Components/Avatar',
  component: Avatar,
  args: { name: 'Andrew Serrazina' },
}
export default meta
type Story = StoryObj<typeof Avatar>

export const Small: Story = { args: { size: 'sm' } }
export const Large: Story = { args: { size: 'lg' } }
