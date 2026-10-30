import type { Metadata } from "next";
import { Suspense } from "react";
import { Skeleton } from "@/components/ui";
import { getCurrentUser } from "@/lib/auth";
import { getClinic, getDentists, getServices } from "@/lib/data/public";
import { BookingWizard } from "./booking-wizard";

export const metadata: Metadata = { title: "Book an appointment" };

export default function BookPage({ searchParams }: PageProps<"/book">) {
  return (
    <div className="mx-auto max-w-6xl px-4 py-10 sm:px-6">
      <h1 className="text-3xl font-bold">Book an appointment</h1>
      <p className="mt-1 text-muted">Choose a service and a time. You&apos;ll get a reference number right away.</p>
      <Suspense fallback={<Skeleton className="mt-8 h-96" />}>
        <BookingLoader searchParams={searchParams} />
      </Suspense>
    </div>
  );
}

async function BookingLoader({ searchParams }: { searchParams: PageProps<"/book">["searchParams"] }) {
  const [params, services, dentists, clinic, user] = await Promise.all([
    searchParams, getServices(), getDentists(), getClinic(), getCurrentUser(),
  ]);
  const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);

  return (
    <BookingWizard
      services={services.map((s) => ({
        id: s.id, name: s.name, description: s.description, category: s.category?.name ?? "Other",
        duration: s.duration_minutes, price: Number(s.price), deposit: Number(s.deposit_amount),
        requiresApproval: s.requires_approval,
      }))}
      dentists={dentists.map((d) => ({ id: d.id, name: d.name, title: d.title, serviceIds: d.serviceIds }))}
      maxAdvanceDays={clinic?.max_advance_days ?? 60}
      paymentInstructions={clinic?.payment_instructions ?? null}
      initial={{ serviceId: one(params.service), startsAt: one(params.start), dentistId: one(params.dentist) }}
      patient={user?.role === "patient" ? { fullName: user.fullName, email: user.email } : null}
      signedInAsStaff={Boolean(user && user.role !== "patient")}
    />
  );
}
