import * as React from "react";

import type { ToastActionElement, ToastProps } from "@/components/ui/toast";

const TOAST_LIMIT = 1;
const TOAST_REMOVE_DELAY = 1000000;
const DEFAULT_DURATION = 5000;

type ToasterToast = ToastProps & {
  id: string;
  title?: React.ReactNode;
  description?: React.ReactNode;
  action?: ToastActionElement;
  duration?: number;
  onMouseEnter?: React.MouseEventHandler;
  onMouseLeave?: React.MouseEventHandler;
};

const actionTypes = {
  ADD_TOAST: "ADD_TOAST",
  UPDATE_TOAST: "UPDATE_TOAST",
  DISMISS_TOAST: "DISMISS_TOAST",
  REMOVE_TOAST: "REMOVE_TOAST",
} as const;

let count = 0;

function genId() {
  count = (count + 1) % Number.MAX_SAFE_INTEGER;
  return count.toString();
}

type ActionType = typeof actionTypes;

type Action =
  | { type: ActionType["ADD_TOAST"]; toast: ToasterToast }
  | { type: ActionType["UPDATE_TOAST"]; toast: Partial<ToasterToast> }
  | { type: ActionType["DISMISS_TOAST"]; toastId?: ToasterToast["id"] }
  | { type: ActionType["REMOVE_TOAST"]; toastId?: ToasterToast["id"] };

interface State {
  toasts: ToasterToast[];
}

const toastTimeouts = new Map<string, ReturnType<typeof setTimeout>>();

const addToRemoveQueue = (toastId: string) => {
  if (toastTimeouts.has(toastId)) return;
  const timeout = setTimeout(() => {
    toastTimeouts.delete(toastId);
    dispatch({ type: "REMOVE_TOAST", toastId });
  }, TOAST_REMOVE_DELAY);
  toastTimeouts.set(toastId, timeout);
};

export const reducer = (state: State, action: Action): State => {
  switch (action.type) {
    case "ADD_TOAST":
      return { ...state, toasts: [action.toast, ...state.toasts].slice(0, TOAST_LIMIT) };
    case "UPDATE_TOAST":
      return {
        ...state,
        toasts: state.toasts.map((t) => (t.id === action.toast.id ? { ...t, ...action.toast } : t)),
      };
    case "DISMISS_TOAST": {
      const { toastId } = action;
      if (toastId) addToRemoveQueue(toastId);
      else state.toasts.forEach((t) => addToRemoveQueue(t.id));
      return {
        ...state,
        toasts: state.toasts.map((t) =>
          t.id === toastId || toastId === undefined ? { ...t, open: false } : t,
        ),
      };
    }
    case "REMOVE_TOAST":
      if (action.toastId === undefined) return { ...state, toasts: [] };
      return { ...state, toasts: state.toasts.filter((t) => t.id !== action.toastId) };
  }
};

const listeners: Array<(state: State) => void> = [];
let memoryState: State = { toasts: [] };

function dispatch(action: Action) {
  memoryState = reducer(memoryState, action);
  listeners.forEach((listener) => listener(memoryState));
}

type Toast = Omit<ToasterToast, "id">;

// Wall-clock auto-dismiss timers (independent of tab focus / Radix pause behavior).
// Pause only on pointer hover; resume on leave.
const dismissTimers = new Map<string, { timeoutId: ReturnType<typeof setTimeout>; remaining: number; startedAt: number; paused: boolean }>();

function clearDismissTimer(id: string) {
  const t = dismissTimers.get(id);
  if (t) {
    clearTimeout(t.timeoutId);
    dismissTimers.delete(id);
  }
}

function scheduleDismiss(id: string, duration: number) {
  clearDismissTimer(id);
  const timeoutId = setTimeout(() => {
    dismissTimers.delete(id);
    dispatch({ type: "DISMISS_TOAST", toastId: id });
  }, duration);
  dismissTimers.set(id, { timeoutId, remaining: duration, startedAt: Date.now(), paused: false });
}

export function pauseToastTimer(id: string) {
  const t = dismissTimers.get(id);
  if (!t || t.paused) return;
  clearTimeout(t.timeoutId);
  const elapsed = Date.now() - t.startedAt;
  t.remaining = Math.max(0, t.remaining - elapsed);
  t.paused = true;
}

export function resumeToastTimer(id: string) {
  const t = dismissTimers.get(id);
  if (!t || !t.paused) return;
  scheduleDismiss(id, t.remaining);
}

function toast({ duration = DEFAULT_DURATION, ...props }: Toast) {
  const id = genId();
  const update = (next: ToasterToast) => dispatch({ type: "UPDATE_TOAST", toast: { ...next, id } });
  const dismiss = () => {
    clearDismissTimer(id);
    dispatch({ type: "DISMISS_TOAST", toastId: id });
  };

  dispatch({
    type: "ADD_TOAST",
    toast: {
      ...props,
      id,
      open: true,
      // Disable Radix's built-in auto-dismiss (which pauses on tab blur / visibility change).
      // We manage dismissal with a wall-clock timer below.
      duration: Infinity,
      onOpenChange: (open) => {
        if (!open) dismiss();
      },
    },
  });

  if (Number.isFinite(duration) && duration > 0) {
    scheduleDismiss(id, duration);
  }

  return { id, dismiss, update };
}

function useToast() {
  const [state, setState] = React.useState<State>(memoryState);

  React.useEffect(() => {
    listeners.push(setState);
    return () => {
      const index = listeners.indexOf(setState);
      if (index > -1) listeners.splice(index, 1);
    };
  }, [state]);

  return {
    ...state,
    toast,
    dismiss: (toastId?: string) => {
      if (toastId) clearDismissTimer(toastId);
      else dismissTimers.forEach((_, id) => clearDismissTimer(id));
      dispatch({ type: "DISMISS_TOAST", toastId });
    },
  };
}

export { useToast, toast };
