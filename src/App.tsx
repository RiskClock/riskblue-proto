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
import ResetPassword from "./pages/ResetPassword";
import InternalAnalysisQueue from "./pages/InternalAnalysisQueue";
import AnalysisRequestDetail from "./pages/AnalysisRequestDetail";
import Controls from "./pages/Controls";
import WMSVProject from "./pages/WMSVProject";
import CheckoutReturn from "./pages/CheckoutReturn";
import NotFound from "./pages/NotFound";

const queryClient = new QueryClient();

const ProtectedRoute = ({ children }: { children: React.ReactNode }) => {
  const { user, loading } = useAuth();
  if (loading) return <div className="min-h-screen flex items-center justify-center">Loading...</div>;
  return user ? <>{children}</> : <Navigate to="/auth" />;
};

const PublicRoute = ({ children }: { children: React.ReactNode }) => {
  const { user, loading } = useAuth();
  if (loading) return <div className="min-h-screen flex items-center justify-center">Loading...</div>;
  return user ? <Navigate to="/projects" /> : <>{children}</>;
};

const App = () => (
  <QueryClientProvider client={queryClient}>
    <TooltipProvider>
      <Toaster />
      <Sonner />
      <BrowserRouter>
        <AuthProvider>
          <Routes>
            <Route path="/auth" element={<PublicRoute><Auth /></PublicRoute>} />
            <Route path="/projects" element={<ProtectedRoute><Projects /></ProtectedRoute>} />
            <Route path="/project/:id" element={<ProtectedRoute><ProjectWizard /></ProtectedRoute>} />
            <Route path="/wmsv-project/:id" element={<ProtectedRoute><WMSVProject /></ProtectedRoute>} />
            <Route path="/solution-provider-portal" element={<ProtectedRoute><SolutionProviderPortal /></ProtectedRoute>} />
            <Route path="/configuration" element={<ProtectedRoute><Configuration /></ProtectedRoute>} />
            <Route path="/logs" element={<ProtectedRoute><Logs /></ProtectedRoute>} />
            <Route path="/controls" element={<ProtectedRoute><Controls /></ProtectedRoute>} />
            <Route path="/internal/analysis-queue" element={<ProtectedRoute><InternalAnalysisQueue /></ProtectedRoute>} />
            <Route path="/internal/analysis-queue/:requestId" element={<ProtectedRoute><AnalysisRequestDetail /></ProtectedRoute>} />
            <Route path="/accept-invite" element={<AcceptInvite />} />
            <Route path="/oauth/callback" element={<OAuthCallback />} />
            <Route path="/connect/google-drive" element={<GoogleDriveConnect />} />
            <Route path="/connect/procore" element={<ProcoreConnect />} />
            <Route path="/reset-password" element={<ResetPassword />} />
            <Route path="/credits/return" element={<ProtectedRoute><CheckoutReturn /></ProtectedRoute>} />
            <Route path="/" element={<Navigate to="/projects" />} />
            <Route path="*" element={<NotFound />} />
          </Routes>
        </AuthProvider>
      </BrowserRouter>
    </TooltipProvider>
  </QueryClientProvider>
);

export default App;
