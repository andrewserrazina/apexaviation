import { useState } from 'react'
import type { Meta, StoryObj } from '@storybook/react-vite'
import { Tabs } from './Tabs'

const meta: Meta<typeof Tabs> = {
  title: 'Components/Tabs',
  component: Tabs,
}
export default meta
type Story = StoryObj<typeof Tabs>

export const Basic: Story = {
  render: () => {
    function Demo() {
      const [active, setActive] = useState('private')
      return (
        <Tabs
          items={[
            { id: 'private', label: 'Private Pilot' },
            { id: 'instrument', label: 'Instrument Rating' },
            { id: 'commercial', label: 'Commercial Pilot' },
          ]}
          activeId={active}
          onChange={setActive}
        />
      )
    }
    return <Demo />
  },
}
