import { Toaster } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import NotFound from "@/pages/NotFound";
import { Route, Switch, Redirect, useLocation } from "wouter";
import { useEffect } from "react";
import { Loader2 } from "lucide-react";
import ErrorBoundary from "./components/ErrorBoundary";
import { AuthProvider, useAuth } from "./contexts/AuthContext";
import { BrandProvider } from "./contexts/BrandContext";
import { ThemeProvider } from "./contexts/ThemeContext";
import WorkspaceLayout from "./components/WorkspaceLayout";
import ProductsPage from "./pages/workspace/ProductsPage";
import ProductDetailPage from "./pages/workspace/ProductDetailPage";
import BrandInfoPage from "./pages/workspace/BrandInfoPage";
import AppsPage from "./pages/workspace/AppsPage";
import BrollAppPage from "./pages/workspace/BrollAppPage";
import CharacterBrollAppPage from "./pages/workspace/CharacterBrollAppPage";
import SingleSceneAppPage from "./pages/workspace/SingleSceneAppPage";
import StaticAdsAppPage from "./pages/workspace/StaticAdsAppPage";
import StaticAdsIterationsAppPage from "./pages/workspace/StaticAdsIterationsAppPage";
import AssetsPage from "./pages/workspace/AssetsPage";
import MessageTestingAppPage from "./pages/workspace/MessageTestingAppPage";
import CopyEngineAppPage from "./pages/workspace/CopyEngineAppPage";
import WorkflowsPage from "./pages/workspace/WorkflowsPage";
import DFYWorkflowPage from "./pages/workspace/DFYWorkflowPage";
import SettingsPage from "./pages/workspace/SettingsPage";
import { AcceptInvitePage, LoginPage, RegisterPage } from "./pages/AuthPages";

/**
 * Gates the workspace behind authentication. While loading the initial /me
 * request we render a small spinner; if the user isn't signed in we
 * redirect to /login. Mounting BrandProvider inside this gate guarantees
 * the brand-fetch only fires for authenticated users — saves spurious 401s
 * in the network tab and prevents the BrandSwitcher flashing empty state
 * during the auth check.
 */
function RequireAuth({ children }: { children: React.ReactNode }) {
  const { user, loading } = useAuth();
  const [, navigate] = useLocation();

  useEffect(() => {
    if (!loading && !user) navigate("/login", { replace: true });
  }, [loading, user, navigate]);

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center" style={{ background: "#0A0B0E", color: "#E2E8F0" }}>
        <div className="flex items-center gap-2 text-white/40 font-mono text-sm">
          <Loader2 size={14} className="animate-spin" /> Loading workspace...
        </div>
      </div>
    );
  }
  if (!user) return null; // navigate effect will fire — render nothing in the meantime
  return <BrandProvider>{children}</BrandProvider>;
}

function Router() {
  return (
    <Switch>
      {/* Public auth routes — outside the auth gate */}
      <Route path="/login" component={LoginPage} />
      <Route path="/register" component={RegisterPage} />
      <Route path="/accept-invite" component={AcceptInvitePage} />

      {/* Redirect root to workspace products */}
      <Route path="/">
        <Redirect to="/workspace/products" />
      </Route>

      {/* Workspace routes — gated. RequireAuth also mounts BrandProvider. */}
      <Route path="/workspace/products">
        <RequireAuth><WorkspaceLayout><ProductsPage /></WorkspaceLayout></RequireAuth>
      </Route>

      <Route path="/workspace/products/:id">
        {(params) => (
          <RequireAuth><WorkspaceLayout><ProductDetailPage productId={params.id} /></WorkspaceLayout></RequireAuth>
        )}
      </Route>

      <Route path="/workspace/brand">
        <RequireAuth><WorkspaceLayout><BrandInfoPage /></WorkspaceLayout></RequireAuth>
      </Route>

      <Route path="/workspace/apps">
        <RequireAuth><WorkspaceLayout><AppsPage /></WorkspaceLayout></RequireAuth>
      </Route>

      <Route path="/workspace/apps/broll">
        <RequireAuth><WorkspaceLayout><BrollAppPage /></WorkspaceLayout></RequireAuth>
      </Route>

      <Route path="/workspace/apps/character-broll">
        <RequireAuth><WorkspaceLayout><CharacterBrollAppPage /></WorkspaceLayout></RequireAuth>
      </Route>

      <Route path="/workspace/apps/single-scene">
        <RequireAuth><WorkspaceLayout><SingleSceneAppPage /></WorkspaceLayout></RequireAuth>
      </Route>

      <Route path="/workspace/apps/static-ads">
        <RequireAuth><WorkspaceLayout><StaticAdsAppPage /></WorkspaceLayout></RequireAuth>
      </Route>

      <Route path="/workspace/apps/static-ads-iterations">
        <RequireAuth><WorkspaceLayout><StaticAdsIterationsAppPage /></WorkspaceLayout></RequireAuth>
      </Route>

      <Route path="/workspace/apps/message-testing">
        <RequireAuth><WorkspaceLayout><MessageTestingAppPage /></WorkspaceLayout></RequireAuth>
      </Route>

      <Route path="/workspace/apps/copy-engine">
        <RequireAuth><WorkspaceLayout><CopyEngineAppPage /></WorkspaceLayout></RequireAuth>
      </Route>

      <Route path="/workspace/assets">
        <RequireAuth><WorkspaceLayout><AssetsPage /></WorkspaceLayout></RequireAuth>
      </Route>

      <Route path="/workspace/workflows">
        <RequireAuth><WorkspaceLayout><WorkflowsPage /></WorkspaceLayout></RequireAuth>
      </Route>

      <Route path="/workspace/workflows/dfy">
        <RequireAuth><WorkspaceLayout><DFYWorkflowPage /></WorkspaceLayout></RequireAuth>
      </Route>

      <Route path="/workspace/settings">
        <RequireAuth><WorkspaceLayout><SettingsPage /></WorkspaceLayout></RequireAuth>
      </Route>

      <Route path={"/404"} component={NotFound} />
      <Route component={NotFound} />
    </Switch>
  );
}

function App() {
  return (
    <ErrorBoundary>
      <ThemeProvider defaultTheme="dark">
        <AuthProvider>
          <TooltipProvider>
            <Toaster />
            <Router />
          </TooltipProvider>
        </AuthProvider>
      </ThemeProvider>
    </ErrorBoundary>
  );
}

export default App;
