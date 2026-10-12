import React from "react";
import ReactDOM from "react-dom/client";

import App from "./App";
import "./styles.css";

const container = document.getElementById("root");

if (!container) {
  throw new Error("Bara IDE: no se encontro el contenedor #root del documento");
}

ReactDOM.createRoot(container).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
