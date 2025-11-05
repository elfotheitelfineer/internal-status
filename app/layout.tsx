import "./globals.css";

export const metadata = {
  title: "TECHSUP • Vendor Status",
  description: "Status board with vendor incidents and quick filters"
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="fr">
      <head>
        <link rel="icon" href="/logo.svg" />
      </head>
      <body>{children}</body>
    </html>
  );
}
