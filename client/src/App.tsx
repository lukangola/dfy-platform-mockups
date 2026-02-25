import { Toaster } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import NotFound from "@/pages/NotFound";
import { Route, Switch } from "wouter";
import ErrorBoundary from "./components/ErrorBoundary";
import { ThemeProvider } from "./contexts/ThemeContext";
import Home from "./pages/Home";
import BrandDashboard from "./pages/BrandDashboard";
import ConceptA from "./pages/ConceptA";
import ConceptB from "./pages/ConceptB";
import ConceptC from "./pages/ConceptC";

function Router() {
  return (
    <Switch>
      <Route path={"/"} component={Home} />
      <Route path={"/dashboard/:brandId"} component={BrandDashboard} />
      <Route path={"/concept-a"} component={ConceptA} />
      <Route path={"/concept-b"} component={ConceptB} />
      <Route path={"/concept-c"} component={ConceptC} />
      <Route path={"/404"} component={NotFound} />
      <Route component={NotFound} />
    </Switch>
  );
}

function App() {
  return (
    <ErrorBoundary>
      <ThemeProvider defaultTheme="light">
        <TooltipProvider>
          <Toaster />
          <Router />
        </TooltipProvider>
      </ThemeProvider>
    </ErrorBoundary>
  );
}

export default App;
