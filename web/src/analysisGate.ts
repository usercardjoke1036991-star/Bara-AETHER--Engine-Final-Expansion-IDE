/** Texto y documento para los que se pidió el análisis. */
export interface AnalysisRequest {
  generation: number;
  text: string;
  path: string | null;
}

/**
 * La respuesta sólo se publica si sigue siendo la generación vigente y el
 * editor no cambió de texto ni de documento. Un análisis más viejo no pisa
 * al activo.
 */
export function analysisStillCurrent(
  request: AnalysisRequest,
  latestGeneration: number,
  activeText: string,
  activePath: string | null,
): boolean {
  return (
    request.generation === latestGeneration &&
    request.text === activeText &&
    request.path === activePath
  );
}
