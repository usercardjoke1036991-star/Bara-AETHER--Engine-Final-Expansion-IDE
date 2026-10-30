// Verificación de bloques ```bara contra el análisis del kernel (IPC).

import { analyzeSource, type Analysis } from "./engine";

export type BaraVerifyStatus = "verified" | "unverified" | "pending" | "error";

/** Decide si un análisis del kernel considera el bloque verificado. */
export function statusFromAnalysis(analysis: Analysis): BaraVerifyStatus {
  if (analysis.summary.rootsUnknown > 0) {
    return "unverified";
  }
  if (analysis.summary.rootsKnown === 0) {
    return "unverified";
  }
  // Alineado con auto_apply: identificadores ASCII/Latin libres invalidan el bloque.
  if (analysis.summary.identifiers > 0) {
    return "unverified";
  }
  return "verified";
}

/** Valida un bloque con el lexer/kernel del IDE. */
export async function verifyBaraBlock(code: string): Promise<BaraVerifyStatus> {
  const trimmed = code.trim();
  if (trimmed.length === 0) {
    return "unverified";
  }
  try {
    const analysis = await analyzeSource(trimmed);
    return statusFromAnalysis(analysis);
  } catch {
    return "error";
  }
}
