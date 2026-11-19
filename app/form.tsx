"use client";

import { startTransition, useActionState, useId } from "react";

export type FormState = { error?: string } | null;

// Auth hashes at most 72 bytes; the server re-checks this rule.
export const NEW_PASSWORD_RULE = {
  type: "password",
  autoComplete: "new-password",
  minLength: 12,
  maxLength: 72,
  hint: "12 to 72 characters; accented letters and symbols count as more than one. A passphrase works well.",
} as const;

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
};

// Each server reply is a new object; give it a stable key so a repeated message
// is a new alert node and is announced again.
const replyIds = new WeakMap<object, number>();
let lastReplyId = 0;
export function replyKey(reply: object) {
  if (!replyIds.has(reply)) replyIds.set(reply, ++lastReplyId);
  return replyIds.get(reply);
}

// One server-action form: native validation and an error announced on every reply.
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
  // The server action itself, so the form also submits before scripts load.
  const [state, formAction, pending] = useActionState(action, null);
  const id = useId();
  return (
    <form
      action={formAction}
      onSubmit={(event) => {
        // Submitting outside React's form action keeps typed values and focus after an error.
        event.preventDefault();
        const data = new FormData(event.currentTarget);
        startTransition(() => formAction(data));
      }}
    >
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
        // A new node per reply, so a repeated message is announced again.
        <p
          className="form-error"
          role="alert"
          id={`${id}-error`}
          key={replyKey(state)}
        >
          {state.error}
        </p>
      )}
      <button type="submit" disabled={pending}>
        {pending ? "Please wait…" : submit}
      </button>
    </form>
  );
}
