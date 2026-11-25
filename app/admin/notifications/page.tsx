import { Mail } from "lucide-react";
import { AppShell } from "@/components/app-shell";
import { AdminNotificationForm } from "@/components/admin-notification-form";
import { listCustomers } from "@/lib/server/admin";
import { loadAdminFrame, shellUser } from "@/lib/server/frame";

export const dynamic = "force-dynamic";

export default async function AdminNotificationsPage() {
  const frame = await loadAdminFrame("/admin/notifications", "notifications.read");
  const customers = await listCustomers(frame.db, { limit: 200 });

  return (
    <AppShell
      active="admin-notifications"
      user={shellUser(frame.actor)}
      availableCredits={frame.wallet.available}
      planName={frame.entitlements.plan?.name ?? null}
      variant="admin"
      title="Email notifications"
    >
      <div className="page-head">
        <div>
          <div className="page-eyebrow"><Mail size={12} /> ADMIN · COMMUNICATIONS</div>
          <h1 className="page-title">Email notifications</h1>
          <p className="page-sub">Send an individual email to one customer.</p>
        </div>
      </div>
      <AdminNotificationForm
        customers={customers.map((customer) => ({
          id: customer.id,
          email: customer.email,
          displayName: customer.display_name || customer.email,
        }))}
      />
    </AppShell>
  );
}
