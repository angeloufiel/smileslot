import type { Metadata } from "next";
import { Suspense } from "react";
import { Skeleton } from "@/components/ui";
import { getClinic } from "@/lib/data/public";
import { TrackBooking } from "./track-booking";

export const metadata: Metadata = { title: "Find my booking" };

export default function TrackPage({ searchParams }: PageProps<"/track">) {
  return (
    <div className="mx-auto max-w-2xl px-4 py-10 sm:px-6">
      <h1 className="text-3xl font-bold">Find my booking</h1>
      <p className="mt-1 text-muted">Enter your booking number and the email you booked with to check, pay for or cancel it.</p>
      <Suspense fallback={<Skeleton className="mt-8 h-56" />}>
        <TrackLoader searchParams={searchParams} />
      </Suspense>
    </div>
  );
}

async function TrackLoader({ searchParams }: { searchParams: PageProps<"/track">["searchParams"] }) {
  const [params, clinic] = await Promise.all([searchParams, getClinic()]);
  const digits = typeof params.ref === "string" ? params.ref.replace(/\D/g, "").slice(0, 8) : "";
  const ref = digits.length === 8 ? `${digits.slice(0, 4)}-${digits.slice(4)}` : digits;
  // Only the reference is ever put in a URL. The email stays out of links and logs.
  return <TrackBooking initialReference={ref} paymentInstructions={clinic?.payment_instructions ?? null} />;
}
