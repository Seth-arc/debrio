"use client";

import { useActionState, useId } from "react";

export type FormState = {
  error?: string;
  values?: Record<string, string>;
} | null;

type Field = {
  name: string;
  label: string;
  type?: "email" | "password" | "text";
  autoComplete?: string;
  inputMode?: "numeric";
  pattern?: string;
  minLength?: number;
  maxLength?: number;
  hint?: string;
  keep?: boolean;
};

// One server-action form: native validation, kept values and an announced error.
export function Form({
  action,
  submit,
  fields,
  hidden = {},
}: {
  action: (state: FormState, data: FormData) => Promise<FormState>;
  submit: string;
  fields: Field[];
  hidden?: Record<string, string>;
}) {
  const [state, formAction, pending] = useActionState(action, null);
  const id = useId();
  return (
    // Remount after each reply so kept values survive React's post-action form reset.
    <form action={formAction} key={JSON.stringify(state)}>
      {Object.entries(hidden).map(([name, value]) => (
        <input key={name} type="hidden" name={name} value={value} />
      ))}
      {fields.map((field) => {
        const hintId = field.hint ? `${id}-${field.name}-hint` : undefined;
        return (
          <div className="field" key={field.name}>
            <label htmlFor={`${id}-${field.name}`}>{field.label}</label>
            {field.hint && (
              <p className="hint" id={hintId}>
                {field.hint}
              </p>
            )}
            <input
              id={`${id}-${field.name}`}
              name={field.name}
              type={field.type ?? "text"}
              required
              autoComplete={field.autoComplete}
              inputMode={field.inputMode}
              pattern={field.pattern}
              minLength={field.minLength}
              maxLength={field.maxLength}
              defaultValue={
                field.keep ? state?.values?.[field.name] : undefined
              }
              aria-invalid={state?.error ? true : undefined}
              aria-describedby={
                [hintId, state?.error && `${id}-error`]
                  .filter(Boolean)
                  .join(" ") || undefined
              }
            />
          </div>
        );
      })}
      {state?.error && (
        <p className="form-error" role="alert" id={`${id}-error`}>
          {state.error}
        </p>
      )}
      <button type="submit" disabled={pending}>
        {pending ? "Please wait…" : submit}
      </button>
    </form>
  );
}
