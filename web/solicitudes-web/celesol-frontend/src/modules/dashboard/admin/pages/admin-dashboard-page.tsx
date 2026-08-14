import { AdminDashboard } from "@/modules/dashboard/admin/components/admin-dashboard";

export function AdminDashboardPage() {
  return (
    <div
      className="h-full overflow-y-auto"
      style={
        {
          background: "#F0F2F5",
          borderTop: "3px solid #E87722",
          "--role-color": "#E87722",
        } as React.CSSProperties
      }
    >
      <AdminDashboard />
    </div>
  );
}
