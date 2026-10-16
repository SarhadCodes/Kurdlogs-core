import { type ReactNode, useEffect } from 'react';
import { X } from 'lucide-react';

interface ModalProps {
  isOpen: boolean;
  onClose: () => void;
  title: string;
  children: ReactNode;
  wide?: boolean;
}

export default function Modal({ isOpen, onClose, title, children, wide }: ModalProps) {
  useEffect(() => {
    const handleEsc = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    if (isOpen) {
      document.addEventListener('keydown', handleEsc);
      document.body.style.overflow = 'hidden';
    }
    return () => {
      document.removeEventListener('keydown', handleEsc);
      document.body.style.overflow = '';
    };
  }, [isOpen, onClose]);

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center sm:p-4">
      <div
        className="absolute inset-0 bg-black/70"
        onClick={onClose}
        aria-hidden
      />
      <div
        className={`relative z-10 w-full flex flex-col max-h-[92dvh] sm:max-h-[90vh] bg-[#111] border border-[#333] shadow-2xl rounded-t-xl sm:rounded-lg mx-0 sm:mx-4 ${
          wide ? 'sm:max-w-4xl' : 'sm:max-w-lg'
        }`}
        role="dialog"
        aria-modal="true"
        aria-labelledby="modal-title"
      >
        <div className="flex items-center justify-between px-4 sm:px-6 py-4 border-b border-[#333] shrink-0">
          <h2 id="modal-title" className="text-base sm:text-lg font-semibold text-white pr-4">
            {title}
          </h2>
          <button
            type="button"
            onClick={onClose}
            className="p-2 -mr-2 text-[#888] hover:text-white transition-colors rounded-md"
            aria-label="Close"
          >
            <X size={20} />
          </button>
        </div>
        <div className="flex-1 overflow-y-auto overscroll-contain px-4 sm:px-6 py-4">
          {children}
        </div>
      </div>
    </div>
  );
}
