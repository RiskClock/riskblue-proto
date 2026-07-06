import { Toaster } from "@/components/ui/toaster"; 
import { Toaster as Sonner } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Routes, Route, Navigate } from "react-router-dom";
import { AuthProvider, useAuth } from "./contexts/AuthContext";
import Auth from "./pages/Auth";
import Projects from "./pages/Projects";
import ProjectWizard from "./pages/ProjectWizard";
import SolutionProviderPortal from "./pages/SolutionProviderPortal";
import Configuration from "./pages/Configuration";
import Logs from "./pages/Logs";
import AcceptInvite from "./pages/AcceptInvite";
import OAuthCallback from "./pages/OAuthCallback";
import GoogleDriveConnect from "./pages/GoogleDriveConnect";
import ProcoreConnect from "./pages/ProcoreConnect";
import SharePointConnect from "./pages/SharePointConnect";
import ResetPassword from "./pages/ResetPassword";
import SetupAccount from "./pages/SetupAccount";
import InternalWorkbench from "./pages/InternalWorkbench";
import WorkbenchProjectDetail from "./pages/WorkbenchProjectDetail";

import UserManagement from "./pages/UserManagement";
import Controls from "./pages/Controls";

import InternalViewerTest from "./pages/InternalViewerTest";
import CheckoutReturn from "./pages/CheckoutReturn";
import ThreatReportDownload from "./pages/ThreatReportDownload";
import NotFound from "./pages/NotFound";
import OAuthConsent from "./pages/OAuthConsent";
import { Loader2 } from "lucide-react";
import { ExportProvider } from "./contexts/ExportContext";
import { ExportProgressPanel } from "./components/export/ExportProgressPanel";
import { PaymentTestModeBanner } from "./components/PaymentTestModeBanner";

const queryClient = new QueryClient();

const FullScreenLoader = () => (
  <div className="min-h-screen flex flex-col items-center justify-center gap-3 bg-background">
    <Loader2 className="h-8 w-8 animate-spin text-primary" />
    <p className="text-sm text-muted-foreground">Loading...</p>
  </div>
);

const ProtectedRoute = ({ children }: { children: React.ReactNode }) => {
  const { user, loading } = useAuth();
  if (loading) return <FullScreenLoader />;
  return user ? <>{children}</> : <Navigate to="/auth" />;
};

const PublicRoute = ({ children }: { children: React.ReactNode }) => {
  const { user, loading } = useAuth();
  if (loading) return <FullScreenLoader />;
  return user ? <Navigate to="/projects" /> : <>{children}</>;
};

const App = () => (
  <QueryClientProvider client={queryClient}>
    <TooltipProvider>
      <Toaster />
      <Sonner />
      <BrowserRouter>
        <AuthProvider>
          <ExportProvider>
            <ExportProgressPanel />
            <PaymentTestModeBanner />
            <Routes>
            <Route path="/auth" element={<PublicRoute><Auth /></PublicRoute>} />
            <Route path="/projects" element={<ProtectedRoute><Projects /></ProtectedRoute>} />
            <Route path="/project/:id" element={<ProtectedRoute><ProjectWizard /></ProtectedRoute>} />
            
            <Route path="/solution-provider-portal" element={<ProtectedRoute><SolutionProviderPortal /></ProtectedRoute>} />
            <Route path="/configuration" element={<ProtectedRoute><Configuration /></ProtectedRoute>} />
            <Route path="/logs" element={<ProtectedRoute><Logs /></ProtectedRoute>} />
            <Route path="/controls" element={<ProtectedRoute><Controls /></ProtectedRoute>} />
            <Route path="/internal/workbench" element={<ProtectedRoute><InternalWorkbench /></ProtectedRoute>} />
            <Route path="/internal/workbench/project/:projectId" element={<ProtectedRoute><WorkbenchProjectDetail /></ProtectedRoute>} />

            <Route path="/internal/users" element={<ProtectedRoute><UserManagement /></ProtectedRoute>} />
            <Route path="/internal/viewer-test" element={<ProtectedRoute><InternalViewerTest /></ProtectedRoute>} />
            <Route path="/accept-invite" element={<AcceptInvite />} />
            <Route path="/oauth/callback" element={<OAuthCallback />} />
            <Route path="/connect/google-drive" element={<GoogleDriveConnect />} />
            <Route path="/connect/procore" element={<ProcoreConnect />} />
            <Route path="/connect/sharepoint" element={<SharePointConnect />} />
            <Route path="/reset-password" element={<ResetPassword />} />
            <Route path="/setup-account" element={<SetupAccount />} />
            <Route path="/credits/return" element={<CheckoutReturn />} />
            <Route path="/projects/:projectId/export/:exportId" element={<ThreatReportDownload />} />
            <Route path="/" element={<Navigate to="/projects" />} />
            <Route path="*" element={<NotFound />} />
            </Routes>
          </ExportProvider>
        </AuthProvider>
      </BrowserRouter>
    </TooltipProvider>
  </QueryClientProvider>
);

export default App;
