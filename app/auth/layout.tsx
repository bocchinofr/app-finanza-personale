export default function AuthLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-screen flex items-center justify-center bg-surface-50">
      <div className="w-full max-w-sm">
        <div className="text-center mb-8">
          <h1 className="text-2xl font-semibold text-gray-900">Patrimonio Netto</h1>
          <p className="text-sm text-gray-500 mt-1">Dashboard finanziaria</p>
        </div>
        {children}
      </div>
    </div>
  )
}
