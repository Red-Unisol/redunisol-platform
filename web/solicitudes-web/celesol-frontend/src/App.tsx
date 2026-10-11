import { ImpersonationBanner } from "@/modules/auth/components/impersonation-banner";
import { AppRouter } from "@/app/router";

function App() {
  return <ImpersonationBanner><AppRouter /></ImpersonationBanner>;
}

export default App;
