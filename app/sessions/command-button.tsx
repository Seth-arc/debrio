"use client";

import { useFormStatus } from "react-dom";

export function CommandButton({
  label,
  secondary,
  children,
}: {
  label?: string;
  secondary?: boolean;
  children: string;
}) {
  const { pending } = useFormStatus();
  return (
    <button
      type="submit"
      aria-label={label}
      className={secondary ? "secondary" : undefined}
      disabled={pending}
      data-pending={pending}
    >
      {children}
    </button>
  );
}
