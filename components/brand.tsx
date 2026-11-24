import Link from "next/link";
import { Clapperboard } from "lucide-react";

export function Brand({ href = "/", compact = false }: { href?: string; compact?: boolean }) {
  return (
    <Link href={href} className="sidebar-brand" aria-label="Malaba Video AI home">
      <span className="brand-mark">
        <Clapperboard size={compact ? 17 : 19} />
      </span>
      <span className="brand-copy">
        <b>MALABA</b>
        <span>VIDEO AI</span>
      </span>
    </Link>
  );
}
