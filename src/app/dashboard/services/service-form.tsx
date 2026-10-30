"use client";

import { saveService } from "@/app/actions/dashboard";
import { ActionForm } from "@/components/action-form";
import { Button, Field, Input, Select, Textarea } from "@/components/ui";

type ServiceRow = {
  id: string; name: string; category_id: string | null; description: string | null;
  duration_minutes: number; buffer_minutes: number; price: number; deposit_amount: number;
  requires_approval: boolean; is_active: boolean; dentistIds: string[];
};

export function ServiceForm({
  service, categories, dentists,
}: { service?: ServiceRow; categories: { id: string; name: string }[]; dentists: { id: string; name: string }[] }) {
  return (
    <ActionForm action={saveService} resetOnSuccess={!service} className="grid gap-4 md:grid-cols-2">
      {({ pending, errors }) => (
        <>
          <input type="hidden" name="id" value={service?.id ?? ""} />
          <Field label="Name" name="name" error={errors.name}>
            <Input name="name" defaultValue={service?.name} error={errors.name} />
          </Field>
          <Field label="Category" name="categoryId">
            <Select name="categoryId" defaultValue={service?.category_id ?? ""}>
              <option value="">None</option>
              {categories.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
            </Select>
          </Field>
          <div className="md:col-span-2">
            <Field label="Description" name="description">
              <Textarea name="description" defaultValue={service?.description ?? ""} maxLength={2000} />
            </Field>
          </div>
          <div className="grid grid-cols-2 gap-4">
            <Field label="Duration (min)" name="duration" error={errors.duration}>
              <Input name="duration" type="number" min={5} max={480} step={5} defaultValue={service?.duration_minutes ?? 30} error={errors.duration} />
            </Field>
            <Field label="Cleanup after (min)" name="buffer" error={errors.buffer} hint="Blocks the chair after each visit">
              <Input name="buffer" type="number" min={0} max={120} step={5} defaultValue={service?.buffer_minutes ?? 10} error={errors.buffer} />
            </Field>
          </div>
          <div className="grid grid-cols-2 gap-4">
            <Field label="Price (₱)" name="price" error={errors.price}>
              <Input name="price" type="number" min={0} step="0.01" defaultValue={service?.price ?? ""} error={errors.price} />
            </Field>
            <Field label="Deposit (₱)" name="deposit" error={errors.deposit} hint="0 = no deposit">
              <Input name="deposit" type="number" min={0} step="0.01" defaultValue={service?.deposit_amount ?? 0} error={errors.deposit} />
            </Field>
          </div>
          <fieldset className="md:col-span-2">
            <legend className="mb-2 text-sm font-medium">Dentists who offer this</legend>
            <div className="flex flex-wrap gap-4">
              {dentists.map((d) => (
                <label key={d.id} className="flex items-center gap-2 text-sm">
                  <input type="checkbox" name="dentistIds" value={d.id} defaultChecked={service ? service.dentistIds.includes(d.id) : true} className="h-4 w-4 accent-cobalt" />
                  {d.name}
                </label>
              ))}
            </div>
          </fieldset>
          <div className="flex flex-wrap gap-6 md:col-span-2">
            <label className="flex items-center gap-2 text-sm">
              <input type="checkbox" name="requiresApproval" defaultChecked={service?.requires_approval} className="h-4 w-4 accent-cobalt" />
              Clinic must approve each booking
            </label>
            <label className="flex items-center gap-2 text-sm">
              <input type="checkbox" name="isActive" defaultChecked={service?.is_active ?? true} className="h-4 w-4 accent-cobalt" />
              Show on the booking page
            </label>
          </div>
          <div className="md:col-span-2">
            <Button type="submit" disabled={pending}>{pending ? "Saving…" : service ? "Save changes" : "Add service"}</Button>
          </div>
        </>
      )}
    </ActionForm>
  );
}
