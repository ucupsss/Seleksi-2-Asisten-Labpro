import {
  Alert,
  Badge,
  Button,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  Input,
  Label,
  Separator,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from "@sso/ui";
import {
  Activity,
  AppWindow,
  KeyRound,
  Plus,
  RefreshCw,
  ShieldCheck,
  Trash2,
  Users,
} from "lucide-react";
import { FormEvent, useEffect, useMemo, useState } from "react";
import { getApiErrorCode, getSafeReturnTo } from "./admin-auth.js";
import { apiJson } from "./lib/api.js";

type UserStatus = "active" | "inactive";

interface User {
  id: string;
  name: string;
  email: string;
  status: UserStatus;
}

interface Group {
  id: string;
  name: string;
  description: string | null;
}

interface Application {
  id: string;
  name: string;
  clientId: string;
  status: "active" | "inactive";
  launchUrl: string | null;
  logoutNotificationUrl: string;
  redirectUris: string[];
}

interface AuditLog {
  id: string;
  eventType: string;
  result: string;
  createdAt: string;
}

interface EventLog {
  id: string;
  eventType: string;
  status: string;
  createdAt: string;
}

interface Membership {
  userId: string;
  groupId: string;
}

interface ApplicationPolicy {
  applicationId: string;
  groupId: string;
  effect: "allow";
}

interface AdministratorSession {
  id: string;
  user: {
    id: string;
    name: string;
    email: string;
    groups: string[];
  };
}

type AdminAccessState =
  | { status: "checking" }
  | { status: "authorized"; session: AdministratorSession }
  | { status: "forbidden" }
  | { status: "error"; message: string };

interface AdminState {
  users: User[];
  groups: Group[];
  applications: Application[];
  memberships: Membership[];
  policies: ApplicationPolicy[];
  auditLogs: AuditLog[];
  events: EventLog[];
}

const emptyAdminState: AdminState = {
  users: [],
  groups: [],
  applications: [],
  memberships: [],
  policies: [],
  auditLogs: [],
  events: [],
};

function getPath() {
  return window.location.pathname || "/";
}

function getReturnTo() {
  return new URLSearchParams(window.location.search).get("returnTo");
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

function MetricCard({
  title,
  value,
  icon: Icon,
}: {
  title: string;
  value: number;
  icon: typeof Users;
}) {
  return (
    <Card>
      <CardContent className="flex items-center justify-between p-5">
        <div>
          <p className="text-sm text-muted-foreground">{title}</p>
          <p className="mt-2 text-2xl font-semibold">{value}</p>
        </div>
        <div className="rounded-md bg-primary/10 p-3 text-primary">
          <Icon className="h-5 w-5" />
        </div>
      </CardContent>
    </Card>
  );
}

function LoginPage() {
  const returnTo = getSafeReturnTo(getReturnTo(), window.location.origin);
  const [email, setEmail] = useState(
    returnTo === "/admin" ? "admin@example.com" : "student@example.com",
  );
  const [password, setPassword] = useState("password123");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setLoading(true);
    setError(null);

    try {
      await apiJson<{ user: User }>("/auth/login", {
        method: "POST",
        body: JSON.stringify({ email, password }),
      });
      window.location.href = returnTo ?? "/admin";
    } catch (caught) {
      setError(errorMessage(caught));
    } finally {
      setLoading(false);
    }
  }

  return (
    <main className="mx-auto flex min-h-[100dvh] max-w-5xl items-center px-4 py-10">
      <div className="grid w-full gap-6 md:grid-cols-[1fr_420px]">
        <section className="flex flex-col justify-center">
          <Badge variant="outline" className="w-fit">
            Auth Provider
          </Badge>
          <h1 className="mt-4 max-w-xl text-4xl font-semibold tracking-tight">
            Central login for App A and App B
          </h1>
        </section>

        <Card>
          <CardHeader>
            <CardTitle>Sign in</CardTitle>
          </CardHeader>
          <CardContent>
            <form className="space-y-4" onSubmit={handleSubmit}>
              {error ? <Alert>{error}</Alert> : null}
              <div className="space-y-2">
                <Label htmlFor="email">Email</Label>
                <Input
                  id="email"
                  type="email"
                  value={email}
                  onChange={(event) => setEmail(event.target.value)}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="password">Password</Label>
                <Input
                  id="password"
                  type="password"
                  value={password}
                  onChange={(event) => setPassword(event.target.value)}
                />
              </div>
              <Button className="w-full" disabled={loading}>
                <KeyRound className="h-4 w-4" />
                {loading ? "Signing in" : "Sign in"}
              </Button>
            </form>
          </CardContent>
        </Card>
      </div>
    </main>
  );
}

function AdminPage() {
  const [access, setAccess] = useState<AdminAccessState>({
    status: "checking",
  });
  const [state, setState] = useState<AdminState>(emptyAdminState);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [userForm, setUserForm] = useState({
    name: "",
    email: "",
    password: "",
  });
  const [groupForm, setGroupForm] = useState({ name: "", description: "" });
  const [appForm, setAppForm] = useState({
    name: "",
    clientId: "",
    redirectUri: "",
    logoutNotificationUrl: "",
  });
  const [policyForm, setPolicyForm] = useState({
    applicationId: "",
    groupId: "",
  });
  const [membershipForm, setMembershipForm] = useState({
    userId: "",
    groupId: "",
  });

  const policyRows = useMemo(() => {
    return state.policies.map((policy) => ({
      ...policy,
      appName:
        state.applications.find((app) => app.id === policy.applicationId)
          ?.name ?? policy.applicationId,
      groupName:
        state.groups.find((group) => group.id === policy.groupId)?.name ??
        policy.groupId,
    }));
  }, [state.applications, state.groups, state.policies]);

  const membershipRows = useMemo(() => {
    return state.memberships.map((membership) => ({
      ...membership,
      userName:
        state.users.find((user) => user.id === membership.userId)?.name ??
        membership.userId,
      groupName:
        state.groups.find((group) => group.id === membership.groupId)?.name ??
        membership.groupId,
    }));
  }, [state.groups, state.memberships, state.users]);

  async function verifyAdministrator() {
    setAccess({ status: "checking" });
    try {
      const response = await apiJson<{ session: AdministratorSession }>(
        "/admin/session",
      );
      setAccess({ status: "authorized", session: response.session });
    } catch (caught) {
      const code = getApiErrorCode(caught);
      if (code === "UNAUTHORIZED") {
        window.location.replace("/login?returnTo=%2Fadmin");
        return;
      }
      if (code === "FORBIDDEN") {
        setAccess({ status: "forbidden" });
        return;
      }
      setAccess({ status: "error", message: errorMessage(caught) });
    }
  }

  async function loadAdminData() {
    setLoading(true);
    setError(null);
    try {
      const [users, groups, applications, memberships, policies, auditLogs, events] =
        await Promise.all([
          apiJson<{ users: User[] }>("/admin/users"),
          apiJson<{ groups: Group[] }>("/admin/groups"),
          apiJson<{ applications: Application[] }>("/admin/applications"),
          apiJson<{ memberships: Membership[] }>("/admin/memberships"),
          apiJson<{ policies: ApplicationPolicy[] }>("/admin/policies"),
          apiJson<{ auditLogs: AuditLog[] }>("/admin/audit-logs"),
          apiJson<{ events: EventLog[] }>("/admin/events"),
        ]);
      setState({
        users: users.users,
        groups: groups.groups,
        applications: applications.applications,
        memberships: memberships.memberships,
        policies: policies.policies,
        auditLogs: auditLogs.auditLogs,
        events: events.events,
      });
    } catch (caught) {
      const code = getApiErrorCode(caught);
      if (code === "UNAUTHORIZED") {
        window.location.replace("/login?returnTo=%2Fadmin");
        return;
      }
      if (code === "FORBIDDEN") {
        setAccess({ status: "forbidden" });
        return;
      }
      setError(errorMessage(caught));
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void verifyAdministrator();
  }, []);

  useEffect(() => {
    if (access.status === "authorized") {
      void loadAdminData();
    }
  }, [access.status]);

  async function createUser(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    await apiJson("/admin/users", {
      method: "POST",
      body: JSON.stringify(userForm),
    });
    setUserForm({ name: "", email: "", password: "" });
    await loadAdminData();
  }

  async function createGroup(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    await apiJson("/admin/groups", {
      method: "POST",
      body: JSON.stringify({
        name: groupForm.name,
        description: groupForm.description || null,
      }),
    });
    setGroupForm({ name: "", description: "" });
    await loadAdminData();
  }

  async function createApplication(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    await apiJson("/admin/applications", {
      method: "POST",
      body: JSON.stringify(appForm),
    });
    setAppForm({
      name: "",
      clientId: "",
      redirectUri: "",
      logoutNotificationUrl: "",
    });
    await loadAdminData();
  }

  async function createPolicy(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    await apiJson(`/admin/applications/${policyForm.applicationId}/policies`, {
      method: "POST",
      body: JSON.stringify({ groupId: policyForm.groupId }),
    });
    await loadAdminData();
  }

  async function toggleUserStatus(user: User) {
    await apiJson(`/admin/users/${user.id}`, {
      method: "PATCH",
      body: JSON.stringify({
        status: user.status === "active" ? "inactive" : "active",
      }),
    });
    await loadAdminData();
  }

  async function createMembership(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    await apiJson(`/admin/groups/${membershipForm.groupId}/users`, {
      method: "POST",
      body: JSON.stringify({ userId: membershipForm.userId }),
    });
    await loadAdminData();
  }

  async function removeMembership(membership: Membership) {
    await apiJson(
      `/admin/groups/${membership.groupId}/users/${membership.userId}`,
      { method: "DELETE" },
    );
    await loadAdminData();
  }

  async function removePolicy(policy: ApplicationPolicy) {
    await apiJson(
      `/admin/applications/${policy.applicationId}/policies/${policy.groupId}`,
      { method: "DELETE" },
    );
    await loadAdminData();
  }

  async function switchAccount() {
    await apiJson("/auth/logout", { method: "POST" });
    window.location.href = "/login?returnTo=%2Fadmin";
  }

  if (access.status === "checking") {
    return (
      <main className="flex min-h-[100dvh] items-center justify-center px-4">
        <Card className="w-full max-w-md">
          <CardHeader>
            <CardTitle>Checking administrator access</CardTitle>
            <CardDescription>
              Verifying your central session before loading the control panel.
            </CardDescription>
          </CardHeader>
        </Card>
      </main>
    );
  }

  if (access.status === "forbidden") {
    return (
      <main className="flex min-h-[100dvh] items-center justify-center px-4">
        <Card className="w-full max-w-md">
          <CardHeader>
            <Badge variant="warning" className="w-fit">Access denied</Badge>
            <CardTitle>Administrator access required</CardTitle>
            <CardDescription>
              Your account is signed in, but it is not a member of the
              administrators group.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <Button className="w-full" onClick={() => void switchAccount()}>
              Sign out and switch account
            </Button>
          </CardContent>
        </Card>
      </main>
    );
  }

  if (access.status === "error") {
    return (
      <main className="flex min-h-[100dvh] items-center justify-center px-4">
        <Card className="w-full max-w-md">
          <CardHeader>
            <CardTitle>Unable to verify access</CardTitle>
            <CardDescription>{access.message}</CardDescription>
          </CardHeader>
          <CardContent>
            <Button className="w-full" onClick={() => void verifyAdministrator()}>
              Retry
            </Button>
          </CardContent>
        </Card>
      </main>
    );
  }

  return (
    <main className="mx-auto min-h-[100dvh] max-w-7xl px-4 py-6">
      <header className="flex flex-col gap-4 border-b pb-5 md:flex-row md:items-center md:justify-between">
        <div>
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <ShieldCheck className="h-4 w-4" />
            SSO Control Panel
          </div>
          <h1 className="mt-2 text-3xl font-semibold tracking-tight">
            Auth Provider Admin
          </h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Signed in as {access.session.user.email}
          </p>
        </div>
        <Button variant="outline" onClick={loadAdminData} disabled={loading}>
          <RefreshCw className="h-4 w-4" />
          Refresh
        </Button>
      </header>

      {error ? <Alert className="mt-4">{error}</Alert> : null}

      <section className="mt-6 grid gap-4 md:grid-cols-4">
        <MetricCard title="Users" value={state.users.length} icon={Users} />
        <MetricCard title="Groups" value={state.groups.length} icon={ShieldCheck} />
        <MetricCard title="Apps" value={state.applications.length} icon={AppWindow} />
        <MetricCard title="Events" value={state.events.length} icon={Activity} />
      </section>

      <Tabs defaultValue="users" className="mt-6">
        <TabsList className="flex w-full justify-start overflow-x-auto md:w-fit">
          <TabsTrigger value="users">Users</TabsTrigger>
          <TabsTrigger value="groups">Groups</TabsTrigger>
          <TabsTrigger value="apps">Applications</TabsTrigger>
          <TabsTrigger value="policies">Policies</TabsTrigger>
          <TabsTrigger value="events">Events</TabsTrigger>
        </TabsList>

        <TabsContent value="users">
          <div className="grid gap-4 lg:grid-cols-[1fr_360px]">
            <Card>
              <CardHeader>
                <CardTitle>Users</CardTitle>
                <CardDescription>Identity records owned by Auth Provider.</CardDescription>
              </CardHeader>
              <CardContent>
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Name</TableHead>
                      <TableHead>Email</TableHead>
                      <TableHead>Status</TableHead>
                      <TableHead className="text-right">Action</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {state.users.map((user) => (
                      <TableRow key={user.id}>
                        <TableCell>{user.name}</TableCell>
                        <TableCell>{user.email}</TableCell>
                        <TableCell>
                          <Badge variant={user.status === "active" ? "success" : "warning"}>
                            {user.status}
                          </Badge>
                        </TableCell>
                        <TableCell className="text-right">
                          <Button
                            size="sm"
                            variant="outline"
                            onClick={() => void toggleUserStatus(user)}
                          >
                            {user.status === "active" ? "Deactivate" : "Activate"}
                          </Button>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </CardContent>
            </Card>
            <Card>
              <CardHeader>
                <CardTitle>Create user</CardTitle>
              </CardHeader>
              <CardContent>
                <form className="space-y-3" onSubmit={createUser}>
                  <Input placeholder="Name" value={userForm.name} onChange={(event) => setUserForm({ ...userForm, name: event.target.value })} />
                  <Input placeholder="Email" type="email" value={userForm.email} onChange={(event) => setUserForm({ ...userForm, email: event.target.value })} />
                  <Input placeholder="Password" type="password" value={userForm.password} onChange={(event) => setUserForm({ ...userForm, password: event.target.value })} />
                  <Button className="w-full">
                    <Plus className="h-4 w-4" />
                    Create user
                  </Button>
                </form>
              </CardContent>
            </Card>
          </div>
        </TabsContent>

        <TabsContent value="groups">
          <div className="grid gap-4 lg:grid-cols-2">
            <Card>
              <CardHeader>
                <CardTitle>Groups</CardTitle>
                <CardDescription>Groups are used by application policies.</CardDescription>
              </CardHeader>
              <CardContent>
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Name</TableHead>
                      <TableHead>Description</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {state.groups.map((group) => (
                      <TableRow key={group.id}>
                        <TableCell>{group.name}</TableCell>
                        <TableCell>{group.description ?? "-"}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </CardContent>
            </Card>
            <Card>
              <CardHeader>
                <CardTitle>Create group</CardTitle>
              </CardHeader>
              <CardContent>
                <form className="space-y-3" onSubmit={createGroup}>
                  <Input placeholder="app-a-users" value={groupForm.name} onChange={(event) => setGroupForm({ ...groupForm, name: event.target.value })} />
                  <Input placeholder="Description" value={groupForm.description} onChange={(event) => setGroupForm({ ...groupForm, description: event.target.value })} />
                  <Button className="w-full">
                    <Plus className="h-4 w-4" />
                    Create group
                  </Button>
                </form>
              </CardContent>
            </Card>
            <Card>
              <CardHeader>
                <CardTitle>Memberships</CardTitle>
                <CardDescription>Assign users to access groups.</CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                <form className="grid gap-3" onSubmit={createMembership}>
                  <select className="h-10 rounded-md border border-input bg-background px-3 text-sm" value={membershipForm.userId} onChange={(event) => setMembershipForm({ ...membershipForm, userId: event.target.value })}>
                    <option value="">Select user</option>
                    {state.users.map((user) => <option key={user.id} value={user.id}>{user.name}</option>)}
                  </select>
                  <select className="h-10 rounded-md border border-input bg-background px-3 text-sm" value={membershipForm.groupId} onChange={(event) => setMembershipForm({ ...membershipForm, groupId: event.target.value })}>
                    <option value="">Select group</option>
                    {state.groups.map((group) => <option key={group.id} value={group.id}>{group.name}</option>)}
                  </select>
                  <Button disabled={!membershipForm.userId || !membershipForm.groupId}>
                    <Plus className="h-4 w-4" /> Add membership
                  </Button>
                </form>
                <Table>
                  <TableHeader><TableRow><TableHead>User</TableHead><TableHead>Group</TableHead><TableHead /></TableRow></TableHeader>
                  <TableBody>
                    {membershipRows.map((membership) => (
                      <TableRow key={`${membership.userId}-${membership.groupId}`}>
                        <TableCell>{membership.userName}</TableCell>
                        <TableCell>{membership.groupName}</TableCell>
                        <TableCell className="text-right">
                          <Button size="sm" variant="ghost" aria-label="Remove membership" onClick={() => void removeMembership(membership)}><Trash2 className="h-4 w-4" /></Button>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </CardContent>
            </Card>
          </div>
        </TabsContent>

        <TabsContent value="apps">
          <div className="grid gap-4 lg:grid-cols-[1fr_420px]">
            <Card>
              <CardHeader>
                <CardTitle>Applications</CardTitle>
                <CardDescription>Relying apps registered for OAuth code flow.</CardDescription>
              </CardHeader>
              <CardContent>
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Name</TableHead>
                      <TableHead>Client ID</TableHead>
                      <TableHead>Redirect URI</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {state.applications.map((application) => (
                      <TableRow key={application.id}>
                        <TableCell>{application.name}</TableCell>
                        <TableCell>{application.clientId}</TableCell>
                        <TableCell>{application.redirectUris[0] ?? "-"}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </CardContent>
            </Card>
            <Card>
              <CardHeader>
                <CardTitle>Create application</CardTitle>
              </CardHeader>
              <CardContent>
                <form className="space-y-3" onSubmit={createApplication}>
                  <Input placeholder="App A" value={appForm.name} onChange={(event) => setAppForm({ ...appForm, name: event.target.value })} />
                  <Input placeholder="app-a-client" value={appForm.clientId} onChange={(event) => setAppForm({ ...appForm, clientId: event.target.value })} />
                  <Input placeholder="Redirect URI" value={appForm.redirectUri} onChange={(event) => setAppForm({ ...appForm, redirectUri: event.target.value })} />
                  <Input placeholder="Logout notification URL" value={appForm.logoutNotificationUrl} onChange={(event) => setAppForm({ ...appForm, logoutNotificationUrl: event.target.value })} />
                  <Button className="w-full">
                    <Plus className="h-4 w-4" />
                    Register app
                  </Button>
                </form>
              </CardContent>
            </Card>
          </div>
        </TabsContent>

        <TabsContent value="policies">
          <div className="grid gap-4 lg:grid-cols-[1fr_360px]">
            <Card>
              <CardHeader>
                <CardTitle>Policies</CardTitle>
                <CardDescription>Allow a group to access an application.</CardDescription>
              </CardHeader>
              <CardContent>
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Application</TableHead>
                      <TableHead>Group</TableHead>
                      <TableHead>Effect</TableHead>
                      <TableHead className="text-right">Action</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {policyRows.length ? (
                      policyRows.map((row) => (
                        <TableRow key={`${row.applicationId}-${row.groupId}`}>
                          <TableCell>{row.appName}</TableCell>
                          <TableCell>{row.groupName}</TableCell>
                          <TableCell><Badge variant="success">allow</Badge></TableCell>
                          <TableCell className="text-right">
                            <Button size="sm" variant="ghost" aria-label="Remove policy" onClick={() => void removePolicy(row)}><Trash2 className="h-4 w-4" /></Button>
                          </TableCell>
                        </TableRow>
                      ))
                    ) : (
                      <TableRow>
                        <TableCell colSpan={4} className="text-muted-foreground">
                          No allow policies configured.
                        </TableCell>
                      </TableRow>
                    )}
                  </TableBody>
                </Table>
              </CardContent>
            </Card>
            <Card>
              <CardHeader>
                <CardTitle>Create policy</CardTitle>
              </CardHeader>
              <CardContent>
                <form className="space-y-3" onSubmit={createPolicy}>
                  <select className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm" value={policyForm.applicationId} onChange={(event) => setPolicyForm({ ...policyForm, applicationId: event.target.value })}>
                    <option value="">Select application</option>
                    {state.applications.map((application) => (
                      <option key={application.id} value={application.id}>{application.name}</option>
                    ))}
                  </select>
                  <select className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm" value={policyForm.groupId} onChange={(event) => setPolicyForm({ ...policyForm, groupId: event.target.value })}>
                    <option value="">Select group</option>
                    {state.groups.map((group) => (
                      <option key={group.id} value={group.id}>{group.name}</option>
                    ))}
                  </select>
                  <Button className="w-full" disabled={!policyForm.applicationId || !policyForm.groupId}>
                    <Plus className="h-4 w-4" />
                    Create allow policy
                  </Button>
                </form>
              </CardContent>
            </Card>
          </div>
        </TabsContent>

        <TabsContent value="events">
          <div className="grid gap-4 lg:grid-cols-2">
            <Card>
              <CardHeader>
                <CardTitle>Events</CardTitle>
                <CardDescription>Outbox status for SSO logout propagation.</CardDescription>
              </CardHeader>
              <CardContent>
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Type</TableHead>
                      <TableHead>Status</TableHead>
                      <TableHead>Created</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {state.events.map((event) => (
                      <TableRow key={event.id}>
                        <TableCell>{event.eventType}</TableCell>
                        <TableCell><Badge>{event.status}</Badge></TableCell>
                        <TableCell>{new Date(event.createdAt).toLocaleString()}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </CardContent>
            </Card>
            <Card>
              <CardHeader>
                <CardTitle>Audit logs</CardTitle>
                <CardDescription>Operator-visible server activity.</CardDescription>
              </CardHeader>
              <CardContent>
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Event</TableHead>
                      <TableHead>Result</TableHead>
                      <TableHead>Created</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {state.auditLogs.map((log) => (
                      <TableRow key={log.id}>
                        <TableCell>{log.eventType}</TableCell>
                        <TableCell>{log.result}</TableCell>
                        <TableCell>{new Date(log.createdAt).toLocaleString()}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </CardContent>
            </Card>
          </div>
        </TabsContent>
      </Tabs>
      <Separator className="mt-8" />
    </main>
  );
}

export function App() {
  const path = getPath();

  if (path === "/login" || path === "/") {
    return <LoginPage />;
  }

  return <AdminPage />;
}
