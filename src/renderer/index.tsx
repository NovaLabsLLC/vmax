import React from "react";
import ReactDOM from "react-dom/client";
import OverlayApp from "./OverlayApp";
import CommandCenter from "./CommandCenter";
import ErrorBoundary from "./ErrorBoundary";
import "./styles.css";

const view =
  window.location.hash.replace("#/", "").replace(/^\/+/, "") || "command";

// Different windows need different body fills: the overlay is transparent,
// the command center is opaque.
document.body.classList.add(view === "overlay" ? "view-overlay" : "view-command");

const Root = view === "overlay" ? OverlayApp : CommandCenter;

ReactDOM.createRoot(document.getElementById("root")!).render(
  <ErrorBoundary>
    <Root />
  </ErrorBoundary>
);
