import Link from "next/link";

export function Brand({ href = "/", compact = false }: { href?: string; compact?: boolean }) {
  return (
    <Link href={href} className="sidebar-brand" aria-label="Malaba AI Studio home">
      <img
        src="/brand/malaba-ai-studio-logo-transparent.png"
        alt="Malaba AI Studio"
        width={compact ? 176 : 210}
        height={compact ? 64 : 77}
        className="brand-logo-img"
      />
      <span className="brand-mark">
        <img
          src="/brand/favicon.png"
          alt=""
          width={compact ? 24 : 28}
          height={compact ? 24 : 28}
          className="brand-mark-img"
        />
      </span>
      <span className="brand-copy">
        <b>MALABA</b>
        <span>AI STUDIO</span>
      </span>
    </Link>
  );
}
