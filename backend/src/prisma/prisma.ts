import "dotenv/config";
import prismaClientPkg from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import bcrypt from "bcrypt";

const { PrismaClient } = prismaClientPkg;
const adapter = new PrismaPg({
    connectionString: process.env.DATABASE_URL!,
});

const prisma = new PrismaClient({ adapter, log: [ 'info', 'warn', 'error'] }).$extends({
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
