import type { Meta, StoryObj } from '@storybook/react-vite'
import { Badge } from './Badge'

const meta: Meta<typeof Badge> = {
  title: 'Components/Badge',
  component: Badge,
}
export default meta
type Story = StoryObj<typeof Badge>

export const Live: Story = { args: { variant: 'live', children: 'Live Today' } }
export const Gold: Story = { args: { variant: 'gold', children: 'Founding Pilot Pricing' } }
export const Locked: Story = { args: { variant: 'locked', children: 'Coming Soon' } }
export const Outline: Story = { args: { variant: 'outline', children: '10 founding spots left' } }
