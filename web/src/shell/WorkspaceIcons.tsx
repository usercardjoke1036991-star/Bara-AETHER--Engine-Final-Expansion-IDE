/** Iconos del explorador Workspace (mockup Jose: carpeta ámbar + archivo). */

const BRAND = "/brand";

export const ICON_FOLDER = `${BRAND}/icon-folder.svg`;
export const ICON_FOLDER_OPEN = `${BRAND}/icon-folder-open.svg`;
export const ICON_FILE_BARA = `${BRAND}/icon-file-bara.svg`;
export const ICON_FILE = `${BRAND}/icon-file.svg`;

interface WorkspaceIconProps {
  src: string;
  label: string;
  className?: string;
}

/** Pictograma 16×16 alineado al texto de filas del shelf/árbol. */
export function WorkspaceIcon({ src, label, className }: WorkspaceIconProps) {
  return (
    <img
      src={src}
      alt=""
      width={14}
      height={14}
      draggable={false}
      className={className ?? "ws-icon"}
      aria-hidden="true"
      title={label}
    />
  );
}
