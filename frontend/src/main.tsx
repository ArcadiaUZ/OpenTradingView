import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import { feedClient } from "./lib/feed";
import { useTerminal } from "./store";
import "./global.css";
import "./ui.css";
import "./drawings-ui.css";
import "./replay.css";

// The socket lives outside React so dev-mode double effects cannot kill it.
feedClient.connect("ws://" + window.location.host + "/ws", useTerminal.getState().handleMessage);
window.setInterval(() => useTerminal.getState().tickClock(), 1000);

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);
