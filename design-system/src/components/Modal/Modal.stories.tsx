import type { Meta, StoryObj } from '@storybook/react-vite'
import { Modal } from './Modal'

const meta: Meta<typeof Modal> = {
  title: 'Components/Modal',
  component: Modal,
  args: { open: true, onClose: () => {} },
}
export default meta
type Story = StoryObj<typeof Modal>

export const UnlockCheckridePrep: Story = {
  args: {
    title: 'Unlock the Complete Prep Pack',
    icon: (
      <svg width="26" height="26" viewBox="0 0 24 24" fill="none">
        <rect x="4" y="10" width="16" height="10" rx="2" stroke="currentColor" strokeWidth="1.8" />
        <path d="M8 10V7a4 4 0 018 0v3" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
      </svg>
    ),
    children: (
      <p>300+ DPE-style questions, model answers, scenario training, and progress tracking — yours for a one-time $29.</p>
    ),
  },
}
