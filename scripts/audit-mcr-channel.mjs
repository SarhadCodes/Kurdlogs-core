import { PrismaClient } from '@prisma/client';

const channelId = process.argv[2] || 'c335bd46-5263-463e-a8fb-f8181ff8522e';
const prisma = new PrismaClient();

const channel = await prisma.channel.findUnique({
  where: { id: channelId },
  include: { mcrRouter: true },
});
console.log(JSON.stringify(channel, null, 2));
await prisma.$disconnect();
