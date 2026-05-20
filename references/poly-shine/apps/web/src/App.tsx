import { BrowserRouter, Route, Routes } from "react-router-dom";
import { AuthGate } from "./components/AuthGate";
import { Layout } from "./components/Layout";
import { ActivityPage } from "./pages/Activity";
import { Dashboard } from "./pages/Dashboard";
import { EnginePage } from "./pages/Engine";
import { DocumentationPage } from "./pages/Documentation";
import { SubscriptionsPage } from "./pages/Subscriptions";
import { WorkshopPage } from "./pages/Workshop";

export default function App() {
  return (
    <BrowserRouter>
      <AuthGate>
        <Routes>
          <Route element={<Layout />}>
            <Route index element={<Dashboard />} />
            <Route path="engine" element={<EnginePage />} />
            <Route path="subscriptions" element={<SubscriptionsPage />} />
            <Route path="activity" element={<ActivityPage />} />
            <Route path="workshop" element={<WorkshopPage />} />
            <Route path="docs" element={<DocumentationPage />} />
          </Route>
        </Routes>
      </AuthGate>
    </BrowserRouter>
  );
}
