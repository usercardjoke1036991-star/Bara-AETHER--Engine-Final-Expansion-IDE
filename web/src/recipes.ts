// Recetas de un clic. El nombre es un catálogo cerrado; el proceso y los
// argumentos los elige el backend.

import { invoke } from "@tauri-apps/api/core";

export type RecipeName = "check" | "test" | "typecheck";

export interface RecipeLine {
  text: string;
  status: string;
  glyph: string;
}

export interface RecipeReport {
  recipe: string;
  exitCode: number;
  lines: RecipeLine[];
  trueCount: number;
  falseCount: number;
  bothCount: number;
  neitherCount: number;
  truncated: boolean;
  timedOut: boolean;
}

export function runWorkspaceRecipe(recipe: RecipeName): Promise<RecipeReport> {
  return invoke<RecipeReport>("run_workspace_recipe", { recipe });
}
