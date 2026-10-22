import "server-only";
import { PrismaClient } from "@prisma/client";

const g = globalThis as unknown as { prisma?: PrismaClient };

export const db = g.prisma ?? new PrismaClient({ log: ["warn", "error"] });

if (process.env.NODE_ENV !== "production") g.prisma = db;

export type Tx = Parameters<Parameters<typeof db.$transaction>[0]>[0];
