import 'dotenv/config';

import { createScriptClient } from '../prisma/client';
import { ROLES } from '../src/constants/permissions';

/**
 * Grants a role to an existing user.
 *
 * There is deliberately no UI for creating the first administrator — bootstrap
 * from a shell where you already have database credentials, not from a public
 * form that someone could reach first.
 *
 *   npm run grant-admin -- you@example.com SUPER_ADMIN
 */
const prisma = createScriptClient();

async function main(): Promise<void> {
  const [rawEmail, roleKey = ROLES.admin] = process.argv.slice(2);

  if (!rawEmail) {
    console.error('Usage: npm run grant-admin -- <email> [ROLE_KEY]');
    process.exit(1);
  }

  // Registration normalises the address before storing it, so match that here —
  // otherwise `Me@Gmail.com` misses the row saved as `me@gmail.com`.
  const email = rawEmail.trim().toLowerCase();

  const [user, role] = await Promise.all([
    prisma.user.findUnique({ where: { email }, select: { id: true } }),
    prisma.role.findUnique({ where: { key: roleKey }, select: { id: true } }),
  ]);

  if (!user) {
    console.error(`No user with email ${email}. Register the account first.`);
    process.exit(1);
  }

  if (!role) {
    console.error(`No role with key ${roleKey}. Run \`npm run db:seed\` first.`);
    process.exit(1);
  }

  await prisma.userRole.upsert({
    where: { userId_roleId: { userId: user.id, roleId: role.id } },
    update: {},
    create: { userId: user.id, roleId: role.id },
  });

  console.log(`Granted ${roleKey} to ${email}. They must sign out and back in.`);
}

main()
  .catch((error) => {
    console.error(error);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
