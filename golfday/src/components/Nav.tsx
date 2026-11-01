import Link from "next/link";
import type { SessionUser } from "@/lib/auth";
import { LogoutButton } from "./LogoutButton";
import { FlagMark } from "./Icons";

export function Nav({ user }: { user: SessionUser | null }) {
  return (
    <header className="no-print sticky top-0 z-30 border-b border-ink/[0.06] bg-[#fbfaf5]/90 backdrop-blur">
      <div className="mx-auto flex h-16 w-full max-w-6xl items-center gap-3 px-4 sm:px-6">
        <Link href="/" className="flex items-center gap-2.5">
          <FlagMark className="h-8 w-8" />
          <span className="text-[17px] font-bold tracking-tight">GolfDay</span>
        </Link>
        <nav className="ml-4 hidden items-center gap-1 text-sm font-medium text-ink/65 sm:flex">
          <Link className="rounded-lg px-3 py-2 hover:bg-ink/[0.04]" href="/events">Events</Link>
          {user && <Link className="rounded-lg px-3 py-2 hover:bg-ink/[0.04]" href="/dashboard">My golf</Link>}
          {user && <Link className="rounded-lg px-3 py-2 hover:bg-ink/[0.04]" href="/societies">Societies</Link>}
          {user && <Link className="rounded-lg px-3 py-2 hover:bg-ink/[0.04]" href="/admin">Organiser</Link>}
        </nav>
        <div className="ml-auto flex items-center gap-2">
          {user ? (
            <>
              <Link href="/dashboard" className="hidden text-right sm:block">
                <div className="text-[13px] font-semibold leading-tight">{user.name}</div>
                <div className="text-[11px] leading-tight text-ink/45">{user.isSiteAdmin ? "Site admin" : "Player"}</div>
              </Link>
              <div className="grid h-9 w-9 place-items-center rounded-full bg-fairway-300 text-[13px] font-bold text-fairway-950 ring-1 ring-inset ring-fairway-400/60">
                {user.name.split(" ").map((p) => p[0]).slice(0, 2).join("")}
              </div>
              <LogoutButton />
            </>
          ) : (
            <>
              <Link href="/login" className="btn-ghost btn-sm">Sign in</Link>
              <Link href="/register" className="btn-primary btn-sm">Create account</Link>
            </>
          )}
        </div>
      </div>
    </header>
  );
}
