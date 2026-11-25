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
  Mail,
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
import { LanguageSwitch } from "./language-runtime";
import { T } from "./t";
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
  { href: "/library", label: "Media", icon: Film, key: "library" },
  { href: "/usage", label: "Generation history", icon: Activity, key: "usage" },
  { href: "/billing", label: "Billing", icon: CreditCard, key: "billing" },
  { href: "/settings", label: "Account", icon: Settings, key: "settings" },
];

const ADMIN_NAV: NavItem[] = [
  { href: "/admin", label: "Business overview", icon: Gauge, key: "admin" },
  { href: "/admin/users", label: "Customers", icon: UserCog, key: "admin-users" },
  { href: "/admin/plans", label: "Subscriptions", icon: Layers, key: "admin-plans" },
  { href: "/admin/providers", label: "AI providers", icon: KeyRound, key: "admin-providers" },
  { href: "/admin/models", label: "Models & pricing", icon: Sparkles, key: "admin-models" },
  { href: "/admin/pricing", label: "Margins", icon: BarChart3, key: "admin-pricing" },
  { href: "/admin/payments", label: "Payments", icon: Receipt, key: "admin-payments" },
  { href: "/admin/notifications", label: "Email notifications", icon: Mail, key: "admin-notifications" },
  { href: "/admin/audit", label: "Audit log", icon: ShieldCheck, key: "admin-audit" },
];

const MOBILE_KEYS = ["dashboard", "studio", "library", "billing", "settings"];

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
  const nav = variant === "admin" ? ADMIN_NAV : CUSTOMER_NAV;
  const isAdminShell = variant === "admin";
  const initial = (user.displayName || user.email || "U").slice(0, 1).toUpperCase();

  async function logout() {
    await fetch("/api/auth/logout", { method: "POST" }).catch(() => undefined);
    router.push("/login");
    router.refresh();
  }

  const navContent = (
    <nav className="nav-group" aria-label={variant === "admin" ? "Administration" : "Workspace"}>
      <div className="nav-label">{variant === "admin" ? "ADMINISTRATION" : "WORKSPACE"}</div>
      {nav.map((item) => {
        const Icon = item.icon;
        return (
          <Link
            key={item.key}
            href={item.href}
            className={`nav-link ${active === item.key ? "active" : ""}`}
            aria-current={active === item.key ? "page" : undefined}
            onClick={() => setOpen(false)}
          >
            <Icon size={17} />
            <span><T>{item.label}</T></span>
          </Link>
        );
      })}
      {isAdminShell ? (
        <>
          <div className="nav-label">SWITCH</div>
          <Link href="/dashboard" className="nav-link">
            <Clapperboard size={17} />
            <span><T>Customer studio</T></span>
          </Link>
        </>
      ) : null}
    </nav>
  );

  return (
    <div className={`app-shell${isAdminShell ? " admin-shell" : ""}`}>
      <aside className="sidebar">
        <Brand href={variant === "admin" ? "/admin" : "/dashboard"} />
        {navContent}
        <div className="sidebar-footer">
          <div className="credit-panel">
            <span><T>{isAdminShell ? "PLATFORM ACCOUNT" : "AVAILABLE CREDITS"}</T></span>
            <b>{isAdminShell ? "ADMIN" : formatCredits(availableCredits)}</b>
            {isAdminShell ? (
              <span className="tiny"><T>Customer data is isolated</T></span>
            ) : (
              <Link href="/billing">
                <Wallet size={12} /> {planName ? <><T>{planName}</T> <T>plan</T></> : <T>Choose a plan</T>}
              </Link>
            )}
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
          <span className="topbar-title"><T>{title}</T></span>
          <span className="topbar-spacer" />
          <LanguageSwitch compact />
          {isAdminShell ? (
            <span className="badge badge-violet">
              <ShieldCheck size={12} /> <T>Platform admin</T>
            </span>
          ) : (
            <>
              <Link href="/billing" className="badge badge-lime" aria-label="Available credits">
                <Wallet size={12} /> {formatCredits(availableCredits)} <T>credits</T>
              </Link>
              <Link href="/studio" className="btn btn-primary btn-sm">
                <Sparkles size={14} /> <T>Create</T>
              </Link>
            </>
          )}
        </header>
        <main className="content">{children}</main>
      </div>

      {variant === "customer" ? (
        <nav className="bottom-nav" aria-label="Primary">
          {CUSTOMER_NAV.filter((item) => MOBILE_KEYS.includes(item.key)).map((item) => {
            const Icon = item.icon;
            return (
              <Link
                key={item.key}
                href={item.href}
                className={active === item.key ? "active" : ""}
                aria-current={active === item.key ? "page" : undefined}
              >
                <Icon size={20} />
                <span><T>{item.label}</T></span>
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
              <span><T>AVAILABLE CREDITS</T></span>
              <b>{formatCredits(availableCredits)}</b>
              <Link href="/billing" onClick={() => setOpen(false)}>
                <Wallet size={12} /> {planName ? <><T>{planName}</T> <T>plan</T></> : <T>Choose a plan</T>}
              </Link>
            </div>
            {navContent}
            <div className="drawer-footer">
              <LanguageSwitch />
              <button className="btn btn-secondary btn-block" onClick={logout}>
                <LogOut size={15} /> <T>Sign out</T>
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
