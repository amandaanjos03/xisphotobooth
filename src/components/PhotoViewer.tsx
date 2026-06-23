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

export function printPhoto(url: string) {
  const w = window.open("", "_blank", "width=900,height=1200");
  if (!w) {
    toast.error("Pop-up bloqueado. Permita pop-ups para imprimir.");
    return;
  }
  w.document.write(`<!doctype html><html><head><title>Imprimir foto</title>
    <style>
      @page { size: 10cm 15cm; margin: 0; }
      html,body { margin:0; padding:0; background:#fff; }
      .wrap { width:100vw; height:100vh; display:grid; place-items:center; }
      img { max-width:100%; max-height:100%; object-fit:contain; }
      @media print { .wrap { width:100%; height:100%; } }
    </style></head><body><div class="wrap"><img src="${url}" crossorigin="anonymous" /></div>
    <script>
      const img = document.querySelector('img');
      function go(){ window.focus(); window.print(); setTimeout(()=>window.close(), 500); }
      if (img.complete) go(); else img.onload = go;
    </script></body></html>`);
  w.document.close();
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
