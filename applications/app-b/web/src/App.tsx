import {
  Alert,
  Badge,
  Button,
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  Separator,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@sso/ui";
import { LogIn, LogOut, RefreshCw, ShieldCheck, UserRound } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { apiJson } from "./lib/api.js";

type SessionResponse =
  | { status: "anonymous" }
  | {
      status: "authenticated";
      user: {
        name: string;
        email: string;
        groups: string[];
      };
      session: {
        status: "active";
        createdAt: string;
        expiresAt: string;
      };
    };

type AuthPhase =
  | "checking"
  | "redirecting"
  | "authenticated"
  | "signed-out"
  | "error";

const signedOutStorageKey = "app-b:local-signed-out";

export function nextAuthPhase(
  currentPhase: AuthPhase,
  sessionStatus: SessionResponse["status"],
  signedOutWasStored = false,
): AuthPhase {
  if (sessionStatus === "authenticated") {
    return "authenticated";
  }

  if (currentPhase === "signed-out" || signedOutWasStored) {
    return "signed-out";
  }

  return "redirecting";
}

function errorMessage(error: unknown) {
  if (
    typeof error === "object" &&
    error !== null &&
    "error" in error &&
    typeof error.error === "object" &&
    error.error !== null &&
    "message" in error.error
  ) {
    return String(error.error.message);
  }

  return "Request gagal diproses";
}

export function App() {
  const [session, setSession] = useState<SessionResponse>({ status: "anonymous" });
  const [phase, setPhase] = useState<AuthPhase>("checking");
  const [error, setError] = useState<string | null>(null);
  const automaticLoginStarted = useRef(false);

  async function loadSession() {
    setPhase("checking");
    setError(null);
    try {
      const loadedSession = await apiJson<SessionResponse>("/session");
      const nextPhase = nextAuthPhase(
        phase,
        loadedSession.status,
        sessionStorage.getItem(signedOutStorageKey) === "true",
      );

      setSession(loadedSession);
      setPhase(nextPhase);

      if (nextPhase === "authenticated") {
        sessionStorage.removeItem(signedOutStorageKey);
      }

      if (nextPhase === "redirecting" && !automaticLoginStarted.current) {
        automaticLoginStarted.current = true;
        await startLogin();
      }
    } catch (caught) {
      setError(errorMessage(caught));
      setPhase("error");
    }
  }

  async function startLogin() {
    sessionStorage.removeItem(signedOutStorageKey);
    setPhase("redirecting");
    setError(null);
    try {
      const response = await apiJson<{ redirectTo: string }>("/login/start", {
        method: "POST",
      });
      window.location.href = response.redirectTo;
    } catch (caught) {
      setError(errorMessage(caught));
      setPhase("error");
    }
  }

  async function retryLogin() {
    automaticLoginStarted.current = false;
    await loadSession();
  }

  async function logout() {
    setError(null);
    try {
      await apiJson<void>("/logout", { method: "POST" });
      sessionStorage.setItem(signedOutStorageKey, "true");
      setSession({ status: "anonymous" });
      setPhase("signed-out");
    } catch (caught) {
      setError(errorMessage(caught));
    }
  }

  useEffect(() => {
    void loadSession();
  }, []);

  if (phase !== "authenticated" || session.status !== "authenticated") {
    const isWaiting = phase === "checking" || phase === "redirecting";

    return (
      <main className="flex min-h-[100dvh] items-center justify-center px-4 py-8">
        <Card className="w-full max-w-md">
          <CardHeader>
            <Badge className="w-fit" variant="outline">App B</Badge>
            <CardTitle className="pt-3">
              {phase === "signed-out"
                ? "Signed out"
                : phase === "error"
                  ? "Unable to sign in"
                  : phase === "redirecting"
                    ? "Redirecting to SSO"
                    : "Checking session"}
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            {isWaiting ? (
              <div className="flex items-center gap-3 text-sm text-muted-foreground">
                <ShieldCheck className="h-5 w-5" />
                Please wait...
              </div>
            ) : null}
            {phase === "signed-out" ? (
              <>
                <p className="text-sm text-muted-foreground">
                  You have signed out of App B.
                </p>
                <Button className="w-full" onClick={() => void startLogin()}>
                  <LogIn className="h-4 w-4" />
                  Sign in with SSO
                </Button>
              </>
            ) : null}
            {phase === "error" ? (
              <>
                <Alert>{error ?? "Request gagal diproses"}</Alert>
                <Button className="w-full" onClick={() => void retryLogin()}>
                  <RefreshCw className="h-4 w-4" />
                  Retry
                </Button>
              </>
            ) : null}
          </CardContent>
        </Card>
      </main>
    );
  }

  return (
    <main className="mx-auto min-h-[100dvh] max-w-5xl px-4 py-8">
      <header className="flex flex-col gap-4 border-b pb-5 md:flex-row md:items-center md:justify-between">
        <div>
          <Badge variant="outline">Relying App</Badge>
          <h1 className="mt-3 text-3xl font-semibold tracking-tight">App B</h1>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" onClick={() => void loadSession()}>
            <RefreshCw className="h-4 w-4" />
            Refresh
          </Button>
          <Button variant="secondary" onClick={() => void logout()}>
            <LogOut className="h-4 w-4" />
            Local logout
          </Button>
        </div>
      </header>

      {error ? <Alert className="mt-4">{error}</Alert> : null}

      <section className="mt-6 grid gap-4 md:grid-cols-[1fr_320px]">
        <Card>
          <CardHeader>
            <CardTitle>Current user</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-4">
              <div className="flex items-center gap-3">
                <div className="rounded-md bg-primary/10 p-3 text-primary">
                  <UserRound className="h-5 w-5" />
                </div>
                <div>
                  <p className="font-medium">{session.user.name}</p>
                  <p className="text-sm text-muted-foreground">{session.user.email}</p>
                </div>
              </div>
              <div className="flex flex-wrap gap-2">
                {session.user.groups.map((group) => (
                  <Badge key={group} variant="success">{group}</Badge>
                ))}
              </div>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Local session</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="flex items-center justify-between">
              <span className="text-sm text-muted-foreground">Status</span>
              <Badge variant="success">{session.session.status}</Badge>
            </div>
            <div className="flex items-center justify-between gap-3 text-sm">
              <span className="text-muted-foreground">Created</span>
              <span>{new Date(session.session.createdAt).toLocaleString()}</span>
            </div>
            <div className="flex items-center justify-between gap-3 text-sm">
              <span className="text-muted-foreground">Expires</span>
              <span>{new Date(session.session.expiresAt).toLocaleString()}</span>
            </div>
          </CardContent>
        </Card>
      </section>

      <section className="mt-6 grid gap-4 md:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>Activity log</CardTitle>
          </CardHeader>
          <CardContent>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Event</TableHead>
                  <TableHead>Status</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                <TableRow>
                  <TableCell>local_login_success</TableCell>
                  <TableCell><Badge>recorded</Badge></TableCell>
                </TableRow>
              </TableBody>
            </Table>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Processed events</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="flex items-center gap-3 rounded-lg border p-4 text-sm text-muted-foreground">
              <ShieldCheck className="h-4 w-4" />
              Event table
            </div>
          </CardContent>
        </Card>
      </section>

      <Separator className="mt-8" />
    </main>
  );
}
