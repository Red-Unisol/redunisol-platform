import type { ReactNode } from "react";
import type { SellerReviewChange } from "@/modules/solicitudes/types/solicitudes-core";
import { cn } from "@/shared/utils/cn";
import { getFieldAccessFieldLabel } from "../utils/field-access-admin-labels";
import { formatReviewValue } from "../utils/seller-review-value";

export function CampoRevisado({
  children,
  changes,
  className,
  compound,
}: {
  children: ReactNode;
  changes?: SellerReviewChange[];
  className?: string;
  compound?: boolean;
}) {
  return (
    <div
      className={cn(
        "min-w-0",
        changes?.length &&
          "rounded-md border-l-2 border-amber-600 bg-amber-50 px-2 py-1",
        className,
      )}
    >
      {children}
      {changes?.length ? (
        <dd className="mt-1 text-xs break-words text-amber-950">
          <strong>Modificado por Vendedores</strong>
          {changes.map((change) => (
            <div key={change.field}>
              Antes
              {compound ? ` (${getFieldAccessFieldLabel(change.field)})` : ""}:{" "}
              {formatReviewValue(change.field, change.before)}
            </div>
          ))}
        </dd>
      ) : null}
    </div>
  );
}
