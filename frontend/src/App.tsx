/**
 * Route table. Pages are code-split with React.lazy; the shell (sidebar, top bar, palette) stays
 * mounted while a page chunk loads.
 */
import { lazy } from "react";
import { createBrowserRouter, RouterProvider, type RouteObject } from "react-router-dom";
import { AppShell } from "@/components/layout/AppShell";

const Overview = lazy(() => import("@/pages/Overview"));
const SignalExplorer = lazy(() => import("@/pages/SignalExplorer"));
const TransitAnalysis = lazy(() => import("@/pages/TransitAnalysis"));
const PlanetDetection = lazy(() => import("@/pages/PlanetDetection"));
const CandidateExplorer = lazy(() => import("@/pages/CandidateExplorer"));
const PredictionHistory = lazy(() => import("@/pages/PredictionHistory"));
const DatasetExplorer = lazy(() => import("@/pages/DatasetExplorer"));
const ModelTraining = lazy(() => import("@/pages/ModelTraining"));
const ModelEvaluation = lazy(() => import("@/pages/ModelEvaluation"));
const Experiments = lazy(() => import("@/pages/Experiments"));
const ResearchDocs = lazy(() => import("@/pages/ResearchDocs"));
const Settings = lazy(() => import("@/pages/Settings"));
const TargetDossier = lazy(() => import("@/pages/TargetDossier"));
const DesignSystem = lazy(() => import("@/pages/DesignSystem"));
const NotFound = lazy(() => import("@/pages/NotFound"));

export const routes: RouteObject[] = [
  {
    element: <AppShell />,
    children: [
      { path: "/", element: <Overview /> },
      { path: "/signals", element: <SignalExplorer /> },
      { path: "/transit", element: <TransitAnalysis /> },
      { path: "/detect", element: <PlanetDetection /> },
      { path: "/candidates", element: <CandidateExplorer /> },
      { path: "/predictions", element: <PredictionHistory /> },
      { path: "/datasets", element: <DatasetExplorer /> },
      { path: "/training", element: <ModelTraining /> },
      { path: "/evaluation", element: <ModelEvaluation /> },
      { path: "/experiments", element: <Experiments /> },
      { path: "/docs", element: <ResearchDocs /> },
      { path: "/settings", element: <Settings /> },
      { path: "/targets/:kepid", element: <TargetDossier /> },
      { path: "/design", element: <DesignSystem /> },
      { path: "*", element: <NotFound /> },
    ],
  },
];

const router = createBrowserRouter(routes, {
  future: { v7_relativeSplatPath: true, v7_fetcherPersist: true, v7_normalizeFormMethod: true, v7_partialHydration: true, v7_skipActionErrorRevalidation: true },
});

export default function App() {
  return <RouterProvider router={router} future={{ v7_startTransition: true }} />;
}
