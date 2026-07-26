import React, { useState } from 'react';
import { Download, Eye, EyeOff, Copy, CheckCircle2, RefreshCw, Shield } from 'lucide-react';
import toast from 'react-hot-toast';
import { Button } from '@/components/ui/button';
import { downloadBackupCodesPdf } from '../utils/backupCodesPdf';

type Props = {
  codes: string[];
  username: string;
  onDismiss?: () => void;
  onRegenerate?: () => void | Promise<void>;
  regenerating?: boolean;
  allowRegenerate?: boolean;
};

export default function MfaBackupCodesPanel({
  codes,
  username,
  onDismiss,
  onRegenerate,
  regenerating = false,
  allowRegenerate = false,
}: Props) {
  const [visible, setVisible] = useState(true);
  const [copied, setCopied] = useState(false);

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(codes.join('\n'));
      setCopied(true);
      toast.success('Backup codes copied');
      window.setTimeout(() => setCopied(false), 2000);
    } catch {
      toast.error('Could not copy codes');
    }
  };

  const handleDownloadPdf = () => {
    try {
      downloadBackupCodesPdf(codes, { username });
      toast.success('PDF downloaded');
    } catch {
      toast.error('Could not create PDF');
    }
  };

  return (
    <div className="overflow-hidden rounded-2xl border border-border bg-card shadow-sm dark:shadow-[0_18px_50px_rgba(0,0,0,0.22)]">
      <div className="flex items-start gap-3 border-b border-border bg-muted/30 px-4 py-3.5 sm:px-5">
        <div className="mt-0.5 rounded-xl border border-border bg-background p-2 shadow-sm">
          <Shield className="h-4 w-4 text-emerald-300/80" />
        </div>
        <div className="min-w-0 flex-1">
          <p className="text-sm font-semibold tracking-tight text-foreground">Recovery codes</p>
          <p className="mt-0.5 text-xs text-muted-foreground">
            Save these now. Each code works once if you lose your authenticator.
          </p>
        </div>
      </div>

      <div className="space-y-4 px-4 py-4 sm:px-5">
        <div
          className={`grid grid-cols-2 gap-2 transition-all duration-300 ${
            visible ? '' : 'select-none blur-[6px]'
          }`}
          aria-hidden={!visible}
        >
          {codes.map((code, i) => (
            <div
              key={`${code}-${i}`}
              className="rounded-xl border border-white/10 bg-black/40 px-3 py-2.5 font-mono text-[12px] tracking-[0.14em] text-zinc-100"
            >
              <span className="mr-2 text-[10px] text-zinc-500">{String(i + 1).padStart(2, '0')}</span>
              {visible ? code : '••••••••'}
            </div>
          ))}
        </div>

        <div className="flex flex-wrap gap-2">
          <Button
            type="button"
            variant="secondary"
            size="sm"
            className="gap-1.5"
            onClick={() => setVisible((v) => !v)}
          >
            {visible ? <EyeOff className="h-3.5 w-3.5" /> : <Eye className="h-3.5 w-3.5" />}
            {visible ? 'Hide codes' : 'Show codes'}
          </Button>
          <Button type="button" variant="secondary" size="sm" className="gap-1.5" onClick={handleCopy}>
            {copied ? <CheckCircle2 className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />}
            {copied ? 'Copied' : 'Copy'}
          </Button>
          <Button
            type="button"
            size="sm"
            className="gap-1.5 bg-emerald-300 text-emerald-950 hover:bg-emerald-200"
            onClick={handleDownloadPdf}
          >
            <Download className="h-3.5 w-3.5" />
            Download PDF
          </Button>
          {allowRegenerate && onRegenerate && (
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="gap-1.5"
              disabled={regenerating}
              onClick={() => void onRegenerate()}
            >
              <RefreshCw className={`h-3.5 w-3.5 ${regenerating ? 'animate-spin' : ''}`} />
              {regenerating ? 'Regenerating…' : 'Regenerate'}
            </Button>
          )}
          {onDismiss && (
            <Button type="button" variant="ghost" size="sm" onClick={onDismiss}>
              Done
            </Button>
          )}
        </div>
      </div>
    </div>
  );
}
