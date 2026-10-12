"use client";

import {
  createContext,
  startTransition,
  useActionState,
  useContext,
  useEffect,
  useId,
  useRef,
  type ComponentProps,
  type ReactNode,
} from "react";
import type { FormState } from "@/lib/validation";
import { cn } from "@/lib/utils";
import { Alert } from "./alert";
import { Button, type ButtonVariant } from "./button";
import { useT } from "@/i18n/client";

const FormStateContext = createContext<{ state: FormState; pending: boolean }>({ state: {}, pending: false });

type FormAction = (state: FormState, formData: FormData) => Promise<FormState>;

/**
 * Formulaire branché sur une server action (useActionState).
 * Les erreurs de validation sont redistribuées aux <Field> par contexte.
 * La soumission passe par onSubmit pour éviter la réinitialisation automatique
 * de React 19 (les saisies sont conservées en cas d'erreur).
 */
export function ActionForm({
  action,
  children,
  className,
  onSuccess,
  resetOnSuccess,
  showMessage = true,
  ...props
}: {
  action: FormAction;
  children: ReactNode;
  className?: string;
  onSuccess?: (state: FormState) => void;
  resetOnSuccess?: boolean;
  showMessage?: boolean;
} & Omit<ComponentProps<"form">, "action" | "children">) {
  const tr = useT();
  const [state, formAction, pending] = useActionState(action, {});
  const formRef = useRef<HTMLFormElement>(null);
  const lastNonce = useRef<number | undefined>(undefined);

  useEffect(() => {
    if (state.ok && state.nonce !== lastNonce.current) {
      lastNonce.current = state.nonce;
      if (resetOnSuccess) formRef.current?.reset();
      onSuccess?.(state);
    }
  }, [state, onSuccess, resetOnSuccess]);

  return (
    <FormStateContext value={{ state, pending }}>
      <form
        ref={formRef}
        className={className}
        noValidate
        onSubmit={(e) => {
          e.preventDefault();
          const fd = new FormData(e.currentTarget, (e.nativeEvent as SubmitEvent).submitter);
          startTransition(() => formAction(fd));
        }}
        {...props}
      >
        {showMessage && state.message && !state.ok && (
          <Alert kind="error" className="mb-5">
            {tr(state.message)}
          </Alert>
        )}
        {showMessage && state.message && state.ok && (
          <Alert kind="success" className="mb-5">
            {tr(state.message)}
          </Alert>
        )}
        {children}
      </form>
    </FormStateContext>
  );
}

export function useFormMessage() {
  return useContext(FormStateContext).state;
}

export function useFieldError(name: string) {
  return useContext(FormStateContext).state.errors?.[name];
}

/** Champ étiqueté : label (bright), contrôle, aide (muted) ou erreur (rouge + ✕). */
export function Field({
  label,
  name,
  hint,
  className,
  children,
  required,
}: {
  label: ReactNode;
  name: string;
  hint?: ReactNode;
  className?: string;
  required?: boolean;
  children: (props: { id: string; name: string; "aria-invalid"?: boolean; "aria-describedby"?: string }) => ReactNode;
}) {
  const tr = useT();
  const id = useId();
  const error = useFieldError(name);
  const describedBy = error || hint ? `${id}-help` : undefined;
  return (
    <div className={className}>
      <label htmlFor={id} className="mb-2 block text-sm font-medium text-h1">
        {label}
        {required && (
          <span className="ml-1 text-accent-text" aria-hidden="true">
            *
          </span>
        )}
      </label>
      {children({ id, name, "aria-invalid": error ? true : undefined, "aria-describedby": describedBy })}
      {error ? (
        <p id={describedBy} className="mt-2 flex items-center gap-1.5 text-xs text-red">
          <span aria-hidden="true">✕</span> {tr(error)}
        </p>
      ) : hint ? (
        <p id={describedBy} className="mt-2 text-xs text-meta">
          {hint}
        </p>
      ) : null}
    </div>
  );
}

const fieldBase = "field w-full px-4 py-2.5 text-base sm:text-sm";
export const inputClass = `${fieldBase} rounded-full`;
/** Zones multilignes : arrondi modéré, jamais en pilule. */
export const textareaClass = `${fieldBase} rounded-2xl resize-y leading-relaxed`;

/** Barre Annuler / Enregistrer des formulaires pleine page : tout en bas, après le dernier champ. */
export const FORM_ACTIONS_CLASS = "mt-2 flex justify-end gap-3";

export function TextField({
  label,
  name,
  hint,
  className,
  required,
  ...input
}: { label: ReactNode; name: string; hint?: ReactNode; className?: string } & Omit<ComponentProps<"input">, "name">) {
  return (
    <Field label={label} name={name} hint={hint} className={className} required={required}>
      {(p) => <input {...p} {...input} className={inputClass} />}
    </Field>
  );
}

export function TextAreaField({
  label,
  name,
  hint,
  className,
  required,
  ...props
}: { label: ReactNode; name: string; hint?: ReactNode; className?: string } & Omit<ComponentProps<"textarea">, "name">) {
  return (
    <Field label={label} name={name} hint={hint} className={className} required={required}>
      {(p) => <textarea rows={4} {...p} {...props} className={textareaClass} />}
    </Field>
  );
}

export function SelectField({
  label,
  name,
  hint,
  className,
  required,
  options,
  placeholder,
  ...props
}: {
  label: ReactNode;
  name: string;
  hint?: ReactNode;
  className?: string;
  options: { value: string | number; label: string }[];
  placeholder?: string;
} & Omit<ComponentProps<"select">, "name">) {
  return (
    <Field label={label} name={name} hint={hint} className={className} required={required}>
      {(p) => (
        <select {...p} {...props} className={inputClass}>
          {placeholder !== undefined && <option value="">{placeholder}</option>}
          {options.map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </select>
      )}
    </Field>
  );
}

/** Interrupteur (switch) de la charte. */
export function Switch({
  name,
  label,
  defaultChecked,
  hint,
}: {
  name: string;
  label: ReactNode;
  defaultChecked?: boolean;
  hint?: ReactNode;
}) {
  return (
    <label className="flex cursor-pointer items-start gap-3 text-sm text-h2">
      <input type="checkbox" role="switch" name={name} defaultChecked={defaultChecked} className="peer sr-only" />
      <span
        aria-hidden="true"
        className="mt-0.5 flex h-6 w-11 shrink-0 items-center rounded-full bg-elevated p-0.5 shadow-[inset_0_0_0_1px_var(--mm-border-strong)] transition-colors duration-200 peer-checked:bg-accent peer-checked:shadow-none peer-focus-visible:outline-2 peer-focus-visible:outline-offset-2 peer-focus-visible:outline-accent-hover peer-checked:[&>span]:translate-x-5 peer-checked:[&>span]:bg-field"
      >
        <span className="h-5 w-5 rounded-full bg-body transition-transform duration-200" />
      </span>
      <span>
        {label}
        {hint && <span className="mt-0.5 block text-xs text-meta">{hint}</span>}
      </span>
    </label>
  );
}

export function SubmitButton({
  children,
  pendingLabel = "Enregistrement…",
  variant = "primary",
  className,
  icon,
}: {
  children: ReactNode;
  pendingLabel?: string;
  variant?: ButtonVariant;
  className?: string;
  icon?: ReactNode;
}) {
  const tr = useT();
  pendingLabel = tr(pendingLabel);
  const { pending } = useContext(FormStateContext);
  return (
    <Button type="submit" variant={variant} disabled={pending} className={className} icon={icon} aria-busy={pending}>
      {pending ? pendingLabel : children}
    </Button>
  );
}

/** Groupe de champs titré dans un formulaire long. */
export function Fieldset({
  legend,
  description,
  children,
  className,
}: {
  legend: string;
  description?: string;
  children: ReactNode;
  className?: string;
}) {
  return (
    <fieldset className={cn("rounded-2xl border border-line-subtle bg-box p-5 sm:p-6", className)}>
      <legend className="sr-only">{legend}</legend>
      <div className="mb-5">
        <p className="font-mono text-xs uppercase tracking-[0.18em] text-accent-text">{legend}</p>
        {description && <p className="mt-1 text-sm text-meta">{description}</p>}
      </div>
      {children}
    </fieldset>
  );
}
