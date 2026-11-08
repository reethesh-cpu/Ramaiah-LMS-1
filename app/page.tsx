import Link from 'next/link'
import { ArrowRight, ArrowUpRight, ClipboardList, Layers3, ShieldCheck } from 'lucide-react'

const processSteps = [
  { icon: Layers3, title: 'Shape your workbook', detail: 'Choose reusable headers, fields, and categories.' },
  { icon: ClipboardList, title: 'Route work clearly', detail: 'Send leads to the right people and teams.' },
  { icon: ShieldCheck, title: 'Keep every update visible', detail: 'Follow progress through your reporting line.' },
]

export default function HomePage() {
  return (
    <main className="hero-page">
      <header className="hero-nav">
        <Link className="brand-lockup" href="/" aria-label="Northstar CRM home">
          <span className="brand-mark"><Layers3 size={18} /></span>
          <span className="brand-copy"><span className="brand-name">Northstar</span><span className="brand-caption" style={{ color: '#7e8d99' }}>LEAD OPERATIONS</span></span>
        </Link>
        <Link className="secondary-button" href="/sign-in">Sign in <ArrowUpRight /></Link>
      </header>
      <section className="hero-content">
        <div className="hero-copy">
          <div className="kicker">A calmer way to manage lead work</div>
          <h1>Every lead.<br />One clear next step.</h1>
          <p>Build flexible workbooks, assign the right work to your team, and keep every update connected from the first call to the final outcome.</p>
          <div className="hero-actions">
            <Link className="primary-button" href="/sign-in">Open your workspace <ArrowRight /></Link>
            <Link className="quiet-button" href="/setup">Set up head office</Link>
          </div>
        </div>
        <div className="hero-process" aria-label="CRM workflow">
          {processSteps.map(({ icon: Icon, title, detail }, index) => (
            <div className="process-row" key={title}>
              <span className="process-icon"><Icon /></span>
              <div><h3>{title}</h3><p>{detail}</p></div>
              <span style={{ marginLeft: 'auto', color: '#a0adb7', fontSize: 11 }}>0{index + 1}</span>
            </div>
          ))}
        </div>
      </section>
      <footer className="hero-footer">A focused operations workspace for growing teams.</footer>
    </main>
  )
}
