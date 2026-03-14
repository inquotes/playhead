import Link from "next/link";
import { redirect } from "next/navigation";
import { getCurrentUserAccount } from "@/server/auth";

export default async function ProfileLayout({ children }: { children: React.ReactNode }) {
  const user = await getCurrentUserAccount();
  if (!user) {
    redirect("/");
  }

  return (
    <main className="mp-page">
      <section className="mp-panel mp-panel-wide">
        <div className="mp-profile-nav-row">
          <p className="mp-kicker">ACCOUNT</p>
          <nav className="mp-profile-nav" aria-label="Profile sections">
            <Link href="/profile" className="mp-pill mp-pill-link">
              Profile
            </Link>
            <Link href="/profile/discovery-list" className="mp-pill mp-pill-link">
              Discovery List
            </Link>
            <Link href="/profile/past-recommendations" className="mp-pill mp-pill-link">
              Past Recommendations
            </Link>
            <Link href="/" className="mp-pill">
              Back Home
            </Link>
          </nav>
        </div>

        <div className="mp-divider" />
        {children}
      </section>
    </main>
  );
}
