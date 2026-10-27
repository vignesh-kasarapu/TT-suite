import { useEffect, useState } from 'react'
import { motion, useMotionValue, useSpring } from 'framer-motion'

export function CustomCursor() {
  const [isVisible, setIsVisible] = useState(false)
  const [isHovered, setIsHovered] = useState(false)
  const [isClicked, setIsClicked] = useState(false)
  const [isPointerDevice, setIsPointerDevice] = useState(false)
  const [isDarkMode, setIsDarkMode] = useState(false)

  // Direct mouse coordinates
  const mouseX = useMotionValue(-100)
  const mouseY = useMotionValue(-100)

  // Spring physics for trailing outer ring
  const springConfig = { damping: 26, stiffness: 380, mass: 0.3 }
  const ringX = useSpring(mouseX, springConfig)
  const ringY = useSpring(mouseY, springConfig)

  useEffect(() => {
    // Check pointer capabilities
    const hasFinePointer = window.matchMedia('(pointer: fine)').matches
    if (!hasFinePointer) return
    setIsPointerDevice(true)

    // Sync dark mode
    const checkDark = () => setIsDarkMode(document.documentElement.classList.contains('dark'))
    checkDark()
    const observer = new MutationObserver(checkDark)
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ['class'] })

    function handleMouseMove(e: MouseEvent) {
      mouseX.set(e.clientX)
      mouseY.set(e.clientY)
      if (!isVisible) setIsVisible(true)

      const target = e.target as HTMLElement | null
      if (target) {
        const isClickable =
          target.closest('button, a, input, select, textarea, [role="button"], .cursor-pointer') !== null
        setIsHovered(isClickable)
      }
    }

    function handleMouseDown() {
      setIsClicked(true)
    }

    function handleMouseUp() {
      setIsClicked(false)
    }

    function handleMouseLeave() {
      setIsVisible(false)
    }

    function handleMouseEnter() {
      setIsVisible(true)
    }

    window.addEventListener('mousemove', handleMouseMove)
    window.addEventListener('mousedown', handleMouseDown)
    window.addEventListener('mouseup', handleMouseUp)
    document.addEventListener('mouseleave', handleMouseLeave)
    document.addEventListener('mouseenter', handleMouseEnter)

    return () => {
      observer.disconnect()
      window.removeEventListener('mousemove', handleMouseMove)
      window.removeEventListener('mousedown', handleMouseDown)
      window.removeEventListener('mouseup', handleMouseUp)
      document.removeEventListener('mouseleave', handleMouseLeave)
      document.removeEventListener('mouseenter', handleMouseEnter)
    }
  }, [isVisible, mouseX, mouseY])

  if (!isPointerDevice || !isVisible) return null

  // Theme-aware styles for maximum contrast and luminosity in dark mode
  const ringBorderColor = isDarkMode
    ? isHovered ? '#C4B5FD' : '#818CF8'
    : isHovered ? '#3C3489' : '#534AB7'

  const ringBg = isDarkMode
    ? isHovered ? 'rgba(167, 139, 250, 0.22)' : 'rgba(129, 140, 248, 0.08)'
    : isHovered ? 'rgba(83, 74, 183, 0.15)' : 'rgba(83, 74, 183, 0.05)'

  const ringShadow = isDarkMode
    ? isHovered
      ? '0 0 20px rgba(196, 181, 253, 0.75), inset 0 0 10px rgba(167, 139, 250, 0.4)'
      : '0 0 12px rgba(129, 140, 248, 0.45)'
    : isHovered
      ? '0 0 14px rgba(83, 74, 183, 0.35)'
      : 'none'

  const dotBg = isDarkMode
    ? isHovered ? '#FFFFFF' : '#A78BFA'
    : isHovered ? '#3C3489' : '#534AB7'

  const dotShadow = isDarkMode
    ? '0 0 8px #C4B5FD, 0 0 2px #FFFFFF'
    : '0 1px 3px rgba(0,0,0,0.2)'

  return (
    <div className="pointer-events-none fixed inset-0 z-[99999] overflow-hidden">
      {/* Outer Spring Ring */}
      <motion.div
        className="fixed top-0 left-0 rounded-full pointer-events-none transition-colors duration-150 backdrop-blur-[1px]"
        style={{
          x: ringX,
          y: ringY,
          translateX: '-50%',
          translateY: '-50%',
          borderWidth: isHovered ? '2.5px' : '1.5px',
          borderStyle: 'solid',
          borderColor: ringBorderColor,
          backgroundColor: ringBg,
          boxShadow: ringShadow,
        }}
        animate={{
          width: isHovered ? 48 : isClicked ? 22 : 32,
          height: isHovered ? 48 : isClicked ? 22 : 32,
          scale: isClicked ? 0.88 : 1,
        }}
        transition={{ duration: 0.12, ease: 'easeOut' }}
      />

      {/* Inner Dot (Instant Precision) */}
      <motion.div
        className="fixed top-0 left-0 rounded-full pointer-events-none"
        style={{
          x: mouseX,
          y: mouseY,
          translateX: '-50%',
          translateY: '-50%',
          backgroundColor: dotBg,
          boxShadow: dotShadow,
        }}
        animate={{
          width: isHovered ? 8 : isClicked ? 4 : 6,
          height: isHovered ? 8 : isClicked ? 4 : 6,
          scale: isClicked ? 0.75 : 1,
        }}
        transition={{ duration: 0.08, ease: 'easeOut' }}
      />
    </div>
  )
}

export default CustomCursor
