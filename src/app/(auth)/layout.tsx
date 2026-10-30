import Image from "next/image";
import Link from "next/link";
import { Brand } from "@/components/brand";
import photo from "@/images/checkup.webp";

export default function AuthLayout({ children }: LayoutProps<"/">) {
  return (
    <main className="grid flex-1 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.1fr)]">
      <div className="flex items-start justify-center px-4 py-12 sm:items-center">
        <div className="w-full max-w-sm">
          <Link href="/" className="mb-8 flex min-w-0 items-center gap-2.5 font-display text-lg font-bold">
            <Brand />
          </Link>
          {children}
        </div>
      </div>
      <div className="relative hidden overflow-hidden lg:block">
        <Image src={photo} alt="" fill priority placeholder="blur" sizes="55vw" className="object-cover" />
        <div className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-ink/80 to-transparent p-10 text-white">
          <p className="font-display text-3xl font-bold">Healthy smiles, booked in a minute.</p>
          <p className="mt-2 text-white/85">See real open times, get reminders, and keep every visit in one place.</p>
        </div>
      </div>
    </main>
  );
}
