import type {prisma} from '../../prisma/prisma.js';
export type VerificationTransaction=Omit<typeof prisma,'$connect'|'$disconnect'|'$on'|'$transaction'|'$use'|'$extends'>;
