import { useEffect, useState } from "react";

import { readAppVersion } from "./readAppVersion";

/** Etiqueta vX.Y.Z leída de la app, no de un literal. */
export default function AppVersion() {
  const [label, setLabel] = useState("");

  useEffect(() => {
    let live = true;
    void readAppVersion().then((value) => {
      if (live) {
        setLabel(value);
      }
    });
    return () => {
      live = false;
    };
  }, []);

  if (!label) {
    return null;
  }
  return (
    <span className="app-version" title="Versión de Bara IDE">
      {label}
    </span>
  );
}
