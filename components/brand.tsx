import Link from "next/link";

export function Brand({ href = "/", compact = false }: { href?: string; compact?: boolean }) {
  return (
    <Link href={href} className="sidebar-brand" aria-label="Malaba AI Studio home">
      <span className="brand-mark">
        {/* Brand mark is the cropped favicon from the supplied Malaba AI Studio logo image. */}
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
