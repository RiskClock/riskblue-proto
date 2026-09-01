import { Suspense, lazy } from "react";
import { Toaster } from "@/components/ui/toaster"; 
import { Toaster as Sonner } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Routes, Route, Navigate } from "react-router-dom";
import { AuthProvider, useAuth } from "./contexts/AuthContext";
import { Loader2 } from "lucide-react";
import { ExportProvider } from "./contexts/ExportContext";
import { ExportProgressPanel } from "./components/export/ExportProgressPanel";
import { PaymentTestModeBanner } from "./components/PaymentTestModeBanner";
import { useVersionCheck } from "./hooks/useVersionCheck";
import { TenantLayout, RootRedirect } from "./components/TenantLayout";

const queryClient = new QueryClient();

const Auth = lazy(() => import("./pages/Auth"));
const Projects = lazy(() => import("./pages/Projects"));
const ProjectWizard = lazy(() => import("./pages/ProjectWizard"));
const SolutionProviderPortal = lazy(() => import("./pages/SolutionProviderPortal"));
const Configuration = lazy(() => import("./pages/Configuration"));
const Logs = lazy(() => import("./pages/Logs"));
const AcceptInvite = lazy(() => import("./pages/AcceptInvite"));
const OAuthCallback = lazy(() => import("./pages/OAuthCallback"));
const GoogleDriveConnect = lazy(() => import("./pages/GoogleDriveConnect"));
const ProcoreConnect = lazy(() => import("./pages/ProcoreConnect"));
const SharePointConnect = lazy(() => import("./pages/SharePointConnect"));
const ResetPassword = lazy(() => import("./pages/ResetPassword"));
const SetupAccount = lazy(() => import("./pages/SetupAccount"));
const InternalWorkbench = lazy(() => import("./pages/InternalWorkbench"));
const WorkbenchProjectDetail = lazy(() => import("./pages/WorkbenchProjectDetail"));
const PromptRefinery = lazy(() => import("./pages/PromptRefinery"));
const PromptRefineryDetail = lazy(() => import("./pages/PromptRefineryDetail"));
const UserManagement = lazy(() => import("./pages/UserManagement"));
const Controls = lazy(() => import("./pages/Controls"));
const InternalViewerTest = lazy(() => import("./pages/InternalViewerTest"));
const InternalActivity = lazy(() => import("./pages/InternalActivity"));
const CheckoutReturn = lazy(() => import("./pages/CheckoutReturn"));
const ThreatReportDownload = lazy(() => import("./pages/ThreatReportDownload"));
const NotFound = lazy(() => import("./pages/NotFound"));
const OAuthConsent = lazy(() => import("./pages/OAuthConsent"));
const CompanyManagement = lazy(() => import("./pages/CompanyManagement"));

const VersionWatcher = () => {
  useVersionCheck();
  return null;
};


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
          <VersionWatcher />
          <ExportProvider>


            <ExportProgressPanel />
            <PaymentTestModeBanner />
            <Suspense fallback={<FullScreenLoader />}>
            <Routes>
            <Route path="/auth" element={<PublicRoute><Auth /></PublicRoute>} />
            <Route path="/projects" element={<ProtectedRoute><Projects /></ProtectedRoute>} />
            <Route path="/project/:id" element={<ProtectedRoute><ProjectWizard /></ProtectedRoute>} />
            
            <Route path="/solution-provider-portal" element={<ProtectedRoute><SolutionProviderPortal /></ProtectedRoute>} />
            <Route path="/configuration" element={<ProtectedRoute><Configuration /></ProtectedRoute>} />
            <Route path="/logs" element={<ProtectedRoute><Logs /></ProtectedRoute>} />
            <Route path="/controls" element={<ProtectedRoute><Controls /></ProtectedRoute>} />
            <Route path="/workbench" element={<ProtectedRoute><InternalWorkbench /></ProtectedRoute>} />
            <Route path="/workbench/project/:projectId" element={<ProtectedRoute><WorkbenchProjectDetail /></ProtectedRoute>} />

            <Route path="/prompt-refinery" element={<ProtectedRoute><PromptRefinery /></ProtectedRoute>} />
            <Route path="/prompt-refinery/:promptId" element={<ProtectedRoute><PromptRefineryDetail /></ProtectedRoute>} />
            <Route path="/internal/users" element={<ProtectedRoute><UserManagement /></ProtectedRoute>} />
            <Route path="/internal/companies" element={<ProtectedRoute><CompanyManagement /></ProtectedRoute>} />
            <Route path="/internal/viewer-test" element={<ProtectedRoute><InternalViewerTest /></ProtectedRoute>} />
            <Route path="/internal/activity" element={<ProtectedRoute><InternalActivity /></ProtectedRoute>} />

            {/* Tenant-scoped routes */}
            <Route path="/t/:tenantId" element={<ProtectedRoute><TenantLayout /></ProtectedRoute>}>
              <Route index element={<Navigate to="projects" replace />} />
              <Route path="projects" element={<Projects />} />
              <Route path="project/:id" element={<ProjectWizard />} />
              <Route path="workbench/project/:projectId" element={<WorkbenchProjectDetail />} />
            </Route>

            <Route path="/accept-invite" element={<AcceptInvite />} />
            <Route path="/accept-company-invite" element={<AcceptCompanyInvite />} />
            <Route path="/oauth/callback" element={<OAuthCallback />} />
            <Route path="/connect/google-drive" element={<GoogleDriveConnect />} />
            <Route path="/connect/procore" element={<ProcoreConnect />} />
            <Route path="/connect/sharepoint" element={<SharePointConnect />} />
            <Route path="/reset-password" element={<ResetPassword />} />
            <Route path="/setup-account" element={<SetupAccount />} />
            <Route path="/credits/return" element={<CheckoutReturn />} />
            <Route path="/projects/:projectId/export/:exportId" element={<ThreatReportDownload />} />
            <Route path="/.lovable/oauth/consent" element={<OAuthConsent />} />
            <Route path="/" element={<ProtectedRoute><RootRedirect /></ProtectedRoute>} />
            <Route path="*" element={<NotFound />} />
            </Routes>
            </Suspense>
          </ExportProvider>
        </AuthProvider>
      </BrowserRouter>
    </TooltipProvider>
  </QueryClientProvider>
);

export default App;
