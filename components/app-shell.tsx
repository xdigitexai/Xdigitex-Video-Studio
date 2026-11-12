"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import {
  Activity,
  BarChart3,
  Clapperboard,
  CreditCard,
  Film,
  FolderOpen,
  Gauge,
  KeyRound,
  Layers,
  LayoutDashboard,
  LogOut,
  Menu,
  Receipt,
  Settings,
  ShieldCheck,
  Sparkles,
  UserCog,
  Wallet,
  X,
} from "lucide-react";
import { Brand } from "./brand";
import { formatCredits } from "@/lib/format";

interface NavItem {
  href: string;
  label: string;
  icon: typeof LayoutDashboard;
  key: string;
}

const CUSTOMER_NAV: NavItem[] = [
  { href: "/dashboard", label: "Dashboard", icon: LayoutDashboard, key: "dashboard" },
  { href: "/studio", label: "Studio", icon: Clapperboard, key: "studio" },
  { href: "/projects", label: "Projects", icon: FolderOpen, key: "projects" },
  { href: "/library", label: "Media library", icon: Film, key: "library" },
  { href: "/usage", label: "Generation history", icon: Activity, key: "usage" },
  { href: "/billing", label: "Billing & credits", icon: CreditCard, key: "billing" },
  { href: "/settings", label: "Account settings", icon: Settings, key: "settings" },
];

const ADMIN_NAV: NavItem[] = [
  { href: "/admin", label: "Business overview", icon: Gauge, key: "admin" },
  { href: "/admin/users", label: "Customers", icon: UserCog, key: "admin-users" },
  { href: "/admin/plans", label: "Subscriptions", icon: Layers, key: "admin-plans" },
  { href: "/admin/providers", label: "AI providers", icon: KeyRound, key: "admin-providers" },
  { href: "/admin/models", label: "Models & pricing", icon: Sparkles, key: "admin-models" },
  { href: "/admin/pricing", label: "Margins", icon: BarChart3, key: "admin-pricing" },
  { href: "/admin/payments", label: "Payments", icon: Receipt, key: "admin-payments" },
  { href: "/admin/audit", label: "Audit log", icon: ShieldCheck, key: "admin-audit" },
];

export interface ShellUser {
  id: string;
  displayName: string;
  email: string;
  role: string;
}

export function AppShell({
  active,
  user,
  availableCredits,
  planName,
  variant = "customer",
  title,
  children,
}: {
  active: string;
  user: ShellUser;
  availableCredits: number;
  planName: string | null;
  variant?: "customer" | "admin";
  title: string;
  children: React.ReactNode;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const isAdmin = user.role === "admin" || user.role === "super_admin";
  const nav = variant === "admin" ? ADMIN_NAV : CUSTOMER_NAV;
  const initial = (user.displayName || user.email || "U").slice(0, 1).toUpperCase();

  async function logout() {
    await fetch("/api/auth/logout", { method: "POST" }).catch(() => undefined);
    router.push("/login");
    router.refresh();
  }

  const navContent = (
    <>
      <div className="nav-group">
        <div className="nav-label">{variant === "admin" ? "ADMINISTRATION" : "WORKSPACE"}</div>
        {nav.map((item) => {
          const Icon = item.icon;
          return (
            <Link
              key={item.key}
              href={item.href}
              className={`nav-link ${active === item.key ? "active" : ""}`}
              onClick={() => setOpen(false)}
            >
              <Icon size={17} />
              <span>{item.label}</span>
            </Link>
          );
        })}
      </div>
      <div className="nav-group">
        <div className="nav-label">SWITCH</div>
        {variant === "admin" ? (
          <Link href="/dashboard" className="nav-link">
            <Clapperboard size={17} />
            <span>Customer studio</span>
          </Link>
        ) : isAdmin ? (
          <Link href="/admin" className="nav-link">
            <ShieldCheck size={17} />
            <span>Admin console</span>
          </Link>
        ) : null}
      </div>
    </>
  );

  return (
    <div className="app-shell">
      <aside className="sidebar">
        <Brand href={variant === "admin" ? "/admin" : "/dashboard"} />
        {navContent}
        <div className="sidebar-footer">
          <div className="credit-panel">
            <span>AVAILABLE CREDITS</span>
            <b>{formatCredits(availableCredits)}</b>
            <Link href="/billing">
              <Wallet size={12} /> {planName ? `${planName} plan` : "Choose a plan"}
            </Link>
          </div>
          <div className="user-chip">
            <span className="avatar">{initial}</span>
            <span className="user-chip-copy">
              <b>{user.displayName}</b>
              <span>{user.email}</span>
            </span>
            <button className="btn btn-ghost btn-icon" aria-label="Sign out" onClick={logout}>
              <LogOut size={16} />
            </button>
          </div>
        </div>
      </aside>

      <div className="main-area">
        <header className="topbar">
          <button className="btn btn-ghost btn-icon mobile-menu-btn" aria-label="Open menu" onClick={() => setOpen(true)}>
            <Menu size={19} />
          </button>
          <span className="topbar-title">{title}</span>
          <span className="topbar-spacer" />
          <Link href="/billing" className="badge badge-lime" aria-label="Available credits">
            <Wallet size={12} /> {formatCredits(availableCredits)} credits
          </Link>
          <Link href="/studio" className="btn btn-primary btn-sm">
            <Sparkles size={14} /> Create
          </Link>
        </header>
        <main className="content">{children}</main>
      </div>

      {variant === "customer" ? (
        <nav className="bottom-nav" aria-label="Primary">
          {[CUSTOMER_NAV[0], CUSTOMER_NAV[1], CUSTOMER_NAV[3], CUSTOMER_NAV[5], CUSTOMER_NAV[6]].map((item) => {
            const Icon = item.icon;
            return (
              <Link key={item.key} href={item.href} className={active === item.key ? "active" : ""}>
                <Icon size={20} />
                <span>{item.label.split(" ")[0]}</span>
              </Link>
            );
          })}
        </nav>
      ) : null}

      {open ? (
        <div className="mobile-drawer" role="dialog" aria-modal="true" aria-label="Navigation">
          <div className="mobile-drawer-backdrop" onClick={() => setOpen(false)} />
          <div className="mobile-drawer-panel">
            <div className="row-between">
              <Brand href={variant === "admin" ? "/admin" : "/dashboard"} />
              <button className="btn btn-ghost btn-icon" aria-label="Close menu" onClick={() => setOpen(false)}>
                <X size={18} />
              </button>
            </div>
            <div className="credit-panel" style={{ marginTop: 12 }}>
              <span>AVAILABLE CREDITS</span>
              <b>{formatCredits(availableCredits)}</b>
              <Link href="/billing" onClick={() => setOpen(false)}>
                <Wallet size={12} /> {planName ? `${planName} plan` : "Choose a plan"}
              </Link>
            </div>
            {navContent}
            <div style={{ marginTop: "auto", paddingTop: 16 }}>
              <button className="btn btn-secondary btn-block" onClick={logout}>
                <LogOut size={15} /> Sign out
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
