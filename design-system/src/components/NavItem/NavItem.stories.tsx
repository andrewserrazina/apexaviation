import type { Meta, StoryObj } from '@storybook/react-vite'
import { NavItem } from './NavItem'

const meta: Meta<typeof NavItem> = {
  title: 'Components/NavItem',
  component: NavItem,
  args: { children: 'Dashboard' },
}
export default meta
type Story = StoryObj<typeof NavItem>

export const Default: Story = {}
export const Active: Story = { args: { active: true } }
export const Gated: Story = { args: { children: 'Checkride Prep Pack', gated: true } }
export const List: Story = {
  render: () => (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 4, width: 260, background: '#0B1F3A', padding: 14 }}>
      <NavItem active>Dashboard</NavItem>
      <NavItem>10 Questions DPEs Love to Ask</NavItem>
      <NavItem gated>Checkride Prep Pack</NavItem>
      <NavItem gated>DPE Questions Library</NavItem>
    </div>
  ),
}
