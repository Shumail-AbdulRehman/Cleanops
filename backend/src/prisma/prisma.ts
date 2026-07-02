import "dotenv/config";
import prismaClientPkg from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import bcrypt from "bcrypt";

const { PrismaClient } = prismaClientPkg;
const adapter = new PrismaPg({
    connectionString: process.env.DATABASE_URL!,
});

const prisma = new PrismaClient({
    adapter,
    log: ['info', 'warn', 'error'],
    // Remote development databases can exceed five seconds across the locked
    // authorization/start/session queries. Keep operations atomic and bounded,
    // using the same budget as inventory creation rather than the Prisma default.
    transactionOptions: { maxWait: 10_000, timeout: 30_000 },
}).$extends({
    query: {
        manager: {
            async create({ args, query }) {
                if (args.data.password) {
                    args.data.password = await bcrypt.hash(args.data.password, 10);
                }
                return query(args);
            },
            async update({ args, query }) {
                if (args.data.password && typeof args.data.password === "string") {
                    args.data.password = await bcrypt.hash(args.data.password, 10);
                }
                return query(args);
            },
        },
        staff: {
            async create({ args, query }) {
                if (args.data.password) {
                    args.data.password = await bcrypt.hash(args.data.password, 10);
                }
                return query(args);
            },
            async update({ args, query }) {
                if (args.data.password && typeof args.data.password === "string") {
                    args.data.password = await bcrypt.hash(args.data.password, 10);
                }
                return query(args);
            },
        },
    },
});

export { prisma };
