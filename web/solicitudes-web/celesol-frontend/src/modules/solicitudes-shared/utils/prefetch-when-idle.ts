type IdleCallbackHandle = number;

type IdleDeadline = {
  didTimeout: boolean;
  timeRemaining: () => number;
};

type RequestIdleCallback = (
  callback: (deadline: IdleDeadline) => void,
  options?: { timeout?: number },
) => IdleCallbackHandle;

type CancelIdleCallback = (handle: IdleCallbackHandle) => void;

type WindowWithIdleCallbacks = Window &
  typeof globalThis & {
    cancelIdleCallback?: CancelIdleCallback;
    requestIdleCallback?: RequestIdleCallback;
  };

function getWindowWithIdleCallbacks() {
  if (typeof window === "undefined") {
    return null;
  }

  return window as WindowWithIdleCallbacks;
}

export function prefetchWhenIdle(prefetch: () => Promise<unknown>) {
  const targetWindow = getWindowWithIdleCallbacks();
  if (!targetWindow) {
    return () => undefined;
  }

  if (typeof targetWindow.requestIdleCallback === "function") {
    const idleId = targetWindow.requestIdleCallback(() => {
      void prefetch();
    });

    return () => {
      if (typeof targetWindow.cancelIdleCallback === "function") {
        targetWindow.cancelIdleCallback(idleId);
      }
    };
  }

  const timeoutId = window.setTimeout(() => {
    void prefetch();
  }, 0);

  return () => {
    window.clearTimeout(timeoutId);
  };
}
