import Link from 'next/link'
import type { Metadata } from 'next'
import { ArrowLeft, ArrowUpRight } from 'lucide-react'
import { BrandLockup } from '@/components/brand-lockup'

export const metadata: Metadata = {
  title: 'Terms & Conditions',
  description: 'The terms that apply when you use the Ramaiah Capital lead operations workspace.',
}

const LAST_UPDATED = '9 November 2026'

export default function TermsPage() {
  return (
    <main className="legal-page">
      <header className="hero-nav">
        <div className="hero-nav-inner">
          <BrandLockup />
          <Link className="secondary-button" href="/sign-in">Sign in <ArrowUpRight /></Link>
        </div>
      </header>
      <article className="legal-shell">
        <div className="legal-head">
          <div className="kicker">Legal</div>
          <h1>Terms &amp; Conditions</h1>
          <p>These terms govern access to and use of the Ramaiah Capital lead operations workspace.</p>
          <div className="legal-meta">
            <span>Last updated: {LAST_UPDATED}</span>
            <span>Applies to every user and administrator</span>
          </div>
        </div>
        <div className="legal-body">
          <section className="legal-section">
            <h2>1. About these terms</h2>
            <p>The workspace is operated by Ramaiah Capital (“Ramaiah Capital”, “we”, “us”, or “our”) to manage lead records, workbooks, assignments, and related reporting. By creating an account, signing in, or using the workspace, you agree to these terms.</p>
            <p>If you use the workspace on behalf of an organisation, you confirm that you are authorised to accept these terms for that organisation.</p>
          </section>
          <section className="legal-section">
            <h2>2. Accounts and access</h2>
            <p>Accounts are created and managed by your head office administrator. You must:</p>
            <ul>
              <li>provide accurate account information and keep it up to date;</li>
              <li>keep your sign-in credentials confidential and not share your account;</li>
              <li>use the workspace only for the role and responsibilities assigned to you; and</li>
              <li>tell your administrator promptly if you believe your account has been compromised.</li>
            </ul>
            <p>You are responsible for activity that takes place through your account.</p>
          </section>
          <section className="legal-section">
            <h2>3. Acceptable use</h2>
            <p>You agree not to:</p>
            <ul>
              <li>use the workspace for any unlawful, fraudulent, or misleading purpose;</li>
              <li>upload malicious code or attempt to interfere with the security or availability of the service;</li>
              <li>access data you are not authorised to view, or copy, scrape, or export data beyond your assigned permissions;</li>
              <li>share confidential lead or customer information outside the workspace except as required for your role; or</li>
              <li>misrepresent your identity, role, or affiliation.</li>
            </ul>
          </section>
          <section className="legal-section">
            <h2>4. Lead data and confidentiality</h2>
            <p>Lead records, workbook content, assignment notes, and reports entered into the workspace remain the responsibility of the organisation that supplied them. You must treat this information as confidential and use it only for legitimate business purposes connected with your role.</p>
            <p>You must not disclose lead or customer information to any third party except where authorised by your organisation or required by law.</p>
          </section>
          <section className="legal-section">
            <h2>5. Privacy</h2>
            <p>The workspace stores account details and business records needed to operate the service. Personal information is handled in line with applicable data protection law and the internal policies of your organisation. For questions about how your personal information is used, contact your administrator or Ramaiah Capital.</p>
          </section>
          <section className="legal-section">
            <h2>6. Intellectual property</h2>
            <p>The workspace, including its software, design, branding, and documentation, is owned by Ramaiah Capital or its licensors and is protected by applicable intellectual property laws. You receive a limited, non-exclusive, non-transferable right to use the workspace for its intended business purpose. You may not copy, modify, distribute, or reverse engineer any part of it except as permitted by law.</p>
          </section>
          <section className="legal-section">
            <h2>7. Availability and changes</h2>
            <p>We aim to keep the workspace available and reliable, but access may be interrupted for maintenance, security updates, or circumstances beyond our reasonable control. We may add, change, or remove features where it improves the service or is required for legal, security, or operational reasons.</p>
          </section>
          <section className="legal-section">
            <h2>8. Disclaimers</h2>
            <p>The workspace is provided on an “as is” and “as available” basis. To the extent permitted by law, we make no warranty that the service will be uninterrupted, error-free, or fit for a particular purpose. You remain responsible for verifying lead information and for business decisions made using the workspace.</p>
          </section>
          <section className="legal-section">
            <h2>9. Limitation of liability</h2>
            <p>To the extent permitted by law, Ramaiah Capital is not liable for indirect, incidental, special, or consequential losses, or for loss of profits, revenue, data, or business opportunity arising from your use of the workspace. Nothing in these terms limits liability that cannot lawfully be limited.</p>
          </section>
          <section className="legal-section">
            <h2>10. Suspension and termination</h2>
            <p>We may suspend or withdraw access where these terms are breached, where required by law, or to protect the security of the workspace and its users. Your administrator may also remove your access when your role changes or your engagement ends. Obligations relating to confidentiality, intellectual property, and liability continue after access ends.</p>
          </section>
          <section className="legal-section">
            <h2>11. Governing law</h2>
            <p>These terms are governed by the laws of India. Any dispute arising from them is subject to the exclusive jurisdiction of the courts of Bangalore, Karnataka, unless applicable law requires otherwise.</p>
          </section>
          <section className="legal-section">
            <h2>12. Contact</h2>
            <p>For questions about these terms or the workspace, contact Ramaiah Capital through <a href="https://ramaiahcapital.com" target="_blank" rel="noreferrer">ramaiahcapital.com</a>.</p>
          </section>
        </div>
        <div className="legal-back">
          <Link className="primary-button" href="/"><ArrowLeft /> Back to home</Link>
          <a className="secondary-button" href="https://ramaiahcapital.com" target="_blank" rel="noreferrer">ramaiahcapital.com <ArrowUpRight aria-hidden="true" /></a>
        </div>
      </article>
      <footer className="hero-footer">
        <span>© {new Date().getFullYear()} Ramaiah Capital. All rights reserved.</span>
        <nav className="hero-footer-links" aria-label="Footer">
          <Link href="/">Home</Link>
          <Link href="/privacy">Privacy Policy</Link>
          <a href="https://ramaiahcapital.com" target="_blank" rel="noreferrer">ramaiahcapital.com <ArrowUpRight aria-hidden="true" /></a>
        </nav>
      </footer>
    </main>
  )
}
