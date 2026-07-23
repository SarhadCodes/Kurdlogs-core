import { CheckCircle2, Copy, Download, ExternalLink } from 'lucide-react';
import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Separator } from '@/components/ui/separator';
import { PageHero, Section, SectionHeading } from '@/components/site/Section';
import { installCommands, installSteps, PANEL_URL, REPO_PAGE_URL, REPO_URL, requirements } from '@/data/site';

function CodeBlock({ label, code }: { label: string; code: string }) {
  const [copied, setCopied] = useState(false);

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(code);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1600);
    } catch {
      /* ignore */
    }
  };

  return (
    <div className="overflow-hidden rounded-xl border border-border bg-[#0a0a0b]">
      <div className="flex items-center justify-between border-b border-border px-4 py-2.5">
        <span className="text-xs font-medium text-muted-foreground">{label}</span>
        <Button type="button" variant="ghost" size="sm" className="h-8 gap-1.5 text-xs" onClick={copy}>
          {copied ? <CheckCircle2 className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />}
          {copied ? 'Copied' : 'Copy'}
        </Button>
      </div>
      <pre className="overflow-x-auto p-4 font-mono text-[13px] leading-relaxed text-foreground/90">
        <code>{code}</code>
      </pre>
    </div>
  );
}

export default function DocsPage() {
  return (
    <>
      <PageHero
        eyebrow="Documentation"
        title="Install KurdLogs Core step by step"
        description="From Docker to first sign-in. Follow these steps on a local machine or VPS."
      />

      <Section className="pt-0 sm:pt-0">
        <SectionHeading
          eyebrow="Tutorial"
          title="Watch the install walkthrough"
          description="Real Docker commands from this machine, then the live KurdLogs panel at localhost:8081."
        />
        <div className="mx-auto max-w-4xl overflow-hidden rounded-2xl border border-border bg-[#0a0a0b] shadow-[0_0_0_1px_rgba(255,255,255,0.03)]">
          <video
            className="aspect-video w-full bg-black"
            controls
            preload="metadata"
            playsInline
            poster="/videos/install-poster.png"
          >
            <source src="/videos/install-kurdlogs-core.mp4" type="video/mp4" />
            Your browser does not support embedded video.
          </video>
        </div>
        <p className="mx-auto mt-4 max-w-4xl text-sm text-muted-foreground">
          The terminal section runs real <code className="rounded bg-secondary px-1 font-mono text-xs">docker</code> /{' '}
          <code className="rounded bg-secondary px-1 font-mono text-xs">docker compose</code> output from this project,
          then shows the running panel.
        </p>
      </Section>

      <Section>
        <SectionHeading
          eyebrow="Prerequisites"
          title="Download what you need"
          description="Grab the tools below, then continue with the install steps. Each link opens the official download page."
        />
        <div className="grid gap-4 sm:grid-cols-2">
          {requirements.map((item) => (
            <a
              key={item.name}
              href={item.href}
              target="_blank"
              rel="noreferrer"
              className="group flex flex-col rounded-xl border border-border bg-card/40 px-5 py-5 transition-colors hover:border-foreground/20 hover:bg-card"
            >
              <div className="flex items-start justify-between gap-3">
                <div>
                  <p className="font-display text-lg font-semibold tracking-tight text-foreground">
                    {item.name}
                  </p>
                  <p className="mt-0.5 text-xs uppercase tracking-[0.16em] text-muted-foreground">
                    {item.platform}
                  </p>
                </div>
                <span className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-full border border-border bg-background text-foreground transition-colors group-hover:border-foreground/30 group-hover:bg-secondary">
                  <Download className="h-4 w-4" strokeWidth={1.75} />
                </span>
              </div>
              <p className="mt-3 flex-1 text-sm leading-relaxed text-muted-foreground">{item.detail}</p>
              <span className="mt-4 inline-flex items-center gap-1.5 text-sm font-medium text-foreground">
                {item.cta}
                <ExternalLink className="h-3.5 w-3.5 opacity-60 transition-transform group-hover:translate-x-0.5" />
              </span>
            </a>
          ))}
        </div>

        <ul className="mt-6 grid gap-3 sm:grid-cols-2">
          {[
            'About 4 GB free RAM for a comfortable local stack',
            'Ports 8081 (panel) and 1936 (RTMP) available',
          ].map((item) => (
            <li
              key={item}
              className="flex items-start gap-3 rounded-xl border border-border/70 px-4 py-3.5 text-sm text-muted-foreground"
            >
              <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-primary" />
              {item}
            </li>
          ))}
        </ul>
      </Section>

      <Section className="border-t border-border bg-card/20 pt-16 sm:pt-20">
        <SectionHeading
          eyebrow="Guide"
          title="Six steps to a running panel"
          description="Each step builds on the previous. After the last one you should see the KurdLogs login screen."
        />
        <ol className="mx-auto max-w-3xl space-y-0">
          {installSteps.map((step, index) => (
            <li key={step.title} className="relative border-l border-border pl-8 pb-12 last:pb-0">
              <span className="absolute -left-3 top-0 flex h-6 w-6 items-center justify-center rounded-full border border-border bg-background font-mono text-[11px] text-foreground">
                {index + 1}
              </span>
              <h3 className="font-display text-xl font-semibold text-foreground">{step.title}</h3>
              <p className="mt-2 text-sm leading-relaxed text-muted-foreground sm:text-base">
                {step.detail}
              </p>
            </li>
          ))}
        </ol>
      </Section>

      <Section className="border-t border-border">
        <SectionHeading
          eyebrow="Commands"
          title="Copy-paste commands"
          description="Use the Windows script for the smoothest local rebuild, or Compose directly."
        />
        <div className="mx-auto max-w-3xl space-y-4">
          {installCommands.map((block) => (
            <CodeBlock key={block.label} label={block.label} code={block.code} />
          ))}
        </div>

        <Separator className="mx-auto my-14 max-w-3xl" />

        <div className="mx-auto max-w-3xl">
          <h3 className="font-display text-2xl font-semibold text-foreground">Default login</h3>
          <p className="mt-3 text-muted-foreground">
            Username <code className="rounded bg-secondary px-1.5 py-0.5 font-mono text-sm text-foreground">admin</code>
            {' · '}
            Password{' '}
            <code className="rounded bg-secondary px-1.5 py-0.5 font-mono text-sm text-foreground">
              admin123
            </code>
          </p>
          <p className="mt-4 text-sm text-muted-foreground">
            Change this immediately in Settings after your first successful login.
          </p>
          <div className="mt-6 flex flex-wrap gap-3">
            <Button asChild>
              <a href={PANEL_URL} target="_blank" rel="noreferrer">
                Open panel at {PANEL_URL.replace(/^https?:\/\//, '')}
              </a>
            </Button>
            <Button asChild variant="outline">
              <a href={REPO_PAGE_URL} target="_blank" rel="noreferrer">
                GitHub repository
                <ExternalLink className="h-4 w-4" />
              </a>
            </Button>
          </div>
          <p className="mt-4 break-all font-mono text-xs text-muted-foreground">{REPO_URL}</p>
        </div>
      </Section>

      <Section className="border-t border-border pb-24">
        <SectionHeading eyebrow="Verify" title="Confirm the install worked" />
        <div className="grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
          {[
            'Sidebar shows a build version after hard refresh',
            'Dashboard loads channel counts and status',
            'Monitoring shows CPU and memory metrics',
          ].map((item) => (
            <div
              key={item}
              className="rounded-xl border border-border px-5 py-5 text-sm leading-relaxed text-muted-foreground"
            >
              <CheckCircle2 className="mb-3 h-4 w-4 text-foreground" />
              {item}
            </div>
          ))}
        </div>
      </Section>
    </>
  );
}
