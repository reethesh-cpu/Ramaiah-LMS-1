import Image from 'next/image'
import Link from 'next/link'

type BrandLockupProps = {
  href?: string
  className?: string
  label?: string
}

/**
 * Shared Ramaiah Capital logo lockup.
 *
 * Uses the wide lockup (emblem + wordmark) wherever there is room, and falls
 * back to the square emblem when the sidebar collapses to its icon rail.
 */
export function BrandLockup({ href = '/', className, label = 'Ramaiah Capital home' }: BrandLockupProps) {
  return (
    <Link className={className ? `brand-lockup ${className}` : 'brand-lockup'} href={href} aria-label={label}>
      <span className="brand-plate">
        <Image
          className="brand-logo brand-logo-wide"
          src="/logo-trimmed.png"
          alt=""
          width={686}
          height={413}
          loading="eager"
        />
        <Image
          className="brand-logo brand-logo-square"
          src="/logo-icon.png"
          alt=""
          width={512}
          height={512}
          loading="eager"
          aria-hidden="true"
        />
      </span>
    </Link>
  )
}
