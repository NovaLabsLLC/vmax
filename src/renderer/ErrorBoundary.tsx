import React from "react";

type State = { error: Error | null };

export default class ErrorBoundary extends React.Component<
  { children: React.ReactNode },
  State
> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error) {
    return { error };
  }
  componentDidCatch(error: Error, info: React.ErrorInfo) {
    // Surface in devtools so the actual stack is one ⌘⌥I away.
    // eslint-disable-next-line no-console
    console.error("[exec] render crashed", error, info);
  }

  render() {
    if (this.state.error) {
      return (
        <div className="h-full w-full flex items-center justify-center bg-[#08080a]">
          <div className="max-w-[480px] mx-auto px-6 py-8 text-[#e6e6ea]">
            <div className="text-[14px] font-semibold mb-2">Something went wrong rendering this view.</div>
            <pre className="mono text-[11px] text-red-300/85 whitespace-pre-wrap leading-snug">
              {String(this.state.error.message || this.state.error)}
            </pre>
            <button
              onClick={() => this.setState({ error: null })}
              className="mt-4 h-9 px-4 rounded-lg text-[12.5px] font-medium bg-white text-black hover:bg-white/90"
            >
              Try again
            </button>
            <div className="mt-3 text-[11px] text-white/45">
              Open DevTools (⌘⌥I) for the full stack.
            </div>
          </div>
        </div>
      );
    }
    return this.props.children;
  }
}
