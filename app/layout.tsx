import type { Metadata } from "next";
import "./globals.css";
import { customMetadataGenerator } from "@/lib/customMetadataGenerator";
import { Analytics } from "@vercel/analytics/react"
import { GoogleAnalytics } from "@next/third-parties/google"

export const metadata: Metadata = customMetadataGenerator({
    title: "Preview Rive",
});

export default function RootLayout({
    children,
}: Readonly<{
    children: React.ReactNode;
}>) {
    return (
        <html lang="en">
            <body className="antialiased dark">
                {children}
                <Analytics />
            </body>
            <GoogleAnalytics gaId="G-8MNPMG2HHQ" />
        </html>
    );
}
