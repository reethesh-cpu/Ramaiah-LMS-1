import Link from 'next/link'
import { ArrowRight, ArrowUpRight, ClipboardList, Layers3, ShieldCheck } from 'lucide-react'
import { BrandLockup } from '@/components/brand-lockup'

const processSteps = [
  { icon: Layers3, title: 'Shape your workbook', detail: 'Choose reusable headers, fields, and categories.' },
  { icon: ClipboardList, title: 'Route work clearly', detail: 'Send leads to the right people and teams.' },
  { icon: ShieldCheck, title: 'Keep every update visible', detail: 'Follow progress through your reporting line.' },
]

export default function HomePage() {
  return (
    <main className="hero-page">
      <header className="hero-nav">
        <div className="hero-nav-inner">
          <BrandLockup />
          <div className="hero-nav-actions">
            <a className="hero-site-link" href="https://ramaiahcapital.com" target="_blank" rel="noreferrer">ramaiahcapital.com <ArrowUpRight aria-hidden="true" /></a>
            <Link className="secondary-button" href="/sign-in">Sign in <ArrowUpRight /></Link>
          </div>
        </div>
      </header>
      <section className="hero-content">
        <div className="hero-copy">
          <div className="kicker">Your team, in sync</div>
          <h1>Every lead.<br />One clear next step.</h1>
          <p>Build flexible workbooks, assign the right work to your team, and keep every update connected from the first call to the final outcome.</p>
          <div className="hero-step-list" aria-label="How the workspace works">
            {processSteps.map(({ icon: Icon, title, detail }) => (
              <div className="hero-step" key={title}>
                <span className="hero-step-icon"><Icon aria-hidden="true" /></span>
                <div><h3>{title}</h3><p>{detail}</p></div>
              </div>
            ))}
          </div>
          <div className="hero-actions">
            <Link className="primary-button" href="/sign-in">Open your workspace <ArrowRight /></Link>
            <Link className="quiet-button" href="/setup">Set up head office</Link>
          </div>
          <div className="hero-note">Private workspace · Role-based access · Supabase protected</div>
        </div>
        <div className="hero-rings" aria-hidden="true" />
      </section>
      <footer className="hero-footer">
        <span>A focused operations workspace for growing teams.</span>
        <nav className="hero-footer-links" aria-label="Footer">
          <Link href="/terms">Terms &amp; Conditions</Link>
          <a href="https://ramaiahcapital.com" target="_blank" rel="noreferrer">ramaiahcapital.com <ArrowUpRight aria-hidden="true" /></a>
        </nav>
      </footer>
    </main>
  )
}
