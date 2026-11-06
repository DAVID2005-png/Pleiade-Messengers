import { useEffect } from 'react'
import { X } from 'lucide-react'

export default function Toast({ message, type = 'error', onClose, duration = 7000 }) {
  useEffect(() => {
    if (!message || !duration) return undefined
    const timer = window.setTimeout(onClose, duration)
    return () => window.clearTimeout(timer)
  }, [duration, message, onClose])

  if (!message) return null
  return <div className={`app-toast ${type}`} role={type === 'error' ? 'alert' : 'status'}>
    <span>{message}</span>
    <button type="button" onClick={onClose} aria-label="Fermer le message"><X size={17} /></button>
  </div>
}
