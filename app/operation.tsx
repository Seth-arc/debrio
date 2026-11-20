"use client";

import { useEffect, useState } from "react";

// Operation ids this tab has already shown in a form.
const shown = new Set<string>();

// One operation id per page view: a double or retried submit reuses it, so the
// database returns the first result. A page shown again (Back, a restored tab)
// gets a fresh id, so its submit is a new request.
export function OperationField({ initial }: { initial: string }) {
  const [operation, setOperation] = useState(initial);
  useEffect(() => {
    const fresh = () => setOperation(crypto.randomUUID());
    if (shown.has(initial)) fresh();
    else shown.add(initial);
    const restored = (event: PageTransitionEvent) => {
      if (event.persisted) fresh();
    };
    window.addEventListener("pageshow", restored);
    return () => window.removeEventListener("pageshow", restored);
  }, [initial]);
  return <input type="hidden" name="operation" value={operation} />;
}
