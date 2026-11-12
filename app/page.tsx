import Link from "next/link";
import {
  ArrowRight,
  Check,
  Clapperboard,
  CreditCard,
  Film,
  Gauge,
  Image as ImageIcon,
  Layers,
  Play,
  Scissors,
  ShieldCheck,
  Sparkles,
  Subtitles,
  WandSparkles,
  Zap,
} from "lucide-react";
import { Brand } from "@/components/brand";
import { optionalPageActor } from "@/lib/server/context";
import { dbFromRequestEnv } from "@/lib/server/runtime";
import { listPlans, toPlanView, type PlanView } from "@/lib/server/plans";
import { formatCredits } from "@/lib/format";

export const dynamic = "force-dynamic";

async function loadPlans(): Promise<PlanView[]> {
  try {
    const db = dbFromRequestEnv();
    return (await listPlans(db, { activeOnly: true })).map(toPlanView);
  } catch {
    return [];
  }
}

export default async function LandingPage() {
  const [plans, actor] = await Promise.all([loadPlans(), optionalPageActor().catch(() => null)]);
  const primary = actor ? "/dashboard" : "/register";

  return (
    <div className="landing">
      <header className="landing-nav">
        <Brand href="/" />
        <nav className="landing-nav-links" aria-label="Sections">
          <a href="#features">Features</a>
          <a href="#workflow">Workflow</a>
          <a href="#pricing">Pricing</a>
        </nav>
        <div className="landing-actions">
          {actor ? (
            <Link href="/dashboard" className="btn btn-primary btn-sm">
              Open studio <ArrowRight size={14} />
            </Link>
          ) : (
            <>
              <Link href="/login" className="btn btn-ghost btn-sm">
                Sign in
              </Link>
              <Link href="/register" className="btn btn-primary btn-sm">
                Start creating
              </Link>
            </>
          )}
        </div>
      </header>

      <section className="hero">
        <div className="hero-grid">
          <div>
            <span className="hero-badge">
              <Sparkles size={13} /> MULTI-MODEL AI STUDIO
            </span>
            <h1>
              Cinematic AI video.
              <br />
              <em>Priced for profit.</em>
            </h1>
            <p className="hero-lede">
              Generate video and images with Runway, OpenAI, Gemini, Kling and more — then trim,
              caption and export in the same studio. Credits, subscriptions and margins are managed
              end to end.
            </p>
            <div className="hero-cta">
              <Link href={primary} className="btn btn-primary btn-lg">
                <Clapperboard size={18} /> {actor ? "Open your studio" : "Create your studio"}
              </Link>
              <a href="#pricing" className="btn btn-secondary btn-lg">
                See pricing
              </a>
            </div>
            <div className="hero-proof">
              <div>
                <b>9</b>
                <span>AI providers</span>
              </div>
              <div>
                <b>14+</b>
                <span>production models</span>
              </div>
              <div>
                <b>1</b>
                <span>studio, end to end</span>
              </div>
            </div>
          </div>

          <div className="hero-visual" aria-hidden="true">
            <div className="hero-frame" />
            <div className="hero-chip one">
              <Sparkles size={14} style={{ color: "var(--lime)" }} /> <b>Gen-4.5</b> · 1080p
            </div>
            <div className="hero-chip two">
              <Gauge size={14} style={{ color: "var(--violet)" }} /> 42s render
            </div>
            <div className="hero-chip three">
              <CreditCard size={14} style={{ color: "var(--lime)" }} /> 124 credits · $1.24
            </div>
            <div className="hero-play">
              <Play size={28} fill="currentColor" />
            </div>
            <div className="hero-caption">
              <span>&ldquo;Golden hour over the reef&rdquo;</span>
              <span className="badge badge-lime">READY</span>
            </div>
          </div>
        </div>
      </section>

      <section className="section" id="features">
        <div className="section-head">
          <div className="page-eyebrow">EVERYTHING IN ONE PLACE</div>
          <h2>A studio built for people who ship.</h2>
          <p>
            Stop stitching together five tools. Generate, edit, caption and deliver from one
            workspace — with clear costs before you spend a credit.
          </p>
        </div>
        <div className="feature-grid">
          {[
            {
              icon: Sparkles,
              title: "Multi-provider generation",
              body: "Runway Gen-4.5 and Aleph 2, GPT Image, Gemini, Kling, FLUX and Stability behind one model selector.",
            },
            {
              icon: ImageIcon,
              title: "Images and video together",
              body: "Create stills, animate them into clips, restyle footage, and keep every asset in one media library.",
            },
            {
              icon: CreditCard,
              title: "Credits you can see",
              body: "Every generation shows an exact credit price and remaining balance before you confirm.",
            },
            {
              icon: Scissors,
              title: "Real editing, not a preview",
              body: "Trim, title, caption and render in the browser. Import and export SRT. Keep full control.",
            },
            {
              icon: Subtitles,
              title: "Automatic captions",
              body: "Transcribe audio with Whisper, edit every line, and burn subtitles into the exported video.",
            },
            {
              icon: ShieldCheck,
              title: "Private by default",
              body: "Every project, asset and job is isolated to your account and enforced on the server.",
            },
          ].map((feature) => {
            const Icon = feature.icon;
            return (
              <article className="feature" key={feature.title}>
                <div className="feature-icon">
                  <Icon size={19} />
                </div>
                <h3>{feature.title}</h3>
                <p>{feature.body}</p>
              </article>
            );
          })}
        </div>
      </section>

      <section className="section" id="workflow">
        <div className="section-head">
          <div className="page-eyebrow">FROM BRIEF TO EXPORT</div>
          <h2>Four steps. No context switching.</h2>
        </div>
        <div className="feature-grid">
          {[
            { icon: WandSparkles, title: "1 · Describe", body: "Write a brief. Optional prompt enhancement turns it into production direction." },
            { icon: Layers, title: "2 · Choose a model", body: "Pick provider and model. See duration, resolution and exact credit cost." },
            { icon: Play, title: "3 · Generate", body: "Jobs survive refreshes. Track queued, processing, completed or failed states." },
            { icon: Film, title: "4 · Edit & export", body: "Trim, title, caption and render a finished file saved back to the project." },
          ].map((step) => {
            const Icon = step.icon;
            return (
              <article className="feature" key={step.title}>
                <div className="feature-icon">
                  <Icon size={19} />
                </div>
                <h3>{step.title}</h3>
                <p>{step.body}</p>
              </article>
            );
          })}
        </div>
      </section>

      <section className="section" id="pricing">
        <div className="section-head">
          <div className="page-eyebrow">SIMPLE MONTHLY PLANS</div>
          <h2>Start small. Scale when it works.</h2>
          <p>Every plan includes the editor, captions, exports and a monthly credit balance.</p>
        </div>
        <div className="pricing-grid">
          {(plans.length ? plans : FALLBACK_PLANS).map((plan, index) => (
            <article className={`price-card ${index === 1 || plan.code === "premium" ? "featured" : ""}`} key={plan.code}>
              {plan.code === "premium" ? <span className="ribbon">MOST POPULAR</span> : null}
              <div className="page-eyebrow">{plan.name}</div>
              <div className="price-tag">
                <b>${plan.priceUsd.toFixed(0)}</b>
                <span>/ month</span>
              </div>
              <p className="muted small">{plan.description}</p>
              <ul className="price-list">
                <li>
                  <Check size={14} /> {formatCredits(plan.credits_per_period)} credits every month
                </li>
                <li>
                  <Check size={14} /> {plan.video_limit < 0 ? "Unlimited" : plan.video_limit} video generations
                </li>
                <li>
                  <Check size={14} /> {plan.image_limit < 0 ? "Unlimited" : plan.image_limit} image generations
                </li>
                <li>
                  <Check size={14} /> Up to {plan.max_video_duration_seconds}s clips ·{" "}
                  {plan.resolutions.join(", ") || "HD"}
                </li>
                <li>
                  <Check size={14} /> {plan.max_concurrent_jobs} concurrent job
                  {plan.max_concurrent_jobs === 1 ? "" : "s"}
                </li>
                <li>
                  <Check size={14} /> {(plan.storage_limit_mb / 1024).toFixed(0)} GB media storage
                </li>
              </ul>
              <Link href={actor ? "/billing" : "/register"} className={`btn btn-block ${index === 1 ? "btn-primary" : "btn-secondary"}`}>
                {actor ? "Manage plan" : "Get started"}
              </Link>
            </article>
          ))}
        </div>
        <p className="tiny muted mt-3">
          Credit top-ups are available separately. Prices are billed in KES at checkout at the
          administrator&apos;s configured exchange rate.
        </p>
      </section>

      <section className="section">
        <div className="card card-pad" style={{ display: "flex", gap: 20, alignItems: "center", flexWrap: "wrap", justifyContent: "space-between" }}>
          <div>
            <div className="page-eyebrow">READY WHEN YOU ARE</div>
            <h2 style={{ fontSize: "clamp(24px, 3vw, 34px)" }}>Your next video is one prompt away.</h2>
            <p className="muted small mt-1">Create an account, pick a plan, and generate your first clip.</p>
          </div>
          <Link href={primary} className="btn btn-primary btn-lg">
            <Zap size={17} /> {actor ? "Open studio" : "Start now"}
          </Link>
        </div>
      </section>

      <footer className="landing-footer">
        <span>© {new Date().getFullYear()} Xdigitex. All rights reserved.</span>
        <span>AI video &amp; image studio · Built on Cloudflare</span>
      </footer>
    </div>
  );
}

const FALLBACK_PLANS: PlanView[] = [
  {
    id: "plan_starter",
    code: "starter",
    name: "Starter",
    description: "1,000 credits every month, HD video and image generation.",
    price_cents: 1000,
    currency: "USD",
    interval_months: 1,
    credits_per_period: 1000,
    video_limit: 30,
    image_limit: 150,
    max_video_duration_seconds: 10,
    queue_priority: 5,
    max_concurrent_jobs: 1,
    storage_limit_mb: 2048,
    is_active: 1,
    sort_order: 1,
    version: 1,
    created_at: 0,
    updated_at: 0,
    resolutions: ["720p"],
    premiumFeatures: [],
    priceUsd: 10,
  },
  {
    id: "plan_premium",
    code: "premium",
    name: "Premium",
    description: "2,200 credits, 1080p, priority queue and advanced models.",
    price_cents: 2000,
    currency: "USD",
    interval_months: 1,
    credits_per_period: 2200,
    video_limit: 120,
    image_limit: 800,
    max_video_duration_seconds: 30,
    queue_priority: 8,
    max_concurrent_jobs: 3,
    storage_limit_mb: 10240,
    is_active: 1,
    sort_order: 2,
    version: 1,
    created_at: 0,
    updated_at: 0,
    resolutions: ["720p", "1080p"],
    premiumFeatures: ["1080p", "priority_queue"],
    priceUsd: 20,
  },
];
