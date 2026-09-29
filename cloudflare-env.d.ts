declare namespace Cloudflare {
  interface Env {
    DB?: D1Database;
    BUCKET?: R2Bucket;
    RUNWAY_API_KEY?: string;
    OPENAI_API_KEY?: string;
  }
}
