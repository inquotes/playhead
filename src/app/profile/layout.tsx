import Link from "next/link";
import { redirect } from "next/navigation";
import { getCurrentUserAccount } from "@/server/auth";
import { AuthenticatedNav } from "@/components/authenticated-nav";

export default async function ProfileLayout({ children }: { children: React.ReactNode }) {
  const user = await getCurrentUserAccount();
  if (!user) {
    redirect("/");
  }

  return (
    <main className="mp-page">
      <section className="mp-panel mp-panel-wide">
        <div className="mp-profile-nav-row">
          <Link href="/" className="mp-profile-brand-link">
            PLAYHEAD
          </Link>
          <AuthenticatedNav />
        </div>

        <div className="mp-divider" />
        {children}
      </section>
    </main>
  );
}
