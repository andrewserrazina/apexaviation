export default function ApexLogo({ size = 32 }) {
  const id = `apexGold_${size}`
  return (
    <svg width={size} height={size} viewBox="0 0 44 44" fill="none" xmlns="http://www.w3.org/2000/svg">
      <defs>
        <linearGradient id={id} x1="4" y1="4" x2="40" y2="40" gradientUnits="userSpaceOnUse">
          <stop offset="0%" stopColor="#F9CC4A" />
          <stop offset="50%" stopColor="#F4B400" />
          <stop offset="100%" stopColor="#B8820A" />
        </linearGradient>
      </defs>
      {/* Left leg of A */}
      <path d="M4 41L22 4L40 41" stroke={`url(#${id})`} strokeWidth="4.5" fill="none"
        strokeLinejoin="miter" strokeLinecap="square" />
      {/* Wing swoosh — cuts through the A diagonally */}
      <path d="M7 30L11 25L37 18L42 22L38 24L12 31Z" fill={`url(#${id})`} />
    </svg>
  )
}
