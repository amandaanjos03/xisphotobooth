import { Dialog, DialogContent } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Download, Printer } from "lucide-react";
import { toast } from "sonner";

export async function downloadPhoto(url: string, filename: string) {
  try {
    const r = await fetch(url);
    const blob = await r.blob();
    const objUrl = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = objUrl;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(objUrl), 1000);
  } catch (e) {
    toast.error((e as Error).message);
  }
}

// Print uses a hidden iframe (works on iOS Safari and most mobile browsers,
// where window.open + document.write is blocked or unreliable). Falls back
// to opening the image in a new tab so the user can use the native share/print.
export async function printPhoto(url: string) {
  try {
    // Load the image as a blob so the print iframe has a same-origin object URL
    // (avoids CORS/tainting that breaks print on some browsers).
    const r = await fetch(url, { mode: "cors" });
    const blob = await r.blob();
    const objUrl = URL.createObjectURL(blob);

    const iframe = document.createElement("iframe");
    iframe.setAttribute("aria-hidden", "true");
    iframe.style.position = "fixed";
    iframe.style.right = "0";
    iframe.style.bottom = "0";
    iframe.style.width = "0";
    iframe.style.height = "0";
    iframe.style.border = "0";
    iframe.style.opacity = "0";
    document.body.appendChild(iframe);

    const cleanup = () => {
      setTimeout(() => {
        URL.revokeObjectURL(objUrl);
        iframe.remove();
      }, 1500);
    };

    const doc = iframe.contentDocument || iframe.contentWindow?.document;
    if (!doc) {
      cleanup();
      window.open(url, "_blank", "noopener");
      return;
    }

    doc.open();
    doc.write(`<!doctype html><html lang="pt-BR"><head><meta charset="utf-8"><title>Imprimir foto</title>
      <style>
        @page { size: 10cm 15cm; margin: 0; }
        html,body { margin:0; padding:0; background:#fff; height:100%; }
        .wrap { width:100vw; height:100vh; display:grid; place-items:center; }
        img { max-width:100%; max-height:100%; object-fit:contain; display:block; }
        @media print { .wrap { width:100%; height:100%; } }
      </style></head><body><div class="wrap"><img id="p" src="${objUrl}" /></div></body></html>`);
    doc.close();

    const img = doc.getElementById("p") as HTMLImageElement | null;
    const go = () => {
      try {
        iframe.contentWindow?.focus();
        iframe.contentWindow?.print();
      } catch {
        window.open(url, "_blank", "noopener");
      } finally {
        cleanup();
      }
    };
    if (img && img.complete && img.naturalWidth > 0) {
      setTimeout(go, 100);
    } else if (img) {
      img.onload = () => setTimeout(go, 100);
      img.onerror = () => {
        cleanup();
        window.open(url, "_blank", "noopener");
      };
    } else {
      cleanup();
      window.open(url, "_blank", "noopener");
    }
  } catch (e) {
    // Last-resort fallback — open the image so the user can print from the browser UI.
    try {
      window.open(url, "_blank", "noopener");
    } catch {
      toast.error((e as Error).message || "Não foi possível imprimir");
    }
  }
}

export function PhotoViewer({
  url,
  filename,
  open,
  onOpenChange,
}: {
  url: string | null;
  filename: string;
  open: boolean;
  onOpenChange: (o: boolean) => void;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-2xl p-3 gap-3">
        {url && (
          <>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={url} alt="" className="w-full h-auto rounded-lg" />
            <div className="grid grid-cols-2 gap-2">
              <Button onClick={() => downloadPhoto(url, filename)} className="rounded-full gap-2">
                <Download className="size-4" /> Baixar
              </Button>
              <Button onClick={() => printPhoto(url)} variant="secondary" className="rounded-full gap-2">
                <Printer className="size-4" /> Imprimir
              </Button>
            </div>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}
