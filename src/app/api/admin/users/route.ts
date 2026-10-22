import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { logger } from "@/lib/logger";
import { parsePagination, paginatedResponse } from "@/lib/pagination";
import { requireAuth, isAuthenticated } from "@/lib/route-auth";

export async function GET(request: NextRequest) {
  const auth = await requireAuth(request, "admin:read");
  if (!isAuthenticated(auth)) return auth;

  try {
    const { searchParams } = new URL(request.url);
    const { page, limit, skip, take } = parsePagination(searchParams);

    const [users, total] = await Promise.all([
      prisma.admin.findMany({
        select: {
          id: true,
          username: true,
          name: true,
          role: true,
          createdAt: true,
          updatedAt: true,
        },
        orderBy: { createdAt: "asc" },
        skip,
        take,
      }),
      prisma.admin.count(),
    ]);

    return NextResponse.json(paginatedResponse(users, total, page, limit));
  } catch (error) {
    logger.error("Failed to fetch admin users:", error);
    return NextResponse.json({ error: "Failed to fetch admin users" }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  const auth = await requireAuth(request, "admin:create");
  if (!isAuthenticated(auth)) return auth;
  return NextResponse.json(
    { error: "Legfeljebb 1 felhasználó engedélyezett. Új fiók nem hozható létre." },
    { status: 409 }
  );
}
