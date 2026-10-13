import { Copy, MessageCircle } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/shared/components/ui/button";

export function LinkFirmaDigital({ url }: { url: string }) {
  const copyLink = async () => {
    try {
      await navigator.clipboard.writeText(url);
      toast.success("Link de firma digital copiado");
    } catch {
      toast.error(
        "No se pudo copiar el link. Podés seleccionarlo y copiarlo manualmente.",
      );
    }
  };

  return (
    <div className="flex w-full flex-wrap items-center gap-2">
      <a
        className="min-w-0 flex-1 basis-64 break-all text-primary underline underline-offset-2"
        href={url}
        rel="noreferrer"
        target="_blank"
      >
        {url}
      </a>
      <Button
        type="button"
        variant="outline"
        size="sm"
        onClick={() => void copyLink()}
      >
        <Copy aria-hidden="true" className="size-4" />
        Copiar link
      </Button>
      <Button asChild variant="outline" size="sm">
        <a
          href={`https://wa.me/?text=${encodeURIComponent(`Te comparto el link para firmar digitalmente: ${url}`)}`}
          target="_blank"
          rel="noopener noreferrer"
          aria-label="Compartir link de firma digital por WhatsApp"
        >
          <MessageCircle aria-hidden="true" className="size-4" />
          Compartir por WhatsApp
        </a>
      </Button>
    </div>
  );
}
