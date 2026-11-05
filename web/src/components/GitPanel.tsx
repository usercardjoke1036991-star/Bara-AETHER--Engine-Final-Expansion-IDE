// A6 — panel Git: status, diff, commit, ramas (sin push).

import { useCallback, useEffect, useState } from "react";

import { describeError } from "../engine";
import {
  gitBranches,
  gitCheckout,
  gitCommit,
  gitDiff,
  gitStatus,
  type GitBranchReport,
  type GitStatusReport,
} from "../gitWorkspace";

interface GitPanelProps {
  workspaceRoot: string;
}

export default function GitPanel({ workspaceRoot }: GitPanelProps) {
  const [status, setStatus] = useState<GitStatusReport | null>(null);
  const [branches, setBranches] = useState<GitBranchReport | null>(null);
  const [patch, setPatch] = useState("");
  const [message, setMessage] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    if (!workspaceRoot) {
      setStatus(null);
      setBranches(null);
      setPatch("");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const [nextStatus, nextBranches, nextDiff] = await Promise.all([
        gitStatus(),
        gitBranches(),
        gitDiff(),
      ]);
      setStatus(nextStatus);
      setBranches(nextBranches);
      setPatch(nextDiff.patch);
    } catch (reason: unknown) {
      setError(describeError(reason));
      setStatus(null);
      setBranches(null);
      setPatch("");
    } finally {
      setBusy(false);
    }
  }, [workspaceRoot]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const onCommit = useCallback(async () => {
    const text = message.trim();
    if (!text) {
      setError("Escribe un mensaje de commit.");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const report = await gitCommit(text);
      setNotice(report.summary);
      setMessage("");
      await refresh();
    } catch (reason: unknown) {
      const msg = describeError(reason);
      if (msg.trim() === "cancelado") {
        setNotice("Commit cancelado. No se escribió nada.");
      } else {
        setError(msg);
      }
    } finally {
      setBusy(false);
    }
  }, [message, refresh]);

  const onSwitch = useCallback(
    async (name: string, create: boolean) => {
      setBusy(true);
      setError(null);
      try {
        const next = await gitCheckout(name, create);
        setBranches(next);
        setNotice(create ? `Rama creada: ${next.current}` : `En ${next.current}`);
        await refresh();
      } catch (reason: unknown) {
        setError(describeError(reason));
      } finally {
        setBusy(false);
      }
    },
    [refresh],
  );

  if (!workspaceRoot) {
    return <p className="muted">Abre una carpeta para usar Git.</p>;
  }

  return (
    <div className="git-panel">
      <div className="row" style={{ gap: "0.5rem", flexWrap: "wrap" }}>
        <strong>
          {branches?.current ? `rama ${branches.current}` : "Git"}
          {status?.dirty ? " · cambios" : status ? " · limpio" : ""}
        </strong>
        <span className="grow" />
        <button type="button" disabled={busy} onClick={() => void refresh()}>
          Actualizar
        </button>
      </div>
      {error ? <p className="error">{error}</p> : null}
      {notice ? <p className="muted">{notice}</p> : null}

      <h4>Cambios</h4>
      {status && status.entries.length > 0 ? (
        <ul className="git-entries">
          {status.entries.map((entry) => (
            <li key={entry.path}>
              <code>
                {entry.index}
                {entry.worktree}
              </code>{" "}
              {entry.path}
            </li>
          ))}
        </ul>
      ) : (
        <p className="muted">Sin cambios en el índice/trabajo.</p>
      )}

      <h4>Diff</h4>
      <pre className="ai-code-body ai-diff git-diff">{patch || "(vacío)"}</pre>

      <h4>Commit</h4>
      <p className="muted">No hay push ni operaciones destructivas desde este panel.</p>
      <textarea
        className="path"
        rows={2}
        value={message}
        disabled={busy}
        placeholder="Mensaje del commit"
        onChange={(event) => setMessage(event.target.value)}
      />
      <button type="button" disabled={busy || !message.trim()} onClick={() => void onCommit()}>
        Crear commit
      </button>

      <h4>Ramas</h4>
      <ul className="git-branches">
        {(branches?.branches ?? []).map((name) => (
          <li key={name}>
            <button
              type="button"
              disabled={busy || name === branches?.current}
              onClick={() => void onSwitch(name, false)}
            >
              {name === branches?.current ? `● ${name}` : name}
            </button>
          </li>
        ))}
      </ul>
      <button
        type="button"
        disabled={busy}
        onClick={() => {
          const name = window.prompt("Nombre de la nueva rama");
          const trimmed = name?.trim() ?? "";
          if (trimmed) {
            void onSwitch(trimmed, true);
          }
        }}
      >
        Nueva rama…
      </button>
    </div>
  );
}
