// Minimal root layout — backend-only scaffold. Frontend agent (Antigravity) owns pages.
export const metadata = { title: "JanNaadi" };

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
