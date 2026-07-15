import type { Preview } from '@storybook/react-vite'
import { createElement } from 'react'
import '../src/tokens/tokens.css'
import '../src/styles.css'

// Every Apex component is designed to sit on the site/portal's dark navy
// background (#080f1e) -- previewing on Storybook's default white canvas
// would misrepresent contrast, borders, and translucent overlays that
// only read correctly against that background.
const preview: Preview = {
  decorators: [
    (Story) =>
      createElement(
        'div',
        { style: { background: '#080f1e', minHeight: '100vh', padding: 32, fontFamily: 'var(--font)' } },
        createElement(Story),
      ),
  ],
}

export default preview
