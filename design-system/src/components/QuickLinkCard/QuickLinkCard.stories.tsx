import type { Meta, StoryObj } from '@storybook/react-vite'
import { QuickLinkCard } from './QuickLinkCard'

const meta: Meta<typeof QuickLinkCard> = {
  title: 'Components/QuickLinkCard',
  component: QuickLinkCard,
}
export default meta
type Story = StoryObj<typeof QuickLinkCard>

export const Basic: Story = {
  args: {
    title: '10 Questions DPEs Love to Ask',
    description: 'Free — no unlock needed',
    icon: (
      <svg width="20" height="20" viewBox="0 0 24 24" fill="none">
        <path d="M9.09 9a3 3 0 015.83 1c0 2-3 2-3 4M12 17.5v.01" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
        <circle cx="12" cy="12" r="9" stroke="currentColor" strokeWidth="2" />
      </svg>
    ),
  },
}
