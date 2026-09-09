import { Baloo_2, Montserrat } from "next/font/google";
import "./globals.css";

/* The two faces Xovi uses, loaded the way Xovi loads them: variable fonts with
 * no weight array, so the full axis ships, and both variables on <html>. Baloo 2
 * is the default face and Montserrat is opt in through .xv-desc.
 *
 * next/font ships inside the installed next package, so this costs no
 * dependency, but it fetches the font files during `next build`. The checks do
 * not touch it: `npm ci`, `npm run check-types` and `npm test` still need no
 * network. If that build time fetch is ever unwanted, delete these two calls and
 * the two variables fall back to the system stack named in globals.css. */
const display = Baloo_2({ subsets: ["latin"], variable: "--font-display", display: "swap" });
const sans = Montserrat({ subsets: ["latin"], variable: "--font-sans", display: "swap" });

export const metadata = {
  title: "Xovi Agents",
  description: "Agents pay x402 to read CV windows and propose clips; humans confirm; EAS anchors it",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${display.variable} ${sans.variable}`}>
      <body>{children}</body>
    </html>
  );
}
