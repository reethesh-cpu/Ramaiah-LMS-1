import Link from 'next/link'
import type { Metadata } from 'next'
import { ArrowLeft, ArrowUpRight } from 'lucide-react'
import { BrandLockup } from '@/components/brand-lockup'

export const metadata: Metadata = {
  title: 'Privacy Policy',
  description: 'How Ramaiah Capital collects, uses, and protects personal information in the lead operations workspace.',
}

const LAST_UPDATED = '9 November 2026'

export default function PrivacyPage() {
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
          <h1>Privacy Policy</h1>
          <p>This policy explains how Ramaiah Capital collects, uses, stores, and protects personal information in the lead operations workspace.</p>
          <div className="legal-meta">
            <span>Last updated: {LAST_UPDATED}</span>
            <span>Applies to all users and administrators</span>
          </div>
        </div>
        <div className="legal-body">
          <section className="legal-section">
            <h2>1. Who we are</h2>
            <p>The workspace is operated by Ramaiah Capital ("Ramaiah Capital", "we", "us", or "our"). We are the data controller for personal information collected when you use this workspace. For any privacy-related queries, contact your administrator or reach us at <a href="https://ramaiahcapital.com" target="_blank" rel="noreferrer">ramaiahcapital.com</a>.</p>
          </section>
          <section className="legal-section">
            <h2>2. What information we collect</h2>
            <p>We collect information in two ways:</p>
            <p><strong>Information you provide directly:</strong></p>
            <ul>
              <li>Account details — your full name, email address, and role, set up by your administrator.</li>
              <li>Work updates — values you enter in lead records, assignment fields, and workbook columns.</li>
              <li>Gmail connection — if you choose to connect your Gmail account, we store an OAuth refresh token so we can send assignment notification emails on your behalf. We do not store your Gmail password or read your emails.</li>
            </ul>
            <p><strong>Information collected automatically:</strong></p>
            <ul>
              <li>Authentication tokens and session data managed by Supabase.</li>
              <li>Timestamps for assignment creation, updates, and completions.</li>
              <li>Notification delivery status (pending, sent, or failed).</li>
            </ul>
          </section>
          <section className="legal-section">
            <h2>3. How we use your information</h2>
            <p>We use personal information only for the following purposes:</p>
            <ul>
              <li>To authenticate your identity and give you access to the workspace.</li>
              <li>To assign leads and workbooks to the correct team members.</li>
              <li>To send email notifications about lead assignments and updates, where you have enabled this.</li>
              <li>To generate internal reports for administrators.</li>
              <li>To maintain security and prevent unauthorised access.</li>
            </ul>
            <p>We do not use your information for advertising, profiling, or any purpose unrelated to operating the workspace.</p>
          </section>
          <section className="legal-section">
            <h2>4. Gmail and email sending</h2>
            <p>If you connect your Gmail account via the Email settings page, you explicitly authorise the workspace to send notification emails from your Gmail address on your behalf. The specific permissions requested are limited to sending mail (the <code>gmail.send</code> scope). We do not access, read, store, or share your existing emails or contacts.</p>
            <p>You can disconnect your Gmail at any time from the Email settings page. Once disconnected, your refresh token is removed and the workspace will fall back to the administrator's Gmail (if configured) or mark notifications as failed.</p>
          </section>
          <section className="legal-section">
            <h2>5. Lead and customer data</h2>
            <p>Lead records uploaded into the workspace are business data belonging to your organisation. We process this data to operate the workspace on your organisation's behalf. Team members see only the lead records and workbook columns assigned to their role. Administrators can view all data within their organisation's workspace.</p>
            <p>You must not upload personal data about third parties (such as customers) beyond what is necessary for the legitimate business purpose of the workspace, and you are responsible for ensuring that doing so complies with applicable data protection laws.</p>
          </section>
          <section className="legal-section">
            <h2>6. Data storage and security</h2>
            <p>Data is stored in Supabase, a cloud database service, and hosted via Vercel. Both services operate data centres in regions that comply with applicable data protection standards. We apply row-level security (RLS) policies so each user can only access data they are authorised to see.</p>
            <p>We take reasonable technical and organisational measures to protect personal information against unauthorised access, loss, or disclosure. However, no system is completely secure, and you should notify your administrator immediately if you suspect a breach.</p>
          </section>
          <section className="legal-section">
            <h2>7. Data retention</h2>
            <p>We retain your account information and work records for as long as your account is active or as required to operate the workspace. When an administrator deactivates your account, your profile is marked inactive but records are retained for reporting and audit purposes unless a deletion request is made. Gmail refresh tokens are deleted when you disconnect your Gmail or when your account is removed.</p>
          </section>
          <section className="legal-section">
            <h2>8. Sharing of information</h2>
            <p>We do not sell, rent, or trade personal information. We share information only in these limited circumstances:</p>
            <ul>
              <li><strong>Within your organisation:</strong> administrators can see all user profiles, assignments, and reports.</li>
              <li><strong>Service providers:</strong> Supabase (database) and Vercel (hosting) process data on our behalf under their own privacy and security commitments.</li>
              <li><strong>Google:</strong> when you use the Gmail connection, your OAuth tokens are exchanged with Google's API in accordance with Google's Privacy Policy.</li>
              <li><strong>Legal requirements:</strong> we may disclose information if required to do so by law or a valid legal process.</li>
            </ul>
          </section>
          <section className="legal-section">
            <h2>9. Your rights</h2>
            <p>Depending on your location and applicable law, you may have the right to:</p>
            <ul>
              <li>access the personal information we hold about you;</li>
              <li>request correction of inaccurate information;</li>
              <li>request deletion of your personal information, subject to retention obligations;</li>
              <li>withdraw consent for Gmail sending at any time; and</li>
              <li>lodge a complaint with a data protection authority.</li>
            </ul>
            <p>To exercise any of these rights, contact your workspace administrator or reach us at <a href="https://ramaiahcapital.com" target="_blank" rel="noreferrer">ramaiahcapital.com</a>.</p>
          </section>
          <section className="legal-section">
            <h2>10. Cookies and local storage</h2>
            <p>The workspace uses cookies and local storage only for session authentication (managed by Supabase Auth). We do not use tracking cookies, analytics cookies, or advertising cookies.</p>
          </section>
          <section className="legal-section">
            <h2>11. Children's privacy</h2>
            <p>The workspace is intended for use by business professionals. We do not knowingly collect personal information from anyone under 18 years of age. If you believe a minor has been given access, contact your administrator immediately.</p>
          </section>
          <section className="legal-section">
            <h2>12. Changes to this policy</h2>
            <p>We may update this policy from time to time. The "Last updated" date at the top reflects the most recent revision. Continued use of the workspace after a change is posted means you accept the updated policy. For significant changes, we will notify administrators directly.</p>
          </section>
          <section className="legal-section">
            <h2>13. Governing law</h2>
            <p>This policy is governed by the laws of India. Any dispute arising from it is subject to the exclusive jurisdiction of the courts of Bangalore, Karnataka.</p>
          </section>
          <section className="legal-section">
            <h2>14. Contact</h2>
            <p>For privacy questions or requests, contact Ramaiah Capital through <a href="https://ramaiahcapital.com" target="_blank" rel="noreferrer">ramaiahcapital.com</a> or speak to your workspace administrator.</p>
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
          <Link href="/terms">Terms &amp; Conditions</Link>
          <a href="https://ramaiahcapital.com" target="_blank" rel="noreferrer">ramaiahcapital.com <ArrowUpRight aria-hidden="true" /></a>
        </nav>
      </footer>
    </main>
  )
}
