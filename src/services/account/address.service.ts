import 'server-only';

import type { AddressType } from '@/generated/prisma/enums';
import type { SavedAddressInput } from '@/features/account/schemas';
import { errors } from '@/lib/api/errors';
import { prisma } from '@/lib/prisma';

/**
 * The address book.
 *
 * Every function takes the owning `userId` and filters by it. An address id on
 * its own is never enough to read or write a row — ids are cuids, not sequential,
 * but that is obscurity, not authorisation.
 *
 * Orders snapshot their own destination (`Order.shippingAddressSnapshot`), so
 * editing or deleting an address here never rewrites where a past order went.
 */

export async function listAddresses(userId: string) {
  return prisma.address.findMany({
    where: { userId },
    orderBy: [{ isDefault: 'desc' }, { updatedAt: 'desc' }],
  });
}

export async function getAddress(userId: string, addressId: string) {
  return prisma.address.findFirst({ where: { id: addressId, userId } });
}

function toRow(input: SavedAddressInput) {
  return {
    firstName: input.firstName,
    lastName: input.lastName,
    company: input.company?.trim() || null,
    line1: input.line1,
    line2: input.line2?.trim() || null,
    city: input.city,
    state: input.state,
    postalCode: input.postalCode,
    country: input.country,
    phone: input.phone?.trim() || null,
  };
}

/**
 * Adds an address.
 *
 * The first address of a given type becomes the default automatically — asking
 * someone to nominate a default when they only have one is a question with one
 * possible answer.
 */
export async function createAddress(userId: string, input: SavedAddressInput) {
  const existing = await prisma.address.count({ where: { userId, type: input.type } });
  const shouldDefault = input.isDefault || existing === 0;

  return prisma.$transaction(async (tx) => {
    if (shouldDefault) await clearDefault(tx, userId, input.type);

    return tx.address.create({
      data: { ...toRow(input), userId, type: input.type, isDefault: shouldDefault },
    });
  });
}

export async function updateAddress(userId: string, addressId: string, input: SavedAddressInput) {
  const owned = await getAddress(userId, addressId);
  if (!owned) throw errors.notFound('Address');

  return prisma.$transaction(async (tx) => {
    if (input.isDefault) await clearDefault(tx, userId, input.type, addressId);

    return tx.address.update({
      where: { id: addressId },
      data: {
        ...toRow(input),
        type: input.type,
        // Never demote the last default to nothing: if this row is currently the
        // default and the form did not ask to change that, it stays.
        isDefault: input.isDefault || (owned.isDefault && owned.type === input.type),
      },
    });
  });
}

/**
 * Deletes an address, promoting a replacement if this was the default.
 *
 * Leaving a customer with addresses but no default means the next checkout
 * pre-fills nothing, which reads as the address book having lost them.
 */
export async function deleteAddress(userId: string, addressId: string): Promise<void> {
  const owned = await getAddress(userId, addressId);
  if (!owned) throw errors.notFound('Address');

  await prisma.$transaction(async (tx) => {
    await tx.address.delete({ where: { id: addressId } });

    if (!owned.isDefault) return;

    const replacement = await tx.address.findFirst({
      where: { userId, type: owned.type },
      orderBy: { updatedAt: 'desc' },
    });

    if (replacement) {
      await tx.address.update({ where: { id: replacement.id }, data: { isDefault: true } });
    }
  });
}

export async function setDefaultAddress(userId: string, addressId: string): Promise<void> {
  const owned = await getAddress(userId, addressId);
  if (!owned) throw errors.notFound('Address');

  await prisma.$transaction(async (tx) => {
    await clearDefault(tx, userId, owned.type, addressId);
    await tx.address.update({ where: { id: addressId }, data: { isDefault: true } });
  });
}

export async function getDefaultAddress(userId: string, type: AddressType = 'SHIPPING') {
  return prisma.address.findFirst({ where: { userId, type, isDefault: true } });
}

type Tx = Parameters<Parameters<typeof prisma.$transaction>[0]>[0];

/**
 * Demotes the current default for a type.
 *
 * A partial unique index in the database enforces one default per user per type,
 * so this must run before the promotion, inside the same transaction — otherwise
 * the second write violates the constraint rather than replacing the first.
 */
async function clearDefault(
  tx: Tx,
  userId: string,
  type: AddressType,
  exceptId?: string,
): Promise<void> {
  await tx.address.updateMany({
    where: { userId, type, isDefault: true, ...(exceptId ? { NOT: { id: exceptId } } : {}) },
    data: { isDefault: false },
  });
}

export type AddressRecord = Awaited<ReturnType<typeof listAddresses>>[number];
