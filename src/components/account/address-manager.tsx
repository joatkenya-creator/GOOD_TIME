'use client';

import { MapPin, Pencil, Plus, Star, Trash2 } from 'lucide-react';
import { useActionState, useState } from 'react';

import { CheckboxField, Field } from '@/components/checkout/address-fields';
import { Alert } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { EmptyState } from '@/components/ui/empty-state';
import { Modal } from '@/components/ui/modal';
import { Select } from '@/components/ui/select';
import { useToast } from '@/components/ui/toast';
import { US_STATES } from '@/features/checkout/schemas';
import {
  deleteAddressAction,
  saveAddressAction,
  setDefaultAddressAction,
  type ActionResult,
} from '@/server/actions/account';
import type { AddressRecord } from '@/services/account/address.service';

/**
 * The address book.
 *
 * One modal serves both adding and editing — the fields are identical, and two
 * forms would be two places to forget a validation rule.
 *
 * Deleting asks first. Unlike removing a cart line, there is no undo: the address
 * is gone, and re-entering it is a minute of typing on a phone.
 */

const EMPTY: ActionResult = { ok: false, message: '' };

export function AddressManager({ addresses }: { addresses: AddressRecord[] }) {
  const [editing, setEditing] = useState<AddressRecord | null>(null);
  const [adding, setAdding] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState<AddressRecord | null>(null);
  const { toast } = useToast();

  const shipping = addresses.filter((address) => address.type === 'SHIPPING');
  const billing = addresses.filter((address) => address.type === 'BILLING');

  async function onDelete(address: AddressRecord) {
    const result = await deleteAddressAction(address.id);
    toast({ variant: result.ok ? 'success' : 'error', title: result.message });
    setConfirmDelete(null);
  }

  async function onSetDefault(address: AddressRecord) {
    const result = await setDefaultAddressAction(address.id);
    toast({ variant: result.ok ? 'success' : 'error', title: result.message });
  }

  return (
    <div className="space-y-8">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-body-sm text-foreground-muted">
          {addresses.length === 0
            ? 'Save an address and checkout fills itself in next time.'
            : `${addresses.length} saved ${addresses.length === 1 ? 'address' : 'addresses'}.`}
        </p>

        <Button onClick={() => setAdding(true)}>
          <Plus aria-hidden="true" className="size-4" />
          Add an address
        </Button>
      </div>

      {addresses.length === 0 ? (
        <EmptyState
          icon={<MapPin aria-hidden="true" className="size-8" />}
          title="No saved addresses"
          description="Addresses you save here appear at checkout, so you only type them once."
          action={<Button onClick={() => setAdding(true)}>Add your first address</Button>}
        />
      ) : (
        <>
          <AddressGroup
            heading="Shipping addresses"
            addresses={shipping}
            onEdit={setEditing}
            onDelete={setConfirmDelete}
            onSetDefault={onSetDefault}
          />
          <AddressGroup
            heading="Billing addresses"
            addresses={billing}
            onEdit={setEditing}
            onDelete={setConfirmDelete}
            onSetDefault={onSetDefault}
          />
        </>
      )}

      <AddressModal
        open={adding || editing !== null}
        address={editing}
        onClose={() => {
          setAdding(false);
          setEditing(null);
        }}
      />

      <Modal
        open={confirmDelete !== null}
        onClose={() => setConfirmDelete(null)}
        title="Delete this address?"
      >
        <p className="text-body-sm text-foreground-muted">
          {confirmDelete?.line1}, {confirmDelete?.city} will be removed. Orders already placed to it
          are unaffected — they keep their own copy.
        </p>

        <div className="mt-6 flex flex-wrap gap-3">
          <Button variant="danger" onClick={() => confirmDelete && void onDelete(confirmDelete)}>
            Delete address
          </Button>
          <Button variant="ghost" onClick={() => setConfirmDelete(null)}>
            Keep it
          </Button>
        </div>
      </Modal>
    </div>
  );
}

function AddressGroup({
  heading,
  addresses,
  onEdit,
  onDelete,
  onSetDefault,
}: {
  heading: string;
  addresses: AddressRecord[];
  onEdit: (address: AddressRecord) => void;
  onDelete: (address: AddressRecord) => void;
  onSetDefault: (address: AddressRecord) => void;
}) {
  if (addresses.length === 0) return null;

  return (
    <section>
      <h2 className="text-body font-semibold text-foreground">{heading}</h2>

      <ul className="mt-3 grid gap-3 sm:grid-cols-2">
        {addresses.map((address) => (
          <li key={address.id} className="rounded-2xl border border-border bg-surface p-5">
            <div className="flex items-start justify-between gap-3">
              <p className="text-body-sm font-semibold text-foreground">
                {address.firstName} {address.lastName}
              </p>
              {address.isDefault ? <Badge variant="success">Default</Badge> : null}
            </div>

            <address className="mt-2 text-body-sm text-foreground-muted not-italic">
              {address.company ? (
                <>
                  {address.company}
                  <br />
                </>
              ) : null}
              {address.line1}
              {address.line2 ? (
                <>
                  <br />
                  {address.line2}
                </>
              ) : null}
              <br />
              {address.city}, {address.state} {address.postalCode}
              {address.phone ? (
                <>
                  <br />
                  {address.phone}
                </>
              ) : null}
            </address>

            <div className="mt-4 flex flex-wrap gap-1">
              <Button variant="ghost" size="sm" onClick={() => onEdit(address)}>
                <Pencil aria-hidden="true" className="size-4" />
                Edit
              </Button>

              {!address.isDefault ? (
                <Button variant="ghost" size="sm" onClick={() => onSetDefault(address)}>
                  <Star aria-hidden="true" className="size-4" />
                  Make default
                </Button>
              ) : null}

              <Button
                variant="ghost"
                size="sm"
                onClick={() => onDelete(address)}
                className="text-foreground-muted hover:text-danger-700"
              >
                <Trash2 aria-hidden="true" className="size-4" />
                Delete
                <span className="sr-only">
                  {' '}
                  {address.firstName} {address.lastName}, {address.line1}
                </span>
              </Button>
            </div>
          </li>
        ))}
      </ul>
    </section>
  );
}

function AddressModal({
  open,
  address,
  onClose,
}: {
  open: boolean;
  address: AddressRecord | null;
  onClose: () => void;
}) {
  const { toast } = useToast();

  const [result, action, pending] = useActionState(
    async (_previous: ActionResult, formData: FormData) => {
      const outcome = await saveAddressAction(address?.id ?? null, formData);

      if (outcome.ok) {
        toast({ variant: 'success', title: outcome.message });
        onClose();
      }

      return outcome;
    },
    EMPTY,
  );

  const errors = result.fieldErrors ?? {};

  return (
    <Modal open={open} onClose={onClose} title={address ? 'Edit address' : 'Add an address'}>
      {/* Keyed so switching between two addresses resets every field — without
          it React reuses the inputs and the previous address's values persist. */}
      <form key={address?.id ?? 'new'} action={action} noValidate className="space-y-4">
        <div className="grid gap-4 sm:grid-cols-2">
          <Field
            id="addr-firstName"
            name="firstName"
            label="First name"
            autoComplete="given-name"
            defaultValue={address?.firstName ?? ''}
            error={errors.firstName?.[0]}
          />
          <Field
            id="addr-lastName"
            name="lastName"
            label="Last name"
            autoComplete="family-name"
            defaultValue={address?.lastName ?? ''}
            error={errors.lastName?.[0]}
          />
        </div>

        <Field
          id="addr-company"
          name="company"
          label="Company"
          optional
          autoComplete="organization"
          defaultValue={address?.company ?? ''}
          error={errors.company?.[0]}
        />

        <Field
          id="addr-line1"
          name="line1"
          label="Street address"
          autoComplete="address-line1"
          defaultValue={address?.line1 ?? ''}
          error={errors.line1?.[0]}
        />

        <Field
          id="addr-line2"
          name="line2"
          label="Apartment, suite, etc."
          optional
          autoComplete="address-line2"
          defaultValue={address?.line2 ?? ''}
          error={errors.line2?.[0]}
        />

        <div className="grid gap-4 sm:grid-cols-3">
          <Field
            id="addr-city"
            name="city"
            label="City"
            autoComplete="address-level2"
            defaultValue={address?.city ?? ''}
            error={errors.city?.[0]}
          />

          <div>
            <label
              htmlFor="addr-state"
              className="mb-1.5 block text-body-sm font-medium text-foreground"
            >
              State
            </label>
            <Select
              id="addr-state"
              name="state"
              defaultValue={address?.state ?? ''}
              autoComplete="address-level1"
            >
              <option value="" disabled>
                Choose
              </option>
              {US_STATES.map(([code, name]) => (
                <option key={code} value={code}>
                  {name}
                </option>
              ))}
            </Select>
          </div>

          <Field
            id="addr-postalCode"
            name="postalCode"
            label="ZIP"
            inputMode="numeric"
            autoComplete="postal-code"
            defaultValue={address?.postalCode ?? ''}
            error={errors.postalCode?.[0]}
          />
        </div>

        <Field
          id="addr-phone"
          name="phone"
          label="Phone"
          optional
          type="tel"
          autoComplete="tel"
          defaultValue={address?.phone ?? ''}
          error={errors.phone?.[0]}
        />

        <div>
          <label
            htmlFor="addr-type"
            className="mb-1.5 block text-body-sm font-medium text-foreground"
          >
            Use this address for
          </label>
          <Select id="addr-type" name="type" defaultValue={address?.type ?? 'SHIPPING'}>
            <option value="SHIPPING">Shipping</option>
            <option value="BILLING">Billing</option>
          </Select>
        </div>

        <CheckboxField
          id="addr-isDefault"
          name="isDefault"
          label="Use this as my default"
          defaultChecked={address?.isDefault ?? false}
        />

        {!result.ok && result.message ? (
          <Alert variant="danger" role="alert">
            {result.message}
          </Alert>
        ) : null}

        <div className="flex flex-wrap gap-3">
          <Button type="submit" isLoading={pending}>
            {address ? 'Save changes' : 'Save address'}
          </Button>
          <Button type="button" variant="ghost" onClick={onClose}>
            Cancel
          </Button>
        </div>
      </form>
    </Modal>
  );
}
