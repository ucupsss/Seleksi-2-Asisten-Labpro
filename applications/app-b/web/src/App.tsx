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
      status: "expired" | "revoked";
      session: {
        status: "expired" | "revoked";
        createdAt: string;
        expiresAt: string;
      };
    }
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

interface ActivityLogEntry {
  id: string;
  eventType: string;
  message: string;
  requestId: string | null;
  correlationId: string | null;
  createdAt: string;
}

interface ProcessedEventEntry {
  eventId: string;
  eventType: string;
  result: string;
  processedAt: string;
}

const signedOutStorageKey = "app-b:local-signed-out";

export function nextAuthPhase(
  currentPhase: AuthPhase,
  sessionStatus: SessionResponse["status"],
  signedOutWasStored = false,
): AuthPhase {
  if (sessionStatus === "authenticated") {
    return "authenticated";
  }

  if (sessionStatus === "expired" || sessionStatus === "revoked") {
    return "signed-out";
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
  const [activityLogs, setActivityLogs] = useState<ActivityLogEntry[]>([]);
  const [processedEvents, setProcessedEvents] = useState<ProcessedEventEntry[]>([]);
  const automaticLoginStarted = useRef(false);

  async function loadOperationalData() {
    try {
      const [activityResponse, processedResponse] = await Promise.all([
        apiJson<{ logs: ActivityLogEntry[] }>("/activity-logs?limit=50"),
        apiJson<{ events: ProcessedEventEntry[] }>("/processed-events?limit=50"),
      ]);
      setActivityLogs(activityResponse.logs);
      setProcessedEvents(processedResponse.events);
    } catch (caught) {
      setError(errorMessage(caught));
    }
  }

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
        await loadOperationalData();
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
      setActivityLogs([]);
      setProcessedEvents([]);
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
                  {session.status === "expired"
                    ? "Your App B session has expired."
                    : session.status === "revoked"
                      ? "Your App B session was revoked by the Auth Provider."
                      : "You have signed out of App B."}
                </p>
                {session.status === "expired" || session.status === "revoked" ? (
                  <div className="rounded-md border p-3 text-xs text-muted-foreground">
                    <p>Status: {session.session.status}</p>
                    <p>Created: {new Date(session.session.createdAt).toLocaleString()}</p>
                    <p>Expires: {new Date(session.session.expiresAt).toLocaleString()}</p>
                  </div>
                ) : null}
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
                  <TableHead>Message</TableHead>
                  <TableHead>Trace</TableHead>
                  <TableHead>Time</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {activityLogs.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={4} className="text-muted-foreground">
                      No activity recorded yet.
                    </TableCell>
                  </TableRow>
                ) : activityLogs.map((log) => (
                  <TableRow key={log.id}>
                    <TableCell><Badge variant="outline">{log.eventType}</Badge></TableCell>
                    <TableCell>{log.message}</TableCell>
                    <TableCell
                      className="max-w-28 truncate font-mono text-xs"
                      title={log.correlationId ?? log.requestId ?? undefined}
                    >
                      {log.correlationId ?? log.requestId ?? "-"}
                    </TableCell>
                    <TableCell className="whitespace-nowrap text-muted-foreground">
                      {new Date(log.createdAt).toLocaleString()}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Processed events</CardTitle>
          </CardHeader>
          <CardContent>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Event ID</TableHead>
                  <TableHead>Type</TableHead>
                  <TableHead>Result</TableHead>
                  <TableHead>Time</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {processedEvents.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={4} className="text-muted-foreground">
                      No synchronization events processed yet.
                    </TableCell>
                  </TableRow>
                ) : processedEvents.map((event) => (
                  <TableRow key={event.eventId}>
                    <TableCell className="max-w-28 truncate font-mono text-xs" title={event.eventId}>
                      {event.eventId}
                    </TableCell>
                    <TableCell>{event.eventType}</TableCell>
                    <TableCell><Badge variant="success">{event.result}</Badge></TableCell>
                    <TableCell className="whitespace-nowrap text-muted-foreground">
                      {new Date(event.processedAt).toLocaleString()}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      </section>

      <Separator className="mt-8" />
    </main>
  );
}
