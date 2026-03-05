let prismaClientPromise: Promise<any | null> | null = null;

function isPostgresUrl(url: string | undefined): boolean {
  if (!url) return false;
  return url.startsWith("postgres://") || url.startsWith("postgresql://");
}

export function usePrismaRuntime(): boolean {
  return isPostgresUrl(process.env.DATABASE_URL);
}

export async function getPrismaClient(): Promise<any | null> {
  if (!usePrismaRuntime()) return null;
  if (prismaClientPromise) return prismaClientPromise;

  prismaClientPromise = (async () => {
    try {
      const dynamicImport = new Function(
        "moduleName",
        "return import(moduleName)"
      ) as (moduleName: string) => Promise<any>;
      const mod = await dynamicImport("@prisma/client");
      const PrismaClient = mod?.PrismaClient;
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
