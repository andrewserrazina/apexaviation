import apexMark from '../assets/apex-logo-mark.png'

export default function ApexLogo({ size = 32 }) {
  return (
    <img
      src={apexMark}
      alt="Apex Aviation"
      width={size}
      height={size}
      style={{ display: 'block', objectFit: 'contain' }}
    />
  )
}
