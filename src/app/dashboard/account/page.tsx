import { Suspense } from "react";
import { PageHeader, Panel, Skeleton } from "@/components/ui";
import { requireStaff } from "@/lib/auth";
import { humanize } from "@/lib/format";
import { NameForm, PasswordForm } from "./forms";

export const metadata = { title: "My account" };

export default function AccountPage() {
  return (
    <>
      <PageHeader title="My account" description="Your name and password." />
      <Suspense fallback={<Skeleton className="h-72" />}>
        <Account />
      </Suspense>
    </>
  );
}

async function Account() {
  const user = await requireStaff("/dashboard/account");
  return (
    <div className="grid max-w-3xl gap-6">
      <Panel>
        <h2 className="text-lg font-bold">Profile</h2>
        <p className="mb-4 text-sm text-muted">Signed in as {user.email} · {humanize(user.role)}</p>
        <NameForm name={user.fullName} />
      </Panel>
      <Panel>
        <h2 className="mb-4 text-lg font-bold">Change password</h2>
        <PasswordForm />
      </Panel>
    </div>
  );
}
