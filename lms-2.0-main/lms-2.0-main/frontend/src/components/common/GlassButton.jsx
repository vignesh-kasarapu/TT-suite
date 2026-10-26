export function PrimaryButton({ children, className = '', ...props }) {
  return <button className={`btn btn--primary ${className}`} {...props}>{children}</button>;
}

export function SecondaryButton({ children, className = '', ...props }) {
  return <button className={`btn btn--secondary ${className}`} {...props}>{children}</button>;
}

export function DangerButton({ children, className = '', ...props }) {
  return <button className={`btn btn--danger ${className}`} {...props}>{children}</button>;
}

export function GhostButton({ children, className = '', ...props }) {
  return <button className={`btn btn--ghost ${className}`} {...props}>{children}</button>;
}
