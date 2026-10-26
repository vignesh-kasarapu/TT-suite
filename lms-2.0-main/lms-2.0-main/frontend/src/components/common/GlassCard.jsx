export default function GlassCard({ children, className = '', strong = false, ...props }) {
  return (
    <div className={`panel ${strong ? 'panel--strong' : ''} ${className}`} {...props}>
      {children}
    </div>
  );
}
