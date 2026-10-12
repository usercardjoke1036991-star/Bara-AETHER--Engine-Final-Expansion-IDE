/// <reference types="vite/client" />

/**
 * Variables de entorno que el panel de IA reconoce (véase `.env.example`).
 *
 * Sólo se leen en desarrollo: lo que se escriba en Ajustes › IA tiene
 * prioridad, y el README explica por qué una clave incrustada en el haz de Vite
 * no es un secreto.
 */
interface ImportMetaEnv {
  readonly VITE_ANTHROPIC_API_KEY?: string;
  readonly VITE_OPENAI_API_KEY?: string;
}
