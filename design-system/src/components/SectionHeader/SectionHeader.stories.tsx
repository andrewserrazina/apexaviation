import type { Meta, StoryObj } from '@storybook/react-vite'
import { SectionHeader } from './SectionHeader'

const meta: Meta<typeof SectionHeader> = {
  title: 'Components/SectionHeader',
  component: SectionHeader,
}
export default meta
type Story = StoryObj<typeof SectionHeader>

export const Centered: Story = {
  args: {
    eyebrow: 'Live Today — No Waitlist Required',
    title: 'Apex Advantage. ',
    accent: 'Ready before the checkride is.',
    desc: 'The Austin simulator facility opens in 2027 — but you don’t have to wait for any of this.',
  },
}
export const LeftAligned: Story = {
  args: {
    align: 'left',
    eyebrow: 'Checkride Prep Pack',
    title: 'Everything you need for checkride day.',
    desc: 'The full Private Pilot Checkride Prep Pack, broken into lessons you can study section by section.',
  },
}
