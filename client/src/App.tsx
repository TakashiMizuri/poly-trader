import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom'
import { TradingLiveProvider } from '@/api/tradingLive'
import { AuthGate } from '@/components/AuthGate'
import { Layout } from '@/components/Layout'
import { DashboardPage } from '@/pages/DashboardPage'

export default function App() {
  return (
    <BrowserRouter>
      <AuthGate>
      <Routes>
        <Route
          element={
            <TradingLiveProvider>
              <Layout />
            </TradingLiveProvider>
          }
        >
          <Route index element={<DashboardPage />} />
          <Route path="live" element={<Navigate to="/" replace />} />
          <Route path="history" element={<Navigate to="/" replace />} />
        </Route>
      </Routes>
      </AuthGate>
    </BrowserRouter>
  )
}
