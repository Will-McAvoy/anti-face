import { Component, type ReactNode } from 'react';
export class ErrorBoundary extends Component<{ children: ReactNode }, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError() { return { failed: true }; }
  render() {
    return this.state.failed ? <div className="fatal-error"><h1>界面遇到了问题</h1><p>请重新打开 Anti Face。已应用的临时主题会在程序退出后恢复。</p><button onClick={() => window.location.reload()}>重新加载</button></div> : this.props.children;
  }
}
