'use client';

import { Component, type ReactNode } from 'react';

export default class PanelErrorBoundary extends Component<{ name: string; children: ReactNode }, { failed: boolean }> {
  state = { failed: false };

  static getDerivedStateFromError() { return { failed: true }; }

  render() {
    if (!this.state.failed) return this.props.children;
    return (
      <section className="context-panel" aria-label={this.props.name}>
        <h2>{this.props.name}</h2>
        <p className="market-panel-note" role="alert">This panel could not be displayed.</p>
        <button className="market-panel-retry" onClick={() => this.setState({ failed: false })}>Retry {this.props.name.toLowerCase()}</button>
      </section>
    );
  }
}
