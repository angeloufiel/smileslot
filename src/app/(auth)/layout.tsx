import Link from "next/link";
import { ToothMark } from "@/components/site-header";

export default function AuthLayout({ children }: LayoutProps<"/">) {
  return (
    <main className="flex flex-1 items-start justify-center px-4 py-12 sm:items-center">
      <div className="w-full max-w-sm">
        <Link href="/" className="mb-8 flex items-center gap-2.5 font-display text-lg font-bold">
          <ToothMark /> Harborview Dental
        </Link>
        {children}
      </div>
    </main>
  );
}
