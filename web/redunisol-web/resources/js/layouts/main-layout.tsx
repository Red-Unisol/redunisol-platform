// Layouts/MainLayout.jsx

export default function MainLayout({ children }) {
    return (
        <div className="flex min-h-screen flex-col bg-[#F5F5F5] text-[#1A1A1A]">
            <main className="flex-1">{children}</main>
        </div>
    );
}
