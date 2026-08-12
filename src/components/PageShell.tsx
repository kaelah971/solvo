import { Footer } from "@/components/Footer";
import { SiteNav } from "@/components/SiteNav";

type PageShellProps = {
  children: React.ReactNode;
  className?: string;
};

export function PageShell({ children, className = "" }: PageShellProps) {
  return (
    <div className="site-substrate min-h-screen">
      <div className="site-inner flex min-h-screen flex-col">
        <SiteNav />
        <main className={`flex-1 ${className}`}>{children}</main>
        <Footer />
      </div>
    </div>
  );
}
