import JSZip from "jszip";
import { jsPDF } from "jspdf";
import type { EventThemeSlug } from "@/lib/event-theme";

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

const CARD_THEMES: Record<
  EventThemeSlug,
  { background: [number, number, number]; foreground: [number, number, number]; accent: [number, number, number] }
> = {
  "kpop-warrior": { background: [30, 17, 47], foreground: [255, 244, 252], accent: [241, 58, 153] },
  kids: { background: [239, 249, 255], foreground: [42, 46, 101], accent: [232, 71, 139] },
  jungle: { background: [31, 61, 43], foreground: [250, 246, 218], accent: [217, 133, 50] },
  "neon-party": { background: [18, 14, 43], foreground: [250, 247, 255], accent: [230, 55, 190] },
  elegant: { background: [29, 30, 38], foreground: [249, 241, 224], accent: [199, 158, 131] },
  minimal: { background: [248, 250, 252], foreground: [35, 42, 57], accent: [51, 112, 210] },
};

export async function downloadEventCardPdf({
  qrDataUrl,
  eventName,
  url,
  code,
  themeSlug,
  cardText,
  cardLogoUrl,
}: {
  qrDataUrl: string;
  eventName: string;
  url: string;
  code: string | null;
  themeSlug: EventThemeSlug;
  cardText?: string | null;
  cardLogoUrl?: string | null;
}) {
  const pdf = new jsPDF({ orientation: "portrait", unit: "mm", format: "a4" });
  const pageW = pdf.internal.pageSize.getWidth();
  const pageH = pdf.internal.pageSize.getHeight();
  const theme = CARD_THEMES[themeSlug] ?? CARD_THEMES.minimal;

  pdf.setFillColor(...theme.background);
  pdf.rect(0, 0, pageW, pageH, "F");

  pdf.setDrawColor(...theme.accent);
  pdf.setLineWidth(1.5);
  pdf.rect(10, 10, pageW - 20, pageH - 20);

  let headlineY = 38;
  if (cardLogoUrl) {
    try {
      const logo = await loadImage(cardLogoUrl);
      const maxW = 58;
      const maxH = 24;
      const scale = Math.min(maxW / logo.naturalWidth, maxH / logo.naturalHeight);
      const logoW = logo.naturalWidth * scale;
      const logoH = logo.naturalHeight * scale;
      const canvas = document.createElement("canvas");
      canvas.width = logo.naturalWidth;
      canvas.height = logo.naturalHeight;
      const context = canvas.getContext("2d");
      if (context) {
        context.drawImage(logo, 0, 0);
        pdf.addImage(canvas.toDataURL("image/png"), "PNG", (pageW - logoW) / 2, 18, logoW, logoH);
        headlineY = 18 + logoH + 13;
      }
    } catch {
      headlineY = 38;
    }
  }

  pdf.setTextColor(...theme.foreground);
  pdf.setFont("helvetica", "bold");
  const headline = cardText?.trim() || "Que bom que você veio!";
  const fontSize = headline.length > 90 ? 22 : headline.length > 50 ? 27 : 34;
  pdf.setFontSize(fontSize);
  const headlineLines = (pdf.splitTextToSize(headline, pageW - 34) as string[]).slice(0, 4);
  pdf.text(headlineLines, pageW / 2, headlineY, { align: "center", lineHeightFactor: 1.08 });
  const headlineBottom = headlineY + (headlineLines.length - 1) * fontSize * 0.38;

  pdf.setFontSize(22);
  pdf.setFont("helvetica", "normal");
  pdf.text(eventName, pageW / 2, headlineBottom + 12, { align: "center" });

  pdf.setFontSize(16);
  pdf.setFont("helvetica", "bold");
  pdf.text("Como participar:", pageW / 2, 96, { align: "center" });
  pdf.setFont("helvetica", "normal");
  pdf.setFontSize(13);
  const steps = [
    "1. Aponte a câmera do celular para o QR Code",
    "2. Toque no link que aparecer",
    code ? `3. Informe a senha do evento: ${code}` : "3. Tire quantas fotos quiser!",
    code ? "4. Tire fotos, grave vídeos e leve suas lembranças" : "4. Baixe suas lembranças a qualquer momento",
  ];
  steps.forEach((s, i) => pdf.text(s, pageW / 2, 108 + i * 8, { align: "center" }));

  const qrSize = 82;
  const qrX = (pageW - qrSize) / 2;
  const qrY = 143;
  pdf.setFillColor(255, 255, 255);
  pdf.rect(qrX - 4, qrY - 4, qrSize + 8, qrSize + 8, "F");
  pdf.addImage(qrDataUrl, "PNG", qrX, qrY, qrSize, qrSize);

  // Code + URL
  if (code) {
    pdf.setFont("helvetica", "bold");
    pdf.setFontSize(25);
    pdf.text(`Senha: ${code}`, pageW / 2, qrY + qrSize + 15, { align: "center" });
  }
  pdf.setFont("helvetica", "normal");
  pdf.setFontSize(11);
  pdf.text(url, pageW / 2, qrY + qrSize + (code ? 25 : 15), { align: "center" });

  pdf.save(`cartao-${eventName.replace(/\s+/g, "-").toLowerCase()}.pdf`);
}
