import { ChangePasswordForm } from '@/components/crm/change-password-form'

export default function WorkspacePasswordPage() {
  return (
    <div className="page-content-inner">
      <div className="page-heading">
        <div>
          <div className="kicker">Account security</div>
          <h1>Change password</h1>
        </div>
      </div>
      <ChangePasswordForm />
    </div>
  )
}
