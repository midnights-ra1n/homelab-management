
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
  liveError,
}: {
  label: ReactNode;
  name: string;
  hint?: ReactNode;
  className?: string;
  required?: boolean;
  /** Contrôle pendant la saisie ; l'erreur renvoyée par le serveur reste prioritaire. */
  liveError?: string;
  children: (props: { id: string; name: string; "aria-invalid"?: boolean; "aria-describedby"?: string }) => ReactNode;
}) {
  const tr = useT();
  const id = useId();
  const error = useFieldError(name) ?? (liveError || undefined);
  const describedBy = error || hint ? `${id}-help` : undefined;
  return (
    <div className={cn("mm-field", className)}>
      <label htmlFor={id} className="mm-field__label">
        {label}
        {required && (
          <span className="mm-field__req" aria-hidden="true">
            *
          </span>
        )}
      </label>
      {children({ id, name, "aria-invalid": error ? true : undefined, "aria-describedby": describedBy })}
      {error ? (
        <p id={describedBy} className="mm-field__error">
          <span aria-hidden="true">✕</span> {tr(error)}
        </p>
      ) : hint ? (
        <p id={describedBy} className="mm-help">
          {hint}
        </p>
      ) : null}
    </div>
  );
}

// Charte : champs en pilule de 36 px (44 px au tactile), textarea rayon 18. 16 px sur mobile (pas de zoom iOS).
const fieldBase = "field w-full px-4 text-base sm:text-sm";
export const inputClass = `${fieldBase} h-9 pointer-coarse:h-11 rounded-full`;
/** Zones multilignes : arrondi modéré, jamais en pilule. */
export const textareaClass = `${fieldBase} min-h-22 py-2.5 rounded-[18px] resize-y leading-relaxed`;

/** Barre Annuler / Enregistrer des formulaires pleine page : tout en bas, après le dernier champ. */
export const FORM_ACTIONS_CLASS = "mt-2 flex justify-end gap-3";

export function TextField({
  label,
  name,
  hint,
  className,
  required,
  liveError,
  ...input
}: { label: ReactNode; name: string; hint?: ReactNode; className?: string; liveError?: string } & Omit<ComponentProps<"input">, "name">) {
  return (
    <Field label={label} name={name} hint={hint} className={className} required={required} liveError={liveError}>
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
        className="mt-0.5 flex h-5 w-9 shrink-0 items-center rounded-full border border-line-strong bg-field px-0.5 transition-colors duration-[120ms] peer-checked:border-accent peer-checked:bg-accent peer-focus-visible:outline-2 peer-focus-visible:outline-offset-2 peer-focus-visible:outline-[var(--mm-focus)] peer-checked:[&>span]:translate-x-4 peer-checked:[&>span]:bg-on-accent"
      >
        <span className="h-3.5 w-3.5 rounded-full bg-body transition-transform duration-[180ms]" />
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
  id,
}: {
  legend: string;
  description?: string;
  children: ReactNode;
  className?: string;
  id?: string;
}) {
  return (
    <fieldset id={id} className={cn("mm-card scroll-mt-6 p-5", className)}>
      <legend className="sr-only">{legend}</legend>
      <div className="mb-5">
        <p className="mm-h3">{legend}</p>
        {description && <p className="mm-help mt-0.5">{description}</p>}
      </div>
      {children}
    </fieldset>
  );
}
