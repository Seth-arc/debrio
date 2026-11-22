"use client";

import { useEffect } from "react";

// One page-level guard protects every editor marked data-work-protected.
export function useNavigationGuard() {
  useEffect(() => {
    let guarded = false,
      leaving = false,
      restoring = false;
    const dirty = () =>
      !!document.querySelector('[data-work-protected="true"]');
    const arm = () => {
      if (!guarded && dirty()) {
        window.history.pushState(
          window.history.state,
          "",
          window.location.href
        );
        guarded = true;
      }
    };
    const observer = new MutationObserver(arm);
    observer.observe(document.body, {
      subtree: true,
      attributes: true,
      childList: true,
      attributeFilter: ["data-work-protected"],
    });
    arm();
    const unload = (event: BeforeUnloadEvent) => {
      if (!leaving && dirty()) {
        event.preventDefault();
        event.returnValue = "";
      }
    };
    const back = () => {
      if (restoring) {
        restoring = false;
        return;
      }
      if (!guarded || leaving) return;
      if (
        dirty() &&
        !window.confirm(
          "Leave this page? Unsaved edits or an unresolved request may be lost."
        )
      ) {
        restoring = true;
        window.history.forward();
      } else {
        leaving = true;
        window.history.back();
      }
    };
    const click = (event: MouseEvent) => {
      const anchor = (event.target as Element).closest?.("a[href]");
      if (
        anchor &&
        anchor.getAttribute("target") !== "_blank" &&
        dirty() &&
        !window.confirm(
          "Leave this page? Unsaved edits or an unresolved request may be lost."
        )
      ) {
        event.preventDefault();
        event.stopPropagation();
      }
    };
    window.addEventListener("beforeunload", unload);
    window.addEventListener("popstate", back);
    document.addEventListener("click", click, true);
    return () => {
      observer.disconnect();
      window.removeEventListener("beforeunload", unload);
      window.removeEventListener("popstate", back);
      document.removeEventListener("click", click, true);
    };
  }, []);
}
