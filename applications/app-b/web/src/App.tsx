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
import { useEffect, useState } from "react";
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
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  async function loadSession() {
    setLoading(true);
    setError(null);
    try {
      setSession(await apiJson<SessionResponse>("/session"));
    } catch (caught) {
      setError(errorMessage(caught));
    } finally {
      setLoading(false);
    }
  }

  async function startLogin() {
    setError(null);
    try {
      const response = await apiJson<{ redirectTo: string }>("/login/start", {
        method: "POST",
      });
      window.location.href = response.redirectTo;
    } catch (caught) {
      setError(errorMessage(caught));
    }
  }

  async function logout() {
    setError(null);
    try {
      await apiJson<void>("/logout", { method: "POST" });
      await loadSession();
    } catch (caught) {
      setError(errorMessage(caught));
    }
  }

  useEffect(() => {
    void loadSession();
  }, []);

  const authenticated = session.status === "authenticated";

  return (
    <main className="mx-auto min-h-[100dvh] max-w-5xl px-4 py-8">
      <header className="flex flex-col gap-4 border-b pb-5 md:flex-row md:items-center md:justify-between">
        <div>
          <Badge variant="outline">Relying App</Badge>
          <h1 className="mt-3 text-3xl font-semibold tracking-tight">App B</h1>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" onClick={loadSession} disabled={loading}>
            <RefreshCw className="h-4 w-4" />
            Refresh
          </Button>
          {authenticated ? (
            <Button variant="secondary" onClick={logout}>
              <LogOut className="h-4 w-4" />
              Local logout
            </Button>
          ) : (
            <Button onClick={startLogin}>
              <LogIn className="h-4 w-4" />
              Sign in with SSO
            </Button>
          )}
        </div>
      </header>

      {error ? <Alert className="mt-4">{error}</Alert> : null}

      <section className="mt-6 grid gap-4 md:grid-cols-[1fr_320px]">
        <Card>
          <CardHeader>
            <CardTitle>Current user</CardTitle>
          </CardHeader>
          <CardContent>
            {authenticated ? (
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
            ) : (
              <div className="rounded-lg border border-dashed p-6 text-sm text-muted-foreground">
                Belum ada local session. Klik tombol SSO untuk memulai
                authorization code flow.
              </div>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Local session</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="flex items-center justify-between">
              <span className="text-sm text-muted-foreground">Status</span>
              <Badge variant={authenticated ? "success" : "outline"}>
                {authenticated ? session.session.status : "anonymous"}
              </Badge>
            </div>
            {authenticated ? (
              <>
                <div className="flex items-center justify-between gap-3 text-sm">
                  <span className="text-muted-foreground">Created</span>
                  <span>{new Date(session.session.createdAt).toLocaleString()}</span>
                </div>
                <div className="flex items-center justify-between gap-3 text-sm">
                  <span className="text-muted-foreground">Expires</span>
                  <span>{new Date(session.session.expiresAt).toLocaleString()}</span>
                </div>
              </>
            ) : null}
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
                  <TableCell>{authenticated ? "local_login_success" : "waiting_for_login"}</TableCell>
                  <TableCell><Badge>{authenticated ? "recorded" : "empty"}</Badge></TableCell>
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
