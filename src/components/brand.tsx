import { ToothMark } from "@/components/site-header";
import { getBranding } from "@/lib/data/branding";

/** The clinic's logo (or the tooth mark) and name, as saved in Settings. */
export async function Brand({ size = "md" }: { size?: "md" | "lg" }) {
  const { name, logoUrl } = await getBranding();
  const box = size === "lg" ? "h-9 w-9" : "h-7 w-7";
  return (
    <>
      {logoUrl ? (
        // A plain <img>: the logo lives on the clinic's own Supabase project, whose host differs per install.
        // eslint-disable-next-line @next/next/no-img-element
        <img src={logoUrl} alt="" className={`${box} shrink-0 rounded-lg object-contain`} />
      ) : (
        <ToothMark className={box} />
      )}
      <span className="truncate">{name}</span>
    </>
  );
}

export async function BrandName() {
  return (await getBranding()).name;
}
