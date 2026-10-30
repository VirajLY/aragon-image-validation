import { PrismaClient } from '@prisma/client';

/**
 * Singleton Prisma client instance for database operations.
 * Reuses the same connection pool across the application.
 */
const prisma = new PrismaClient({
  log:
    process.env.NODE_ENV === 'development'
      ? ['query', 'info', 'warn', 'error']
      : ['warn', 'error'],
});

export default prisma;
