"use client"

import React from "react"
import Link from "next/link"
import { useRouter } from "next/navigation"
import { useForm } from "react-hook-form"
import { useMutation, useQueryClient } from "@tanstack/react-query"
import { toast } from "sonner"
import { ArrowLeft, Loader2 } from "lucide-react"
import { cn } from "@workspace/ui/lib/utils"
import { createDistributor, generateCompanyInviteCode, type CreateDistributorInput } from "@/lib/backend-api"
import { STATE_NAMES, citiesForState } from "@/lib/india-locations"
import { useMe } from "@/hooks/useMe"
import { companyInviteCodeKey } from "./CompanyInviteCodeDialog"

type FormValues = {
  orgName: string
  gstNumber: string
  ownerName: string
  ownerEmail: string
  ownerContact: string
  phone: string
  address: string
  city: string
  state: string
  pincode: string
  country: string
}

const inputCls =
  "w-full rounded-lg border border-input bg-background px-3 py-2.5 text-sm outline-none focus:ring-2 focus:ring-ring/40"

function Field({
  label,
  error,
  children,
}: {
  label: string
  error?: string
  children: React.ReactNode
}) {
  return (
    <div>
      <label className="mb-1.5 block text-sm font-medium">{label}</label>
      {children}
      {error && <p className="mt-1 text-xs text-destructive">{error}</p>}
    </div>
  )
}

export default function AddDistributorForm() {
  const router = useRouter()
  const queryClient = useQueryClient()
  const { canManageDistributors, isLoading, me } = useMe()
  const inviteKey = companyInviteCodeKey(me?.membership?.organizationId)

  const {
    register,
    handleSubmit,
    watch,
    setValue,
    formState: { errors },
  } = useForm<FormValues>({ defaultValues: {
    country: "India",
  } })

  // City list cascades off the chosen state.
  const selectedState = watch("state")
  const cityOptions = React.useMemo(() => citiesForState(selectedState), [selectedState])

  const mutation = useMutation({
    mutationFn: async (values: FormValues) => {
      const { inviteCode } = await generateCompanyInviteCode()
      queryClient.removeQueries({ queryKey: inviteKey })
      const payload: CreateDistributorInput = {
        inviteCode,
        orgName: values.orgName,
        ownerName: values.ownerName,
        ownerEmail: values.ownerEmail,
        ownerContact: values.ownerContact,
        address: values.address,
        city: values.city,
        state: values.state,
        pincode: Number(values.pincode),
        gstNumber: values.gstNumber || undefined,
        phone: values.phone || undefined,
        country: values.country || undefined,
      }
      return createDistributor(payload)
    },
    onSuccess: (data) => {
      queryClient.removeQueries({ queryKey: inviteKey })
      toast.success(`Distributor "${data.organization.name}" registered`)
      if (data.credentialsEmailSent === false) {
        toast.warning("Couldn't email login credentials — configure the mail service to send them.")
      }
      queryClient.invalidateQueries({ queryKey: ["distributors"] })
      router.push("/distributors")
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Failed to register distributor"),
  })

  // Guard: only company admin/super-admin.
  if (!isLoading && !canManageDistributors) {
    return (
      <div className="mx-auto max-w-3xl">
        <div className="rounded-xl border border-border bg-card p-8 text-center text-sm text-muted-foreground">
          You don't have permission to register distributors.
        </div>
      </div>
    )
  }

  return (
    <div className="mx-auto max-w-3xl">
      <div className="mb-5 flex items-center gap-3">
        <Link href="/distributors" className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground">
          <ArrowLeft size={16} /> Back
        </Link>
        <h1 className="text-2xl font-semibold tracking-tight">Register Distributor</h1>
      </div>

      <form
        onSubmit={handleSubmit((v) => mutation.mutate(v))}
        className="rounded-2xl border border-border bg-card p-6"
      >
        {/* Distributor Information */}
        <h2 className="mb-4 text-sm font-semibold">Distributor Information</h2>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <Field label="Business Name" error={errors.orgName?.message}>
            <input className={inputCls} {...register("orgName", { required: "Business name is required" })} />
          </Field>
          <Field label="GST Number">
            <input className={inputCls} {...register("gstNumber")} />
          </Field>
          <Field label="Contact Person" error={errors.ownerName?.message}>
            <input className={inputCls} {...register("ownerName", { required: "Contact person is required" })} />
          </Field>
          <Field label="Email Address" error={errors.ownerEmail?.message}>
            <input
              type="email"
              className={inputCls}
              {...register("ownerEmail", {
                required: "Email is required",
                pattern: { value: /^[^\s@]+@[^\s@]+\.[^\s@]+$/, message: "Enter a valid email" },
              })}
            />
          </Field>
          <Field label="Owner Contact Number" error={errors.ownerContact?.message}>
            <input aria-label="Owner Contact Number" type="tel" inputMode="numeric" autoComplete="tel-national" maxLength={10} className={inputCls}
              {...register("ownerContact", {
                required: "Owner contact is required",
                setValueAs: (value: string) => value.trim(),
                pattern: { value: /^\d{10}$/, message: "Enter a 10-digit contact number" },
              })} />
          </Field>
          <Field label="Organization Phone (optional)">
            <input className={inputCls} {...register("phone")} />
          </Field>
        </div>

        {/* Address Information */}
        <h2 className="mb-4 mt-6 border-t border-border pt-6 text-sm font-semibold">Address Information</h2>
        <div className="space-y-4">
          <Field label="Street Address" error={errors.address?.message}>
            <input className={inputCls} {...register("address", { required: "Street address is required" })} />
          </Field>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <Field label="State" error={errors.state?.message}>
              <select
                className={inputCls}
                defaultValue=""
                {...register("state", {
                  required: "State is required",
                  onChange: () => setValue("city", ""),
                })}
              >
                <option value="" disabled>
                  Select state
                </option>
                {STATE_NAMES.map((s) => (
                  <option key={s} value={s}>
                    {s}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="City" error={errors.city?.message}>
              <select
                className={cn(inputCls, !selectedState && "cursor-not-allowed opacity-60")}
                defaultValue=""
                disabled={!selectedState}
                {...register("city", { required: "City is required" })}
              >
                <option value="" disabled>
                  {selectedState ? "Select city" : "Select a state first"}
                </option>
                {cityOptions.map((c) => (
                  <option key={c} value={c}>
                    {c}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="Postal Code" error={errors.pincode?.message}>
              <input
                inputMode="numeric"
                className={inputCls}
                {...register("pincode", {
                  required: "Postal code is required",
                  pattern: { value: /^\d{6}$/, message: "Enter a valid 6-digit PIN code" },
                })}
              />
            </Field>
            <Field label="Country">
              <input
                className={cn(inputCls, "cursor-not-allowed bg-muted text-muted-foreground")}
                readOnly
                {...register("country")}
              />
            </Field>
          </div>
        </div>

        <div className="mt-6 flex justify-end gap-2 border-t border-border pt-5">
          <Link
            href="/distributors"
            className="rounded-lg border border-border px-4 py-2 text-sm font-medium hover:bg-muted"
          >
            Cancel
          </Link>
          <button
            type="submit"
            disabled={mutation.isPending}
            className={cn(
              "inline-flex items-center gap-2 rounded-lg bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground transition hover:opacity-90",
              "disabled:cursor-not-allowed disabled:opacity-60"
            )}
          >
            {mutation.isPending && <Loader2 size={16} className="animate-spin" />}
            Register Distributor
          </button>
        </div>
      </form>
    </div>
  )
}
