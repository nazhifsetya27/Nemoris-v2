import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

export { prisma };

export async function connectDatabase() {
  await prisma.$connect();
  console.log('✅ PostgreSQL connected');
}

export async function disconnectDatabase() {
  await prisma.$disconnect();
}
