"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";

const NAV_ITEMS = [
  { href: "/profile/discovery-list", label: "Discovery List" },
  { href: "/profile/past-recommendations", label: "Past Recommendations" },
  { href: "/profile", label: "Profile" },
] as const;

function isActivePath(pathname: string, href: string): boolean {
  if (href === "/") return pathname === "/";
  return pathname === href || pathname.startsWith(`${href}/`);
}

export function AuthenticatedNav() {
  const pathname = usePathname();
  const [open, setOpen] = useState(false);
  const [isMobile, setIsMobile] = useState(false);
  const rootRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const media = window.matchMedia("(max-width: 640px)");
    const update = () => setIsMobile(media.matches);
    update();
    media.addEventListener("change", update);

    function handleClickOutside(event: MouseEvent) {
      if (!rootRef.current) return;
      if (event.target instanceof Node && !rootRef.current.contains(event.target)) {
        setOpen(false);
      }
    }

    function handleEscape(event: KeyboardEvent) {
      if (event.key === "Escape") {
        setOpen(false);
      }
    }

    document.addEventListener("mousedown", handleClickOutside);
    document.addEventListener("keydown", handleEscape);
    return () => {
      media.removeEventListener("change", update);
      document.removeEventListener("mousedown", handleClickOutside);
      document.removeEventListener("keydown", handleEscape);
    };
  }, []);

  return (
    <div className="mp-auth-nav" ref={rootRef}>
      {isMobile ? (
        <div className="mp-auth-nav-mobile">
          <button
            className="mp-auth-nav-trigger"
            onClick={() => setOpen((prev) => !prev)}
            aria-expanded={open}
            aria-controls="mobile-auth-menu"
          >
            Menu
          </button>
          {open && (
            <nav id="mobile-auth-menu" className="mp-auth-nav-menu" aria-label="Primary mobile">
              {NAV_ITEMS.map((item) => (
                <Link
                  key={`mobile-${item.href}`}
                  href={item.href}
                  className={`mp-pill mp-pill-link ${isActivePath(pathname, item.href) ? "is-active" : ""}`}
                  onClick={() => setOpen(false)}
                >
                  {item.label}
                </Link>
              ))}
            </nav>
          )}
        </div>
      ) : (
        <nav className="mp-auth-nav-desktop" aria-label="Primary">
          {NAV_ITEMS.map((item) => (
            <Link
              key={item.href}
              href={item.href}
              className={`mp-pill mp-pill-link ${isActivePath(pathname, item.href) ? "is-active" : ""}`}
            >
              {item.label}
            </Link>
          ))}
        </nav>
      )}
    </div>
  );
}
