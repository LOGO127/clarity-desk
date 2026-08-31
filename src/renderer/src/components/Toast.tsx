import { CheckCircle2, CircleAlert, Info, X } from 'lucide-react'

export type ToastTone = 'success' | 'error' | 'info'

export interface ToastData {
  id: number
  message: string
  tone: ToastTone
}

export function ToastStack({ toasts, onDismiss }: { toasts: ToastData[]; onDismiss: (id: number) => void }) {
  return (
    <div className="toast-stack" aria-live="polite">
      {toasts.map((toast) => {
        const Icon = toast.tone === 'success' ? CheckCircle2 : toast.tone === 'error' ? CircleAlert : Info
        return (
          <div className={`toast toast-${toast.tone}`} key={toast.id}>
            <Icon size={18} />
            <span>{toast.message}</span>
            <button className="icon-button subtle" onClick={() => onDismiss(toast.id)} aria-label="关闭提示">
              <X size={16} />
            </button>
          </div>
        )
      })}
    </div>
  )
}
