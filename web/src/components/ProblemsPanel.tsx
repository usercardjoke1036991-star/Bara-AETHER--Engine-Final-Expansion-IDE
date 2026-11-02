// A7 — lista de problemas con salto a línea/columna.

import type { EditorProblem } from "../problems";

interface ProblemsPanelProps {
  problems: EditorProblem[];
  onOpen: (problem: EditorProblem) => void;
}

export default function ProblemsPanel({ problems, onOpen }: ProblemsPanelProps) {
  if (problems.length === 0) {
    return <p className="muted">Sin problemas en el documento activo.</p>;
  }
  return (
    <ul className="problems-list" aria-label="Problemas del editor">
      {problems.map((problem) => (
        <li key={problem.id}>
          <button
            type="button"
            className={`problem-row severity-${problem.severity}`}
            title={`${problem.path}:${problem.line}:${problem.column}`}
            onClick={() => onOpen(problem)}
          >
            <span className="problem-loc">
              {problem.path}:{problem.line}:{problem.column}
            </span>
            <span className="problem-msg">{problem.message}</span>
          </button>
        </li>
      ))}
    </ul>
  );
}
