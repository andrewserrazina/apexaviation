export default function Card({ children, className = '', as: Component = 'section' }) {
  return <Component className={`portal-card${className ? ` ${className}` : ''}`}>{children}</Component>
}
