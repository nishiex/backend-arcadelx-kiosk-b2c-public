"use client"

import React from "react"
import Link from "next/link"
import { useRouter } from "next/navigation"
import { useForm, useWatch } from "react-hook-form"
import { useMutation, useQueryClient } from "@tanstack/react-query"
import { toast } from "sonner"
import { ArrowLeft, Loader2, ShieldCheck } from "lucide-react"
import { registerIpParty, type RegisterIpPartyInput } from "@/lib/ip-api"
import { STATE_NAMES, citiesForState } from "@/lib/india-locations"
import { useMe } from "@/hooks/useMe"
import { EmptyState, Panel } from "@/components/dashboard/ui"

const inputCls =
  "w-full rounded-lg border border-input bg-background px-3 py-2.5 text-sm outline-none focus:ring-2 focus:ring-ring/40"

const PAN_PATTERN = /^[A-Z]{5}[0-9]{4}[A-Z]$/
const GSTIN_PATTERN = /^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z][1-9A-Z]Z[0-9A-Z]$/
const SOURCE_KEY_PATTERN = /^[a-zA-Z0-9_-]+$/

type FormValues = {
  orgName: string
  ownerName: string
  ownerEmail: string
  ownerContact: string
  address: string
  state: string
  city: string
  pincode: string
  legalName: string
  pan: string
  gstin: string
  statementEmail: string
  sourceKey: string
  ipSharePct: string
  effectiveFrom: string
}

function Field({
  label,
  error,
  hint,
  required = false,
  children,
}: {
  label: string
  error?: string
  hint?: string
  required?: boolean
  children: React.ReactNode
}) {
  return (
    <div>
      <label className="mb-1.5 block text-sm font-medium">
        {label}
        {required && (
          <span className="ml-1 text-destructive" aria-hidden="true">
            *
          </span>
        )}
      </label>
      {children}
      {hint && !error ? <p className="mt-1 text-xs text-muted-foreground">{hint}</p> : null}
      {error && <p className="mt-1 text-xs text-destructive">{error}</p>}
    </div>
  )
}

function todayInput(): string {
  const now = new Date()
  const month = String(now.getMonth() + 1).padStart(2, "0")
  const day = String(now.getDate()).padStart(2, "0")
  return `${now.getFullYear()}-${month}-${day}`
}

export default function RegisterIpForm() {
  const router = useRouter()
  const queryClient = useQueryClient()
  const { isMasterAdmin, isLoading } = useMe()

  const {
    register,
    handleSubmit,
    control,
    setValue,
    formState: { errors },
  } = useForm<FormValues>({
    defaultValues: {
      orgName: "",
      ownerName: "",
      ownerEmail: "",
      ownerContact: "",
      address: "",
      state: "",
      city: "",
      pincode: "",
      legalName: "",
      pan: "",
      gstin: "",
      statementEmail: "",
      sourceKey: "",
      ipSharePct: "60",
      effectiveFrom: todayInput(),
    },
  })

  const state = useWatch({ control, name: "state" })
  const cities = React.useMemo(() => (state ? citiesForState(state) : []), [state])

  const mutation = useMutation({
    mutationFn: registerIpParty,
    onSuccess: (data) => {
      void queryClient.invalidateQueries({ queryKey: ["ip-parties"] })
      toast.success(
        `${data.organization.name} registered. A temporary password was emailed to ${data.owner.email}.`,
      )
      router.push("/ip")
    },
    onError: (error: Error) => toast.error(error.message),
  })

  if (isLoading) {
    return <div className="py-16 text-center text-sm text-muted-foreground">Loading…</div>
  }

  if (!isMasterAdmin) {
    return (
      <Panel title="Register IP party" subtitle="Company owner only">
        <EmptyState
          icon={<ShieldCheck size={18} />}
          message="Only the Company owner (master admin) can register IP parties."
        />
      </Panel>
    )
  }

  const onSubmit = (values: FormValues) => {
    const payload: RegisterIpPartyInput = {
      orgName: values.orgName.trim(),
      ownerName: values.ownerName.trim(),
      ownerEmail: values.ownerEmail.trim().toLowerCase(),
      ownerContact: values.ownerContact.trim(),
      address: values.address.trim(),
      state: values.state.trim(),
      city: values.city.trim(),
      pincode: Number(values.pincode),
      pan: values.pan.trim().toUpperCase(),
      sourceKey: values.sourceKey.trim(),
      ipSharePct: Number(values.ipSharePct),
      ...(values.legalName.trim() ? { legalName: values.legalName.trim() } : {}),
      ...(values.gstin.trim() ? { gstin: values.gstin.trim().toUpperCase() } : {}),
      ...(values.statementEmail.trim() ? { statementEmail: values.statementEmail.trim().toLowerCase() } : {}),
      ...(values.effectiveFrom ? { effectiveFrom: new Date(values.effectiveFrom).toISOString() } : {}),
    }
    mutation.mutate(payload)
  }

  return (
    <form onSubmit={handleSubmit(onSubmit)} className="space-y-5" noValidate>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <Link
            href="/ip"
            className="inline-flex items-center gap-1.5 text-xs font-medium text-muted-foreground hover:text-foreground"
          >
            <ArrowLeft size={14} /> Back to IP parties
          </Link>
          <h1 className="mt-2 text-xl font-semibold tracking-tight">Register IP party</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Creates the organization, owner login, IP profile and the first royalty agreement in one step.
          </p>
        </div>
      </div>

      <Panel title="Organization" subtitle="Legal entity that owns the content.">
        <div className="grid gap-4 md:grid-cols-2">
          <Field label="Organization name" required error={errors.orgName?.message}>
            <input
              {...register("orgName", {
                required: "Organization name is required",
                minLength: { value: 2, message: "At least 2 characters" },
                maxLength: { value: 100, message: "At most 100 characters" },
              })}
              className={inputCls}
              autoComplete="organization"
            />
          </Field>

          <Field label="Legal name" error={errors.legalName?.message} hint="Optional; defaults to the organization name on the profile.">
            <input {...register("legalName", { maxLength: { value: 150, message: "At most 150 characters" } })} className={inputCls} />
          </Field>

          <Field label="Address" required error={errors.address?.message}>
            <input
              {...register("address", {
                required: "Address is required",
                minLength: { value: 5, message: "At least 5 characters" },
              })}
              className={inputCls}
              autoComplete="street-address"
            />
          </Field>

          <Field label="Pincode" required error={errors.pincode?.message}>
            <input
              {...register("pincode", {
                required: "Pincode is required",
                pattern: { value: /^\d{6}$/, message: "Enter a 6-digit pincode" },
              })}
              className={inputCls}
              inputMode="numeric"
              maxLength={6}
              autoComplete="postal-code"
            />
          </Field>

          <Field label="State" required error={errors.state?.message}>
            <select
              {...register("state", { required: "State is required" })}
              className={inputCls}
              onChange={(event) => {
                setValue("state", event.target.value, { shouldValidate: true })
                setValue("city", "")
              }}
            >
              <option value="">Select a state</option>
              {STATE_NAMES.map((name) => (
                <option key={name} value={name}>
                  {name}
                </option>
              ))}
            </select>
          </Field>

          <Field label="City" required error={errors.city?.message}>
            <input
              {...register("city", { required: "City is required", minLength: { value: 2, message: "At least 2 characters" } })}
              className={inputCls}
              list="ip-city-options"
              autoComplete="address-level2"
            />
            <datalist id="ip-city-options">
              {cities.map((city) => (
                <option key={city} value={city} />
              ))}
            </datalist>
          </Field>
        </div>
      </Panel>

      <Panel title="Owner login" subtitle="The owner receives a temporary password by email.">
        <div className="grid gap-4 md:grid-cols-3">
          <Field label="Owner name" required error={errors.ownerName?.message}>
            <input
              {...register("ownerName", {
                required: "Owner name is required",
                minLength: { value: 2, message: "At least 2 characters" },
              })}
              className={inputCls}
              autoComplete="name"
            />
          </Field>

          <Field label="Owner email" required error={errors.ownerEmail?.message}>
            <input
              {...register("ownerEmail", {
                required: "Owner email is required",
                pattern: { value: /^[^\s@]+@[^\s@]+\.[^\s@]+$/, message: "Enter a valid email" },
              })}
              className={inputCls}
              type="email"
              autoComplete="email"
            />
          </Field>

          <Field label="Owner contact" required error={errors.ownerContact?.message} hint="10 digits, no spaces.">
            <input
              {...register("ownerContact", {
                required: "Owner contact is required",
                pattern: { value: /^\d{10}$/, message: "Enter a 10-digit number" },
              })}
              className={inputCls}
              inputMode="numeric"
              maxLength={10}
              autoComplete="tel"
            />
          </Field>
        </div>
      </Panel>

      <Panel title="Tax details" subtitle="Used on the monthly royalty statement.">
        <div className="grid gap-4 md:grid-cols-2">
          <Field label="PAN" required error={errors.pan?.message} hint="Format ABCDE1234F.">
            <input
              {...register("pan", {
                required: "PAN is required",
                pattern: { value: PAN_PATTERN, message: "Enter a valid PAN" },
              })}
              className={`${inputCls} uppercase`}
              maxLength={10}
              onChange={(event) => setValue("pan", event.target.value.toUpperCase())}
            />
          </Field>

          <Field label="GSTIN" error={errors.gstin?.message} hint="Optional.">
            <input
              {...register("gstin", {
                validate: (value) =>
                  !value || GSTIN_PATTERN.test(value.toUpperCase()) || "Enter a valid GSTIN",
              })}
              className={`${inputCls} uppercase`}
              maxLength={15}
              onChange={(event) => setValue("gstin", event.target.value.toUpperCase())}
            />
          </Field>

          <Field label="Statement email" error={errors.statementEmail?.message} hint="Defaults to the owner email.">
            <input
              {...register("statementEmail", {
                validate: (value) =>
                  !value || /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value) || "Enter a valid email",
              })}
              className={inputCls}
              type="email"
            />
          </Field>
        </div>
      </Panel>

      <Panel title="Commercials" subtitle="Attribution key and royalty share.">
        <div className="grid gap-4 md:grid-cols-3">
          <Field
            label="Source key"
            required
            error={errors.sourceKey?.message}
            hint="Matches the transaction feed's source, e.g. nilee-games."
          >
            <input
              {...register("sourceKey", {
                required: "Source key is required",
                minLength: { value: 2, message: "At least 2 characters" },
                maxLength: { value: 50, message: "At most 50 characters" },
                pattern: { value: SOURCE_KEY_PATTERN, message: "Letters, numbers, hyphen or underscore only" },
              })}
              className={inputCls}
            />
          </Field>

          <Field label="IP share (%)" required error={errors.ipSharePct?.message}>
            <input
              {...register("ipSharePct", {
                required: "Share is required",
                min: { value: 0, message: "Cannot be negative" },
                max: { value: 100, message: "Cannot exceed 100" },
              })}
              className={inputCls}
              type="number"
              min={0}
              max={100}
              step="0.01"
            />
          </Field>

          <Field label="Effective from" error={errors.effectiveFrom?.message} hint="Defaults to today (IST).">
            <input {...register("effectiveFrom")} className={inputCls} type="date" />
          </Field>
        </div>
      </Panel>

      <div className="flex items-center justify-end gap-3">
        <Link href="/ip" className="rounded-lg border border-input px-3.5 py-2 text-sm font-medium hover:bg-muted">
          Cancel
        </Link>
        <button
          type="submit"
          disabled={mutation.isPending}
          className="inline-flex items-center gap-2 rounded-lg bg-primary px-3.5 py-2 text-sm font-medium text-primary-foreground shadow-sm transition-colors hover:bg-primary/90 disabled:opacity-60"
        >
          {mutation.isPending ? <Loader2 size={16} className="animate-spin" /> : null}
          Register IP party
        </button>
      </div>
    </form>
  )
}
