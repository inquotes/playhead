import { PrismaClient, type Prisma } from "@prisma/client";
import { PrismaD1 } from "@prisma/adapter-d1";
import { getCloudflareContext } from "@opennextjs/cloudflare";

const globalForPrisma = globalThis as unknown as {
  prismaGlobal: PrismaClient | undefined;
};

function getCloudflareD1Binding(): unknown | null {
  try {
    const { env } = getCloudflareContext();
    const value = (env as { DB?: unknown }).DB;
    return value ?? null;
  } catch {
    return null;
  }
}

const cloudflareD1Binding = getCloudflareD1Binding();

function createPrismaClient(d1Binding: unknown | null = cloudflareD1Binding) {
  const log: Prisma.LogLevel[] = process.env.NODE_ENV === "development" ? ["warn", "error"] : ["error"];
  if (d1Binding) {
    return new PrismaClient({
      adapter: new PrismaD1(d1Binding as any),
      log,
    } as any);
  }

  return new PrismaClient({ log });
}

const existingNodeClient = globalForPrisma.prismaGlobal;
const prismaClient = cloudflareD1Binding ? createPrismaClient(cloudflareD1Binding) : existingNodeClient ?? createPrismaClient();

export const prisma = prismaClient;

if (process.env.NODE_ENV !== "production" && !cloudflareD1Binding) {
  globalForPrisma.prismaGlobal = prisma;
}
