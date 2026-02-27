import { Toaster } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import NotFound from "@/pages/NotFound";
import { Route, Switch, Redirect } from "wouter";
import ErrorBoundary from "./components/ErrorBoundary";
import { ThemeProvider } from "./contexts/ThemeContext";
import WorkspaceLayout from "./components/WorkspaceLayout";
import ProductsPage from "./pages/workspace/ProductsPage";
import ProductDetailPage from "./pages/workspace/ProductDetailPage";
import BrandInfoPage from "./pages/workspace/BrandInfoPage";
import AppsPage from "./pages/workspace/AppsPage";
import BrollAppPage from "./pages/workspace/BrollAppPage";
import StaticAdsAppPage from "./pages/workspace/StaticAdsAppPage";
import AssetsPage from "./pages/workspace/AssetsPage";
import MessageTestingAppPage from "./pages/workspace/MessageTestingAppPage";

function Router() {
  return (
    <Switch>
      {/* Redirect root to workspace products */}
      <Route path="/">
        <Redirect to="/workspace/products" />
      </Route>

      {/* Workspace routes wrapped in layout */}
      <Route path="/workspace/products">
        <WorkspaceLayout>
          <ProductsPage />
        </WorkspaceLayout>
      </Route>

      <Route path="/workspace/products/:id">
        {(params) => (
          <WorkspaceLayout>
            <ProductDetailPage productId={params.id} />
          </WorkspaceLayout>
        )}
      </Route>

      <Route path="/workspace/brand">
        <WorkspaceLayout>
          <BrandInfoPage />
        </WorkspaceLayout>
      </Route>

      <Route path="/workspace/apps">
        <WorkspaceLayout>
          <AppsPage />
        </WorkspaceLayout>
      </Route>

      <Route path="/workspace/apps/broll">
        <WorkspaceLayout>
          <BrollAppPage />
        </WorkspaceLayout>
      </Route>

      <Route path="/workspace/apps/static-ads">
        <WorkspaceLayout>
          <StaticAdsAppPage />
        </WorkspaceLayout>
      </Route>

      <Route path="/workspace/apps/message-testing">
        <WorkspaceLayout>
          <MessageTestingAppPage />
        </WorkspaceLayout>
      </Route>

      <Route path="/workspace/assets">
        <WorkspaceLayout>
          <AssetsPage />
        </WorkspaceLayout>
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
        <TooltipProvider>
          <Toaster />
          <Router />
        </TooltipProvider>
      </ThemeProvider>
    </ErrorBoundary>
  );
}

export default App;
