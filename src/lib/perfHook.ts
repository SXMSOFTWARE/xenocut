// Counts React commits without React DevTools: react-dom reports every commit to this global hook
// (also in production builds). Must be imported before React. Used by the autotest perf probe.
type Hook = Record<string, unknown>;
export const perfCounters = { commits: 0 };
const w = window as unknown as { __REACT_DEVTOOLS_GLOBAL_HOOK__?: Hook };
if (!w.__REACT_DEVTOOLS_GLOBAL_HOOK__) {
  w.__REACT_DEVTOOLS_GLOBAL_HOOK__ = {
    supportsFiber: true,
    renderers: new Map(),
    inject: () => 1,
    onScheduleFiberRoot: () => {},
    onCommitFiberRoot: () => {
      perfCounters.commits++;
    },
    onCommitFiberUnmount: () => {},
    onPostCommitFiberRoot: () => {},
    checkDCE: () => {},
  };
}
