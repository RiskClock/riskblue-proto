import { Suspense } from "react";
import { Toaster } from "@/components/ui/toaster"; 
import { Toaster as Sonner } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Routes, Route, Navigate } from "react-router-dom";
import { AuthProvider, useAuth } from "./contexts/AuthContext";
import { Loader2 } from "lucide-react";
import { ExportProvider } from "./contexts/ExportContext";
import { ExportProgressPanel } from "./components/export/ExportProgressPanel";
import { useVersionCheck } from "./hooks/useVersionCheck";
import { TenantLayout, RootRedirect } from "./components/TenantLayout";
import { routeLoaders } from "./lib/routePreload";
import { lazyWithRetry } from "./lib/lazyWithRetry";

const queryClient = new QueryClient();

const Auth = lazyWithRetry(() => import("./pages/Auth"));
const Projects = lazyWithRetry(routeLoaders.projects);
const ProjectWizard = lazyWithRetry(() => import("./pages/ProjectWizard"));
const SolutionProviderPortal = lazyWithRetry(() => import("./pages/SolutionProviderPortal"));
const Configuration = lazyWithRetry(routeLoaders.configuration);
const Logs = lazyWithRetry(routeLoaders.logs);
const AcceptInvite = lazyWithRetry(() => import("./pages/AcceptInvite"));
const AcceptCompanyInvite = lazyWithRetry(() => import("./pages/AcceptCompanyInvite"));
const OAuthCallback = lazyWithRetry(() => import("./pages/OAuthCallback"));
const GoogleDriveConnect = lazyWithRetry(() => import("./pages/GoogleDriveConnect"));
const ProcoreConnect = lazyWithRetry(() => import("./pages/ProcoreConnect"));
const SharePointConnect = lazyWithRetry(() => import("./pages/SharePointConnect"));
const ResetPassword = lazyWithRetry(() => import("./pages/ResetPassword"));
const SetupAccount = lazyWithRetry(() => import("./pages/SetupAccount"));
const InternalWorkbench = lazyWithRetry(routeLoaders.workbench);
const WorkbenchProjectDetail = lazyWithRetry(() => import("./pages/WorkbenchProjectDetail"));
const WaterMitigationPlan = lazyWithRetry(() => import("./pages/WaterMitigationPlan"));
const ProposalEditor = lazyWithRetry(() => import("./pages/ProposalEditor"));
const PromptRefinery = lazyWithRetry(routeLoaders.promptRefinery);
const PromptRefineryDetail = lazyWithRetry(() => import("./pages/PromptRefineryDetail"));
const UserManagement = lazyWithRetry(routeLoaders.userManagement);
const Controls = lazyWithRetry(() => import("./pages/Controls"));
const InternalViewerTest = lazyWithRetry(() => import("./pages/InternalViewerTest"));
const InternalActivity = lazyWithRetry(() => import("./pages/InternalActivity"));
const CheckoutReturn = lazyWithRetry(() => import("./pages/CheckoutReturn"));
const ThreatReportDownload = lazyWithRetry(() => import("./pages/ThreatReportDownload"));
const NotFound = lazyWithRetry(() => import("./pages/NotFound"));
const OAuthConsent = lazyWithRetry(() => import("./pages/OAuthConsent"));
const CompanyManagement = lazyWithRetry(routeLoaders.companyManagement);

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
            <Suspense fallback={<FullScreenLoader />}>
            <Routes>
            <Route path="/auth" element={<PublicRoute><Auth /></PublicRoute>} />
            <Route path="/projects" element={<ProtectedRoute><RootRedirect fallback={<Projects />} /></ProtectedRoute>} />
            <Route path="/project/:id" element={<ProtectedRoute><ProjectWizard /></ProtectedRoute>} />
            
            <Route path="/solution-provider-portal" element={<ProtectedRoute><SolutionProviderPortal /></ProtectedRoute>} />
            <Route path="/configuration" element={<ProtectedRoute><Configuration /></ProtectedRoute>} />
            <Route path="/logs" element={<ProtectedRoute><Logs /></ProtectedRoute>} />
            <Route path="/workbench" element={<ProtectedRoute><InternalWorkbench /></ProtectedRoute>} />
            <Route path="/workbench/project/:projectId" element={<ProtectedRoute><WorkbenchProjectDetail /></ProtectedRoute>} />
            <Route path="/project/:projectId/mitigation-plan" element={<ProtectedRoute><WaterMitigationPlan /></ProtectedRoute>} />
            <Route path="/project/:projectId/proposal-editor" element={<ProtectedRoute><ProposalEditor /></ProtectedRoute>} />

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
              <Route path="users" element={<UserManagement />} />
              <Route path="controls" element={<Controls />} />
              <Route path="project/:id" element={<ProjectWizard />} />
              <Route path="workbench/project/:projectId" element={<WorkbenchProjectDetail />} />
              <Route path="project/:projectId/mitigation-plan" element={<WaterMitigationPlan />} />
              <Route path="project/:projectId/proposal-editor" element={<ProposalEditor />} />
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
