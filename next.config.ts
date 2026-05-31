import withPWAInit from "@ducanh2912/next-pwa";
import type { NextConfig } from "next";

const withPWA = withPWAInit({
  dest: "public",
  // Enable PWA in production; disable in development to avoid caching issues
  disable: process.env.NODE_ENV === "development",
  // Register the service worker automatically
  register: true,
  // Use workbox's GenerateSW strategy (generates sw.js automatically)
  workboxOptions: {
    // Cache the offline page and static assets
    runtimeCaching: [
      {
        // Cache API responses for offline read access
        urlPattern: /^https?.*\/api\/items.*/i,
        handler: "NetworkFirst",
        options: {
          cacheName: "api-items-cache",
          expiration: {
            maxEntries: 200,
            maxAgeSeconds: 60 * 60 * 24, // 24 hours
          },
          networkTimeoutSeconds: 10,
        },
      },
      {
        // Cache location data
        urlPattern: /^https?.*\/api\/locations.*/i,
        handler: "StaleWhileRevalidate",
        options: {
          cacheName: "api-locations-cache",
          expiration: {
            maxEntries: 50,
            maxAgeSeconds: 60 * 60 * 24, // 24 hours
          },
        },
      },
      {
        // Cache static assets (JS, CSS, fonts)
        urlPattern: /\.(?:js|css|woff2?|ttf|eot)$/i,
        handler: "StaleWhileRevalidate",
        options: {
          cacheName: "static-assets-cache",
          expiration: {
            maxEntries: 100,
            maxAgeSeconds: 60 * 60 * 24 * 30, // 30 days
          },
        },
      },
      {
        // Cache images
        urlPattern: /\.(?:png|jpg|jpeg|svg|gif|webp|ico)$/i,
        handler: "CacheFirst",
        options: {
          cacheName: "image-cache",
          expiration: {
            maxEntries: 100,
            maxAgeSeconds: 60 * 60 * 24 * 30, // 30 days
          },
        },
      },
    ],
  },
});

const nextConfig: NextConfig = {
  // Strict mode for better development experience
  reactStrictMode: true,
};

export default withPWA(nextConfig);
