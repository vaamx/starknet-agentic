const isBuildTime =
  process.env.NEXT_PHASE === "phase-production-build" ||
  process.env.PREDICTION_AGENT_BUILD === "true";

function isPostgresUrl(url: string | undefined): boolean {
  if (!url) return false;
  return url.startsWith("postgres://") || url.startsWith("postgresql://");
}

export function usePrismaRuntime(): boolean {
  if (isBuildTime) return false;
  return isPostgresUrl(process.env.DATABASE_URL);
}

let prismaClientPromise: Promise<any | null> | null = null;

export async function getPrismaClient(): Promise<any | null> {
  if (!usePrismaRuntime()) return null;
  if (prismaClientPromise) return prismaClientPromise;

  prismaClientPromise = (async () => {
    try {
      // Dynamic import to avoid bundling when not using Postgres
      const { PrismaClient } = await import("@prisma/client");
      if (!PrismaClient) return null;

      if (!(globalThis as any).__hivecaster_prisma) {
        (globalThis as any).__hivecaster_prisma = new PrismaClient();
      }
      return (globalThis as any).__hivecaster_prisma;
    } catch {
      return null;
    }
  })();

  return prismaClientPromise;
}
