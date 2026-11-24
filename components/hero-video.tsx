"use client";

import { useEffect, useRef, useState } from "react";
import { CreditCard, Gauge, Pause, Play, Sparkles } from "lucide-react";

type Particle = { seed: number; speed: number; size: number; alpha: number };

const PARTICLES: Particle[] = Array.from({ length: 46 }, (_, i) => ({
  seed: (i * 0.6180339887) % 1,
  speed: 0.000018 + ((i * 7) % 11) * 0.000004,
  size: 0.6 + ((i * 13) % 9) * 0.16,
  alpha: 0.18 + ((i * 17) % 13) * 0.035,
}));

const LOOP_MS = 8000;

export function HeroVideo() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const fillRef = useRef<HTMLSpanElement>(null);
  const timeRef = useRef<HTMLSpanElement>(null);
  const startRef = useRef(performance.now());
  const [paused, setPaused] = useState(false);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    let width = 0;
    let height = 0;
    let raf = 0;

    const resize = () => {
      const rect = canvas.parentElement?.getBoundingClientRect();
      if (!rect) return;
      width = rect.width;
      height = rect.height;
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      canvas.width = Math.max(1, Math.floor(width * dpr));
      canvas.height = Math.max(1, Math.floor(height * dpr));
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    };

    const observer = new ResizeObserver(resize);
    observer.observe(canvas.parentElement ?? canvas);
    resize();

    function draw(now: number) {
      if (width < 2 || height < 2) {
        raf = requestAnimationFrame(draw);
        return;
      }

      const t = reduced ? 0 : now - startRef.current;
      const horizon = height * 0.55;
      ctx.clearRect(0, 0, width, height);

      const sky = ctx.createLinearGradient(0, 0, 0, height);
      sky.addColorStop(0, "#07071c");
      sky.addColorStop(0.35, "#241552");
      sky.addColorStop(0.62, "#7b3b5a");
      sky.addColorStop(1, "#0b1029");
      ctx.fillStyle = sky;
      ctx.fillRect(0, 0, width, height);

      const glowX = width * 0.22 + Math.sin(t / 2600) * width * 0.07;
      const glow = ctx.createRadialGradient(glowX, height * 0.16, 0, glowX, height * 0.16, width * 0.62);
      glow.addColorStop(0, "rgba(139,92,246,0.42)");
      glow.addColorStop(0.45, "rgba(34,211,238,0.12)");
      glow.addColorStop(1, "rgba(34,211,238,0)");
      ctx.fillStyle = glow;
      ctx.fillRect(0, 0, width, height);

      const sunX = width * 0.62 + Math.sin(t / 3400) * width * 0.025;
      const sunY = height * 0.36 + Math.cos(t / 4100) * height * 0.012;
      const sunR = Math.min(width, height) * 0.15;
      const halo = ctx.createRadialGradient(sunX, sunY, 0, sunX, sunY, sunR * 3.4);
      halo.addColorStop(0, "rgba(255,214,170,0.78)");
      halo.addColorStop(0.28, "rgba(255,138,110,0.32)");
      halo.addColorStop(1, "rgba(255,138,110,0)");
      ctx.fillStyle = halo;
      ctx.fillRect(0, 0, width, height);

      const sun = ctx.createRadialGradient(sunX - sunR * 0.3, sunY - sunR * 0.3, 0, sunX, sunY, sunR);
      sun.addColorStop(0, "#fff4d6");
      sun.addColorStop(0.55, "#ffc98b");
      sun.addColorStop(1, "rgba(255,150,100,0.35)");
      ctx.beginPath();
      ctx.arc(sunX, sunY, sunR, 0, Math.PI * 2);
      ctx.fillStyle = sun;
      ctx.fill();

      const sea = ctx.createLinearGradient(0, horizon, 0, height);
      sea.addColorStop(0, "rgba(28,26,76,0.72)");
      sea.addColorStop(0.5, "rgba(10,16,46,0.96)");
      sea.addColorStop(1, "#050714");
      ctx.fillStyle = sea;
      ctx.fillRect(0, horizon, width, height - horizon);

      for (let layer = 0; layer < 4; layer += 1) {
        const base = horizon + (height - horizon) * (0.08 + layer * 0.19);
        const amp = height * (0.016 + layer * 0.008);
        const speed = 0.00032 + layer * 0.00011;
        ctx.beginPath();
        ctx.moveTo(0, height);
        for (let x = 0; x <= width + 12; x += 12) {
          const p = x / width;
          const y =
            base +
            Math.sin(p * Math.PI * (2.3 + layer * 0.55) + t * speed + layer) * amp +
            Math.sin(p * Math.PI * 7.5 - t * speed * 0.72) * amp * 0.34;
          ctx.lineTo(x, y);
        }
        ctx.lineTo(width, height);
        ctx.closePath();
        ctx.fillStyle = `rgba(${8 + layer * 4},${12 + layer * 5},${38 + layer * 8},${0.72 - layer * 0.08})`;
        ctx.fill();
      }

      ctx.save();
      ctx.globalCompositeOperation = "screen";
      for (let i = 0; i < 26; i += 1) {
        const k = i / 26;
        const y = horizon + Math.pow(k, 1.35) * (height - horizon) * 0.78;
        const span = (1 - k) * width * 0.24 + 6;
        const jitter = Math.sin(t * 0.0022 + i * 1.7) * span * 0.3;
        ctx.fillStyle = `rgba(255,190,140,${0.3 * (1 - k)})`;
        ctx.fillRect(sunX - span / 2 + jitter, y, span, 1.3);
      }

      for (const particle of PARTICLES) {
        const py = (particle.seed - t * particle.speed + 1) % 1;
        const px = (particle.seed * 7.31 + Math.sin(t / 2400 + particle.seed * 9) * 0.035) % 1;
        ctx.fillStyle = `rgba(200,230,255,${particle.alpha})`;
        ctx.beginPath();
        ctx.arc(((px + 1) % 1) * width, py * height, particle.size, 0, Math.PI * 2);
        ctx.fill();
      }

      const sweepX = ((t / 9000) % 1) * width * 1.5 - width * 0.25;
      const sweep = ctx.createLinearGradient(sweepX - 130, 0, sweepX + 130, 0);
      sweep.addColorStop(0, "rgba(255,255,255,0)");
      sweep.addColorStop(0.5, "rgba(255,255,255,0.07)");
      sweep.addColorStop(1, "rgba(255,255,255,0)");
      ctx.fillStyle = sweep;
      ctx.fillRect(0, 0, width, height);
      ctx.restore();

      const vignette = ctx.createRadialGradient(width / 2, height / 2, height * 0.18, width / 2, height / 2, height * 0.9);
      vignette.addColorStop(0, "rgba(0,0,0,0)");
      vignette.addColorStop(1, "rgba(0,0,0,0.58)");
      ctx.fillStyle = vignette;
      ctx.fillRect(0, 0, width, height);

      const progress = (t % LOOP_MS) / LOOP_MS;
      if (fillRef.current) fillRef.current.style.width = `${progress * 100}%`;
      if (timeRef.current) {
        const seconds = Math.floor((t % LOOP_MS) / 1000)
          .toString()
          .padStart(2, "0");
        timeRef.current.textContent = `00:${seconds} / 00:08`;
      }

      if (!paused && !reduced && !document.hidden) raf = requestAnimationFrame(draw);
    }

    const onVisibility = () => {
      cancelAnimationFrame(raf);
      if (!document.hidden && !paused && !reduced) raf = requestAnimationFrame(draw);
    };
    document.addEventListener("visibilitychange", onVisibility);

    if (paused || reduced) draw(startRef.current);
    else raf = requestAnimationFrame(draw);

    return () => {
      cancelAnimationFrame(raf);
      observer.disconnect();
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, [paused]);

  return (
    <div className="hero-visual">
      <canvas ref={canvasRef} className="hero-video-canvas" aria-hidden="true" />
      <div className="hero-frame" />
      <div className="hero-video-top">
        <span className="hero-live">
          <i /> LIVE PREVIEW
        </span>
        <span className="hero-time" ref={timeRef}>
          00:00 / 00:08
        </span>
      </div>
      <div className="hero-chip one">
        <Sparkles size={14} style={{ color: "var(--lime)" }} /> <b>Gen-4.5</b> - 1080p
      </div>
      <div className="hero-chip two">
        <Gauge size={14} style={{ color: "var(--violet)" }} /> 42s render
      </div>
      <div className="hero-chip three">
        <CreditCard size={14} style={{ color: "var(--lime)" }} /> 124 credits - $1.24
      </div>
      <button
        type="button"
        className="hero-play"
        onClick={() => setPaused((value) => !value)}
        aria-label={paused ? "Play preview" : "Pause preview"}
        title={paused ? "Play preview" : "Pause preview"}
      >
        {paused ? <Play size={26} fill="currentColor" /> : <Pause size={26} fill="currentColor" />}
      </button>
      <div className="hero-caption">
        <span>&ldquo;Golden hour over the reef&rdquo;</span>
        <span className="badge badge-lime">READY</span>
      </div>
      <div className="hero-timeline">
        <span ref={fillRef} />
      </div>
    </div>
  );
}
