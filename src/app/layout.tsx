import type { Metadata, Viewport } from "next";
import "./globals.css";
import { Toaster } from "@/components/ui/toaster";

export const metadata: Metadata = {
  title: "LiveDub — دوبله زنده با Gemini",
  description:
    "دوبله زنده تب کروم و هر اپلیکیشن اندروید با Gemini Live Translate — نسخه ۲ بدون قطعی ۱۵ دقیقه‌ای",
  keywords: ["LiveDub", "دوبله زنده", "Gemini", "Chrome Extension", "Android"],
  icons: {
    icon: "/livedub-app-icon.png",
  },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  themeColor: "#0b0f0e",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="fa" dir="rtl" suppressHydrationWarning>
      <body className="antialiased bg-[#0b0f0e] text-[#e8efec] [font-family:Vazirmatn,'Segoe_UI',Tahoma,system-ui,sans-serif]">
        {children}
        <Toaster />
      </body>
    </html>
  );
}
