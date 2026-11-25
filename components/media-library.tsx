"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { ArrowDownUp, Download, Film, Image as ImageIcon, Search, SlidersHorizontal } from "lucide-react";
import { relativeTime } from "@/lib/format";

export interface MediaItem {
  id: string;
  fileName: string;
  contentType: string;
  byteSize: number;
  createdAt: number;
  projectId: string;
  projectName: string;
}

function sizeLabel(bytes: number): string {
  if (bytes > 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  return `${Math.max(1, Math.round(bytes / 1024))} KB`;
}

export function MediaLibrary({ items }: { items: MediaItem[] }) {
  const [query, setQuery] = useState("");
  const [kind, setKind] = useState<"all" | "video" | "image">("all");
  const [sort, setSort] = useState<"newest" | "oldest" | "name">("newest");

  const visible = useMemo(() => {
    const needle = query.trim().toLowerCase();
    const filtered = items.filter((item) => {
      const matchesKind =
        kind === "all" ||
        (kind === "video" && item.contentType.startsWith("video/")) ||
        (kind === "image" && item.contentType.startsWith("image/"));
      const matchesQuery =
        !needle ||
        item.fileName.toLowerCase().includes(needle) ||
        item.projectName.toLowerCase().includes(needle);
      return matchesKind && matchesQuery;
    });
    return filtered.sort((a, b) => {
      if (sort === "name") return a.fileName.localeCompare(b.fileName);
      return sort === "newest" ? b.createdAt - a.createdAt : a.createdAt - b.createdAt;
    });
  }, [items, query, kind, sort]);

  return (
    <>
      <div className="library-toolbar card">
        <label className="library-search">
          <Search size={16} />
          <input
            type="search"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Search files or projects"
            aria-label="Search media"
          />
        </label>
        <div className="library-filters">
          <span className="row" style={{ gap: 6 }}><SlidersHorizontal size={14} /> <span>Type</span></span>
          <select className="select" value={kind} onChange={(event) => setKind(event.target.value as typeof kind)} aria-label="Filter by type">
            <option value="all">All files</option>
            <option value="video">Videos</option>
            <option value="image">Images</option>
          </select>
          <span className="row" style={{ gap: 6 }}><ArrowDownUp size={14} /> <span>Sort</span></span>
          <select className="select" value={sort} onChange={(event) => setSort(event.target.value as typeof sort)} aria-label="Sort media">
            <option value="newest">Newest first</option>
            <option value="oldest">Oldest first</option>
            <option value="name">Name A–Z</option>
          </select>
        </div>
      </div>

      {visible.length ? (
        <div className="media-grid">
          {visible.map((item) => {
            const isImage = item.contentType.startsWith("image/");
            return (
              <article className="media-tile" key={item.id}>
                <div className="media-preview">
                  {isImage ? (
                    <img src={`/api/assets/${item.id}`} alt={item.fileName} loading="lazy" decoding="async" />
                  ) : (
                    <video src={`/api/assets/${item.id}#t=0.2`} muted preload="metadata" playsInline />
                  )}
                </div>
                <div className="media-info">
                  <b title={item.fileName}>{item.fileName}</b>
                  <div className="row-between">
                    <span className="row" style={{ gap: 5 }}>
                      {isImage ? <ImageIcon size={11} /> : <Film size={11} />}
                      {sizeLabel(item.byteSize)} · {relativeTime(item.createdAt)}
                    </span>
                    <a
                      href={`/api/assets/${item.id}?download=1`}
                      className="btn btn-ghost btn-sm"
                      aria-label={`Download ${item.fileName}`}
                    >
                      <Download size={13} />
                    </a>
                  </div>
                  <Link href={`/studio/${item.projectId}`} className="tiny" style={{ color: "var(--lime)", display: "block", marginTop: 5 }}>
                    {item.projectName}
                  </Link>
                </div>
              </article>
            );
          })}
        </div>
      ) : (
        <div className="empty">
          <div className="empty-icon"><Film size={22} /></div>
          <strong>{items.length ? "No files match your filters" : "No media yet"}</strong>
          <p>
            {items.length
              ? "Try a different search term or clear the type filter."
              : "Upload footage in a project, or generate your first image or clip in the Studio."}
          </p>
          <Link href="/studio" className="btn btn-primary">Open studio</Link>
        </div>
      )}
    </>
  );
}
