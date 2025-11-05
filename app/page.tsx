"use client";
import { useEffect, useMemo, useRef, useState } from "react";

type Service = { name: string; status: string; note?: string; link?: string };
type Payload = { banner?: string; lastUpdatedISO?: string; services?: Service[] };

const GPT_URL = "https://chatgpt.com/g/g-6891d22835448191affa77266cae32d0-tech-support-helper";
const TICKET_LINKS = [
  { label: "Incident",         url: "https://trainline.atlassian.net/servicedesk/customer/portal/26/group/108/create/364" },
  { label: "Hardware Request", url: "https://trainline.atlassian.net/servicedesk/customer/portal/26/group/108/create/365" },
  { label: "Software Request", url: "https://trainline.atlassian.net/servicedesk/customer/portal/26/group/108/create/368" },
  { label: "Access Request",   url: "https://trainline.atlassian.net/servicedesk/customer/portal/26/group/108/create/371" },
  { label: "Event Request",    url: "https://trainline.atlassian.net/servicedesk/customer/portal/26/group/108/create/366" }
];

const statusClass = (s?: string) =>
  ["ok", "degraded", "outage", "unknown"].includes(String(s || "").toLowerCase())
    ? (String(s || "").toLowerCase() as "ok" | "degraded" | "outage" | "unknown")
    : "unknown";

export default function Page() {
  const [activeTab, setActiveTab] = useState<"#help" | "#status">("#help");
  const [data, setData] = useState<Payload | null>(null);
  const [sourceUrl, setSourceUrl] = useState<string>("/api/status");
  const [filter, setFilter] = useState<"all" | "ok" | "degraded" | "outage" | "unknown">("all");

  // Load status with API then fallback to /services.json
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const r = await fetch(`/api/status?ts=${Date.now()}`, { cache: "no-store" });
        if (!r.ok) throw new Error();
        const j = (await r.json()) as Payload;
        if (!cancelled) {
          setData(j);
          setSourceUrl("/api/status");
        }
      } catch {
        const r2 = await fetch(`/services.json?ts=${Date.now()}`, { cache: "no-store" });
        if (!r2.ok) return;
        const j2 = (await r2.json()) as Payload;
        if (!cancelled) {
          setData(j2);
          setSourceUrl("/services.json");
        }
      }
    })();
    return () => { cancelled = true; };
  }, []);

  // Derived
  const all = useMemo(() => data?.services ?? [], [data]);
  const bad = useMemo(() => all.filter(s => ["degraded", "outage"].includes(statusClass(s.status))), [all]);

  const filtered = useMemo(() => {
    if (filter === "all") return all;
    return all.filter(s => statusClass(s.status) === filter);
  }, [all, filter]);

  // Sources map
  const sources = useMemo(() => {
    const m = new Map<string, string>();
    for (const svc of all) if (svc.link) m.set(svc.name, svc.link);
    return m;
  }, [all]);

  // Sticky + FAB
  useEffect(() => {
    const onScroll = () => {
      const y = window.scrollY || document.documentElement.scrollTop;
      const sticky = document.getElementById("sticky");
      const fab = document.getElementById("fabChat");
      sticky?.classList.toggle("collapsed", y > 100);
      fab?.classList.toggle("show", y > 240);
    };
    window.addEventListener("scroll", onScroll, { passive: true });
    onScroll();
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  // Reveal-on-scroll animations
  const didReveal = useRef(false);
  useEffect(() => {
    if (didReveal.current) return;
    const io = new IntersectionObserver(
      entries => entries.forEach(e => { if (e.isIntersecting) e.target.classList.add("in"); }),
      { threshold: 0.15 }
    );
    document.querySelectorAll(".reveal").forEach(el => io.observe(el));
    didReveal.current = true;
    return () => io.disconnect();
  }, []);

  const openPopup = (url: string) => {
    const w = Math.min(1100, window.screen.width - 80);
    const h = Math.min(800, window.screen.height - 120);
    const left = window.screenX + (window.outerWidth - w) / 2;
    const top = window.screenY + (window.outerHeight - h) / 2;
    const win = window.open(url, "_blank", `popup=yes,width=${w},height=${h},left=${left},top=${top}`);
    if (!win) window.open(url, "_blank", "noopener,noreferrer");
  };

  const lastUpdated = data?.lastUpdatedISO
    ? new Date(data.lastUpdatedISO).toLocaleString()
    : "—";

  // Sticky contents derived from status
const hasIncidents = bad.length > 0;

const stickyText = hasIncidents
  ? `${bad.length} vendor issue${bad.length > 1 ? "s" : ""} detected`
  : "All systems normal";

  return (
    <>
      {/* Header */}
      <header>
        <div className="wrap">
          <div className="brand">
            <img src="/logo.png" alt="Trainline logo" />
            <h1>TECHSUP</h1>
          </div>
          <div className="sub" id="updated">Last updated: {lastUpdated}</div>

          <nav className="tabs" id="tabs">
            <button
              className={`tab ${activeTab === "#help" ? "active" : ""}`}
              onClick={() => setActiveTab("#help")}
            >
              Get Help
            </button>
            <button
              className={`tab ${activeTab === "#status" ? "active" : ""}`}
              onClick={() => setActiveTab("#status")}
            >
              Services Status
            </button>
          </nav>
        </div>
      </header>

      {/* Sticky ribbon */}
<div id="sticky" className="sticky" role="status" aria-live="polite">
  <span id="stickyText">{stickyText}</span>

  {hasIncidents ? (
    // Go to Services Status panel and scroll into view
    <a
      id="stickyBtn"
      href="#status"
      className="stickyBtn"
      onClick={(e) => {
        e.preventDefault();
        setActiveTab("#status");
        document.getElementById("status")?.scrollIntoView({ behavior: "smooth", block: "start" });
      }}
    >
      View impacted
    </a>
  ) : (
    // Open chatbot in a centered popup (same as step 2)
    <a
      id="stickyBtn"
      href={GPT_URL}
      target="_blank"
      rel="noreferrer noopener"
      className="stickyBtn"
      onClick={(e) => { e.preventDefault(); openPopup(GPT_URL); }}
    >
      Open TECHSUP Chat
    </a>
  )}
</div>


      {/* STATUS PANEL */}
      <section className={`panel ${activeTab === "#status" ? "" : "hidden"}`} id="status">
        <div className="wrap">
          <div className="banner" id="banner" aria-live="polite">
            {data?.banner || ""}
          </div>

          <div className="controls" id="filters">
            {(["all","outage","degraded","ok","unknown"] as const).map(f => (
              <button
                key={f}
                className={`chip ${filter === f ? "active" : ""}`}
                data-filter={f}
                onClick={() => setFilter(f)}
              >
                {f === "all" ? "All" :
                 f === "outage" ? "Outage" :
                 f === "degraded" ? "Degraded" :
                 f === "ok" ? "Operational" : "Unknown"}
              </button>
            ))}
            <a className="chip" href={sourceUrl} target="_blank" rel="noreferrer noopener">Raw JSON</a>
          </div>

          <section className="grid" id="cards">
            {filtered.map((svc, i) => {
              const cls = statusClass(svc.status);
              const host = (() => { try { return svc.link ? new URL(svc.link).host : ""; } catch { return ""; } })();
              return (
                <article className={`card item ${cls}`} data-status={cls} key={i}>
                  <div className={`dot ${cls}`} title={cls}></div>
                  <div>
                    <div className="name">
                      {svc.link
                        ? <a href={svc.link} target="_blank" rel="noreferrer noopener">{svc.name}</a>
                        : svc.name}
                    </div>
                    <div className="note">{svc.note || ""}</div>
                    {svc.link
                      ? <div className="src">Source: <a href={svc.link} target="_blank" rel="noreferrer noopener">{host}</a></div>
                      : null}
                  </div>
                </article>
              );
            })}
          </section>

          <details className={`sources ${sources.size ? "" : "hidden"}`} id="sourcesBox">
            <summary>Sources used for this status</summary>
            <ul id="sourcesList">
              {Array.from(sources.entries()).map(([name, url]) => (
                <li key={name}><a href={url} target="_blank" rel="noreferrer noopener">{name}</a></li>
              ))}
            </ul>
          </details>
        </div>
      </section>

      {/* HELP PANEL */}
      <section className={`panel ${activeTab === "#help" ? "" : "hidden"}`} id="help">
        <div className="wrap">
          <h2>Get help, step by step</h2>

          <div className="notice reveal" id="statusAdvisory" aria-live="polite">
            {bad.length
              ? (
                <>
                  <strong>{bad.length} vendor issue{bad.length>1?"s":""} detected:</strong>{" "}
                  {bad.map(s => s.name).join(", ")}. If your problem relates to these, no ticket is needed. Follow the vendor pages for ETA.
                </>
                )
              : "All monitored vendors are green. If you're still blocked, open TECHSUP Chat, then create a ticket if needed."
            }
          </div>

          <div id="impactedWrap" className={`reveal ${bad.length ? "" : "hidden"}`} aria-label="Currently impacted services">
            <h3 style={{margin:"0 0 8px",fontSize:14}}>Currently impacted</h3>
            <section className="grid" id="impactedCards">
              {bad.map((svc, i) => {
                const cls = statusClass(svc.status);
                const host = (() => { try { return svc.link ? new URL(svc.link).host : ""; } catch { return ""; } })();
                return (
                  <article className={`card ${cls}`} key={`bad-${i}`}>
                    <div className={`dot ${cls}`} title={cls}></div>
                    <div>
                      <div className="name">
                        {svc.link
                          ? <a href={svc.link} target="_blank" rel="noreferrer noopener">{svc.name}</a>
                          : svc.name}
                      </div>
                      <div className="note">{svc.note || ""}</div>
{svc.link ? (
  <div className="src">Source: <a href={svc.link} target="_blank" rel="noreferrer noopener">
    {new URL(svc.link).host}
  </a></div>
) : null}
                    </div>
                  </article>
                );
              })}
            </section>
          </div>

          <div className="steps">
            <div className="step reveal">
              <h3>1) Check status first</h3>
              <p>If any tool shows Outage or Degraded, it’s likely the cause. No ticket needed. Follow the vendor link for updates.</p>
            </div>
            <div className="step reveal">
              <h3>2) Ask TECHSUP Chat</h3>
              <p>Click the button to open the TECHSUP helper in a new tab. If it doesn’t solve it, come back and raise a ticket.</p>
<p className="ctaRow">
  <a className="btnBrand" id="openGpt" href="#" onClick={(e)=>{e.preventDefault(); openPopup(GPT_URL);}}>
    Open TECHSUP Chat
  </a>
</p>            
</div>
            <div className="step reveal">
              <h3>3) Raise a ticket</h3>
              <p>Pick the right request type so it lands with the right team.</p>
              <div className="ctaGrid" id="ticketGrid">
                {TICKET_LINKS.map((t, i) => (
                  <button
                    key={t.label}
                    className="btnBrand reveal"
                    style={{ transitionDelay: `${Math.min(i * 0.06, 0.4)}s` }}
                    onClick={() => openPopup(t.url)}
                  >
                    {t.label}
                  </button>
                ))}
              </div>
            </div>
            <div className="step reveal">
              <h3>4) Slack fallback</h3>
              <p>Emergencies only: <a href="https://slack.com/app_redirect?channel=help-tech-support" target="_blank" rel="noreferrer noopener">#help-tech-support</a>.</p>
            </div>
          </div>
        </div>
      </section>

      {/* Footer */}
      <footer>
        <div className="wrap">
          <div>Built by Elfo the IT Elfineer</div>
          <div><a href={sourceUrl} target="_blank" rel="noreferrer noopener">Status API</a></div>
        </div>
      </footer>

      {/* Floating Chat Button */}
      <button
        id="fabChat"
        className="fab"
        aria-label="Open TECHSUP Chat"
        onClick={() => openPopup(GPT_URL)}
      >
        Chat
      </button>
    </>
  );
}
