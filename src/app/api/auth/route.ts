import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import {
  hashPassword,
  verifyPassword,
  generateToken,
  setAuthCookie,
  clearAuthCookie,
  getCurrentUser,
  isSetupComplete,
} from "@/lib/auth";

// POST /api/auth - Login or Setup
export async function POST(request: NextRequest) {
  const body = await request.json();
  const { action, username, password, name } = body;

  if (action === "setup" || action === "register") {
    const setupDone = action === "setup" && (await isSetupComplete());
    if (setupDone || (await prisma.admin.count()) >= 2) {
      return NextResponse.json(
        {
          error: "A regisztráció lezárult: legfeljebb 2 felhasználó engedélyezett.",
          code: "ACCOUNT_LIMIT",
        },
        { status: action === "setup" ? 400 : 409 }
      );
    }

    if (
      typeof username !== "string" ||
      typeof password !== "string" ||
      !/^[\p{L}\p{N}_.-]{3,32}$/u.test(username.trim()) ||
      password.length < 8 ||
      Buffer.byteLength(password, "utf8") > 72
    ) {
      return NextResponse.json(
        {
          error:
            "Adj meg egy 3–32 karakteres felhasználónevet és legalább 8 karakteres jelszót (legfeljebb 72 bájt).",
        },
        { status: 400 }
      );
    }

    if (username.trim() === "balazs") {
      return NextResponse.json(
        {
          error: "Ez a felhasználónév az ideiglenes adminfióké. Válassz másikat.",
          code: "USERNAME_TAKEN",
        },
        { status: 409 }
      );
    }
    const hashed = await hashPassword(password);
    let admin;
    try {
      admin = await prisma.admin.create({
        data: {
          username: username.trim(),
          password: hashed,
          name: typeof name === "string" && name.trim() ? name.trim() : username.trim(),
          role: "admin",
        },
      });
    } catch (error) {
      // The database singleton index also rejects simultaneous registrations.
      if (
        typeof error === "object" &&
        error !== null &&
        "code" in error &&
        error.code === "P2002"
      ) {
        return NextResponse.json(
          (await prisma.admin.count()) >= 2
            ? { error: "A két felhasználói hely már foglalt.", code: "ACCOUNT_LIMIT" }
            : { error: "Ez a felhasználónév már foglalt.", code: "USERNAME_TAKEN" },
          { status: 409 }
        );
      }
      throw error;
    }

    // Ensure default settings exist
    await prisma.settings.upsert({
      where: { id: "default" },
      update: {},
      create: { id: "default" },
    });

    // Ensure channels exist
    for (const type of ["whatsapp", "email", "phone"]) {
      await prisma.channel.upsert({
        where: { type },
        update: {},
        create: { type, isActive: false, status: "disconnected" },
      });
    }

    const token = generateToken(admin.id, admin.role);
    const cookie = setAuthCookie(token);

    const response = NextResponse.json({
      success: true,
      user: { id: admin.id, username: admin.username, name: admin.name },
    });
    response.cookies.set(cookie);
    return response;
  }

  if (action === "login") {
    if (!username || !password) {
      return NextResponse.json({ error: "Username and password are required" }, { status: 400 });
    }

    const admin = await prisma.admin.findUnique({ where: { username } });
    if (!admin) {
      return NextResponse.json({ error: "Invalid credentials" }, { status: 401 });
    }

    const valid = await verifyPassword(password, admin.password);
    if (!valid) {
      return NextResponse.json({ error: "Invalid credentials" }, { status: 401 });
    }

    const token = generateToken(admin.id, admin.role);
    const cookie = setAuthCookie(token);

    const response = NextResponse.json({
      success: true,
      user: { id: admin.id, username: admin.username, name: admin.name },
    });
    response.cookies.set(cookie);
    return response;
  }

  if (action === "logout") {
    const cookie = clearAuthCookie();
    const response = NextResponse.json({ success: true });
    response.cookies.set(cookie);
    return response;
  }

  return NextResponse.json({ error: "Invalid action" }, { status: 400 });
}

// GET /api/auth - Check auth status
export async function GET() {
  const setupDone = await isSetupComplete();
  const registrationOpen = (await prisma.admin.count()) < 2;
  if (!setupDone) {
    return NextResponse.json({ authenticated: false, setupRequired: true, registrationOpen });
  }

  const user = await getCurrentUser();
  if (!user) {
    return NextResponse.json({ authenticated: false, setupRequired: false, registrationOpen });
  }

  return NextResponse.json({
    authenticated: true,
    setupRequired: false,
    registrationOpen,
    user,
  });
}
