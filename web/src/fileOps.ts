/** Confirmación explícita antes de borrar (A5). */
export function confirmDeletePath(
  path: string,
  ask: (message: string) => boolean = (message) => window.confirm(message),
): boolean {
  return ask(`¿Borrar «${path}»?\nSe moverá a .bara-trash/ si es posible.`);
}
