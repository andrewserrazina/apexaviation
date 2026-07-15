import type { Meta, StoryObj } from '@storybook/react-vite'
import { Card } from './Card'

const meta: Meta<typeof Card> = {
  title: 'Components/Card',
  component: Card,
}
export default meta
type Story = StoryObj<typeof Card>

export const Basic: Story = {
  args: {
    eyebrow: 'Free Resource',
    title: '10 Questions DPEs Love to Ask',
    children: 'The private pilot oral exam questions worth mastering before checkride day.',
  },
}
export const Featured: Story = {
  args: {
    featured: true,
    eyebrow: 'Ready for the Complete Picture?',
    title: 'The Apex Advantage Checkride Prep Pack',
    children: 'The complete oral exam study guide, built by CFIs, mapped to the ACS.',
  },
}
export const Interactive: Story = {
  args: {
    interactive: true,
    title: 'Checkride Prep Pack',
    children: 'Study guides & endorsement checklists',
  },
}
