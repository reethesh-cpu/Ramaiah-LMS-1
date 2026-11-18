import { LoaderCircle } from 'lucide-react'

// Shown by loading.tsx while a route segment is being prepared. The top
// progress bar from RouteTransitionProvider covers the earlier gap where the
// server layout is still authenticating the request.
export function RouteLoading({ label = 'Loading page' }: { label?: string }) {
  return <div className="route-loading" role="status" aria-live="polite">
    <div className="page-heading">
      <div>
        <div className="kicker">Ramaiah Capital</div>
        <div className="route-skeleton" style={{ width: 240, height: 28 }} />
        <div className="route-skeleton" style={{ width: 360, height: 12, marginTop: 10 }} />
      </div>
    </div>
    <div className="route-loading-body"><LoaderCircle className="animate-spin" size={18} /><span>{label}…</span></div>
    <div className="route-loading-grid">
      {[0, 1, 2, 3].map((index) => (
        <div className="route-loading-card" key={index}>
          <div className="route-skeleton" style={{ width: '55%', height: 12 }} />
          <div className="route-skeleton" style={{ width: '80%', height: 24, marginTop: 18 }} />
          <div className="route-skeleton" style={{ width: '65%', height: 10, marginTop: 14 }} />
        </div>
      ))}
    </div>
  </div>
}
