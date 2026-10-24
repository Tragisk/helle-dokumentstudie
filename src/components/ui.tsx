import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from "react";

// ---------- toast ----------
const ToastCtx = createContext<(msg: string) => void>(() => {});
export const useToast = () => useContext(ToastCtx);
export function ToastProvider({ children }: { children: ReactNode }) {
  const [msg, setMsg] = useState<string | null>(null);
  const t = useRef<number>();
  const show = useCallback((m: string) => { setMsg(m); clearTimeout(t.current); t.current = window.setTimeout(() => setMsg(null), 3000); }, []);
  return <ToastCtx.Provider value={show}>{children}<div className={"toast" + (msg ? " show" : "")} role="status">{msg}</div></ToastCtx.Provider>;
}

// ---------- modal ----------
export function Modal({ title, children, onClose, wide }: { title: string; children: ReactNode; onClose: () => void; wide?: boolean }) {
  useEffect(() => {
    const k = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    document.addEventListener("keydown", k); return () => document.removeEventListener("keydown", k);
  }, [onClose]);
  return (
    <div className="modal show" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="dlg" style={wide ? { width: "min(680px,100%)" } : undefined} role="dialog" aria-label={title}>
        <h2>{title}</h2>
        {children}
      </div>
    </div>
  );
}

export function Confirm({ title, text, ok = "OK", danger, onOk, onClose, children }: {
  title: string; text?: ReactNode; ok?: string; danger?: boolean; onOk: () => void | Promise<void>; onClose: () => void; children?: ReactNode;
}) {
  const [busy, setBusy] = useState(false);
  return (
    <Modal title={title} onClose={onClose}>
      {text && <p>{text}</p>}
      {children}
      <div className="row">
        <button className="btn" onClick={onClose}>Annullér</button>
        <button className={"btn " + (danger ? "dangerfill" : "primary")} disabled={busy} onClick={async () => { setBusy(true); try { await onOk(); } finally { setBusy(false); } }}>{ok}</button>
      </div>
    </Modal>
  );
}

export const Chip = ({ kind, children }: { kind?: string; children: ReactNode }) => <span className={"chip " + (kind ?? "")}>{children}</span>;
