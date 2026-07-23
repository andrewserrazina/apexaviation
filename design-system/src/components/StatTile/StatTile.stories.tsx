import type { Meta, StoryObj } from '@storybook/react-vite'
import { StatTile } from './StatTile'

const meta: Meta<typeof StatTile> = {
  title: 'Components/StatTile',
  component: StatTile,
}
export default meta
type Story = StoryObj<typeof StatTile>

export const Basic: Story = { args: { value: '300+', label: 'DPE Questions Available' } }
export const WithIcon: Story = {
  args: {
    value: '10',
    label: 'Training Scenarios',
    icon: (
      <svg width="20" height="20" viewBox="0 0 24 24" fill="none">
        <path d="M9 20l-5.447-2.724A1 1 0 013 16.382V5.618a1 1 0 011.447-.894L9 7l6-3 5.447 2.724A1 1 0 0121 7.618v10.764a1 1 0 01-1.447.894L15 17l-6 3z" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    ),
  },
}
