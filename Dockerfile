# syntax=docker/dockerfile:1
FROM node:22-slim AS builder
WORKDIR /app
ENV PUPPETEER_SKIP_DOWNLOAD=true
# Public build-only placeholder; never inherited by the runner.
ENV JWT_SECRET=build-only-placeholder-never-use-for-runtime
COPY package*.json ./
RUN npm ci
COPY . .
RUN node render-whatsapp-patch.cjs
RUN npx prisma generate
RUN npm run build

FROM node:22-slim AS runner
WORKDIR /app
RUN apt-get update && apt-get install -y --no-install-recommends chromium fonts-liberation && rm -rf /var/lib/apt/lists/*
ENV PUPPETEER_SKIP_DOWNLOAD=true
ENV PUPPETEER_EXECUTABLE_PATH=/usr/bin/chromium
ENV NEXT_TELEMETRY_DISABLED=1
ENV NODE_ENV=production
ENV NODE_OPTIONS=--max-old-space-size=128
ENV OWLY_WHATSAPP_MODE=browser
ENV PORT=3000
RUN addgroup --system --gid 1001 nodejs && adduser --system --uid 1001 nextjs
COPY --from=builder /app/package*.json ./
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/.next ./.next
COPY --from=builder /app/public ./public
COPY --from=builder /app/prisma ./prisma
COPY --from=builder /app/src/generated ./src/generated
COPY --from=builder /app/next.config.ts ./
COPY --from=builder /app/prisma.config.ts ./
RUN cat > /app/bootstrap.ts <<'BOOTSTRAP'
import { PrismaClient } from './src/generated/prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import bcrypt from 'bcryptjs';
const db = new PrismaClient({ adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL }) });
async function main() {
  if (await db.admin.findUnique({ where: { username: 'balazs' } })) return;
  const password = process.env.OWLY_BOOTSTRAP_PASSWORD;
  if (!password || password.length < 32) throw new Error('Bootstrap password is required to restore the administrator');
  const passwordHash = await bcrypt.hash(password, 12);
  await db.$transaction(async (tx) => {
    await tx.admin.create({ data: { username: 'balazs', password: passwordHash, name: 'Balazs', role: 'admin' } });
    await tx.settings.upsert({ where: { id: 'default' }, update: {}, create: { id: 'default' } });
    for (const type of ['whatsapp', 'email', 'phone']) {
      await tx.channel.upsert({ where: { type }, update: {}, create: { type, isActive: false, status: 'disconnected' } });
    }
  }, { timeout: 30000 });
  console.log('Bootstrap administrator preserved; one additional registration allowed');
}
main().catch((error) => { console.error('Administrator initialization failed', { code: error?.code, name: error?.name }); process.exitCode = 1; }).finally(() => db.$disconnect());
BOOTSTRAP
RUN chown -R nextjs:nodejs /app
USER nextjs
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=10s --start-period=30s --retries=3 CMD node -e "fetch('http://localhost:3000/api/health').then(async r => { const b = await r.json(); if (!r.ok || b.services?.database !== 'connected') process.exit(1) }).catch(() => process.exit(1))"
CMD ["sh", "-c", "npx prisma migrate deploy && npx tsx bootstrap.ts && exec npm start -- --hostname 0.0.0.0"]
