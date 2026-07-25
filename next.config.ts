import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // sharp: native addon, can't be bundled.
  // ws: pulled in transitively by @supabase/realtime-js (we never use
  // realtime subscriptions, just Storage/Postgrest) — its permessage-deflate
  // module does a runtime `require("zlib")`/`require("fs")` that the bundler
  // can't resolve, producing the harmless-but-noisy "Couldn't load fs/zlib"
  // console warnings. Marking it external makes Next.js `require()` it
  // natively at runtime instead of trying to bundle it, which silences that.
  serverExternalPackages: ["sharp", "ws"],
};

export default nextConfig;
