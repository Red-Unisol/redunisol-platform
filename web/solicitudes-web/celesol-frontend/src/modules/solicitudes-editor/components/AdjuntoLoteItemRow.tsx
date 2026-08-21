import { FileText, Image, Paperclip, X } from "lucide-react";

import { LegacyIconButton, StyledSelect } from "./fields/base";

export type PendingAdjuntoLoteItem = {
  id: string;
  file: File;
  tipoAdjunto: string;
};

const IMAGE_EXTENSIONS = new Set(["jpg", "jpeg", "png", "gif", "webp", "bmp"]);
const DOCUMENT_EXTENSIONS = new Set(["pdf", "doc", "docx"]);

function getFileExtensionLabel(fileName: string): string {
  const match = fileName.match(/\.([^./]+)$/);

  return match ? match[1].toUpperCase() : "Archivo";
}

function renderFileTypeIcon(fileName: string, className: string) {
  const extension = getFileExtensionLabel(fileName).toLowerCase();

  if (IMAGE_EXTENSIONS.has(extension)) {
    return <Image className={className} />;
  }

  if (DOCUMENT_EXTENSIONS.has(extension)) {
    return <FileText className={className} />;
  }

  return <Paperclip className={className} />;
}

function formatFileSize(bytes: number): string {
  if (bytes < 1024) {
    return `${bytes} B`;
  }

  const units = ["KB", "MB", "GB"];
  let value = bytes / 1024;
  let unitIndex = 0;

  while (value >= 1024 && unitIndex < units.length - 1) {
    value /= 1024;
    unitIndex += 1;
  }

  return `${value.toFixed(value < 10 ? 1 : 0)} ${units[unitIndex]}`;
}

function truncateFileNameMiddle(fileName: string, maxLength = 32): string {
  if (fileName.length <= maxLength) {
    return fileName;
  }

  const extensionMatch = fileName.match(/\.[^./]+$/);
  const extension = extensionMatch ? extensionMatch[0] : "";
  const baseName = extension ? fileName.slice(0, -extension.length) : fileName;
  const keepLength = Math.max(maxLength - extension.length - 1, 4);
  const headLength = Math.ceil(keepLength / 2);
  const tailLength = Math.floor(keepLength / 2);

  if (baseName.length <= headLength + tailLength) {
    return fileName;
  }

  return `${baseName.slice(0, headLength)}…${baseName.slice(
    baseName.length - tailLength,
  )}${extension}`;
}

export function AdjuntoLoteItemRow({
  disabled,
  item,
  onRemove,
  onTipoAdjuntoChange,
  tiposAdjunto,
}: {
  disabled: boolean;
  item: PendingAdjuntoLoteItem;
  onRemove: () => void;
  onTipoAdjuntoChange: (tipoAdjunto: string) => void;
  tiposAdjunto: { label: string; value: string }[];
}) {
  const displayName = truncateFileNameMiddle(item.file.name);
  const isTruncated = displayName !== item.file.name;

  return (
    <div className="flex flex-col gap-2 rounded-md border border-border bg-surface p-3 sm:flex-row sm:items-center sm:gap-3 sm:py-2">
      <div className="flex min-w-0 flex-1 items-start gap-2">
        {renderFileTypeIcon(
          item.file.name,
          "mt-0.5 size-4 shrink-0 text-foreground-secondary",
        )}
        <div className="min-w-0 flex-1">
          <p
            aria-hidden={isTruncated}
            className="truncate text-sm text-foreground"
            title={isTruncated ? item.file.name : undefined}
          >
            {displayName}
          </p>
          {isTruncated ? (
            <span className="sr-only">{item.file.name}</span>
          ) : null}
          <p className="text-xs text-foreground-secondary">
            {getFileExtensionLabel(item.file.name)} ·{" "}
            {formatFileSize(item.file.size)}
          </p>
        </div>
      </div>
      <div className="flex items-center gap-2 sm:shrink-0">
        <StyledSelect
          ariaLabel={`Tipo de adjunto para ${item.file.name}`}
          className="w-full sm:w-56"
          disabled={disabled}
          onChange={onTipoAdjuntoChange}
          options={tiposAdjunto}
          placeholder="Tipo de adjunto *"
          value={item.tipoAdjunto}
        />
        <LegacyIconButton disabled={disabled} onClick={onRemove}>
          <X className="size-4" />
        </LegacyIconButton>
      </div>
    </div>
  );
}
