/// <reference types="node" />

import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  resolveListRefreshState,
  runListManualRefresh,
} from "./list-refresh-state.ts";

describe("resolveListRefreshState", () => {
  it("disables the refresh action during the initial load request", () => {
    const state = resolveListRefreshState({
      hasData: false,
      isFetching: true,
      isLoading: true,
      isManualRefreshPending: false,
    });

    assert.deepEqual(state, {
      isBackgroundRefreshing: false,
      isInitialLoading: true,
      isRefreshActionDisabled: true,
    });
  });

  it("shows a background refresh without replacing the current data", () => {
    const state = resolveListRefreshState({
      hasData: true,
      isFetching: true,
      isLoading: false,
      isManualRefreshPending: false,
    });

    assert.deepEqual(state, {
      isBackgroundRefreshing: true,
      isInitialLoading: false,
      isRefreshActionDisabled: true,
    });
  });

  it("keeps the refresh action enabled after an error when there is no active request", () => {
    const state = resolveListRefreshState({
      hasData: false,
      isFetching: false,
      isLoading: false,
      isManualRefreshPending: false,
    });

    assert.deepEqual(state, {
      isBackgroundRefreshing: false,
      isInitialLoading: false,
      isRefreshActionDisabled: false,
    });
  });

  it("keeps the refresh action disabled while a manual refresh promise is pending", () => {
    const state = resolveListRefreshState({
      hasData: true,
      isFetching: false,
      isLoading: false,
      isManualRefreshPending: true,
    });

    assert.deepEqual(state, {
      isBackgroundRefreshing: false,
      isInitialLoading: false,
      isRefreshActionDisabled: true,
    });
  });
});

describe("runListManualRefresh", () => {
  it("calls refetch once when the action is enabled", async () => {
    const pendingRef = { current: false };
    const states: boolean[] = [];
    let calls = 0;

    const started = runListManualRefresh({
      isRefreshActionDisabled: false,
      isRefreshPendingRef: pendingRef,
      refetch: async () => {
        calls += 1;
      },
      setIsManualRefreshPending: (value) => {
        states.push(value);
      },
    });

    assert.equal(await started, true);
    assert.equal(calls, 1);
    assert.deepEqual(states, [true, false]);
    assert.equal(pendingRef.current, false);
  });

  it("ignores additional rapid clicks while the first refetch is still pending", async () => {
    const pendingRef = { current: false };
    const states: boolean[] = [];
    let calls = 0;
    let resolveRefetch!: () => void;

    const firstRefresh = runListManualRefresh({
      isRefreshActionDisabled: false,
      isRefreshPendingRef: pendingRef,
      refetch: () =>
        new Promise<void>((resolve) => {
          calls += 1;
          resolveRefetch = resolve;
        }),
      setIsManualRefreshPending: (value) => {
        states.push(value);
      },
    });
    const secondRefresh = runListManualRefresh({
      isRefreshActionDisabled: false,
      isRefreshPendingRef: pendingRef,
      refetch: async () => {
        calls += 1;
      },
      setIsManualRefreshPending: (value) => {
        states.push(value);
      },
    });

    assert.equal(await secondRefresh, false);
    assert.equal(calls, 1);
    assert.equal(pendingRef.current, true);

    resolveRefetch();
    assert.equal(await firstRefresh, true);
    assert.deepEqual(states, [true, false]);
    assert.equal(pendingRef.current, false);
  });

  it("does not call refetch while the action is disabled", async () => {
    const pendingRef = { current: false };
    let calls = 0;

    const started = runListManualRefresh({
      isRefreshActionDisabled: true,
      isRefreshPendingRef: pendingRef,
      refetch: async () => {
        calls += 1;
      },
      setIsManualRefreshPending: () => {
        throw new Error("should not toggle pending state");
      },
    });

    assert.equal(await started, false);
    assert.equal(calls, 0);
    assert.equal(pendingRef.current, false);
  });
});
