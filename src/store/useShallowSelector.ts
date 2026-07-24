import { useRef } from 'react';
import { shallow } from 'zustand/vanilla/shallow';

/**
 * Phase 52 — local stand-in for zustand's own `useShallow` (normally
 * `zustand/react/shallow`). That hook crashes under this project's Vite
 * dependency pre-bundler (Rolldown-based): its pre-bundled chunk wraps
 * React in a CJS-interop shim, and the `useRef` call inside that shim hits
 * a null hook dispatcher — "Cannot read properties of null (reading
 * 'useRef')" — even though this file's own, ordinary `useRef` import works
 * fine everywhere else in the app. Same algorithm as zustand's `useShallow`
 * (a ref-memoized shallow-equality selector wrapper), built from this
 * file's own working React import and zustand's pure, hook-free `shallow`
 * comparator instead of the broken pre-bundled hook chunk.
 */
export function useShallow<S, U>(selector: (state: S) => U): (state: S) => U {
  const prev = useRef<U | undefined>(undefined);
  return (state: S) => {
    const next = selector(state);
    if (prev.current !== undefined && shallow(prev.current, next)) {
      return prev.current;
    }
    prev.current = next;
    return next;
  };
}
