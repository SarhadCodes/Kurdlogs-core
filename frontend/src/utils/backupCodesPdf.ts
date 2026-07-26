import { jsPDF } from 'jspdf';

export type BackupCodesPdfMeta = {
  username: string;
  generatedAt?: Date;
};

/** Premium one-page KurdLogs backup-codes PDF (A4) — mint / zinc brand palette. */
export function downloadBackupCodesPdf(codes: string[], meta: BackupCodesPdfMeta): void {
  const doc = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' });
  const pageW = doc.internal.pageSize.getWidth();
  const pageH = doc.internal.pageSize.getHeight();
  const margin = 18;
  const generatedAt = meta.generatedAt ?? new Date();

  // Background
  doc.setFillColor(10, 10, 12);
  doc.rect(0, 0, pageW, pageH, 'F');

  // Soft card surface
  doc.setFillColor(18, 18, 22);
  doc.roundedRect(margin - 4, margin - 4, pageW - (margin - 4) * 2, pageH - (margin - 4) * 2, 4, 4, 'F');

  // Accent mint line at top (emerald-300)
  doc.setDrawColor(110, 231, 183);
  doc.setLineWidth(0.6);
  doc.line(margin, margin + 2, pageW - margin, margin + 2);

  // Brand
  doc.setTextColor(226, 232, 240);
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(11);
  doc.text('KURDLOGS CORE', margin, margin + 12);

  doc.setTextColor(148, 163, 184);
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(8);
  doc.text('BROADCAST CONTROL  ·  SECURITY', margin, margin + 18);

  // Title
  doc.setTextColor(250, 250, 250);
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(22);
  doc.text('Recovery codes', margin, margin + 34);

  doc.setTextColor(161, 161, 170);
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(10);
  doc.text('Keep these offline. Each code works once if you lose your authenticator.', margin, margin + 42, {
    maxWidth: pageW - margin * 2,
  });

  // Meta card
  const metaY = margin + 50;
  doc.setFillColor(24, 24, 28);
  doc.setDrawColor(63, 63, 70);
  doc.setLineWidth(0.25);
  doc.roundedRect(margin, metaY, pageW - margin * 2, 18, 2.5, 2.5, 'FD');

  doc.setTextColor(113, 113, 122);
  doc.setFontSize(7.5);
  doc.text('ACCOUNT', margin + 5, metaY + 7);
  doc.text('ISSUED', pageW / 2 + 2, metaY + 7);

  doc.setTextColor(244, 244, 245);
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(10);
  doc.text(`@${meta.username}`, margin + 5, metaY + 13);
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(9);
  doc.setTextColor(212, 212, 216);
  const dateStr = generatedAt.toLocaleString(undefined, {
    year: 'numeric',
    month: 'short',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  });
  doc.text(dateStr, pageW / 2 + 2, metaY + 13);

  // Codes grid
  const gridTop = metaY + 28;
  const cols = 2;
  const gapX = 6;
  const gapY = 6;
  const cardW = (pageW - margin * 2 - gapX) / cols;
  const cardH = 16;

  codes.forEach((code, i) => {
    const col = i % cols;
    const row = Math.floor(i / cols);
    const x = margin + col * (cardW + gapX);
    const y = gridTop + row * (cardH + gapY);

    doc.setFillColor(15, 15, 18);
    doc.setDrawColor(63, 63, 70);
    doc.setLineWidth(0.35);
    doc.roundedRect(x, y, cardW, cardH, 2, 2, 'FD');

    // left accent bar — mint
    doc.setFillColor(110, 231, 183);
    doc.rect(x, y + 3, 1.1, cardH - 6, 'F');

    doc.setTextColor(113, 113, 122);
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(7);
    doc.text(String(i + 1).padStart(2, '0'), x + 5, y + 6);

    doc.setTextColor(250, 250, 250);
    doc.setFont('courier', 'bold');
    doc.setFontSize(13);
    const spaced = code.replace(/(.{4})/g, '$1 ').trim();
    doc.text(spaced, x + 5, y + 12);
  });

  // Warning footer — cool zinc, not amber
  const footerY = pageH - margin - 28;
  doc.setFillColor(24, 24, 28);
  doc.setDrawColor(82, 82, 91);
  doc.setLineWidth(0.3);
  doc.roundedRect(margin, footerY, pageW - margin * 2, 22, 2.5, 2.5, 'FD');

  doc.setTextColor(110, 231, 183);
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(8);
  doc.text('IMPORTANT', margin + 5, footerY + 7);

  doc.setTextColor(212, 212, 216);
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(8);
  doc.text(
    'Store this file somewhere safe (password manager / offline). Never share these codes. Regenerating invalidates previous codes.',
    margin + 5,
    footerY + 13,
    { maxWidth: pageW - margin * 2 - 10 }
  );

  // Bottom brand line
  doc.setDrawColor(39, 39, 42);
  doc.setLineWidth(0.3);
  doc.line(margin, pageH - margin + 2, pageW - margin, pageH - margin + 2);
  doc.setTextColor(82, 82, 91);
  doc.setFontSize(7);
  doc.text('kurdlogs core  ·  confidential', margin, pageH - margin + 7);
  doc.text('single-use recovery', pageW - margin, pageH - margin + 7, { align: 'right' });

  const safeUser = meta.username.replace(/[^a-zA-Z0-9_-]/g, '');
  const stamp = generatedAt.toISOString().slice(0, 10);
  doc.save(`kurdlogs-backup-codes-${safeUser}-${stamp}.pdf`);
}
