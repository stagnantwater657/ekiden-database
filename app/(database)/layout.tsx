import { SiteFooter, SiteHeader } from "../../components/site-shell";
export default function DatabaseLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <>
      <SiteHeader />
      <main className="site-width pb-8">{children}</main>
      <SiteFooter />
    </>
  );
}
