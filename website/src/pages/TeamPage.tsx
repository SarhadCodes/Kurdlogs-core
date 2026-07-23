import { PageHero, Section } from '@/components/site/Section';
import { team } from '@/data/site';
import { cn } from '@/lib/utils';

export default function TeamPage() {
  return (
    <>
      <PageHero
        eyebrow="Team"
        title="People behind the panel"
        description="Building KurdLogs Core for operators who keep channels on air."
      />
      <Section>
        <div className="mx-auto grid max-w-3xl gap-8 sm:grid-cols-2">
          {team.map((member) => (
            <article
              key={member.name}
              className="overflow-hidden rounded-2xl border border-border bg-card/40 transition-colors hover:bg-card"
            >
              {member.photo ? (
                <div
                  className={cn(
                    'aspect-square overflow-hidden border-b border-border',
                    member.name === 'KurdLogs Team' ? 'bg-white' : 'bg-[#a8e000]'
                  )}
                >
                  <img
                    src={member.photo}
                    alt={member.name}
                    className={cn(
                      'h-full w-full',
                      member.name === 'KurdLogs Team'
                        ? 'object-contain p-6 sm:p-8'
                        : 'object-cover object-top'
                    )}
                  />
                </div>
              ) : null}
              <div className="p-6">
                <h2 className="font-display text-xl font-semibold text-foreground">{member.name}</h2>
                <p className="mt-1 text-sm text-muted-foreground">{member.role}</p>
                <p className="mt-4 text-sm leading-relaxed text-muted-foreground">{member.bio}</p>
              </div>
            </article>
          ))}
        </div>
      </Section>
    </>
  );
}
