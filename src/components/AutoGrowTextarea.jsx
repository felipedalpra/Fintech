import { forwardRef, useLayoutEffect, useRef } from 'react'

function assignRef(ref, value) {
  if (typeof ref === 'function') ref(value)
  else if (ref) ref.current = value
}

export const AutoGrowTextarea = forwardRef(function AutoGrowTextarea(
  { value, minHeight = 96, maxHeight = 520, style, onInput, ...props },
  forwardedRef,
) {
  const localRef = useRef(null)

  function resize(element) {
    if (!element) return
    element.style.height = 'auto'
    const nextHeight = Math.max(minHeight, Math.min(element.scrollHeight, maxHeight))
    element.style.height = `${nextHeight}px`
    element.style.overflowY = element.scrollHeight > maxHeight ? 'auto' : 'hidden'
  }

  useLayoutEffect(() => {
    resize(localRef.current)
  }, [value, minHeight, maxHeight])

  return (
    <textarea
      {...props}
      ref={element => {
        localRef.current = element
        assignRef(forwardedRef, element)
      }}
      value={value}
      onInput={event => {
        resize(event.currentTarget)
        onInput?.(event)
      }}
      style={{ resize:'vertical', lineHeight:1.6, ...style }}
    />
  )
})
