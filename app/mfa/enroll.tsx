"use client";

import { useActionState } from "react";
import {
  startEnrollment,
  verifyEnrollment,
  type Enrollment,
} from "../auth/actions";
import { Form } from "../form";

export const CODE_FIELD = {
  name: "code",
  label: "6-digit code",
  autoComplete: "one-time-code",
  inputMode: "numeric",
  pattern: "[0-9]{6}",
  maxLength: 6,
} as const;

// Shows the TOTP secret only to its owner, only while setting it up.
export function EnrollAuthenticator({ start }: { start: string }) {
  const [enrollment, startAction, pending] = useActionState<Enrollment>(
    startEnrollment,
    null
  );
  if (!enrollment || "error" in enrollment)
    return (
      <form action={startAction}>
        {enrollment?.error && (
          <p className="form-error" role="alert">
            {enrollment.error}
          </p>
        )}
        <button type="submit" disabled={pending}>
          {pending ? "Please wait…" : start}
        </button>
      </form>
    );
  return (
    <section aria-labelledby="enroll-steps">
      <h2 id="enroll-steps">Add Debrio to your authenticator app</h2>
      <ol>
        <li>
          Scan this QR code with an authenticator app.
          {/* eslint-disable-next-line @next/next/no-img-element -- Auth returns a data: URL SVG; no optimisation applies. */}
          <img
            className="qr"
            src={enrollment.qr}
            alt="QR code for adding Debrio to an authenticator app"
            width={200}
            height={200}
          />
        </li>
        <li>
          Or enter this setup key:{" "}
          <code className="secret">{enrollment.secret}</code>
        </li>
        <li>Enter the code the app shows.</li>
      </ol>
      <Form
        action={verifyEnrollment}
        submit="Verify and continue"
        hidden={{ factorId: enrollment.factorId }}
        fields={[CODE_FIELD]}
      />
    </section>
  );
}
