import Image, { type StaticImageData } from "next/image";
import Link from "next/link";
import checkup from "@/images/checkup.webp";
import braces from "@/images/braces.webp";
import extraction from "@/images/extraction.webp";
import filling from "@/images/filling.webp";

type Card = { title: string; text: string; image: StaticImageData; alt: string; slugs: string[] };

const CARDS: Card[] = [
  { title: "Check-ups and cleaning", text: "A full exam and a gentle clean to keep problems small.", image: checkup,
    alt: "Dentist checking a smiling patient's teeth with a mirror", slugs: ["consultation", "cleaning"] },
  { title: "Braces", text: "Straighter teeth and a better bite. Start with a consultation.", image: braces,
    alt: "Patient with metal braces during a check", slugs: ["braces-consultation", "braces", "consultation"] },
  { title: "Tooth extraction", text: "Quick and careful, under local anesthesia.", image: extraction,
    alt: "Dentist gently removing a tooth", slugs: ["extraction"] },
  { title: "Tooth-colored fillings", text: "Repair a cavity with a filling that matches your tooth.", image: filling,
    alt: "Composite filling being set with a curing light", slugs: ["filling"] },
];

/**
 * Photo cards that show what the clinic does. Each card books the matching service
 * when the clinic offers one (by its slug), otherwise it opens the booking page.
 */
export function CareGallery({
  services, compact = false, heading = "Care for the whole family",
}: { services: { id: string; slug: string }[]; compact?: boolean; heading?: string }) {
  const hrefFor = (slugs: string[]) => {
    const s = slugs.map((slug) => services.find((x) => x.slug === slug)).find(Boolean);
    return s ? `/book?service=${s.id}` : "/book";
  };
  return (
    <section aria-labelledby="care-title">
      <h2 id="care-title" className={compact ? "text-xl font-bold" : "text-2xl font-bold sm:text-3xl"}>{heading}</h2>
      {!compact && <p className="mt-1 text-muted">Modern, gentle dentistry. Book any of these online in under a minute.</p>}
      <ul className={`mt-5 grid gap-4 ${compact ? "grid-cols-2 sm:grid-cols-4" : "sm:grid-cols-2 lg:grid-cols-4"}`}>
        {CARDS.map((c) => (
          <li key={c.title}>
            <Link href={hrefFor(c.slugs)}
              className="group block h-full overflow-hidden rounded-[var(--radius-panel)] bg-surface ring-1 ring-line transition hover:ring-cobalt focus-visible:ring-cobalt">
              <span className="relative block aspect-[4/3] overflow-hidden bg-canvas">
                <Image src={c.image} alt={c.alt} fill placeholder="blur"
                  sizes={compact ? "(min-width: 640px) 25vw, 50vw" : "(min-width: 1024px) 25vw, (min-width: 640px) 50vw, 100vw"}
                  className="object-cover transition duration-500 group-hover:scale-105" />
              </span>
              <span className={`block ${compact ? "p-3" : "p-4"}`}>
                <span className={`block font-semibold ${compact ? "text-sm" : ""}`}>{c.title}</span>
                {!compact && <span className="mt-1 block text-sm text-muted">{c.text}</span>}
                <span className={`mt-2 inline-block font-semibold text-cobalt group-hover:underline ${compact ? "text-xs" : "text-sm"}`}>Book now</span>
              </span>
            </Link>
          </li>
        ))}
      </ul>
    </section>
  );
}

