import { Link } from 'react-router-dom';
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from '@/components/ui/accordion';
import { Button } from '@/components/ui/button';
import { PageHero, Section } from '@/components/site/Section';
import { faqItems } from '@/data/site';

export default function FaqPage() {
  return (
    <>
      <PageHero
        eyebrow="FAQ"
        title="Answers before you deploy"
        description="Common questions about hosting, login, ports, and what KurdLogs Core is built to do."
      />
      <Section>
        <Accordion type="single" collapsible className="mx-auto max-w-3xl">
          {faqItems.map((item, index) => (
            <AccordionItem key={item.q} value={`item-${index}`}>
              <AccordionTrigger>{item.q}</AccordionTrigger>
              <AccordionContent>{item.a}</AccordionContent>
            </AccordionItem>
          ))}
        </Accordion>

        <div className="mx-auto mt-14 max-w-3xl rounded-2xl border border-border bg-card/50 px-6 py-8">
          <p className="font-display text-xl font-semibold text-foreground">Still installing?</p>
          <p className="mt-2 text-sm text-muted-foreground">
            The documentation walks through Docker setup, first login, and verification step by step.
          </p>
          <Button asChild className="mt-5">
            <Link to="/docs">Go to documentation</Link>
          </Button>
        </div>
      </Section>
    </>
  );
}
