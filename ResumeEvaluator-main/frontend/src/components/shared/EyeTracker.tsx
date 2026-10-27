import { useEffect, useRef, useState } from 'react'
import { motion } from 'framer-motion'

interface EyeTrackerProps {
  size?: number
  pupilSize?: number
  borderColor?: string
  pupilColor?: string
  irisColor?: string
  className?: string
  targetRef?: React.RefObject<HTMLElement>
  isLookingDown?: boolean
  onClick?: () => void
}

export function EyeTracker({
  size = 40,
  pupilSize = 14,
  borderColor,
  pupilColor,
  irisColor,
  className = '',
  isLookingDown = false,
  onClick,
}: EyeTrackerProps) {
  const eyeRef = useRef<HTMLDivElement>(null)
  const [pupilPos, setPupilPos] = useState({ x: 0, y: 0 })
  const [isBlinking, setIsBlinking] = useState(false)
  const [isHovered, setIsHovered] = useState(false)
  const [isDarkMode, setIsDarkMode] = useState(false)

  // Max distance pupil can move from center
  const maxRadius = (size - pupilSize) / 2 - 2

  useEffect(() => {
    const checkDark = () => setIsDarkMode(document.documentElement.classList.contains('dark'))
    checkDark()
    const observer = new MutationObserver(checkDark)
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ['class'] })
    return () => observer.disconnect()
  }, [])

  useEffect(() => {
    if (isLookingDown) {
      // Force pupil to look downwards (e.g. when dragging file over dropzone)
      setPupilPos({ x: 0, y: maxRadius * 0.85 })
      return
    }

    function handleMouseMove(e: MouseEvent) {
      if (!eyeRef.current) return
      const rect = eyeRef.current.getBoundingClientRect()
      const eyeCenterX = rect.left + rect.width / 2
      const eyeCenterY = rect.top + rect.height / 2

      const dx = e.clientX - eyeCenterX
      const dy = e.clientY - eyeCenterY
      const distance = Math.hypot(dx, dy)
      const angle = Math.atan2(dy, dx)

      // Clamp distance so pupil stays inside the eyeball circle
      const clampedDist = Math.min(distance * 0.16, maxRadius)
      const px = Math.cos(angle) * clampedDist
      const py = Math.sin(angle) * clampedDist

      setPupilPos({ x: px, y: py })
    }

    window.addEventListener('mousemove', handleMouseMove)
    return () => window.removeEventListener('mousemove', handleMouseMove)
  }, [maxRadius, isLookingDown])

  // Random natural blink
  useEffect(() => {
    const triggerBlink = () => {
      setIsBlinking(true)
      setTimeout(() => setIsBlinking(false), 160)
    }

    const interval = setInterval(() => {
      if (Math.random() > 0.35) {
        triggerBlink()
      }
    }, 3800 + Math.random() * 2500)

    return () => clearInterval(interval)
  }, [])

  // Default color palette: Sclera is crisp white/off-white with glowing border in dark mode
  const effectiveBorder = borderColor ?? (isDarkMode ? '#AFA9EC' : '#534AB7')
  const effectiveIrisBg = irisColor ?? (isDarkMode ? '#F8F9FA' : '#FFFFFF')
  const effectivePupil = pupilColor ?? (isDarkMode ? '#1E1B4B' : '#111827')
  const effectiveEyelidBg = isDarkMode ? '#1E1B4B' : '#3C3489'

  return (
    <div
      ref={eyeRef}
      onClick={() => {
        setIsBlinking(true)
        setTimeout(() => setIsBlinking(false), 200)
        onClick?.()
      }}
      onMouseEnter={() => setIsHovered(true)}
      onMouseLeave={() => setIsHovered(false)}
      className={`relative rounded-full flex items-center justify-center cursor-pointer select-none overflow-hidden transition-all duration-200 ${
        isHovered ? 'scale-105 shadow-lg' : 'shadow-xs'
      } ${className}`}
      style={{
        width: size,
        height: size,
        backgroundColor: effectiveIrisBg,
        border: `2px solid ${effectiveBorder}`,
        boxShadow: isDarkMode
          ? `0 0 12px rgba(175, 169, 236, 0.35), inset 0 0 4px rgba(0,0,0,0.15)`
          : `0 2px 6px rgba(83, 74, 183, 0.15), inset 0 0 3px rgba(0,0,0,0.08)`,
      }}
    >
      {/* Pupil */}
      <motion.div
        className="rounded-full flex items-center justify-center relative shadow-sm"
        style={{
          width: pupilSize,
          height: pupilSize,
          backgroundColor: effectivePupil,
        }}
        animate={{
          x: pupilPos.x,
          y: pupilPos.y,
          scale: isHovered || isLookingDown ? 1.25 : 1,
        }}
        transition={{
          type: 'spring',
          damping: 18,
          stiffness: 280,
          mass: 0.4,
        }}
      >
        {/* Pupil glint / reflection dot */}
        <div
          className="absolute rounded-full bg-white/90 shadow-xs"
          style={{
            width: Math.max(3, pupilSize * 0.32),
            height: Math.max(3, pupilSize * 0.32),
            top: '16%',
            left: '20%',
          }}
        />
      </motion.div>

      {/* Eyelid for blinking */}
      <motion.div
        className="absolute inset-0 z-10 origin-top pointer-events-none"
        style={{ backgroundColor: effectiveEyelidBg }}
        initial={{ scaleY: 0 }}
        animate={{ scaleY: isBlinking ? 1 : 0 }}
        transition={{ duration: 0.1 }}
      />
    </div>
  )
}

export function EyeMascot({
  size = 32,
  label = 'AI Assistant',
  className = '',
  isLookingDown = false,
}: {
  size?: number
  label?: string
  className?: string
  isLookingDown?: boolean
}) {
  return (
    <div
      className={`inline-flex items-center gap-2 px-3 py-1.5 rounded-full bg-white/90 dark:bg-gray-800/90 backdrop-blur-md border border-gray-200/80 dark:border-indigo-500/30 shadow-sm transition-colors ${className}`}
    >
      <div className="flex items-center gap-1.5">
        <EyeTracker size={size} pupilSize={size * 0.4} isLookingDown={isLookingDown} />
        <EyeTracker size={size} pupilSize={size * 0.4} isLookingDown={isLookingDown} />
      </div>
      {label && (
        <span className="text-xs font-semibold text-gray-800 dark:text-indigo-200 select-none tracking-wide">
          {label}
        </span>
      )}
    </div>
  )
}

export default EyeTracker
