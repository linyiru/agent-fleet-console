import { AlertTriangle } from "lucide-react";
import { lazy, Suspense, useState } from "react";
import { useFleetConsole } from "../controllers/useFleetConsole.ts";
import { AuthPrompt } from "./AuthPrompt.tsx";
import { CreateAgentModal } from "./CreateAgentModal.tsx";
import { FleetDashboard } from "./FleetDashboard.tsx";
import { SplashScreen } from "./SplashScreen.tsx";
import { Alert } from "../components/ui/alert.tsx";
import { Toaster } from "../components/ui/sonner.tsx";

const AgentDetailModal = lazy(() => import("./AgentDetailModal.tsx").then((module) => ({ default: module.AgentDetailModal })));
const SPLASH_SEEN_KEY = "hermesFleetSplashSeenDate";

function shouldSkipSplash() {
  const params = new URLSearchParams(window.location.search);
  const skip = params.get("skipSplash");
  const splash = params.get("splash");
  const demo = params.get("demo");
  return skip === "1" || skip === "true" || splash === "0" || splash === "false" || demo === "" || demo === "1" || demo === "true";
}

function todayKey() {
  return new Date().toISOString().slice(0, 10);
}

function shouldShowSplash() {
  if (shouldSkipSplash()) return false;
  const params = new URLSearchParams(window.location.search);
  if (params.get("splash") === "1" || params.get("splash") === "true") return true;
  try {
    return window.localStorage.getItem(SPLASH_SEEN_KEY) !== todayKey();
  } catch {
    return true;
  }
}

function markSplashSeenToday() {
  try {
    window.localStorage.setItem(SPLASH_SEEN_KEY, todayKey());
  } catch {
    // Local storage can be unavailable in private or restricted contexts.
  }
}

export function App() {
  const fleet = useFleetConsole();
  const [showSplash, setShowSplash] = useState(() => {
    const show = shouldShowSplash();
    if (show) markSplashSeenToday();
    return show;
  });

  if (showSplash) return <SplashScreen appReady={!fleet.loading} onDone={() => setShowSplash(false)} />;
  if (fleet.error === "Authentication required") return <AuthPrompt />;
  return (
    <div className="shell shell--no-sidebar">
      <main className="main main--split">
        {fleet.error ? (
          <Alert variant="warning" className="app-alert">
            <AlertTriangle />
            <span>{fleet.error}</span>
          </Alert>
        ) : null}
        <div className="split-layout">
          <div className="split-primary">
            <FleetDashboard
              {...fleet}
              onRefreshGlobalConfig={fleet.refreshGlobalConfig}
              onSaveCredential={fleet.saveGlobalCredential}
              onSaveProvider={fleet.saveGlobalProvider}
              onSync={fleet.syncGlobalConfig}
            />
          </div>
        </div>
        <CreateAgentModal
          open={fleet.createOpen}
          onClose={() => fleet.setCreateOpen(false)}
          onCreate={fleet.createAgent}
          fleetNodes={fleet.fleetNodes}
          globalConfig={fleet.globalConfig}
          onSaveProvider={fleet.saveGlobalProvider}
        />
        <Suspense fallback={null}>
          {fleet.detailOpen ? (
            <AgentDetailModal
              open={fleet.detailOpen}
              onClose={() => fleet.setDetailOpen(false)}
              selected={fleet.selected}
              jobs={fleet.jobs}
              instances={fleet.instances}
              pendingAction={fleet.pendingAction}
              onBackupAgent={fleet.backupAgent}
              onCaptureTemplate={fleet.captureAgentTemplate}
              onCloneAgent={fleet.cloneAgent}
              onMoveAgent={fleet.moveAgent}
              onConnectTelegram={fleet.connectTelegram}
              onRenameAgent={fleet.renameAgent}
              fleetNodes={fleet.fleetNodes}
              runAction={fleet.runAction}
              cancelJob={fleet.cancelJob}
              refresh={() => fleet.loadFleet(true)}
              openAgent={fleet.openAgent}
            />
          ) : null}
        </Suspense>
        <Toaster position="bottom-right" richColors />
      </main>
    </div>
  );
}
