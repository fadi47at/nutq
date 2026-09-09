import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import Overlay from "./views/Overlay";
import "@fontsource/vazirmatn/400.css";
import "@fontsource/vazirmatn/500.css";
import "@fontsource/vazirmatn/600.css";
import "@fontsource/vazirmatn/700.css";
import "./styles.css";

// The overlay window loads the same bundle with #overlay; it must not render
// the full app, and its body has to be transparent for the pill to float.
const isOverlay = window.location.hash === "#overlay";
if (isOverlay) document.body.classList.add("overlay-mode");

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>{isOverlay ? <Overlay /> : <App />}</React.StrictMode>,
);
