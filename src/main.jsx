import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App.jsx";

// A render error in React unmounts the whole tree and leaves an empty <div
// id="root">, which is exactly the "blank page" symptom — with the real cause
// visible only in the console. This boundary catches it and shows the message
// and stack on screen, so a crash reports itself instead of hiding.
class ErrorBoundary extends React.Component {
  constructor(props) { super(props); this.state = { error: null, info: null }; }
  static getDerivedStateFromError(error) { return { error }; }
  componentDidCatch(error, info) { this.setState({ info }); console.error("App crashed:", error, info); }
  render() {
    if (!this.state.error) return this.props.children;
    const box = { fontFamily: "ui-monospace, monospace", fontSize: 12, lineHeight: 1.6,
      whiteSpace: "pre-wrap", wordBreak: "break-word", background: "#fff5f5",
      border: "1px solid #f0b4b4", borderRadius: 8, padding: 12, margin: "10px 0", color: "#7a1c1c" };
    return (
      <div style={{ padding: 20, maxWidth: 760, margin: "0 auto", fontFamily: "system-ui, sans-serif" }}>
        <h2 style={{ margin: "0 0 4px", fontSize: 17 }}>The app hit an error and stopped</h2>
        <p style={{ fontSize: 13, color: "#555", margin: "0 0 10px" }}>
          Copy everything below — it identifies the exact cause.
        </p>
        <div style={box}>{String(this.state.error?.stack || this.state.error)}</div>
        {this.state.info?.componentStack && (
          <div style={box}>{this.state.info.componentStack}</div>
        )}
        <button onClick={() => window.location.reload()}
          style={{ padding: "8px 14px", fontSize: 13, borderRadius: 7, border: "1px solid #ccc",
                   background: "#fff", cursor: "pointer" }}>
          Reload
        </button>
      </div>
    );
  }
}

ReactDOM.createRoot(document.getElementById("root")).render(
  <React.StrictMode>
    <ErrorBoundary>
      <App />
    </ErrorBoundary>
  </React.StrictMode>
);
