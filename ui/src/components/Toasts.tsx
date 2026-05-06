import { createContext, useContext, useState, useCallback, type ReactNode } from 'react'
import { X, CheckCircle, AlertTriangle, Info } from 'lucide-react'

type ToastType = 'error' | 'success' | 'info'
type Toast = { id: number; message: string; type: ToastType }
type AddToast = (message: string, type?: ToastType) => void

const Ctx = createContext<AddToast>(() => {})
export const useToast = () => useContext(Ctx)

let _id = 0

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([])

  const add = useCallback((message: string, type: ToastType = 'error') => {
    const id = ++_id
    setToasts(t => [...t, { id, message, type }])
    setTimeout(() => setToasts(t => t.filter(x => x.id !== id)), 6000)
  }, [])

  const remove = (id: number) => setToasts(t => t.filter(x => x.id !== id))

  return (
    <Ctx.Provider value={add}>
      {children}
      <div className="fixed bottom-4 right-4 z-[200] flex flex-col gap-2 max-w-sm w-full pointer-events-none">
        {toasts.map(t => (
          <div key={t.id}
            className={`pointer-events-auto flex items-start gap-3 px-4 py-3 rounded-xl shadow-xl text-sm font-medium border ${
              t.type === 'error'   ? 'bg-red-600 text-white border-red-700' :
              t.type === 'success' ? 'bg-green-600 text-white border-green-700' :
                                     'bg-gray-800 text-white border-gray-700'
            }`}>
            <span className="flex-shrink-0 mt-0.5">
              {t.type === 'error'   ? <AlertTriangle size={15} /> :
               t.type === 'success' ? <CheckCircle size={15} /> :
                                      <Info size={15} />}
            </span>
            <span className="flex-1 leading-snug">{t.message}</span>
            <button onClick={() => remove(t.id)} className="flex-shrink-0 opacity-70 hover:opacity-100 mt-0.5">
              <X size={14} />
            </button>
          </div>
        ))}
      </div>
    </Ctx.Provider>
  )
}
