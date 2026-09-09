import { AppShell } from "./app-shell";

// The root is the full viewport delegation app: no page scroll, the panel owns
// 100dvh minus the header, and there is no footer for the same reason Xovi's
// home hides its own. All logic lives in <AppShell>.
export default function Page() {
  return <AppShell />;
}
