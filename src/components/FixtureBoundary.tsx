import { Component, type ReactNode } from "react";

/** A broken example component must not take down its editor or recovery controls. */
export default class FixtureBoundary extends Component<
  { children: ReactNode; onRecover: () => void },
  { error: string | null }
> {
  state: { error: string | null } = { error: null };

  static getDerivedStateFromError(error: unknown) {
    return {
      error:
        error instanceof Error
          ? error.message
          : "The component could not render.",
    };
  }

  render() {
    if (this.state.error) {
      return (
        <div className="fixture-error" role="alert">
          <strong>Preview could not render</strong>
          <span>{this.state.error}</span>
          <button onClick={this.props.onRecover}>Open source to recover</button>
        </div>
      );
    }
    return this.props.children;
  }
}
