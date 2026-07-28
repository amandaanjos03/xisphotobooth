import JSZip from "jszip";
import { jsPDF } from "jspdf";

export async function downloadAsZip(
  items: { url: string; filename: string }[],
  zipName: string,
): Promise<void> {
  const zip = new JSZip();
  for (const it of items) {
    try {
      const r = await fetch(it.url);
      const blob = await r.blob();
      zip.file(it.filename, blob);
    } catch {
      /* skip failed */
    }
  }
  const blob = await zip.generateAsync({ type: "blob" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = zipName;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function loadImage(url: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.crossOrigin = "anonymous";
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error("Falha ao carregar imagem"));
    img.src = url;
  });
}

export async function downloadAlbumPdf(
  imageUrls: string[],
  title: string,
  filename: string,
): Promise<void> {
  const pdf = new jsPDF({ orientation: "portrait", unit: "mm", format: "a4" });
  const pageW = pdf.internal.pageSize.getWidth();
  const pageH = pdf.internal.pageSize.getHeight();
  const margin = 10;
  const gutter = 6;
  const cols = 2;
  const cellW = (pageW - margin * 2 - gutter * (cols - 1)) / cols;
  const cellH = cellW; // square cells
  const rows = Math.floor((pageH - margin * 2 - 12) / (cellH + gutter));
  const perPage = cols * rows;

  pdf.setFont("helvetica", "bold");
  pdf.setFontSize(16);
  pdf.text(title, margin, margin + 6);

  let placed = 0;
  for (let i = 0; i < imageUrls.length; i++) {
    if (placed > 0 && placed % perPage === 0) {
      pdf.addPage();
      pdf.setFont("helvetica", "bold");
      pdf.setFontSize(16);
      pdf.text(title, margin, margin + 6);
    }
    const posOnPage = placed % perPage;
    const col = posOnPage % cols;
    const row = Math.floor(posOnPage / cols);
    const x = margin + col * (cellW + gutter);
    const y = margin + 12 + row * (cellH + gutter);
    try {
      const img = await loadImage(imageUrls[i]);
      const canvas = document.createElement("canvas");
      const scale = Math.min(1, 800 / Math.max(img.naturalWidth, img.naturalHeight));
      canvas.width = Math.max(1, Math.round(img.naturalWidth * scale));
      canvas.height = Math.max(1, Math.round(img.naturalHeight * scale));
      const ctx = canvas.getContext("2d");
      if (!ctx) throw new Error("canvas context");
      ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
      const dataUrl = canvas.toDataURL("image/jpeg", 0.85);
      // fit inside cell preserving aspect
      const ar = canvas.width / canvas.height;
      let w = cellW;
      let h = w / ar;
      if (h > cellH) { h = cellH; w = h * ar; }
      const ox = x + (cellW - w) / 2;
      const oy = y + (cellH - h) / 2;
      pdf.addImage(dataUrl, "JPEG", ox, oy, w, h);
    } catch {
      /* skip */
    }
    placed++;
  }

  pdf.save(filename);
}

export function downloadEventCardPdf({
  qrDataUrl, eventName, url, code,
}: { qrDataUrl: string; eventName: string; url: string; code: string | null }) {
  const pdf = new jsPDF({ orientation: "portrait", unit: "mm", format: "a4" });
  const pageW = pdf.internal.pageSize.getWidth();
  const pageH = pdf.internal.pageSize.getHeight();

  // Warm cream background
  pdf.setFillColor(253, 246, 217);
  pdf.rect(0, 0, pageW, pageH, "F");

  // Border
  pdf.setDrawColor(14, 82, 74);
  pdf.setLineWidth(1.5);
  pdf.rect(10, 10, pageW - 20, pageH - 20);

  // Headline
  pdf.setTextColor(14, 82, 74);
  pdf.setFont("helvetica", "bold");
  pdf.setFontSize(42);
  pdf.text("Que bom que você veio!!!", pageW / 2, 45, { align: "center" });

  pdf.setFontSize(22);
  pdf.setFont("helvetica", "normal");
  pdf.text(eventName, pageW / 2, 60, { align: "center" });

  // Instructions
  pdf.setFontSize(16);
  pdf.setFont("helvetica", "bold");
  pdf.text("Como participar:", pageW / 2, 82, { align: "center" });
  pdf.setFont("helvetica", "normal");
  pdf.setFontSize(13);
  const steps = [
    "1. Aponte a câmera do celular para o QR Code",
    "2. Toque no link que aparecer",
    code ? `3. Informe a senha do evento: ${code}` : "3. Tire quantas fotos quiser!",
    code ? "4. Tire fotos, grave vídeos e leve suas lembranças" : "4. Baixe suas lembranças a qualquer momento",
  ];
  steps.forEach((s, i) => pdf.text(s, pageW / 2, 94 + i * 8, { align: "center" }));

  // QR code centered
  const qrSize = 90;
  const qrX = (pageW - qrSize) / 2;
  const qrY = 135;
  pdf.setFillColor(255, 255, 255);
  pdf.rect(qrX - 4, qrY - 4, qrSize + 8, qrSize + 8, "F");
  pdf.addImage(qrDataUrl, "PNG", qrX, qrY, qrSize, qrSize);

  // Code + URL
  if (code) {
    pdf.setFont("helvetica", "bold");
    pdf.setFontSize(28);
    pdf.text(`Senha: ${code}`, pageW / 2, qrY + qrSize + 15, { align: "center" });
  }
  pdf.setFont("helvetica", "normal");
  pdf.setFontSize(11);
  pdf.text(url, pageW / 2, qrY + qrSize + (code ? 25 : 15), { align: "center" });

  pdf.save(`cartao-${eventName.replace(/\s+/g, "-").toLowerCase()}.pdf`);
}
