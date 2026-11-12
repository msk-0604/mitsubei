"use client";

import { AlertCircle, CheckCircle2, ChevronLeft, ChevronRight, Loader2, X } from "lucide-react";
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useId,
  useRef,
  useState,
  type ButtonHTMLAttributes,
  type InputHTMLAttributes,
  type ReactNode,
  type SelectHTMLAttributes,
  type TextareaHTMLAttributes,
} from "react";

type ButtonVariant = "primary" | "secondary" | "ghost" | "danger";

const buttonBase =
  "inline-flex items-center justify-center gap-1.5 rounded-lg font-medium transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-600 disabled:cursor-not-allowed disabled:opacity-60 whitespace-nowrap";
const buttonVariants: Record<ButtonVariant, string> = {
  primary: "bg-blue-600 text-white hover:bg-blue-700 active:bg-blue-800 shadow-sm",
  secondary: "border border-slate-300 bg-white text-slate-700 hover:bg-slate-50 active:bg-slate-100",
  ghost: "text-slate-600 hover:bg-slate-100 active:bg-slate-200",
  danger: "bg-red-600 text-white hover:bg-red-700 active:bg-red-800",
};
const buttonSizes = { sm: "h-9 px-3 text-sm", md: "h-11 px-4 text-[15px]", lg: "h-12 px-5 text-base" };

export function buttonClass(variant: ButtonVariant = "primary", size: keyof typeof buttonSizes = "md", extra = "") {
  return `${buttonBase} ${buttonVariants[variant]} ${buttonSizes[size]} ${extra}`;
}

export function Button({
  variant = "primary",
  size = "md",
  loading = false,
  className = "",
  children,
  disabled,
  type = "button",
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: ButtonVariant; size?: keyof typeof buttonSizes; loading?: boolean }) {
  return (
    <button type={type} className={buttonClass(variant, size, className)} disabled={disabled || loading} aria-busy={loading || undefined} {...props}>
      {loading && <Loader2 className="size-4 animate-spin" aria-hidden />}
      {children}
    </button>
  );
}

const controlBase =
  "w-full rounded-lg border bg-white px-3 text-[16px] sm:text-[15px] text-slate-800 placeholder:text-slate-400 transition-colors focus:border-blue-600 focus:outline-none focus:ring-2 focus:ring-blue-600/20 disabled:bg-slate-50 disabled:text-slate-500";

function controlBorder(error?: string) {
  return error ? "border-red-400" : "border-slate-300";
}

export function Field({
  label,
  required,
  error,
  hint,
  children,
  htmlFor,
  className = "",
}: {
  label: string;
  required?: boolean;
  error?: string;
  hint?: ReactNode;
  children: ReactNode;
  htmlFor: string;
  className?: string;
}) {
  return (
    <div className={`space-y-1.5 ${className}`}>
      <label htmlFor={htmlFor} className="flex items-center gap-1.5 text-sm font-medium text-slate-700">
        {label}
        {required && <span className="rounded bg-red-50 px-1.5 py-0.5 text-[11px] font-semibold text-red-600">必須</span>}
      </label>
      {children}
      {error ? (
        <p id={`${htmlFor}-error`} className="text-sm text-red-600">
          {error}
        </p>
      ) : hint ? (
        <p className="text-xs text-slate-500">{hint}</p>
      ) : null}
    </div>
  );
}

export function TextInput({ error, className = "", ...props }: InputHTMLAttributes<HTMLInputElement> & { error?: string }) {
  return (
    <input
      className={`${controlBase} ${controlBorder(error)} h-11 ${className}`}
      aria-invalid={error ? true : undefined}
      aria-describedby={error && props.id ? `${props.id}-error` : undefined}
      {...props}
    />
  );
}

export function TextArea({ error, className = "", ...props }: TextareaHTMLAttributes<HTMLTextAreaElement> & { error?: string }) {
  return (
    <textarea
      className={`${controlBase} ${controlBorder(error)} min-h-24 py-2.5 leading-relaxed ${className}`}
      aria-invalid={error ? true : undefined}
      aria-describedby={error && props.id ? `${props.id}-error` : undefined}
      {...props}
    />
  );
}

export function Select({ error, className = "", children, ...props }: SelectHTMLAttributes<HTMLSelectElement> & { error?: string }) {
  return (
    <select className={`${controlBase} ${controlBorder(error)} h-11 ${className}`} aria-invalid={error ? true : undefined} {...props}>
      {children}
    </select>
  );
}

export function Alert({ tone = "error", children }: { tone?: "error" | "success" | "info" | "warning"; children: ReactNode }) {
  const styles = {
    error: "border-red-200 bg-red-50 text-red-700",
    success: "border-emerald-200 bg-emerald-50 text-emerald-700",
    info: "border-blue-200 bg-blue-50 text-blue-800",
    warning: "border-amber-200 bg-amber-50 text-amber-800",
  }[tone];
  const Icon = tone === "success" ? CheckCircle2 : AlertCircle;
  return (
    <div role={tone === "error" ? "alert" : "status"} className={`flex items-start gap-2 rounded-lg border px-3 py-2.5 text-sm ${styles}`}>
      <Icon className="mt-0.5 size-4 shrink-0" aria-hidden />
      <div className="min-w-0 flex-1">{children}</div>
    </div>
  );
}

export function Spinner({ label = "読み込み中" }: { label?: string }) {
  return (
    <div className="flex items-center justify-center gap-2 py-10 text-sm text-slate-500" role="status">
      <Loader2 className="size-5 animate-spin text-blue-600" aria-hidden />
      {label}
    </div>
  );
}

export function Card({ children, className = "" }: { children: ReactNode; className?: string }) {
  return <section className={`rounded-xl border border-slate-200 bg-white shadow-[0_1px_2px_rgba(15,23,42,0.04)] ${className}`}>{children}</section>;
}

export function CardHeader({ title, actions, description }: { title: ReactNode; actions?: ReactNode; description?: ReactNode }) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-100 px-4 py-3 sm:px-5">
      <div className="min-w-0">
        <h2 className="text-base font-semibold text-slate-800">{title}</h2>
        {description && <p className="mt-0.5 text-xs text-slate-500">{description}</p>}
      </div>
      {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
    </div>
  );
}

export function PageTitle({ title, actions, back }: { title: ReactNode; actions?: ReactNode; back?: ReactNode }) {
  return (
    <div className="mb-5 flex flex-wrap items-center justify-between gap-3">
      <div className="flex min-w-0 items-center gap-2">
        {back}
        <h1 className="truncate text-xl font-bold text-slate-800 sm:text-2xl">{title}</h1>
      </div>
      {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
    </div>
  );
}

export function Badge({ tone = "slate", children }: { tone?: "slate" | "blue" | "green" | "red" | "amber"; children: ReactNode }) {
  const styles = {
    slate: "bg-slate-100 text-slate-700",
    blue: "bg-blue-50 text-blue-700 ring-1 ring-blue-200",
    green: "bg-emerald-50 text-emerald-700 ring-1 ring-emerald-200",
    red: "bg-red-50 text-red-700 ring-1 ring-red-200",
    amber: "bg-amber-50 text-amber-800 ring-1 ring-amber-200",
  }[tone];
  return <span className={`inline-flex items-center whitespace-nowrap rounded-md px-2 py-0.5 text-xs font-medium ${styles}`}>{children}</span>;
}

export function EmptyState({ icon, title, children }: { icon?: ReactNode; title: string; children?: ReactNode }) {
  return (
    <div className="flex flex-col items-center gap-2 px-4 py-12 text-center">
      {icon && <div className="text-slate-300">{icon}</div>}
      <p className="font-medium text-slate-700">{title}</p>
      {children && <div className="text-sm text-slate-500">{children}</div>}
    </div>
  );
}

export function Pagination({ page, pageSize, total, onChange }: { page: number; pageSize: number; total: number; onChange: (p: number) => void }) {
  const pages = Math.max(1, Math.ceil(total / pageSize));
  if (total <= pageSize) return <p className="px-4 py-3 text-right text-xs text-slate-500">{total.toLocaleString()}件</p>;
  return (
    <div className="flex items-center justify-between gap-2 border-t border-slate-100 px-4 py-3 text-sm text-slate-600">
      <span>
        {total.toLocaleString()}件中 {((page - 1) * pageSize + 1).toLocaleString()}〜{Math.min(page * pageSize, total).toLocaleString()}件
      </span>
      <div className="flex items-center gap-1">
        <Button variant="secondary" size="sm" disabled={page <= 1} onClick={() => onChange(page - 1)} aria-label="前のページ">
          <ChevronLeft className="size-4" />
        </Button>
        <span className="min-w-14 text-center tabular-nums">
          {page} / {pages}
        </span>
        <Button variant="secondary" size="sm" disabled={page >= pages} onClick={() => onChange(page + 1)} aria-label="次のページ">
          <ChevronRight className="size-4" />
        </Button>
      </div>
    </div>
  );
}

export function Modal({
  open,
  onClose,
  title,
  children,
  footer,
  closeDisabled,
  size = "md",
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  children: ReactNode;
  footer?: ReactNode;
  closeDisabled?: boolean;
  size?: "md" | "lg" | "xl";
}) {
  const titleId = useId();
  const panelRef = useRef<HTMLDivElement>(null);
  const closeRef = useRef(onClose);
  useEffect(() => {
    closeRef.current = onClose;
  });

  useEffect(() => {
    if (!open) return;
    const previous = document.activeElement as HTMLElement | null;
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const first = panelRef.current?.querySelector<HTMLElement>("[data-autofocus], input, textarea, select");
    (first ?? panelRef.current)?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !closeDisabled) closeRef.current();
    };
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("keydown", onKey);
      document.body.style.overflow = prevOverflow;
      previous?.focus?.();
    };
  }, [open, closeDisabled]);

  if (!open) return null;
  const width = { md: "sm:max-w-lg", lg: "sm:max-w-2xl", xl: "sm:max-w-4xl" }[size];
  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center sm:items-center sm:p-4">
      <div className="absolute inset-0 bg-slate-900/40" onClick={() => !closeDisabled && onClose()} aria-hidden />
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        tabIndex={-1}
        className={`relative flex max-h-[92dvh] w-full flex-col rounded-t-2xl bg-white shadow-xl outline-none sm:rounded-xl ${width}`}
      >
        <div className="flex items-center justify-between border-b border-slate-200 px-5 py-3.5">
          <h2 id={titleId} className="text-lg font-semibold text-slate-800">
            {title}
          </h2>
          <button
            type="button"
            onClick={onClose}
            disabled={closeDisabled}
            className="-mr-2 rounded-lg p-2 text-slate-500 hover:bg-slate-100 disabled:opacity-50"
            aria-label="閉じる"
          >
            <X className="size-5" />
          </button>
        </div>
        <div className="flex-1 overflow-y-auto px-5 py-5">{children}</div>
        {footer && (
          <div className="flex flex-wrap justify-end gap-2 border-t border-slate-200 px-5 py-3 pb-[max(0.75rem,env(safe-area-inset-bottom))]">{footer}</div>
        )}
      </div>
    </div>
  );
}

/* ───────────── 確認ダイアログ ───────────── */

type ConfirmOptions = { title: string; message: ReactNode; confirmLabel?: string; danger?: boolean };
const ConfirmContext = createContext<(o: ConfirmOptions) => Promise<boolean>>(async () => false);

export function useConfirm() {
  return useContext(ConfirmContext);
}

/* ───────────── トースト（保存完了・エラー通知） ───────────── */

type Toast = { id: number; tone: "success" | "error" | "info"; message: string };
const ToastContext = createContext<(tone: Toast["tone"], message: string) => void>(() => {});

export function useToast() {
  return useContext(ToastContext);
}

export function UiProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const [confirm, setConfirm] = useState<(ConfirmOptions & { resolve: (v: boolean) => void }) | null>(null);
  const seq = useRef(0);

  const toast = useCallback((tone: Toast["tone"], message: string) => {
    const id = ++seq.current;
    setToasts((t) => [...t.slice(-2), { id, tone, message }]);
    setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), tone === "error" ? 6000 : 3000);
  }, []);

  const ask = useCallback((o: ConfirmOptions) => new Promise<boolean>((resolve) => setConfirm({ ...o, resolve })), []);
  const close = (v: boolean) => {
    confirm?.resolve(v);
    setConfirm(null);
  };

  return (
    <ToastContext.Provider value={toast}>
      <ConfirmContext.Provider value={ask}>
        {children}
        <div className="pointer-events-none fixed inset-x-0 bottom-20 z-[60] flex flex-col items-center gap-2 px-4 sm:bottom-6" aria-live="polite">
          {toasts.map((t) => (
            <div
              key={t.id}
              role={t.tone === "error" ? "alert" : "status"}
              className={`pointer-events-auto flex max-w-md items-center gap-2 rounded-lg px-4 py-3 text-sm font-medium text-white shadow-lg ${
                t.tone === "error" ? "bg-red-600" : t.tone === "success" ? "bg-emerald-600" : "bg-slate-800"
              }`}
            >
              {t.tone === "error" ? <AlertCircle className="size-4 shrink-0" /> : <CheckCircle2 className="size-4 shrink-0" />}
              {t.message}
            </div>
          ))}
        </div>
        <Modal
          open={!!confirm}
          onClose={() => close(false)}
          title={confirm?.title ?? ""}
          footer={
            <>
              <Button variant="secondary" onClick={() => close(false)}>
                キャンセル
              </Button>
              <Button variant={confirm?.danger ? "danger" : "primary"} onClick={() => close(true)} data-autofocus>
                {confirm?.confirmLabel ?? "OK"}
              </Button>
            </>
          }
        >
          <div className="text-[15px] leading-relaxed text-slate-700">{confirm?.message}</div>
        </Modal>
      </ConfirmContext.Provider>
    </ToastContext.Provider>
  );
}
