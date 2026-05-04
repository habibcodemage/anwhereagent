import "./globals.css";

export const metadata = {
  title: "Codebase Investigator",
  description: "Ask questions about a public GitHub repo. Every answer is audited.",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
